import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

/**
 * AST-based regression guard: every `supabase.from("justice_cases").update(...)` call site in the
 * app must either carry a real case_version CAS filter (`.eq("case_version", ...)`, chained
 * directly or attached to the same query-builder variable in a later statement, as in
 * api/justice/cases/[id]/route.ts) or a narrow at-most-once `.is("<col>", null)` guard — or be a
 * reviewed exception in REVIEWED_EXCEPTIONS.
 *
 * This replaces an earlier regex/text-window scanner that a release audit proved could be defeated
 * by a misleading trailing comment, incidental whitespace before `(`, or extracting the table name
 * into a local constant — none of which change what the code actually does. Working from the real
 * parsed AST instead of source text closes all three: comments are never part of the syntax tree,
 * whitespace/formatting is irrelevant to node identity, and identifiers are resolved back to their
 * string-literal initializer within the same file. It also resolves query-builder aliases (the
 * object a chain is built on assigned to a variable and continued later) and is immune to "helper
 * extraction" (moving the write into a differently-named function) by construction, since every
 * `.update(...)` call site in the file is visited regardless of which function contains it.
 *
 * Known limitation (documented, not silently assumed away): resolution is same-file only. A write
 * reached only through a cross-file factory (e.g. `getCasesQuery(supabase).update(patch)` where
 * `getCasesQuery` is defined in another module and itself calls `.from("justice_cases")`) would not
 * be traced. No such pattern exists anywhere in this codebase today (every `.from("justice_cases")`
 * call is written inline at its use site) — if one is introduced, extend the resolver rather than
 * treat this comment as a substitute for doing so.
 */

const TARGET_TABLE = "justice_cases";

/** Files with a write that is deliberately NOT case_version-CAS-guarded, because it uses a
 * narrower, equally-real, tested compare-and-swap on the exact single field it changes (an
 * `.is("<col>", null)` at-most-once filter), verified by a real permission/behavior test in that
 * file's own test suite. Keep this list short and specific — one relative path per reviewed write. */
export const REVIEWED_EXCEPTIONS: ReadonlySet<string> = new Set([
  // .is("client_state->approved_next_action", null) — narrow CAS on the exact field this
  // best-effort follow-up writes; the authoritative cancellation already committed atomically via
  // the cancel_operator_fulfillment_task RPC. See cancelOperatorFulfillmentTask.test.ts: "does not
  // overwrite a concurrently-set approved_next_action".
  "lib/justice/cancelOperatorFulfillmentTask.ts",
  // .is("orphan_recovery_confirmed_at", null) — at-most-once marker write, best-effort, never
  // touches intake/client_state.
  "lib/justice/finalizePaidPreparedPacketApproval.ts",
  // .is("archived_at", null) — at-most-once transition, re-reads and reports idempotently on a
  // CAS miss rather than retrying with a stale timestamp.
  "lib/justice/operatorOwnedCaseArchive.ts",
  // .is("paid_at", null) — at-most-once transition guarding against a redelivered Stripe webhook.
  "lib/stripe/processStripeCheckoutCompletedEvent.ts",
]);

export type JusticeCasesUpdateFinding = {
  file: string;
  line: number;
  snippet: string;
};

/** Resolve a string literal, following same-file `const`/`let` identifier bindings a bounded
 * number of hops so `const T = "justice_cases"; .from(T)` resolves exactly like the inline literal. */
function resolveStringLiteral(
  expr: ts.Expression,
  stringLocals: ReadonlyMap<string, ts.Expression>,
  depth = 0
): string | null {
  if (depth > 6) return null;
  if (ts.isParenthesizedExpression(expr)) return resolveStringLiteral(expr.expression, stringLocals, depth + 1);
  if (ts.isStringLiteralLike(expr)) return expr.text;
  if (ts.isIdentifier(expr)) {
    const init = stringLocals.get(expr.text);
    if (init) return resolveStringLiteral(init, stringLocals, depth + 1);
  }
  return null;
}

/** True when `expr`'s call chain (following same-file identifier aliases of the query-builder
 * object itself, not just the table-name string) ultimately roots at `.from("justice_cases")`. */
function resolvesToJusticeCasesFrom(
  expr: ts.Expression,
  stringLocals: ReadonlyMap<string, ts.Expression>,
  builderLocals: ReadonlyMap<string, ts.Expression>,
  depth = 0
): boolean {
  if (depth > 12) return false;
  if (ts.isParenthesizedExpression(expr)) {
    return resolvesToJusticeCasesFrom(expr.expression, stringLocals, builderLocals, depth + 1);
  }
  if (ts.isAwaitExpression(expr)) {
    return resolvesToJusticeCasesFrom(expr.expression, stringLocals, builderLocals, depth + 1);
  }
  if (ts.isCallExpression(expr)) {
    const callee = expr.expression;
    if (ts.isPropertyAccessExpression(callee)) {
      if (callee.name.text === "from" && expr.arguments.length > 0) {
        const table = resolveStringLiteral(expr.arguments[0], stringLocals);
        if (table === TARGET_TABLE) return true;
      }
      return resolvesToJusticeCasesFrom(callee.expression, stringLocals, builderLocals, depth + 1);
    }
    return false;
  }
  if (ts.isIdentifier(expr)) {
    const init = builderLocals.get(expr.text);
    if (init) return resolvesToJusticeCasesFrom(init, stringLocals, builderLocals, depth + 1);
  }
  return false;
}

/** A `.eq("case_version", ...)` CAS filter, or a narrow `.is("<col>", null)` at-most-once guard. */
function isGuardCall(methodName: string, args: ts.NodeArray<ts.Expression>): boolean {
  if (methodName === "eq" && args.length >= 1) {
    const key = args[0];
    if (ts.isStringLiteralLike(key) && key.text === "case_version") return true;
  }
  if (methodName === "is" && args.length >= 2) {
    const key = args[0];
    const val = args[1];
    if (
      ts.isStringLiteralLike(key) &&
      /^[a-zA-Z0-9_>./-]+$/.test(key.text) &&
      val.kind === ts.SyntaxKind.NullKeyword
    ) {
      return true;
    }
  }
  return false;
}

/** Walks a fluent chain top-down (from its outermost call inward) checking every method level
 * for a guard call — used both for the directly-chained case and for scanning a reassignment's
 * right-hand side (`updateQuery = updateQuery.eq("case_version", v)`). */
function chainContainsGuard(expr: ts.Expression, depth = 0): boolean {
  if (depth > 20) return false;
  if (ts.isParenthesizedExpression(expr)) return chainContainsGuard(expr.expression, depth + 1);
  if (ts.isAwaitExpression(expr)) return chainContainsGuard(expr.expression, depth + 1);
  if (ts.isCallExpression(expr)) {
    const callee = expr.expression;
    if (ts.isPropertyAccessExpression(callee)) {
      if (isGuardCall(callee.name.text, expr.arguments)) return true;
      return chainContainsGuard(callee.expression, depth + 1);
    }
  }
  return false;
}

function findEnclosingScope(node: ts.Node, sourceFile: ts.SourceFile): ts.Node {
  const fn = ts.findAncestor(
    node,
    (n): n is ts.FunctionLikeDeclaration =>
      ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n) || ts.isMethodDeclaration(n)
  );
  return fn ?? sourceFile;
}

/** True if `bindingName` is re-assigned (or re-declared) anywhere in `scope` with a chain that
 * contains a guard call — the split-across-statements pattern real production code uses, e.g.
 * `let q = X.update(patch).eq("id", id); if (cond) q = q.eq("case_version", v);`. */
function scopeHasGuardedReassignment(scope: ts.Node, bindingName: string): boolean {
  let found = false;
  const visit = (n: ts.Node) => {
    if (found) return;
    if (
      ts.isBinaryExpression(n) &&
      n.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(n.left) &&
      n.left.text === bindingName &&
      chainContainsGuard(n.right)
    ) {
      found = true;
      return;
    }
    if (
      ts.isVariableDeclaration(n) &&
      ts.isIdentifier(n.name) &&
      n.name.text === bindingName &&
      n.initializer &&
      chainContainsGuard(n.initializer)
    ) {
      found = true;
      return;
    }
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(scope, visit);
  return found;
}

/** Walks up from an `.update(...)` call through its own fluent chain (`.update(p).eq(...).select(...)`),
 * checking each level for a guard, and returns the outermost node of that same-statement chain so the
 * caller can find its binding name for reassignment tracking. */
function walkUpChain(update: ts.CallExpression): { guardedInline: boolean; outer: ts.Node } {
  let current: ts.Node = update;
  let guardedInline = false;
  for (;;) {
    const parent: ts.Node | undefined = current.parent;
    if (parent && ts.isPropertyAccessExpression(parent) && parent.expression === current) {
      const grand: ts.Node | undefined = parent.parent;
      if (grand && ts.isCallExpression(grand) && grand.expression === parent) {
        if (isGuardCall(parent.name.text, grand.arguments)) guardedInline = true;
        current = grand;
        continue;
      }
    }
    break;
  }
  return { guardedInline, outer: current };
}

/** Binding name this chain's outermost call feeds into, via `let x = <chain>` or `x = <chain>`. */
function bindingNameOf(outer: ts.Node): string | null {
  let node: ts.Node = outer;
  if (ts.isAwaitExpression(node.parent ?? node)) node = node.parent;
  const parent = node.parent;
  if (!parent) return null;
  if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name) && parent.initializer === node) {
    return parent.name.text;
  }
  if (
    ts.isBinaryExpression(parent) &&
    parent.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    ts.isIdentifier(parent.left) &&
    parent.right === node
  ) {
    return parent.left.text;
  }
  return null;
}

/** Collects same-file `const`/`let` string-literal bindings and query-builder-chain bindings in a
 * single flat, whole-file pass — deliberately not scope-precise: an over-inclusive match can only
 * make this guard MORE likely to flag/scan a site, never less, which is the safe direction for a
 * regression guard (false positives cost a human a look; false negatives cost a silent bypass). */
function collectLocals(sourceFile: ts.SourceFile): {
  stringLocals: Map<string, ts.Expression>;
  builderLocals: Map<string, ts.Expression>;
} {
  const stringLocals = new Map<string, ts.Expression>();
  const builderLocals = new Map<string, ts.Expression>();
  const visit = (n: ts.Node) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
      const init = n.initializer;
      if (ts.isStringLiteralLike(init)) stringLocals.set(n.name.text, init);
      builderLocals.set(n.name.text, init);
    }
    ts.forEachChild(n, visit);
  };
  visit(sourceFile);
  return { stringLocals, builderLocals };
}

function lineOf(sourceFile: ts.SourceFile, pos: number): number {
  return sourceFile.getLineAndCharacterOfPosition(pos).line + 1;
}

function snippetAt(content: string, pos: number): string {
  const lineStart = content.lastIndexOf("\n", pos) + 1;
  const lineEnd = content.indexOf("\n", pos);
  return content.slice(lineStart, lineEnd === -1 ? undefined : lineEnd).trim();
}

/**
 * Scans one file's already-read source text for unguarded `justice_cases` update call sites.
 * Exported standalone (not file-system-coupled) so bypass/regression tests can exercise it directly
 * against inline source snippets, the same way the real scanner exercises it against src/.
 */
export function findUnguardedJusticeCasesWritesInSource(
  content: string,
  relPath: string,
  options: { skipReviewedExceptions?: boolean } = {}
): JusticeCasesUpdateFinding[] {
  const findings: JusticeCasesUpdateFinding[] = [];
  const skipExceptions = options.skipReviewedExceptions ?? true;
  if (skipExceptions && REVIEWED_EXCEPTIONS.has(relPath)) return findings;

  const sourceFile = ts.createSourceFile(relPath, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const { stringLocals, builderLocals } = collectLocals(sourceFile);

  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n)) {
      const callee = n.expression;
      if (ts.isPropertyAccessExpression(callee) && callee.name.text === "update") {
        if (resolvesToJusticeCasesFrom(callee.expression, stringLocals, builderLocals)) {
          const { guardedInline, outer } = walkUpChain(n);
          let guarded = guardedInline;
          if (!guarded) {
            const bindingName = bindingNameOf(outer);
            if (bindingName) {
              const scope = findEnclosingScope(n, sourceFile);
              guarded = scopeHasGuardedReassignment(scope, bindingName);
            }
          }
          if (!guarded) {
            findings.push({
              file: relPath,
              line: lineOf(sourceFile, n.getStart(sourceFile)),
              snippet: snippetAt(content, n.getStart(sourceFile)),
            });
          }
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sourceFile);
  return findings;
}

/** Whether `content` contains at least one justice_cases update call site at all (guarded or not) —
 * used to keep REVIEWED_EXCEPTIONS honest (each entry must still name a file with a real write). */
export function sourceHasJusticeCasesUpdate(content: string, relPath: string): boolean {
  const findingsIncludingGuarded = findUnguardedJusticeCasesWritesInSource(content, relPath, {
    skipReviewedExceptions: true,
  });
  if (findingsIncludingGuarded.length > 0) return true;
  // The above only reports UNGUARDED sites; a guarded site in a REVIEWED_EXCEPTIONS-eligible path
  // still needs detecting here, so re-scan bypassing the guard check entirely via a tiny local walk.
  const sourceFile = ts.createSourceFile(relPath, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const { stringLocals, builderLocals } = collectLocals(sourceFile);
  let found = false;
  const visit = (n: ts.Node) => {
    if (found) return;
    if (ts.isCallExpression(n)) {
      const callee = n.expression;
      if (
        ts.isPropertyAccessExpression(callee) &&
        callee.name.text === "update" &&
        resolvesToJusticeCasesFrom(callee.expression, stringLocals, builderLocals)
      ) {
        found = true;
        return;
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sourceFile);
  return found;
}

export const SRC_DIR = path.join(process.cwd(), "src");

export function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listSourceFiles(full));
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry.name)) continue;
    if (/\.test\.(ts|tsx)$/.test(entry.name)) continue;
    out.push(full);
  }
  return out;
}

export function findUnguardedJusticeCasesWritesInRepo(): JusticeCasesUpdateFinding[] {
  const findings: JusticeCasesUpdateFinding[] = [];
  for (const absPath of listSourceFiles(SRC_DIR)) {
    const relPath = path.relative(SRC_DIR, absPath).split(path.sep).join("/");
    const content = fs.readFileSync(absPath, "utf8");
    findings.push(...findUnguardedJusticeCasesWritesInSource(content, relPath));
  }
  return findings;
}

import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

/**
 * AST-based regression guard: every `supabase.from("justice_cases").update(...)` call site in the
 * app must either carry a real case_version CAS filter (`.eq("case_version", ...)`, chained
 * directly or attached to the same query-builder variable in a later statement, as in
 * api/justice/cases/[id]/route.ts) or be an EXACT, pinned, shape-validated entry in
 * REVIEWED_EXCEPTIONS below — never a whole-file exemption, and never a bare `.is(col, null)`
 * accepted on its own say-so.
 *
 * History: this replaced an earlier regex/text-window scanner proven bypassable by a misleading
 * trailing comment, incidental whitespace before `(`, or a table-name constant. A second-round
 * AST version fixed those but was itself proven bypassable by (a) REVIEWED_EXCEPTIONS skipping the
 * ENTIRE FILE rather than the one reviewed line — letting a second, unrelated, unguarded write in
 * the same file through for free — and (b) never even considering a destructured
 * (`const { update } = ...`) or bound/aliased (`table.update.bind(...)`) reference, since both use
 * a bare Identifier callee rather than a `.update` PropertyAccessExpression. This version:
 *   - pins every exception to an EXACT file+line, and re-validates its payload shape and guard
 *     column against the live source every run — a tampered or moved exception FAILS CLOSED
 *     (reported as a finding) rather than silently continuing to pass;
 *   - never accepts `.is(col, null)` as a general-purpose guard for an unlisted call site — only
 *     for a "narrow-is-guard" exception whose object-literal argument's key set is validated to
 *     equal exactly the approved field(s);
 *   - fails closed (always reports a finding, no exception mechanism) on any destructured
 *     (`const { update } = ...`) or non-immediately-called (bound/aliased) reference to `.update`
 *     resolving to justice_cases, since neither can be reliably traced to a guarded call site;
 *   - resolves query-builder-returning helper functions defined in the same file (e.g.
 *     `function getCasesTable(supabase) { return supabase.from("justice_cases"); }`), so an
 *     `.update(...)` chained onto a call to such a helper is scanned exactly like an inline
 *     `.from("justice_cases").update(...)` would be;
 *   - resolves query-builder aliases (the object a chain is built on assigned to a variable and
 *     continued later) and same-file table-name string constants, and is immune to "helper
 *     extraction" (moving an update into a differently-named function) by construction, since
 *     every `.update(...)` call site in the file is visited regardless of which function contains
 *     it.
 *
 * Known limitation (documented, not silently assumed away): resolution is same-file only. A write
 * reached only through a cross-FILE factory (a helper defined in a DIFFERENT module) would not be
 * traced. No such pattern exists anywhere in this codebase today — if one is introduced, extend
 * the resolver rather than treat this comment as a substitute for doing so.
 */

const TARGET_TABLE = "justice_cases";

/**
 * A write validated only by an exact `.is("<col>", null)` at-most-once filter, because the
 * update()'s object-literal argument is verified (every run) to contain ONLY `approvedFields` as
 * its top-level keys — never a general write with an incidental unrelated `.is()` tacked on.
 */
type NarrowIsGuardException = {
  kind: "narrow-is-guard";
  file: string;
  /** 1-indexed line where the `.update(` call begins — pins this exception to one exact site. */
  line: number;
  approvedFields: readonly string[];
  guardColumn: string;
  reason: string;
};

/**
 * A write validated to need no case_version/is() guard at all, because the update()'s argument at
 * this EXACT line is verified (every run) to still be the specific identifier reviewed — not an
 * object literal whose shape this checker can itself re-verify (the value is built up
 * dynamically), so this kind of exception is a narrower guarantee (line-pinned + argument-identity
 * checked) than narrow-is-guard, not a blanket "trust the comment" exemption.
 */
type NoCasRequiredException = {
  kind: "no-cas-required";
  file: string;
  line: number;
  argumentIdentifier: string;
  reason: string;
};

export type ReviewedException = NarrowIsGuardException | NoCasRequiredException;

export const REVIEWED_EXCEPTIONS: readonly ReviewedException[] = [
  {
    kind: "narrow-is-guard",
    file: "lib/justice/cancelOperatorFulfillmentTask.ts",
    line: 345,
    approvedFields: ["client_state"],
    guardColumn: "client_state->approved_next_action",
    reason:
      "Narrow CAS on the exact field this best-effort follow-up writes; the authoritative " +
      "cancellation already committed atomically via the cancel_operator_fulfillment_task RPC. " +
      'See cancelOperatorFulfillmentTask.test.ts: "does not overwrite a concurrently-set ' +
      'approved_next_action".',
  },
  {
    kind: "narrow-is-guard",
    file: "lib/justice/finalizePaidPreparedPacketApproval.ts",
    line: 180,
    approvedFields: ["orphan_recovery_confirmed_at"],
    guardColumn: "orphan_recovery_confirmed_at",
    reason: "At-most-once marker write, best-effort, never touches intake/client_state.",
  },
  {
    kind: "narrow-is-guard",
    file: "lib/justice/operatorOwnedCaseArchive.ts",
    line: 370,
    approvedFields: ["archived_at"],
    guardColumn: "archived_at",
    reason:
      "At-most-once transition, re-reads and reports idempotently on a CAS miss rather than " +
      "retrying with a stale timestamp.",
  },
  {
    kind: "narrow-is-guard",
    file: "lib/stripe/processStripeCheckoutCompletedEvent.ts",
    line: 168,
    approvedFields: ["paid_at"],
    guardColumn: "paid_at",
    reason: "At-most-once transition guarding against a redelivered Stripe webhook.",
  },
  {
    kind: "no-cas-required",
    file: "app/api/justice/cases/[id]/route.ts",
    line: 611,
    argumentIdentifier: "patch",
    reason:
      "Reached only when patch touches none of intake/client_state/archived_at — some " +
      "combination of timeline (conflict-free server-side merge via mergeCaseTimelineEntries " +
      "regardless of staleness), case_label, and payment_dispute_draft (plain last-write-wins " +
      "fields, no two-values-conflict semantics). The CAS-protected branch immediately above " +
      "handles every other case.",
  },
];

export type JusticeCasesUpdateFinding = {
  file: string;
  line: number;
  snippet: string;
  detail: string;
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
 * object itself, and same-file helper functions that return a `.from("justice_cases")` chain)
 * ultimately roots at `.from("justice_cases")`. */
function resolvesToJusticeCasesFrom(
  expr: ts.Expression,
  stringLocals: ReadonlyMap<string, ts.Expression>,
  builderLocals: ReadonlyMap<string, ts.Expression>,
  helperNames: ReadonlySet<string>,
  depth = 0
): boolean {
  if (depth > 12) return false;
  if (ts.isParenthesizedExpression(expr)) {
    return resolvesToJusticeCasesFrom(expr.expression, stringLocals, builderLocals, helperNames, depth + 1);
  }
  if (ts.isAwaitExpression(expr)) {
    return resolvesToJusticeCasesFrom(expr.expression, stringLocals, builderLocals, helperNames, depth + 1);
  }
  if (ts.isCallExpression(expr)) {
    const callee = expr.expression;
    if (ts.isPropertyAccessExpression(callee)) {
      if (callee.name.text === "from" && expr.arguments.length > 0) {
        const table = resolveStringLiteral(expr.arguments[0], stringLocals);
        if (table === TARGET_TABLE) return true;
      }
      return resolvesToJusticeCasesFrom(callee.expression, stringLocals, builderLocals, helperNames, depth + 1);
    }
    if (ts.isIdentifier(callee) && helperNames.has(callee.text)) return true;
    return false;
  }
  if (ts.isIdentifier(expr)) {
    const init = builderLocals.get(expr.text);
    if (init) return resolvesToJusticeCasesFrom(init, stringLocals, builderLocals, helperNames, depth + 1);
  }
  return false;
}

/** Only a real `.eq("case_version", ...)` CAS filter counts as a general-purpose guard — `.is()`
 * is never accepted here; it is only ever valid via a validated narrow-is-guard exception. */
function isCaseVersionGuardCall(methodName: string, args: ts.NodeArray<ts.Expression>): boolean {
  if (methodName !== "eq" || args.length < 1) return false;
  const key = args[0];
  return ts.isStringLiteralLike(key) && key.text === "case_version";
}

function isIsNullGuardCall(methodName: string, args: ts.NodeArray<ts.Expression>, column: string): boolean {
  if (methodName !== "is" || args.length < 2) return false;
  const key = args[0];
  const val = args[1];
  return ts.isStringLiteralLike(key) && key.text === column && val.kind === ts.SyntaxKind.NullKeyword;
}

/** Walks a fluent chain top-down (from its outermost call inward) checking every method level for
 * a case_version guard call — used both for the directly-chained case and for scanning a
 * reassignment's right-hand side (`updateQuery = updateQuery.eq("case_version", v)`). */
function chainContainsCaseVersionGuard(expr: ts.Expression, depth = 0): boolean {
  if (depth > 20) return false;
  if (ts.isParenthesizedExpression(expr)) return chainContainsCaseVersionGuard(expr.expression, depth + 1);
  if (ts.isAwaitExpression(expr)) return chainContainsCaseVersionGuard(expr.expression, depth + 1);
  if (ts.isCallExpression(expr)) {
    const callee = expr.expression;
    if (ts.isPropertyAccessExpression(callee)) {
      if (isCaseVersionGuardCall(callee.name.text, expr.arguments)) return true;
      return chainContainsCaseVersionGuard(callee.expression, depth + 1);
    }
  }
  return false;
}

/** Same top-down chain walk, but checks for one specific `.is(column, null)` call — used only
 * while validating a narrow-is-guard exception's exact chain, never as a general guard check. */
function chainContainsIsNullGuard(expr: ts.Expression, column: string, depth = 0): boolean {
  if (depth > 20) return false;
  if (ts.isParenthesizedExpression(expr)) return chainContainsIsNullGuard(expr.expression, column, depth + 1);
  if (ts.isAwaitExpression(expr)) return chainContainsIsNullGuard(expr.expression, column, depth + 1);
  if (ts.isCallExpression(expr)) {
    const callee = expr.expression;
    if (ts.isPropertyAccessExpression(callee)) {
      if (isIsNullGuardCall(callee.name.text, expr.arguments, column)) return true;
      return chainContainsIsNullGuard(callee.expression, column, depth + 1);
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

/** True if any ancestor of `node`, up to (but not including) `scope`, is a control-flow construct
 * that could make `node` execute on only SOME paths through `scope` — an `if`/ternary/loop/switch
 * branch. Used to reject a "guarded" reassignment that is itself conditional: reassigning `q` to a
 * guarded chain only `if (cond)` does not prove every execution path reaches a guarded write — the
 * exact shape that let a real, reviewed omission (a deliberately unguarded branch) coexist with a
 * guarded one in the same statement in a prior version of api/justice/cases/[id]/route.ts, now
 * refactored into two syntactically separate call sites specifically so this check can be sound. */
function isConditionallyReached(node: ts.Node, scope: ts.Node): boolean {
  let current: ts.Node | undefined = node.parent;
  while (current && current !== scope) {
    if (
      ts.isIfStatement(current) ||
      ts.isConditionalExpression(current) ||
      ts.isSwitchStatement(current) ||
      ts.isCaseClause(current) ||
      ts.isDefaultClause(current) ||
      ts.isForStatement(current) ||
      ts.isForInStatement(current) ||
      ts.isForOfStatement(current) ||
      ts.isWhileStatement(current) ||
      ts.isDoStatement(current) ||
      ts.isBinaryExpression(current) &&
        (current.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
          current.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
          current.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) &&
        current.right === node
    ) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

/** True if `bindingName` is re-assigned (or re-declared) UNCONDITIONALLY anywhere in `scope` with
 * a chain that contains a case_version guard call — the split-across-statements pattern real
 * production code uses, e.g.
 * `let q = X.update(patch).eq("id", id); q = q.eq("case_version", v);`.
 * A reassignment reachable only through a conditional branch does NOT count: it does not prove
 * every execution path through `scope` applies the guard before the query executes (see
 * isConditionallyReached) — the exact adversarial shape this checker must fail closed on rather
 * than treat as "guarded somewhere in this function". */
function scopeHasGuardedReassignment(scope: ts.Node, bindingName: string): boolean {
  let found = false;
  const visit = (n: ts.Node) => {
    if (found) return;
    if (
      ts.isBinaryExpression(n) &&
      n.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(n.left) &&
      n.left.text === bindingName &&
      chainContainsCaseVersionGuard(n.right) &&
      !isConditionallyReached(n, scope)
    ) {
      found = true;
      return;
    }
    if (
      ts.isVariableDeclaration(n) &&
      ts.isIdentifier(n.name) &&
      n.name.text === bindingName &&
      n.initializer &&
      chainContainsCaseVersionGuard(n.initializer) &&
      !isConditionallyReached(n, scope)
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
 * checking each level for a case_version guard, and returns the outermost node of that
 * same-statement chain so the caller can find its binding name for reassignment tracking. */
function walkUpChain(update: ts.CallExpression): { guardedInline: boolean; outer: ts.Node } {
  let current: ts.Node = update;
  let guardedInline = false;
  for (;;) {
    const parent: ts.Node | undefined = current.parent;
    if (parent && ts.isPropertyAccessExpression(parent) && parent.expression === current) {
      const grand: ts.Node | undefined = parent.parent;
      if (grand && ts.isCallExpression(grand) && grand.expression === parent) {
        if (isCaseVersionGuardCall(parent.name.text, grand.arguments)) guardedInline = true;
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

/** Same-file function declarations/expressions/arrows whose body returns an expression that
 * itself resolves to a justice_cases `.from(...)` chain — so `getCasesTable(supabase).update(...)`
 * is scanned exactly like `supabase.from("justice_cases").update(...)` would be. */
function collectJusticeCasesReturningHelperNames(
  sourceFile: ts.SourceFile,
  stringLocals: ReadonlyMap<string, ts.Expression>,
  builderLocals: ReadonlyMap<string, ts.Expression>
): Set<string> {
  const names = new Set<string>();
  const emptyHelperNames: ReadonlySet<string> = new Set();
  const bodyReturnsBuilder = (body: ts.ConciseBody | ts.Block): boolean => {
    if (!ts.isBlock(body)) {
      return resolvesToJusticeCasesFrom(body, stringLocals, builderLocals, emptyHelperNames);
    }
    let found = false;
    const scan = (n: ts.Node) => {
      if (found) return;
      if (ts.isReturnStatement(n) && n.expression) {
        if (resolvesToJusticeCasesFrom(n.expression, stringLocals, builderLocals, emptyHelperNames)) {
          found = true;
          return;
        }
      }
      ts.forEachChild(n, scan);
    };
    scan(body);
    return found;
  };
  const visit = (n: ts.Node) => {
    if (ts.isFunctionDeclaration(n) && n.name && n.body) {
      if (bodyReturnsBuilder(n.body)) names.add(n.name.text);
    } else if (
      ts.isVariableDeclaration(n) &&
      ts.isIdentifier(n.name) &&
      n.initializer &&
      (ts.isFunctionExpression(n.initializer) || ts.isArrowFunction(n.initializer))
    ) {
      if (bodyReturnsBuilder(n.initializer.body)) names.add(n.name.text);
    }
    ts.forEachChild(n, visit);
  };
  visit(sourceFile);
  return names;
}

function lineOf(sourceFile: ts.SourceFile, pos: number): number {
  return sourceFile.getLineAndCharacterOfPosition(pos).line + 1;
}

function snippetAt(content: string, pos: number): string {
  const lineStart = content.lastIndexOf("\n", pos) + 1;
  const lineEnd = content.indexOf("\n", pos);
  return content.slice(lineStart, lineEnd === -1 ? undefined : lineEnd).trim();
}

/** Object-literal top-level property names, or null if `expr` isn't (only) a plain object literal
 * with statically-readable keys (no spreads, no computed keys) — callers must fail closed on null. */
function objectLiteralKeys(expr: ts.Expression): string[] | null {
  if (!ts.isObjectLiteralExpression(expr)) return null;
  const keys: string[] = [];
  for (const prop of expr.properties) {
    if (ts.isSpreadAssignment(prop)) return null;
    const name = prop.name;
    if (!name) return null;
    if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) {
      keys.push(name.text);
    } else {
      return null; // computed property name — cannot statically verify
    }
  }
  return keys;
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const setB = new Set(b);
  return a.every((x) => setB.has(x));
}

/** Validates a matched exception against the ACTUAL call site every run — a tampered, moved, or
 * shape-changed exception fails closed (is reported as a finding), never silently continues to
 * pass just because a file+line once matched. */
function validateException(exception: ReviewedException, update: ts.CallExpression): boolean {
  const arg = update.arguments[0];
  if (exception.kind === "narrow-is-guard") {
    if (!arg) return false;
    const keys = objectLiteralKeys(arg);
    if (!keys) return false; // not a plain object literal — cannot verify the field set
    if (!sameSet(keys, exception.approvedFields)) return false;
    const { outer } = walkUpChain(update);
    if (chainContainsIsNullGuard(outer as ts.Expression, exception.guardColumn)) return true;
    // Also allow the guard attached via a later reassignment, matching the general guard's
    // split-across-statements support.
    const bindingName = bindingNameOf(outer);
    if (!bindingName) return false;
    // Reuse the enclosing-scope reassignment scan, but for the is() guard specifically.
    let found = false;
    const scope = findEnclosingScope(update, update.getSourceFile());
    const visit = (n: ts.Node) => {
      if (found) return;
      if (
        ts.isBinaryExpression(n) &&
        n.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isIdentifier(n.left) &&
        n.left.text === bindingName &&
        chainContainsIsNullGuard(n.right, exception.guardColumn)
      ) {
        found = true;
      }
      ts.forEachChild(n, visit);
    };
    ts.forEachChild(scope, visit);
    return found;
  }
  // no-cas-required
  return Boolean(arg && ts.isIdentifier(arg) && arg.text === exception.argumentIdentifier);
}

/**
 * Scans one file's already-read source text for unguarded `justice_cases` update call sites.
 * Exported standalone (not file-system-coupled) so bypass/regression tests can exercise it directly
 * against inline source snippets, the same way the real scanner exercises it against src/.
 */
export function findUnguardedJusticeCasesWritesInSource(
  content: string,
  relPath: string
): JusticeCasesUpdateFinding[] {
  const findings: JusticeCasesUpdateFinding[] = [];
  const sourceFile = ts.createSourceFile(relPath, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const { stringLocals, builderLocals } = collectLocals(sourceFile);
  const helperNames = collectJusticeCasesReturningHelperNames(sourceFile, stringLocals, builderLocals);
  const exceptionsForFile = REVIEWED_EXCEPTIONS.filter((e) => e.file === relPath);

  function pushFindingAt(pos: number, detail: string) {
    findings.push({
      file: relPath,
      line: lineOf(sourceFile, pos),
      snippet: snippetAt(content, pos),
      detail,
    });
  }

  const visit = (n: ts.Node) => {
    // Fail closed: a destructured `{ update } = <justice-cases builder>` binding can call the
    // write through a bare identifier this scanner (and any regex-based one before it) cannot
    // reliably trace to a guarded call site.
    if (ts.isVariableDeclaration(n) && n.initializer && ts.isObjectBindingPattern(n.name)) {
      const hasUpdateBinding = n.name.elements.some((el) => {
        const propName = el.propertyName ?? el.name;
        return ts.isIdentifier(propName) && propName.text === "update";
      });
      if (hasUpdateBinding && resolvesToJusticeCasesFrom(n.initializer, stringLocals, builderLocals, helperNames)) {
        pushFindingAt(n.getStart(sourceFile), "destructured `update` binding off a justice_cases query builder — cannot be traced to a guarded call site");
      }
    }
    // Fail closed: any reference to `.update` that resolves to justice_cases and is NOT
    // immediately called (bound, aliased, passed as a callback, etc.).
    if (ts.isPropertyAccessExpression(n) && n.name.text === "update") {
      const parent = n.parent;
      const isImmediatelyCalled = Boolean(parent && ts.isCallExpression(parent) && parent.expression === n);
      if (!isImmediatelyCalled && resolvesToJusticeCasesFrom(n.expression, stringLocals, builderLocals, helperNames)) {
        pushFindingAt(n.getStart(sourceFile), "`.update` referenced without being called immediately (bound/aliased) on a justice_cases query builder — cannot be traced to a guarded call site");
      }
    }
    if (ts.isCallExpression(n)) {
      const callee = n.expression;
      if (ts.isPropertyAccessExpression(callee) && callee.name.text === "update") {
        if (resolvesToJusticeCasesFrom(callee.expression, stringLocals, builderLocals, helperNames)) {
          // The `.update` NAME token's own line, not the CallExpression's overall start (which,
          // for a fluent chain, is wherever the chain's root expression begins — often several
          // lines earlier) and not the argument list's line either.
          const updateNamePos = callee.name.getStart(sourceFile);
          const line = lineOf(sourceFile, updateNamePos);
          const exception = exceptionsForFile.find((e) => e.line === line);
          if (exception) {
            if (!validateException(exception, n)) {
              pushFindingAt(
                updateNamePos,
                `REVIEWED_EXCEPTIONS entry (${exception.kind}) at ${relPath}:${line} no longer matches the call site's actual shape/guard — update the exception or fix the guard`
              );
            }
            // valid exception: not a finding
          } else {
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
              pushFindingAt(updateNamePos, "no case_version CAS guard, and no REVIEWED_EXCEPTIONS entry pinned to this exact line");
            }
          }
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sourceFile);
  return findings;
}

/** Whether `content` contains at least one justice_cases update call site at all (guarded, fail-
 * closed, or exempted) — used to keep REVIEWED_EXCEPTIONS honest (each entry must still name a
 * file that actually has an `.update(` call at the pinned line, targeting justice_cases). */
export function sourceHasJusticeCasesUpdateAtLine(content: string, relPath: string, line: number): boolean {
  const sourceFile = ts.createSourceFile(relPath, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const { stringLocals, builderLocals } = collectLocals(sourceFile);
  const helperNames = collectJusticeCasesReturningHelperNames(sourceFile, stringLocals, builderLocals);
  let found = false;
  const visit = (n: ts.Node) => {
    if (found) return;
    if (ts.isCallExpression(n)) {
      const callee = n.expression;
      if (
        ts.isPropertyAccessExpression(callee) &&
        callee.name.text === "update" &&
        lineOf(sourceFile, callee.name.getStart(sourceFile)) === line &&
        resolvesToJusticeCasesFrom(callee.expression, stringLocals, builderLocals, helperNames)
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

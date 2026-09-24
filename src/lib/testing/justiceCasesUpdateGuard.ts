import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

/**
 * AST-based regression guard: every `supabase.from("justice_cases").update(...)` call site in the
 * app must carry a real case_version CAS filter (`.eq("case_version", ...)`, chained directly or
 * attached to the same query-builder variable in a LATER, UNCONDITIONAL statement, as in
 * api/justice/cases/[id]/route.ts) — UNLESS it is an EXACT, pinned, shape-validated single-field
 * "narrow-is-guard" entry in REVIEWED_EXCEPTIONS below, whose `.is(col, null)` guard column is
 * required to be exactly the one field the write's object-literal argument touches. There is no
 * other exception mechanism: no whole-file exemption, no "no CAS required" carve-out, and no
 * general-purpose acceptance of `.is()` for an unlisted call site.
 *
 * History: round 1 (regex/text-window) was proven bypassable by a misleading trailing comment,
 * incidental whitespace, or a table-name constant. Round 2 (AST-based) fixed those but was proven
 * bypassable by REVIEWED_EXCEPTIONS exempting the entire file, `.is()` being accepted for ANY call
 * site, never considering destructured/bound references, and a guard applied on only one
 * conditional branch still counting as "guarded". Round 3 fixed the first three and added
 * path-completeness checking for reassignment-based guards, but (a) trusted a CROSS-FILE
 * query-builder-returning helper function with no way to verify it at all (same-file helpers were
 * already correctly re-verified via their own `return` statement), (b) never considered
 * computed/bracket (`obj["update"]`) access, and (c) a "no-cas-required" exception existed at all,
 * whose safety depended on a control-flow invariant (which fields could reach that branch) the
 * checker could not itself verify — proven by tampering the real route's upstream condition while
 * leaving the pinned line unchanged and the exception still validating. That route was refactored
 * to require case_version CAS unconditionally for every remaining patch shape, removing the need
 * for a "no-cas-required" exception at all, and cancelOperatorFulfillmentTask.ts was rewritten to
 * use a real case_version CAS retry loop instead of its narrow `.is()` guard, removing that
 * exception too. This version:
 *   - has exactly ONE exception kind (narrow-is-guard), each entry pinned to an EXACT file+line
 *     and re-validated against the live source every run — a tampered, moved, or reshaped
 *     exception FAILS CLOSED (reported as a finding), never silently continues to pass;
 *   - requires a narrow-is-guard's approvedField to be a SINGLE field, and guardColumn to be
 *     EXACTLY that field (not merely a JSON sub-path within it) — a write that replaces a whole
 *     object (like client_state) while only guarding one JSON key inside it can never qualify,
 *     closing the class of bug where the guard checks less than the write touches;
 *   - never accepts `.is(col, null)` as a general-purpose guard for an unlisted call site;
 *   - fails closed on destructured (`const { update } = ...`) and non-immediately-called
 *     (bound/aliased) `.update` references;
 *   - fails closed on computed/bracket access (`obj["update"](...)`, `obj[nameVar](...)`) —
 *     detected and always reported, never resolved/trusted;
 *   - fails closed on `.update(...)` called through the result of calling an identifier imported
 *     from ANOTHER FILE IN THIS PROJECT (`someImportedFactory(...).update(...)`) — a cross-file
 *     query-builder factory this checker has no way to inspect, so it is never resolved/trusted,
 *     only flagged. This is deliberately scoped to same-project imports (relative or `@/*`
 *     path-alias) — a third-party/Node-built-in import (e.g. `createHmac`, which also exposes an
 *     unrelated `.update()`) is excluded, since it can never be a justice_cases factory and
 *     flagging it would only be noise, not a closed gap. A SAME-file helper
 *     function is still resolved (not blindly trusted): its own `return` statement is re-verified
 *     against this exact resolver every run, exactly like an inline `.from("justice_cases")`
 *     chain would be — this is what "helper extraction" (moving a write into a differently-named
 *     function) cannot evade, and remains fully covered;
 *   - resolves query-builder aliases (the object a chain is built on assigned to a plain variable
 *     via `let q = supabase.from(...)`) and same-file table-name string constants.
 */

const TARGET_TABLE = "justice_cases";

/**
 * The ONLY exception kind: a write validated by an exact `.is("<col>", null)` at-most-once filter,
 * where `approvedField` is proven (every run) to be the single top-level key the update()'s
 * object-literal argument sets, and `guardColumn` is required to be EXACTLY `approvedField` — not
 * a JSON path within a larger object the write also replaces. A write that touches more than one
 * field, or whose guard checks something narrower than the whole value being written, can never
 * validate as this kind of exception.
 */
export type ReviewedException = {
  kind: "narrow-is-guard";
  file: string;
  /** 1-indexed line where the `.update(` call begins — pins this exception to one exact site. */
  line: number;
  approvedField: string;
  guardColumn: string;
  reason: string;
};

export const REVIEWED_EXCEPTIONS: readonly ReviewedException[] = [
  {
    kind: "narrow-is-guard",
    file: "lib/justice/finalizePaidPreparedPacketApproval.ts",
    line: 180,
    approvedField: "orphan_recovery_confirmed_at",
    guardColumn: "orphan_recovery_confirmed_at",
    reason: "At-most-once marker write, best-effort, never touches intake/client_state.",
  },
  {
    kind: "narrow-is-guard",
    file: "lib/justice/operatorOwnedCaseArchive.ts",
    line: 370,
    approvedField: "archived_at",
    guardColumn: "archived_at",
    reason:
      "At-most-once transition, re-reads and reports idempotently on a CAS miss rather than " +
      "retrying with a stale timestamp.",
  },
  {
    kind: "narrow-is-guard",
    file: "lib/stripe/processStripeCheckoutCompletedEvent.ts",
    line: 168,
    approvedField: "paid_at",
    guardColumn: "paid_at",
    reason: "At-most-once transition guarding against a redelivered Stripe webhook.",
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

/**
 * True when `expr`'s call chain (following same-file identifier aliases of the query-builder
 * object itself, same-file table-name string constants, and calls to a same-file function proven
 * — via `helperNames`, see collectJusticeCasesReturningHelperNames — to itself return a
 * justice_cases query builder) ultimately roots at `.from("justice_cases")`. A call to an
 * identifier NOT in `helperNames` (an unresolved same-file function, or any imported/cross-file
 * identifier) is never resolved here — callers handle that class of indirection separately, and
 * fail closed on it rather than "resolving and trusting" it.
 */
function resolvesToJusticeCasesFrom(
  expr: ts.Expression,
  stringLocals: ReadonlyMap<string, ts.Expression>,
  builderLocals: ReadonlyMap<string, ts.Expression>,
  helperNames: ReadonlySet<string> = new Set(),
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

/** Same-file functions (function declarations, or `const x = (...) => ...` / `function expr`
 * bindings) whose body directly `return`s something `resolvesToJusticeCasesFrom` proves resolves
 * to a justice_cases query builder. Computed once per file per scan (never cached across runs) so
 * it is re-verified every time, not "trusted" — this is what keeps same-file helper-extraction
 * fully covered: calling one of these, then `.update(...)`, is scanned exactly like an inline
 * `.from("justice_cases")...update(...)` chain would be. Deliberately shallow (does not resolve a
 * helper that itself only calls ANOTHER same-file helper) — an unresolved case falls through to
 * the caller's fail-closed handling for calls through an unrecognized identifier, so this can only
 * ever cost a human a look, never a silent bypass. */
function collectJusticeCasesReturningHelperNames(
  sourceFile: ts.SourceFile,
  stringLocals: ReadonlyMap<string, ts.Expression>,
  builderLocals: ReadonlyMap<string, ts.Expression>
): Set<string> {
  const names = new Set<string>();
  const bodyResolvesToJusticeCases = (body: ts.ConciseBody): boolean => {
    if (ts.isBlock(body)) {
      let matched = false;
      const findReturn = (stmt: ts.Node) => {
        if (matched) return;
        if (
          ts.isReturnStatement(stmt) &&
          stmt.expression &&
          resolvesToJusticeCasesFrom(stmt.expression, stringLocals, builderLocals)
        ) {
          matched = true;
          return;
        }
        // Don't attribute a NESTED function's return statements to the outer helper.
        if (ts.isFunctionDeclaration(stmt) || ts.isFunctionExpression(stmt) || ts.isArrowFunction(stmt)) return;
        ts.forEachChild(stmt, findReturn);
      };
      ts.forEachChild(body, findReturn);
      return matched;
    }
    return resolvesToJusticeCasesFrom(body, stringLocals, builderLocals);
  };
  const visit = (n: ts.Node) => {
    if (ts.isFunctionDeclaration(n) && n.name && n.body) {
      if (bodyResolvesToJusticeCases(n.body)) names.add(n.name.text);
    } else if (
      ts.isVariableDeclaration(n) &&
      ts.isIdentifier(n.name) &&
      n.initializer &&
      (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer))
    ) {
      if (bodyResolvesToJusticeCases(n.initializer.body)) names.add(n.name.text);
    }
    ts.forEachChild(n, visit);
  };
  visit(sourceFile);
  return names;
}

/** True for a module specifier that resolves to a file INSIDE this project (a relative import, or
 * the project's `@/*` path-alias) — as opposed to an npm package or Node built-in. Scoping the
 * cross-file-factory check (below) to same-project imports is deliberate: a third-party or
 * built-in import (e.g. Node's `createHmac`, which also exposes an unrelated `.update()` method)
 * can never be a justice_cases query-builder factory, so treating every imported identifier's
 * `.update(` call as ambiguous would flood real findings with unrelated library usage — the actual
 * risk this check targets is a factory DEFINED ELSEWHERE IN THIS CODEBASE that this scanner, by
 * construction, cannot open and re-verify the way it does for same-file helpers. */
function isSameProjectModuleSpecifier(specifier: string): boolean {
  return specifier.startsWith(".") || specifier.startsWith("@/");
}

/** Local binding names introduced by this file's `import` statements FROM ANOTHER FILE IN THIS
 * PROJECT (default, named — using the local/aliased name — and namespace imports; third-party/
 * built-in module imports excluded, see isSameProjectModuleSpecifier) — used to fail closed
 * specifically on `.update(...)` called through the result of calling one of THESE identifiers: a
 * cross-file factory this checker has no way to inspect, so it is never resolved/trusted, only
 * flagged. */
function collectImportedIdentifiers(sourceFile: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  const visit = (n: ts.Node) => {
    if (
      ts.isImportDeclaration(n) &&
      n.importClause &&
      ts.isStringLiteralLike(n.moduleSpecifier) &&
      isSameProjectModuleSpecifier(n.moduleSpecifier.text)
    ) {
      const clause = n.importClause;
      if (clause.name) names.add(clause.name.text);
      if (clause.namedBindings) {
        if (ts.isNamespaceImport(clause.namedBindings)) {
          names.add(clause.namedBindings.name.text);
        } else if (ts.isNamedImports(clause.namedBindings)) {
          for (const el of clause.namedBindings.elements) names.add(el.name.text);
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sourceFile);
  return names;
}

/** If `expr` (after unwrapping parens/await) is a call to a bare identifier (`someFunction(...)`),
 * returns that identifier's text; otherwise null. */
function calledIdentifierName(expr: ts.Expression): string | null {
  if (ts.isParenthesizedExpression(expr)) return calledIdentifierName(expr.expression);
  if (ts.isAwaitExpression(expr)) return calledIdentifierName(expr.expression);
  if (ts.isCallExpression(expr) && ts.isIdentifier(expr.expression)) return expr.expression.text;
  return null;
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
 * guarded chain only `if (cond)` does not prove every execution path reaches a guarded write. */
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
      (ts.isBinaryExpression(current) &&
        (current.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
          current.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
          current.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) &&
        current.right === node)
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
 * every execution path through `scope` applies the guard before the query executes. */
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

/** Validates a matched exception against the ACTUAL call site every run — a tampered, moved, or
 * shape-changed exception fails closed (is reported as a finding), never silently continues to
 * pass just because a file+line once matched. */
function validateException(exception: ReviewedException, update: ts.CallExpression): boolean {
  const arg = update.arguments[0];
  if (!arg) return false;
  const keys = objectLiteralKeys(arg);
  if (!keys) return false; // not a plain object literal — cannot verify the field set
  if (keys.length !== 1 || keys[0] !== exception.approvedField) return false;
  if (exception.guardColumn !== exception.approvedField) return false; // defensive; should never trip given the literal table above
  const { outer } = walkUpChain(update);
  if (chainContainsIsNullGuard(outer as ts.Expression, exception.guardColumn)) return true;
  // Also allow the guard attached via a later, UNCONDITIONAL reassignment, matching the general
  // guard's split-across-statements support.
  const bindingName = bindingNameOf(outer);
  if (!bindingName) return false;
  const scope = findEnclosingScope(update, update.getSourceFile());
  let found = false;
  const visit = (n: ts.Node) => {
    if (found) return;
    if (
      ts.isBinaryExpression(n) &&
      n.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(n.left) &&
      n.left.text === bindingName &&
      chainContainsIsNullGuard(n.right, exception.guardColumn) &&
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
  const importedIdentifiers = collectImportedIdentifiers(sourceFile);
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
    // Fail closed: computed/bracket access (`obj["update"](...)` or `obj[nameVar](...)`) on
    // something that resolves to justice_cases — an ElementAccessExpression is never resolved or
    // trusted, only ever flagged, when its property name is the literal "update" or is not
    // statically provable to be something else.
    if (ts.isElementAccessExpression(n) && resolvesToJusticeCasesFrom(n.expression, stringLocals, builderLocals, helperNames)) {
      const key = n.argumentExpression;
      const isProvablyNotUpdate = ts.isStringLiteralLike(key) && key.text !== "update";
      if (!isProvablyNotUpdate) {
        pushFindingAt(n.getStart(sourceFile), "computed/bracket property access on a justice_cases query builder — cannot be statically verified as guarded (or as anything other than `update`)");
      }
    }
    if (ts.isCallExpression(n)) {
      const callee = n.expression;
      if (ts.isPropertyAccessExpression(callee) && callee.name.text === "update") {
        const updateNamePos = callee.name.getStart(sourceFile);
        const line = lineOf(sourceFile, updateNamePos);
        const calledIdent = calledIdentifierName(callee.expression);
        if (calledIdent !== null && !helperNames.has(calledIdent)) {
          // `.update(...)` reached through a function call this scanner cannot resolve as a
          // same-file justice_cases-returning helper. Fail closed ONLY on an imported (cross-file)
          // identifier — a factory this checker has no way to inspect. An unresolved same-file
          // function call is left alone (true negative): collectJusticeCasesReturningHelperNames
          // already re-verifies, every run, every same-file function whose return statement
          // actually resolves to justice_cases, so failing here would only ever be re-flagging an
          // already-proven-unrelated local call, not closing a real gap.
          if (importedIdentifiers.has(calledIdent)) {
            pushFindingAt(
              updateNamePos,
              `\`.update\` called on the result of calling imported identifier \`${calledIdent}\` — a cross-file factory this checker cannot inspect; never resolved/trusted, always flagged`
            );
          }
        } else if (resolvesToJusticeCasesFrom(callee.expression, stringLocals, builderLocals, helperNames)) {
          // The `.update` NAME token's own line, not the CallExpression's overall start (which,
          // for a fluent chain, is wherever the chain's root expression begins — often several
          // lines earlier) and not the argument list's line either.
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
  let found = false;
  const visit = (n: ts.Node) => {
    if (found) return;
    if (ts.isCallExpression(n)) {
      const callee = n.expression;
      if (
        ts.isPropertyAccessExpression(callee) &&
        callee.name.text === "update" &&
        lineOf(sourceFile, callee.name.getStart(sourceFile)) === line &&
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

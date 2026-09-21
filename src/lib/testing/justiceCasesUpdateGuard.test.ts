import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Regression guard: every `.from("justice_cases").update(...)` call site in the app must either
 * be case_version-CAS-guarded (an `.eq("case_version", ...)` in the same statement) or be a
 * reviewed, narrow, idempotent exception explicitly listed below — never a bare, unconditional
 * write that can silently clobber a concurrent editor's intake/timeline/client_state/archive
 * state. A release audit found several justice_cases writes with no concurrency guard at all;
 * this test exists so a NEW one can never land silently again. If you are adding a legitimate
 * exception, add it to REVIEWED_EXCEPTIONS with a one-line reason — do not widen the general
 * case_version-proximity check to make it pass instead.
 *
 * This is a heuristic static scan (regex over source text), not a real SQL parser — it looks for
 * `case_version` or a narrow `.is("<col>", null)` guard appearing within WINDOW characters after
 * each `.update(` that follows a `.from("justice_cases")` call. It intentionally accepts some
 * slop (e.g. a CAS filter attached via a later statement on the same query builder, as in
 * api/justice/cases/[id]/route.ts) rather than requiring one single chained expression, since real
 * production code sometimes builds the query across a few lines/statements.
 */

const SRC_DIR = path.join(process.cwd(), "src");
const WINDOW = 700;

/**
 * Files with a write that is deliberately NOT case_version-CAS-guarded, because it uses a
 * narrower, equally-real, tested compare-and-swap on the exact single field it changes (an
 * `.is("<col>", null)` at-most-once filter), verified by a real permission/behavior test in that
 * file's own test suite. Keep this list short and specific — one relative path per reviewed write.
 */
const REVIEWED_EXCEPTIONS: ReadonlySet<string> = new Set([
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

function listSourceFiles(dir: string): string[] {
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

type Finding = { file: string; index: number; snippet: string };

function findUnguardedWrites(): Finding[] {
  const findings: Finding[] = [];
  for (const absPath of listSourceFiles(SRC_DIR)) {
    const relPath = path.relative(SRC_DIR, absPath).split(path.sep).join("/");
    const content = fs.readFileSync(absPath, "utf8");

    const fromRe = /\.from\(\s*["']justice_cases["']\s*\)/g;
    let fromMatch: RegExpExecArray | null;
    while ((fromMatch = fromRe.exec(content))) {
      const afterFrom = content.slice(fromMatch.index, fromMatch.index + WINDOW);
      const updateRel = afterFrom.indexOf(".update(");
      if (updateRel === -1) continue; // this .from(...) call is a read, not a write

      const updateAbsIndex = fromMatch.index + updateRel;
      if (REVIEWED_EXCEPTIONS.has(relPath)) continue;

      const guardWindow = content.slice(updateAbsIndex, updateAbsIndex + WINDOW);
      const hasCaseVersionGuard = /case_version/.test(guardWindow);
      const hasNarrowIsGuard = /\.is\(\s*["'][a-zA-Z0-9_>./-]+["']\s*,\s*null\s*\)/.test(guardWindow);
      if (hasCaseVersionGuard || hasNarrowIsGuard) continue;

      const lineStart = content.lastIndexOf("\n", updateAbsIndex) + 1;
      const lineEnd = content.indexOf("\n", updateAbsIndex);
      findings.push({
        file: relPath,
        index: updateAbsIndex,
        snippet: content.slice(lineStart, lineEnd === -1 ? undefined : lineEnd).trim(),
      });
    }
  }
  return findings;
}

describe("justice_cases.update() concurrency guard (regression protection)", () => {
  it("every non-exempt .from(\"justice_cases\").update(...) call site is case_version-guarded or a narrow .is(col, null) guard", () => {
    const findings = findUnguardedWrites();
    if (findings.length > 0) {
      const detail = findings
        .map((f) => `  ${f.file} — ${f.snippet}`)
        .join("\n");
      throw new Error(
        `Found ${findings.length} unguarded justice_cases.update() call site(s) with no case_version CAS and no narrow .is(col, null) guard:\n${detail}\n\n` +
          `Add a real compare-and-swap (prefer .eq("case_version", expectedVersion)), or — if this ` +
          `is a genuinely narrow, reviewed, tested exception — add its path to REVIEWED_EXCEPTIONS ` +
          `in this test with a one-line justification, matching the existing entries.`
      );
    }
    expect(findings).toHaveLength(0);
  });

  it("REVIEWED_EXCEPTIONS only lists files that still exist and still contain a justice_cases write", () => {
    for (const relPath of REVIEWED_EXCEPTIONS) {
      const absPath = path.join(SRC_DIR, relPath);
      expect(fs.existsSync(absPath), `${relPath} no longer exists — remove it from REVIEWED_EXCEPTIONS`).toBe(
        true
      );
      const content = fs.readFileSync(absPath, "utf8");
      expect(
        /\.from\(\s*["']justice_cases["']\)[\s\S]{0,700}\.update\(/.test(content),
        `${relPath} no longer contains a justice_cases update — remove it from REVIEWED_EXCEPTIONS`
      ).toBe(true);
    }
  });
});

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  REVIEWED_EXCEPTIONS,
  SRC_DIR,
  findUnguardedJusticeCasesWritesInRepo,
  findUnguardedJusticeCasesWritesInSource,
  sourceHasJusticeCasesUpdateAtLine,
} from "@/lib/testing/justiceCasesUpdateGuard";

/**
 * Regression guard: every `.from("justice_cases").update(...)` call site in the app must either
 * be case_version-CAS-guarded or be a reviewed, EXACTLY pinned (file + line), shape-validated
 * exception in REVIEWED_EXCEPTIONS (src/lib/testing/justiceCasesUpdateGuard.ts) — never a bare,
 * unconditional write that can silently clobber a concurrent editor's
 * intake/timeline/client_state/archive state, and never a whole-file exemption.
 *
 * This is the third generation of this guard. Round 1 (regex/text-window) was proven bypassable
 * by a misleading comment, incidental whitespace, or a table-name constant. Round 2 (AST-based)
 * fixed those but was itself proven bypassable by (a) REVIEWED_EXCEPTIONS exempting the entire
 * FILE rather than the one reviewed line, (b) accepting `.is(col, null)` as a guard for ANY call
 * site rather than only a validated narrow write, (c) never considering destructured/bound/aliased
 * references to `.update`, and (d) accepting a guard applied on only ONE conditional branch as
 * proof every execution path is guarded. The "bypass resistance" describe blocks below are the
 * regression tests for all of round 1, round 2, and round 3's demonstrated bypasses.
 */

describe("justice_cases.update() concurrency guard (regression protection)", () => {
  it("every non-exempt justice_cases update call site in src/ is case_version-guarded or an exact, validated REVIEWED_EXCEPTIONS entry", () => {
    const findings = findUnguardedJusticeCasesWritesInRepo();
    if (findings.length > 0) {
      const detail = findings.map((f) => `  ${f.file}:${f.line} — ${f.detail}\n    ${f.snippet}`).join("\n");
      throw new Error(
        `Found ${findings.length} unguarded/unverifiable justice_cases.update() call site(s):\n${detail}\n\n` +
          `Add a real compare-and-swap (prefer .eq("case_version", expectedVersion), applied ` +
          `UNCONDITIONALLY on every execution path), or — if this is a genuinely narrow, reviewed, ` +
          `tested exception — add an exact, line-pinned entry to REVIEWED_EXCEPTIONS in ` +
          `src/lib/testing/justiceCasesUpdateGuard.ts, never a whole-file exemption.`
      );
    }
    expect(findings).toHaveLength(0);
  });

  it("every REVIEWED_EXCEPTIONS entry still points to a real justice_cases update at its pinned line", () => {
    for (const exception of REVIEWED_EXCEPTIONS) {
      const absPath = path.join(SRC_DIR, exception.file);
      expect(
        fs.existsSync(absPath),
        `${exception.file} no longer exists — remove its REVIEWED_EXCEPTIONS entry`
      ).toBe(true);
      const content = fs.readFileSync(absPath, "utf8");
      expect(
        sourceHasJusticeCasesUpdateAtLine(content, exception.file, exception.line),
        `${exception.file}:${exception.line} no longer has a justice_cases update — fix or remove this REVIEWED_EXCEPTIONS entry`
      ).toBe(true);
      // And the exception must actually validate (shape + guard) against that exact line — this
      // is the same check the real scanner runs, exercised here so a broken exception surfaces on
      // its own test rather than only as a diffuse "found N unguarded writes" failure above.
      const findings = findUnguardedJusticeCasesWritesInSource(content, exception.file);
      const findingsAtLine = findings.filter((f) => f.line === exception.line);
      expect(
        findingsAtLine,
        `REVIEWED_EXCEPTIONS entry for ${exception.file}:${exception.line} does not validate: ${JSON.stringify(findingsAtLine)}`
      ).toHaveLength(0);
    }
  });

  it("REVIEWED_EXCEPTIONS entries are individually pinned — no two entries share a file+line, and every entry's file is one of the expected reviewed files", () => {
    const seen = new Set<string>();
    for (const e of REVIEWED_EXCEPTIONS) {
      const key = `${e.file}:${e.line}`;
      expect(seen.has(key), `duplicate REVIEWED_EXCEPTIONS entry for ${key}`).toBe(false);
      seen.add(key);
    }
    expect([...seen].sort()).toEqual(
      [
        "lib/justice/finalizePaidPreparedPacketApproval.ts:180",
        "lib/justice/operatorOwnedCaseArchive.ts:370",
        "lib/stripe/processStripeCheckoutCompletedEvent.ts:168",
      ].sort()
    );
  });
});

describe("justice_cases.update() guard bypass resistance — round 1 (regex-scanner bypasses)", () => {
  const FAKE_PATH = "lib/justice/__not_a_real_file.ts";

  it("is NOT bypassed by a misleading same-line trailing comment mentioning case_version", () => {
    const src = `
      export async function save(supabase: any, id: string, patch: any) {
        return await supabase
          .from("justice_cases")
          .update(patch) // case_version guard intentionally omitted here, reviewed separately
          .eq("id", id)
          .select()
          .maybeSingle();
      }
    `;
    expect(findUnguardedJusticeCasesWritesInSource(src, FAKE_PATH)).toHaveLength(1);
  });

  it("is NOT bypassed by incidental whitespace before the update() parenthesis", () => {
    const src = `
      export async function save(supabase: any, id: string, patch: any) {
        return await supabase
          .from("justice_cases")
          .update (patch)
          .eq("id", id)
          .select()
          .maybeSingle();
      }
    `;
    expect(findUnguardedJusticeCasesWritesInSource(src, FAKE_PATH)).toHaveLength(1);
  });

  it("is NOT bypassed by extracting the table name into a local constant", () => {
    const src = `
      const JUSTICE_CASES_TABLE = "justice_cases";
      export async function save(supabase: any, id: string, patch: any) {
        return await supabase
          .from(JUSTICE_CASES_TABLE)
          .update(patch)
          .eq("id", id)
          .select()
          .maybeSingle();
      }
    `;
    expect(findUnguardedJusticeCasesWritesInSource(src, FAKE_PATH)).toHaveLength(1);
  });
});

describe("justice_cases.update() guard bypass resistance — round 2 (AST-scanner bypasses)", () => {
  const FAKE_PATH = "lib/justice/__not_a_real_file.ts";

  it("is NOT bypassed by aliasing the query builder itself to a variable before calling update()", () => {
    const src = `
      export async function save(supabase: any, id: string, patch: any) {
        const q = supabase.from("justice_cases");
        return await q.update(patch).eq("id", id).select().maybeSingle();
      }
    `;
    expect(findUnguardedJusticeCasesWritesInSource(src, FAKE_PATH)).toHaveLength(1);
  });

  it("is NOT bypassed by extracting the unguarded write into a differently-named helper function", () => {
    const src = `
      async function totallyUnrelatedSoundingHelper(supabase: any, id: string, patch: any) {
        return await supabase.from("justice_cases").update(patch).eq("id", id).select().maybeSingle();
      }
      export async function save(supabase: any, id: string, patch: any) {
        return totallyUnrelatedSoundingHelper(supabase, id, patch);
      }
    `;
    expect(findUnguardedJusticeCasesWritesInSource(src, FAKE_PATH)).toHaveLength(1);
  });

  it("does NOT flag a directly-chained case_version guard (no false positive)", () => {
    const src = `
      export async function save(supabase: any, id: string, expectedVersion: number, patch: any) {
        return await supabase
          .from("justice_cases")
          .update(patch)
          .eq("id", id)
          .eq("case_version", expectedVersion)
          .select()
          .maybeSingle();
      }
    `;
    expect(findUnguardedJusticeCasesWritesInSource(src, FAKE_PATH)).toHaveLength(0);
  });

  it("does NOT flag an UNCONDITIONAL case_version guard attached to the query-builder variable in a later statement", () => {
    const src = `
      export async function save(supabase: any, id: string, casToken: number, patch: any) {
        let updateQuery = supabase.from("justice_cases").update(patch).eq("id", id);
        updateQuery = updateQuery.eq("case_version", casToken);
        return await updateQuery.select().maybeSingle();
      }
    `;
    expect(findUnguardedJusticeCasesWritesInSource(src, FAKE_PATH)).toHaveLength(0);
  });

  it("still ignores a plain read (.from(\"justice_cases\").select(...), no .update at all)", () => {
    const src = `
      export async function read(supabase: any, id: string) {
        return await supabase.from("justice_cases").select("id").eq("id", id).maybeSingle();
      }
    `;
    expect(findUnguardedJusticeCasesWritesInSource(src, FAKE_PATH)).toHaveLength(0);
  });

  it("does not confuse an unrelated table's update() for a justice_cases write", () => {
    const src = `
      export async function save(supabase: any, id: string, patch: any) {
        return await supabase.from("justice_case_tasks").update(patch).eq("id", id).select().maybeSingle();
      }
    `;
    expect(findUnguardedJusticeCasesWritesInSource(src, FAKE_PATH)).toHaveLength(0);
  });
});

describe("justice_cases.update() guard bypass resistance — round 3 (exception/is()/alias/conditional bypasses)", () => {
  const FAKE_PATH = "lib/justice/__not_a_real_file.ts";

  it("BLOCKING FIX: a second, unrelated, unguarded write in a REVIEWED_EXCEPTIONS file is caught (exceptions are per-line, not per-file)", () => {
    const realExceptionPath = "lib/justice/finalizePaidPreparedPacketApproval.ts";
    const realContent = fs.readFileSync(path.join(SRC_DIR, realExceptionPath), "utf8");
    const tampered =
      realContent +
      `\n\nasync function unrelatedUnguardedWrite(supabase: any, id: string, patch: any) {\n` +
      `  return await supabase.from("justice_cases").update(patch).eq("id", id).select().maybeSingle();\n` +
      `}\n`;
    const findings = findUnguardedJusticeCasesWritesInSource(tampered, realExceptionPath);
    // The original reviewed line must still validate (0 findings there); the new unrelated line
    // must be flagged.
    expect(findings.some((f) => f.line === 180)).toBe(false);
    expect(findings.length).toBeGreaterThanOrEqual(1);
  });

  it("BLOCKING FIX: an exception whose exact line no longer has an object literal matching its approvedFields fails closed", () => {
    const src = `
      export async function save(supabase: any, id: string, patch: any) {
        return await supabase
          .from("justice_cases")
          .update({ client_state: patch.client_state, archived_at: patch.archived_at })
          .eq("id", id)
          .is("client_state->approved_next_action", null)
          .select()
          .maybeSingle();
      }
    `;
    // Two fields (client_state + archived_at) where the real exception only approves client_state
    // alone — even with the exact matching guard column present, this must NOT silently pass.
    // (Exercised indirectly: since this fake file isn't itself in REVIEWED_EXCEPTIONS, this also
    // confirms .is() alone is never a general guard — see the next test for the direct case.)
    expect(findUnguardedJusticeCasesWritesInSource(src, FAKE_PATH)).toHaveLength(1);
  });

  it("BLOCKING FIX: .is(column, null) is NOT accepted as a guard for an unlisted call site, even for a genuinely single-field write", () => {
    const src = `
      export async function archive(supabase: any, id: string, archivedAt: string) {
        return await supabase
          .from("justice_cases")
          .update({ archived_at: archivedAt })
          .eq("id", id)
          .is("archived_at", null)
          .select("id")
          .maybeSingle();
      }
    `;
    // This is structurally identical to the real, reviewed operatorOwnedCaseArchive.ts write —
    // but it is NOT a pinned REVIEWED_EXCEPTIONS entry, so it must still be flagged.
    expect(findUnguardedJusticeCasesWritesInSource(src, FAKE_PATH)).toHaveLength(1);
  });

  it("a multi-field update guarded ONLY by an unrelated .is(column, null) is caught (was previously accepted)", () => {
    const src = `
      export async function save(supabase: any, id: string, patch: any) {
        return await supabase
          .from("justice_cases")
          .update({ intake: patch.intake, client_state: patch.client_state, archived_at: patch.archived_at })
          .eq("id", id)
          .is("some_never_conflicting_column", null)
          .select()
          .maybeSingle();
      }
    `;
    expect(findUnguardedJusticeCasesWritesInSource(src, FAKE_PATH)).toHaveLength(1);
  });

  it("BLOCKING FIX: an unguarded query-builder-returning helper is now caught (helper return-value resolution)", () => {
    const src = `
      function getCasesTable(supabase: any) {
        return supabase.from("justice_cases");
      }
      export async function save(supabase: any, id: string, patch: any) {
        return await getCasesTable(supabase).update(patch).eq("id", id).select().maybeSingle();
      }
    `;
    expect(findUnguardedJusticeCasesWritesInSource(src, FAKE_PATH)).toHaveLength(1);
  });

  it("does NOT flag a GUARDED write reached through a query-builder-returning helper (no false positive)", () => {
    const src = `
      function getCasesTable(supabase: any) {
        return supabase.from("justice_cases");
      }
      export async function save(supabase: any, id: string, expectedVersion: number, patch: any) {
        return await getCasesTable(supabase).update(patch).eq("id", id).eq("case_version", expectedVersion).select().maybeSingle();
      }
    `;
    expect(findUnguardedJusticeCasesWritesInSource(src, FAKE_PATH)).toHaveLength(0);
  });

  it("BLOCKING FIX: a destructured update call (`const { update } = supabase.from(...); update(patch)`) is now caught (fails closed)", () => {
    const src = `
      export async function save(supabase: any, id: string, patch: any) {
        const { update } = supabase.from("justice_cases");
        return await update(patch);
      }
    `;
    expect(findUnguardedJusticeCasesWritesInSource(src, FAKE_PATH)).toHaveLength(1);
  });

  it("BLOCKING FIX: a bound/aliased update reference (`const doUpdate = table.update.bind(table)`) is now caught (fails closed)", () => {
    const src = `
      export async function save(supabase: any, id: string, patch: any) {
        const table = supabase.from("justice_cases");
        const doUpdate = table.update.bind(table);
        return await doUpdate(patch);
      }
    `;
    expect(findUnguardedJusticeCasesWritesInSource(src, FAKE_PATH)).toHaveLength(1);
  });

  it("does NOT flag an ordinary, immediately-called .update() as a bound/aliased reference (no false positive)", () => {
    const src = `
      export async function save(supabase: any, id: string, expectedVersion: number, patch: any) {
        return await supabase.from("justice_cases").update(patch).eq("id", id).eq("case_version", expectedVersion).select().maybeSingle();
      }
    `;
    expect(findUnguardedJusticeCasesWritesInSource(src, FAKE_PATH)).toHaveLength(0);
  });

  it("BLOCKING FIX: a case_version guard applied only on a conditional path is now caught (path-completeness)", () => {
    const src = `
      export async function save(supabase: any, id: string, patch: any, attackerControllableFlag: boolean) {
        let q = supabase.from("justice_cases").update(patch).eq("id", id);
        if (attackerControllableFlag) {
          q = q.eq("case_version", 999);
        }
        return await q.select().maybeSingle();
      }
    `;
    expect(findUnguardedJusticeCasesWritesInSource(src, FAKE_PATH)).toHaveLength(1);
  });

  it("also catches a ternary-conditional guard (same class as the if-statement case)", () => {
    const src = `
      export async function save(supabase: any, id: string, patch: any, casToken: number | undefined) {
        let q = supabase.from("justice_cases").update(patch).eq("id", id);
        q = casToken !== undefined ? q.eq("case_version", casToken) : q;
        return await q.select().maybeSingle();
      }
    `;
    expect(findUnguardedJusticeCasesWritesInSource(src, FAKE_PATH)).toHaveLength(1);
  });

  it("does NOT flag the refactored real [id]/route.ts pattern: every justice_cases update requires case_version CAS unconditionally, with no exception needed", () => {
    const routePath = "app/api/justice/cases/[id]/route.ts";
    const content = fs.readFileSync(path.join(SRC_DIR, routePath), "utf8");
    const findings = findUnguardedJusticeCasesWritesInSource(content, routePath);
    expect(findings).toHaveLength(0);
  });

  it("an ordinary unguarded identifier-argument write is flagged (no ambient exception mechanism revives it)", () => {
    const src = `
      export async function save(supabase: any, id: string, userId: string, other: any) {
        return await supabase.from("justice_cases").update(other).eq("id", id).eq("user_id", userId).select().maybeSingle();
      }
    `;
    expect(findUnguardedJusticeCasesWritesInSource(src, FAKE_PATH)).toHaveLength(1);
  });
});

describe("justice_cases.update() guard bypass resistance — round 4 (computed access, cross-file factories, exception-shape tightening)", () => {
  const FAKE_PATH = "lib/justice/__not_a_real_file.ts";

  it("BLOCKING FIX: bracket/computed property access (`obj[\"update\"](...)`) on a justice_cases builder is caught", () => {
    const src = `
      export async function save(supabase: any, id: string, patch: any) {
        const table = supabase.from("justice_cases");
        return await table["update"](patch).eq("id", id).select().maybeSingle();
      }
    `;
    expect(findUnguardedJusticeCasesWritesInSource(src, FAKE_PATH)).toHaveLength(1);
  });

  it("BLOCKING FIX: bracket/computed property access via a variable key (`obj[methodName](...)`) on a justice_cases builder is caught, even though the key isn't statically \"update\"", () => {
    const src = `
      export async function save(supabase: any, id: string, patch: any, methodName: string) {
        const table = supabase.from("justice_cases");
        return await table[methodName](patch).eq("id", id).select().maybeSingle();
      }
    `;
    expect(findUnguardedJusticeCasesWritesInSource(src, FAKE_PATH)).toHaveLength(1);
  });

  it("does NOT flag bracket/computed access on a justice_cases builder when the key is statically provably NOT \"update\" (no false positive)", () => {
    const src = `
      export async function read(supabase: any, id: string) {
        const table = supabase.from("justice_cases");
        return await table["select"]("id").eq("id", id).maybeSingle();
      }
    `;
    expect(findUnguardedJusticeCasesWritesInSource(src, FAKE_PATH)).toHaveLength(0);
  });

  it("BLOCKING FIX: an unguarded write reached through calling an IMPORTED (cross-file) factory function is caught — this checker cannot inspect what an import returns, so it is never trusted, only flagged", () => {
    const src = `
      import { getCasesTable } from "./someOtherFile";
      export async function save(supabase: any, id: string, patch: any) {
        return await getCasesTable(supabase).update(patch).eq("id", id).select().maybeSingle();
      }
    `;
    expect(findUnguardedJusticeCasesWritesInSource(src, FAKE_PATH)).toHaveLength(1);
  });

  it("BLOCKING FIX: a GUARDED write reached through calling an imported factory function is STILL flagged — a real case_version .eq() on the result cannot rescue an unverifiable cross-file factory", () => {
    const src = `
      import { getCasesTable } from "./someOtherFile";
      export async function save(supabase: any, id: string, expectedVersion: number, patch: any) {
        return await getCasesTable(supabase).update(patch).eq("id", id).eq("case_version", expectedVersion).select().maybeSingle();
      }
    `;
    expect(findUnguardedJusticeCasesWritesInSource(src, FAKE_PATH)).toHaveLength(1);
  });

  it("an imported identifier's return value being chained with .update() is ALWAYS flagged, even where it is plainly unrelated to justice_cases (e.g. a logger) — this checker has no way to inspect a cross-file import's return type, so ambiguity always fails closed rather than being guessed away; this is an intentional, accepted over-approximation, not a bug", () => {
    const src = `
      import { buildLogger } from "./logger";
      export async function save() {
        return buildLogger().update("some-unrelated-thing");
      }
    `;
    expect(findUnguardedJusticeCasesWritesInSource(src, FAKE_PATH)).toHaveLength(1);
  });

  it("does NOT flag a call to an identifier imported from a THIRD-PARTY/BUILT-IN module (e.g. Node's createHmac, which also exposes an unrelated .update()) — a real bug found while re-running this suite against the actual repo: verifyResendWebhookSignature.ts's createHmac(...).update(...) is not a justice_cases write and must not be flagged", () => {
    const src = `
      import { createHmac } from "node:crypto";
      export function sign(key: string, body: string) {
        return createHmac("sha256", key).update(body).digest("base64");
      }
    `;
    expect(findUnguardedJusticeCasesWritesInSource(src, FAKE_PATH)).toHaveLength(0);
  });

  it("does NOT flag a call to an UNRESOLVED same-file function (not proven to return a justice_cases builder) — true negative, avoids a false-positive flood on ordinary local helpers", () => {
    const src = `
      function buildLogger() {
        return { update: (msg: string) => console.log(msg) };
      }
      export async function save() {
        return buildLogger().update("some-unrelated-thing");
      }
    `;
    expect(findUnguardedJusticeCasesWritesInSource(src, FAKE_PATH)).toHaveLength(0);
  });

  it("BLOCKING FIX: altering the control flow around a pinned exception's call site (wrapping it in a new conditional) does not affect the exception's own validation, but a NEW unguarded branch alongside it is caught", () => {
    const src = `
      export async function save(supabase: any, id: string, archivedAt: string, attackerControllableFlag: boolean) {
        if (attackerControllableFlag) {
          return await supabase.from("justice_cases").update({ archived_at: archivedAt }).eq("id", id).is("archived_at", null).select("id").maybeSingle();
        }
        return await supabase.from("justice_cases").update({ archived_at: archivedAt }).eq("id", id).select("id").maybeSingle();
      }
    `;
    // Neither call site is a pinned REVIEWED_EXCEPTIONS entry in this fake file, so both must be
    // flagged: the conditional .is()-guarded one (never a general-purpose guard) and the wholly
    // unguarded else-branch one.
    expect(findUnguardedJusticeCasesWritesInSource(src, FAKE_PATH)).toHaveLength(2);
  });

  it("BLOCKING FIX: an exception file with an EXTRA, unrelated unguarded write elsewhere in the file is caught even when the pinned line itself still validates", () => {
    const realExceptionPath = "lib/justice/operatorOwnedCaseArchive.ts";
    const realContent = fs.readFileSync(path.join(SRC_DIR, realExceptionPath), "utf8");
    const tampered =
      realContent +
      `\n\nasync function secondUnrelatedUnguardedWrite(supabase: any, id: string, patch: any) {\n` +
      `  return await supabase.from("justice_cases").update(patch).eq("id", id).select().maybeSingle();\n` +
      `}\n`;
    const findings = findUnguardedJusticeCasesWritesInSource(tampered, realExceptionPath);
    expect(findings.some((f) => f.line === 370)).toBe(false);
    expect(findings.length).toBeGreaterThanOrEqual(1);
  });

  it("BLOCKING FIX: a mismatched payload/guard field pair (guardColumn present in a pinned exception, but the write's actual argument sets a DIFFERENT single field) fails closed", () => {
    const src = `
      export async function save(supabase: any, id: string, paidAt: string) {
        return await supabase
          .from("justice_cases")
          .update({ paid_at: paidAt })
          .eq("id", id)
          .is("some_other_column_entirely", null)
          .select()
          .maybeSingle();
      }
    `;
    expect(findUnguardedJusticeCasesWritesInSource(src, FAKE_PATH)).toHaveLength(1);
  });
});

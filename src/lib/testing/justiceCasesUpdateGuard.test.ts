import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  REVIEWED_EXCEPTIONS,
  SRC_DIR,
  findUnguardedJusticeCasesWritesInRepo,
  findUnguardedJusticeCasesWritesInSource,
  sourceHasJusticeCasesUpdate,
} from "@/lib/testing/justiceCasesUpdateGuard";

/**
 * Regression guard: every `.from("justice_cases").update(...)` call site in the app must either
 * be case_version-CAS-guarded or be a reviewed, narrow, idempotent exception explicitly listed in
 * REVIEWED_EXCEPTIONS (src/lib/testing/justiceCasesUpdateGuard.ts) — never a bare, unconditional
 * write that can silently clobber a concurrent editor's intake/timeline/client_state/archive
 * state. A release audit found several justice_cases writes with no concurrency guard at all;
 * this test exists so a NEW one can never land silently again.
 *
 * The scanner itself is AST-based (see justiceCasesUpdateGuard.ts) specifically because an earlier
 * regex/text-window version was proven bypassable by a misleading comment, incidental whitespace,
 * or a table-name constant — none of which survive real parsing. The "guard bypass" describe block
 * below is the regression test for that: it feeds the scanner the exact snippets that defeated the
 * old version (plus two bypass classes that weren't demonstrated against it but are structurally
 * the same class of issue — a query-builder alias and helper extraction) and asserts every one is
 * now caught, while the corresponding legitimately-guarded version of each is NOT flagged.
 */

describe("justice_cases.update() concurrency guard (regression protection)", () => {
  it("every non-exempt justice_cases update call site in src/ is case_version-guarded or a narrow .is(col, null) guard", () => {
    const findings = findUnguardedJusticeCasesWritesInRepo();
    if (findings.length > 0) {
      const detail = findings.map((f) => `  ${f.file}:${f.line} — ${f.snippet}`).join("\n");
      throw new Error(
        `Found ${findings.length} unguarded justice_cases.update() call site(s) with no case_version CAS and no narrow .is(col, null) guard:\n${detail}\n\n` +
          `Add a real compare-and-swap (prefer .eq("case_version", expectedVersion)), or — if this ` +
          `is a genuinely narrow, reviewed, tested exception — add its path to REVIEWED_EXCEPTIONS ` +
          `in src/lib/testing/justiceCasesUpdateGuard.ts with a one-line justification, matching the ` +
          `existing entries.`
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
        sourceHasJusticeCasesUpdate(content, relPath),
        `${relPath} no longer contains a justice_cases update — remove it from REVIEWED_EXCEPTIONS`
      ).toBe(true);
    }
  });
});

describe("justice_cases.update() guard bypass resistance (AST vs. the three demonstrated regex-scanner bypasses, plus query/helper aliasing)", () => {
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
    const findings = findUnguardedJusticeCasesWritesInSource(src, FAKE_PATH);
    expect(findings).toHaveLength(1);
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
    const findings = findUnguardedJusticeCasesWritesInSource(src, FAKE_PATH);
    expect(findings).toHaveLength(1);
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
    const findings = findUnguardedJusticeCasesWritesInSource(src, FAKE_PATH);
    expect(findings).toHaveLength(1);
  });

  it("is NOT bypassed by aliasing the query builder itself to a variable before calling update()", () => {
    const src = `
      export async function save(supabase: any, id: string, patch: any) {
        const q = supabase.from("justice_cases");
        return await q.update(patch).eq("id", id).select().maybeSingle();
      }
    `;
    const findings = findUnguardedJusticeCasesWritesInSource(src, FAKE_PATH);
    expect(findings).toHaveLength(1);
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
    const findings = findUnguardedJusticeCasesWritesInSource(src, FAKE_PATH);
    expect(findings).toHaveLength(1);
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

  it("does NOT flag a case_version guard attached to the query-builder variable in a later statement (the real [id]/route.ts pattern)", () => {
    const src = `
      export async function save(supabase: any, id: string, casToken: number | undefined, patch: any) {
        let updateQuery = supabase.from("justice_cases").update(patch).eq("id", id);
        if (casToken !== undefined) {
          updateQuery = updateQuery.eq("case_version", casToken);
        }
        return await updateQuery.select().maybeSingle();
      }
    `;
    expect(findUnguardedJusticeCasesWritesInSource(src, FAKE_PATH)).toHaveLength(0);
  });

  it("does NOT flag a guarded write reached through a query-builder alias", () => {
    const src = `
      export async function save(supabase: any, id: string, expectedVersion: number, patch: any) {
        const q = supabase.from("justice_cases");
        return await q.update(patch).eq("id", id).eq("case_version", expectedVersion).select().maybeSingle();
      }
    `;
    expect(findUnguardedJusticeCasesWritesInSource(src, FAKE_PATH)).toHaveLength(0);
  });

  it("does NOT flag a guarded write reached through a helper function under any name", () => {
    const src = `
      async function totallyUnrelatedSoundingHelper(supabase: any, id: string, expectedVersion: number, patch: any) {
        return await supabase
          .from("justice_cases")
          .update(patch)
          .eq("id", id)
          .eq("case_version", expectedVersion)
          .select()
          .maybeSingle();
      }
      export async function save(supabase: any, id: string, expectedVersion: number, patch: any) {
        return totallyUnrelatedSoundingHelper(supabase, id, expectedVersion, patch);
      }
    `;
    expect(findUnguardedJusticeCasesWritesInSource(src, FAKE_PATH)).toHaveLength(0);
  });

  it("does NOT flag a narrow .is(col, null) at-most-once guard (no false positive)", () => {
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

  it("a REVIEWED_EXCEPTIONS path is skipped by default even when unguarded", () => {
    const src = `
      export async function save(supabase: any, id: string, patch: any) {
        return await supabase.from("justice_cases").update(patch).eq("id", id).select().maybeSingle();
      }
    `;
    const exceptionPath = "lib/justice/cancelOperatorFulfillmentTask.ts";
    expect(findUnguardedJusticeCasesWritesInSource(src, exceptionPath)).toHaveLength(0);
    expect(
      findUnguardedJusticeCasesWritesInSource(src, exceptionPath, { skipReviewedExceptions: false })
    ).toHaveLength(1);
  });
});

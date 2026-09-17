import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

/**
 * Empirical, real-Postgres (WASM PGlite, no Docker/network) regression coverage for the two live
 * bugs a release audit found in the justice_case_tasks_dedupe_key migration and its apply
 * procedure — both previously only reasoned about or covered by mocks:
 *
 *  - The documented pre-flight/remediation query originally grouped by (case_id, notes), so two
 *    duplicate open tasks sharing the same stable marker but with different draft/complaint text
 *    on later lines of notes were NOT detected as duplicates (a false negative). It must group by
 *    the extracted marker (split_part(notes, chr(10), 1)) instead.
 *  - The migration's own RAISE EXCEPTION remediation text, and the apply procedure's copy of it,
 *    referenced the dedupe_key column — which does not exist once the migration's failure has
 *    rolled back the ADD COLUMN earlier in the same transaction. The canonical remediation query
 *    must be runnable both before the migration and immediately after it fails.
 *
 * This runs the actual migration files (not a reconstruction of them) against a real Postgres
 * engine, and extracts the actual canonical query text from APPLY_PROCEDURE_20260916.md (not a
 * hand-copied version of it), so both files are re-validated as they exist on disk.
 */

const MIGRATIONS_DIR = path.join(process.cwd(), "supabase", "migrations");
const APPLY_PROCEDURE_PATH = path.join(MIGRATIONS_DIR, "APPLY_PROCEDURE_20260916.md");
const DEDUPE_KEY_MIGRATION_PATH = path.join(
  MIGRATIONS_DIR,
  "20260916130000_justice_case_tasks_dedupe_key.sql"
);

function extractCanonicalRemediationQuery(): string {
  const doc = fs.readFileSync(APPLY_PROCEDURE_PATH, "utf8");
  const matches = Array.from(
    doc.matchAll(/select split_part\(notes, chr\(10\), 1\) as marker[\s\S]*?having count\(\*\) > 1;/g)
  ).map((m) => m[0]);
  // Step 1 and step 3 must carry byte-identical copies of this query, by design, so they can't
  // drift apart — assert that instead of just picking one.
  expect(matches.length).toBe(2);
  expect(matches[0]).toBe(matches[1]);
  const query = matches[0];
  if (!query) throw new Error("Could not find canonical remediation query in apply procedure doc");
  return query;
}

function readMigrationsUpTo(lastFileName: string): string[] {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .filter((name) => name <= lastFileName)
    .map((name) => fs.readFileSync(path.join(MIGRATIONS_DIR, name), "utf8"));
}

function stripUnsupportedStatements(sql: string): string {
  // pgcrypto is unsupported by PGlite; gen_random_uuid() is core since PG13 so it's unnecessary.
  return sql.replace(/create extension if not exists pgcrypto;\s*/gi, "");
}

async function bootstrapSupabaseStubs(db: PGlite): Promise<void> {
  // The migrations' RLS policies reference roles and auth.uid() that only exist in a real
  // Supabase project. Stub the minimum needed for the migration files to apply verbatim.
  await db.exec(`
    do $$
    begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then
        create role anon;
      end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then
        create role authenticated;
      end if;
      if not exists (select 1 from pg_roles where rolname = 'service_role') then
        create role service_role;
      end if;
    end $$;

    create schema if not exists auth;
    create or replace function auth.uid() returns uuid as $$
      select null::uuid;
    $$ language sql stable;
  `);
}

async function applyMigrationsThrough(db: PGlite, lastFileName: string): Promise<void> {
  const files = readMigrationsUpTo(lastFileName);
  for (const sql of files) {
    await db.exec(stripUnsupportedStatements(sql));
  }
}

async function seedCaseAndTasks(
  db: PGlite,
  caseId: string,
  tasks: { notes: string }[]
): Promise<void> {
  await db.query(
    `insert into justice_cases (id, user_id, intake) values ($1, 'user_1', '{}'::jsonb)`,
    [caseId]
  );
  for (const task of tasks) {
    await db.query(
      `insert into justice_case_tasks (user_id, case_id, title, notes)
       values ('user_1', $1, 'Managed task', $2)`,
      [caseId, task.notes]
    );
  }
}

const CASE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const canonicalQuery = extractCanonicalRemediationQuery();

describe("justice_case_tasks_dedupe_key migration — duplicate detection is empirically correct against real Postgres", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = new PGlite();
    await bootstrapSupabaseStubs(db);
    // Everything up to (but not including) the dedupe_key migration — this is the pre-flight
    // state the apply procedure's step 1 query actually runs against in Production.
    await applyMigrationsThrough(db, "20260916120000_justice_case_payments_intended_action.sql");
  });

  afterAll(async () => {
    await db.close();
  });

  it("finds the canonical query in the apply procedure doc, identical at both step 1 and step 3 (sanity check)", () => {
    expect(canonicalQuery).toContain("group by split_part(notes, chr(10), 1)");
  });

  it("detects two duplicate open tasks sharing a marker even when their notes text differs after the marker line — the exact false negative the old (case_id, notes) grouping missed", async () => {
    await seedCaseAndTasks(db, CASE_ID, [
      { notes: `orphaned_paid_case_approval_queue:${CASE_ID}\nDraft: consumer says the company never refunded the $400 charge.` },
      { notes: `orphaned_paid_case_approval_queue:${CASE_ID}\nDraft: second review pass, consumer added a follow-up complaint about shipping delays.` },
    ]);

    const result = await db.query<{ marker: string; open_count: string; task_ids: string[] }>(
      canonicalQuery
    );

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.marker).toBe(`orphaned_paid_case_approval_queue:${CASE_ID}`);
    expect(Number(result.rows[0]?.open_count)).toBe(2);
    expect(result.rows[0]?.task_ids).toHaveLength(2);
  });

  it("selects no notes/complaint text — only the marker prefix and identifiers (zero PII)", async () => {
    const result = await db.query<Record<string, unknown>>(canonicalQuery);
    expect(result.rows.length).toBeGreaterThan(0);
    for (const row of result.rows) {
      expect(Object.keys(row).sort()).toEqual(["marker", "open_count", "task_ids"]);
      const marker = row.marker as string;
      // The marker is exactly the stable prefix line, never the full notes body (no draft text).
      expect(marker).not.toMatch(/Draft:/);
      expect(marker.split("\n")).toHaveLength(1);
    }
  });

  it("does not misclassify an ordinary personal reminder task as a duplicate", async () => {
    const soloCaseId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    await seedCaseAndTasks(db, soloCaseId, [{ notes: "Call the moving company back next week." }]);

    const result = await db.query<{ marker: string }>(canonicalQuery);
    const markers = result.rows.map((r) => r.marker);
    expect(markers.some((m) => m.includes(soloCaseId))).toBe(false);
  });
});

describe("justice_case_tasks_dedupe_key migration — rollback-safe remediation", () => {
  let db: PGlite;
  const dupCaseId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

  beforeAll(async () => {
    db = new PGlite();
    await bootstrapSupabaseStubs(db);
    await applyMigrationsThrough(db, "20260916120000_justice_case_payments_intended_action.sql");
    await seedCaseAndTasks(db, dupCaseId, [
      { notes: `state_ag_filing_queue:${dupCaseId}\nFirst draft.` },
      { notes: `state_ag_filing_queue:${dupCaseId}\nSecond draft, different wording.` },
    ]);
  });

  afterAll(async () => {
    await db.close();
  });

  it("fails the migration with a named exception when a pre-existing duplicate is present", async () => {
    const migrationSql = stripUnsupportedStatements(
      fs.readFileSync(DEDUPE_KEY_MIGRATION_PATH, "utf8")
    );
    await expect(db.exec(migrationSql)).rejects.toThrow(/dedupe_key/i);
  });

  it("rolls back the whole file — dedupe_key column does not exist after the failure", async () => {
    const columnCheck = await db.query(
      `select column_name from information_schema.columns
       where table_name = 'justice_case_tasks' and column_name = 'dedupe_key'`
    );
    expect(columnCheck.rows).toHaveLength(0);
  });

  it("the canonical remediation query (never referencing dedupe_key) is still runnable immediately after the failed migration and finds the duplicate", async () => {
    expect(canonicalQuery).not.toMatch(/dedupe_key/);
    const result = await db.query<{ marker: string; open_count: string }>(canonicalQuery);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.marker).toBe(`state_ag_filing_queue:${dupCaseId}`);
    expect(Number(result.rows[0]?.open_count)).toBe(2);
  });

  it("once the duplicate is resolved, the migration applies cleanly and the unique index rejects a fresh real duplicate", async () => {
    const extraTaskId = await db.query<{ id: string }>(
      `select id from justice_case_tasks where case_id = $1 order by created_at desc limit 1`,
      [dupCaseId]
    );
    await db.query(`update justice_case_tasks set completed_at = now() where id = $1`, [
      extraTaskId.rows[0]?.id,
    ]);

    const migrationSql = stripUnsupportedStatements(
      fs.readFileSync(DEDUPE_KEY_MIGRATION_PATH, "utf8")
    );
    await db.exec(migrationSql);

    const columnCheck = await db.query(
      `select column_name from information_schema.columns
       where table_name = 'justice_case_tasks' and column_name = 'dedupe_key'`
    );
    expect(columnCheck.rows).toHaveLength(1);

    await db.exec("begin");
    try {
      await db.query(
        `insert into justice_case_tasks (user_id, case_id, title, notes, dedupe_key)
         values ('smoke', $1, 'smoke', 'smoke', '__test_smoke__')`,
        [dupCaseId]
      );
      await expect(
        db.query(
          `insert into justice_case_tasks (user_id, case_id, title, notes, dedupe_key)
           values ('smoke', $1, 'smoke', 'smoke', '__test_smoke__')`,
          [dupCaseId]
        )
      ).rejects.toThrow(/unique/i);
    } finally {
      await db.exec("rollback");
    }
  });
});

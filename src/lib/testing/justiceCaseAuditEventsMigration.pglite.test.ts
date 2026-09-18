import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

/**
 * Empirical, real-Postgres (WASM PGlite, no Docker/network) regression coverage for
 * repair_orphaned_paid_case_approval_intake — the atomic RPC that replaced a two-round-trip
 * Node-side "update intake, then append a timeline entry" sequence a release audit proved could
 * leave a genuinely-committed intake correction with no durable audit record if the second step
 * failed, with nothing in the codebase ever revisiting it. This runs the actual migration files
 * (not a reconstruction) against a real Postgres engine, calling the real SQL function exactly as
 * the app does via supabase.rpc(...), as the actual service_role identity the app authenticates
 * as (not the PGlite superuser), so RLS and GRANT behavior match production.
 */

const MIGRATIONS_DIR = path.join(process.cwd(), "supabase", "migrations");

function readAllMigrations(): string[] {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => fs.readFileSync(path.join(MIGRATIONS_DIR, name), "utf8"));
}

function stripUnsupportedStatements(sql: string): string {
  return sql.replace(/create extension if not exists pgcrypto;\s*/gi, "");
}

async function bootstrapSupabaseStubs(db: PGlite): Promise<void> {
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
        -- Real Supabase grants service_role BYPASSRLS; without it, this role can insert/select
        -- nothing on tables like justice_cases that enable RLS with zero policies.
        create role service_role bypassrls;
      end if;
    end $$;

    create schema if not exists auth;
    create or replace function auth.uid() returns uuid as $$
      select null::uuid;
    $$ language sql stable;
  `);
}

type RepairResult = {
  status: string;
  case_updated_at?: string;
  case_intake?: unknown;
  audit_event_id?: string;
};

async function repair(
  db: PGlite,
  args: {
    caseId: string;
    taskId: string;
    userId: string;
    expectedUpdatedAt: string;
    intake: unknown;
    actor: string;
  }
): Promise<RepairResult> {
  const r = await db.query<{ result: RepairResult }>(
    `select repair_orphaned_paid_case_approval_intake($1,$2,$3,$4,$5,$6) as result`,
    [args.caseId, args.taskId, args.userId, args.expectedUpdatedAt, JSON.stringify(args.intake), args.actor]
  );
  return r.rows[0].result;
}

async function caseUpdatedAt(db: PGlite, caseId: string): Promise<string> {
  const r = await db.query<{ updated_at: string }>(`select updated_at from justice_cases where id = $1`, [
    caseId,
  ]);
  return r.rows[0].updated_at;
}

const CASE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TASK_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const USER_ID = "user_1";
const OPERATOR = "operator_1";
const MARKER = `orphaned_paid_case_approval_queue:${CASE_ID}`;

describe("repair_orphaned_paid_case_approval_intake — atomic intake correction + immutable audit", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = new PGlite();
    await bootstrapSupabaseStubs(db);
    for (const sql of readAllMigrations()) {
      await db.exec(stripUnsupportedStatements(sql));
    }
    await db.exec(`set role service_role;`);
  });

  afterAll(async () => {
    await db.exec(`reset role;`);
    await db.close();
  });

  beforeEach(async () => {
    // Deleting the case cascades to its tasks and audit events (both FK'd ON DELETE CASCADE) —
    // service_role is never granted DELETE on justice_case_audit_events directly (see the
    // immutability test below), but the cascade fires as part of the FK's own referential-integrity
    // enforcement, not a direct DML grant check, so cleanup between tests still works.
    await db.query(`delete from justice_cases`);
    await db.query(`insert into justice_cases (id, user_id, intake) values ($1, $2, '{"invalid": true}'::jsonb)`, [
      CASE_ID,
      USER_ID,
    ]);
    await db.query(
      `insert into justice_case_tasks (id, user_id, case_id, title, notes) values ($1, $2, $3, 'Review', $4)`,
      [TASK_ID, USER_ID, CASE_ID, `${MARKER}\nreason: invalid_intake`]
    );
  });

  it("applies the correction and records exactly one immutable audit event in the same transaction", async () => {
    const t0 = await caseUpdatedAt(db, CASE_ID);
    const intake = { company_name: "Corrected A" };
    const result = await repair(db, {
      caseId: CASE_ID,
      taskId: TASK_ID,
      userId: USER_ID,
      expectedUpdatedAt: t0,
      intake,
      actor: OPERATOR,
    });
    expect(result.status).toBe("applied");
    expect(result.audit_event_id).toBeTruthy();

    const audit = await db.query<{ actor: string; task_id: string; intake_snapshot: unknown }>(
      `select actor, task_id, intake_snapshot from justice_case_audit_events`
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].actor).toBe(OPERATOR);
    expect(audit.rows[0].intake_snapshot).toEqual(intake);

    const caseRow = await db.query<{ intake: unknown }>(`select intake from justice_cases where id = $1`, [
      CASE_ID,
    ]);
    expect(caseRow.rows[0].intake).toEqual(intake);
  });

  it("no-client-retry failure mode is structurally eliminated: a single call either commits both the intake and the audit, or commits neither — never one without the other", async () => {
    // This is the exact bug the audit trail gap depended on: intake commits, then a SEPARATE
    // audit write fails, and nobody ever retries. With intake + audit in one transaction there is
    // no second step to fail independently — a single, un-retried call already guarantees both or
    // neither. Assert both exist after exactly one call, with no retry of any kind.
    const t0 = await caseUpdatedAt(db, CASE_ID);
    const result = await repair(db, {
      caseId: CASE_ID,
      taskId: TASK_ID,
      userId: USER_ID,
      expectedUpdatedAt: t0,
      intake: { company_name: "Only ever called once" },
      actor: OPERATOR,
    });
    expect(result.status).toBe("applied");
    const audit = await db.query<{ n: number }>(`select count(*)::int as n from justice_case_audit_events`);
    expect(audit.rows[0].n).toBe(1);
    const caseRow = await db.query<{ intake: unknown }>(`select intake from justice_cases where id = $1`, [
      CASE_ID,
    ]);
    expect(caseRow.rows[0].intake).toEqual({ company_name: "Only ever called once" });
  });

  it("atomic rollback: if the final write fails after the audit insert, the audit insert is rolled back too — never left dangling", async () => {
    // Force a genuine runtime failure inside the function, after the audit row has already been
    // inserted, by adding a constraint the corrected intake deliberately violates. ALTER TABLE
    // requires table ownership, so this one statement runs as the superuser; the RPC call itself
    // still runs as service_role, matching production.
    await db.exec(`reset role;`);
    await db.exec(`
      alter table justice_cases
        add constraint chk_test_poison_intake check (not (intake ? '__force_fail__'));
    `);
    await db.exec(`set role service_role;`);
    try {
      const t0 = await caseUpdatedAt(db, CASE_ID);
      await expect(
        repair(db, {
          caseId: CASE_ID,
          taskId: TASK_ID,
          userId: USER_ID,
          expectedUpdatedAt: t0,
          intake: { __force_fail__: true },
          actor: OPERATOR,
        })
      ).rejects.toThrow();

      const audit = await db.query<{ n: number }>(`select count(*)::int as n from justice_case_audit_events`);
      expect(audit.rows[0].n).toBe(0);
      const caseRow = await db.query<{ intake: unknown; updated_at: string }>(
        `select intake, updated_at from justice_cases where id = $1`,
        [CASE_ID]
      );
      expect(caseRow.rows[0].intake).toEqual({ invalid: true });
      expect(new Date(caseRow.rows[0].updated_at).toISOString()).toBe(new Date(t0).toISOString());
    } finally {
      await db.exec(`reset role;`);
      await db.exec(`alter table justice_cases drop constraint chk_test_poison_intake;`);
      await db.exec(`set role service_role;`);
    }
  });

  it("an exact retry with unchanged content deduplicates to a single audit event, even against a stale expected_updated_at", async () => {
    const t0 = await caseUpdatedAt(db, CASE_ID);
    const intake = { company_name: "Corrected A" };
    const first = await repair(db, {
      caseId: CASE_ID,
      taskId: TASK_ID,
      userId: USER_ID,
      expectedUpdatedAt: t0,
      intake,
      actor: OPERATOR,
    });
    expect(first.status).toBe("applied");

    // Retried with the SAME (now stale) t0 token — simulates a client that never learned the
    // first attempt succeeded.
    const retry = await repair(db, {
      caseId: CASE_ID,
      taskId: TASK_ID,
      userId: USER_ID,
      expectedUpdatedAt: t0,
      intake,
      actor: OPERATOR,
    });
    expect(retry.status).toBe("already_applied");
    expect(retry.audit_event_id).toBe(first.audit_event_id);

    const audit = await db.query<{ n: number }>(`select count(*)::int as n from justice_case_audit_events`);
    expect(audit.rows[0].n).toBe(1);
  });

  it("two distinct corrections on the same still-open task each get their own audit event and their own timeline entry", async () => {
    const t0 = await caseUpdatedAt(db, CASE_ID);
    const a = await repair(db, {
      caseId: CASE_ID,
      taskId: TASK_ID,
      userId: USER_ID,
      expectedUpdatedAt: t0,
      intake: { company_name: "Corrected A" },
      actor: OPERATOR,
    });
    expect(a.status).toBe("applied");
    const t1 = await caseUpdatedAt(db, CASE_ID);

    const b = await repair(db, {
      caseId: CASE_ID,
      taskId: TASK_ID,
      userId: USER_ID,
      expectedUpdatedAt: t1,
      intake: { company_name: "Corrected B" },
      actor: OPERATOR,
    });
    expect(b.status).toBe("applied");
    expect(b.audit_event_id).not.toBe(a.audit_event_id);

    const audit = await db.query<{ n: number }>(`select count(*)::int as n from justice_case_audit_events`);
    expect(audit.rows[0].n).toBe(2);

    const caseRow = await db.query<{ intake: unknown; timeline: { id: string }[] }>(
      `select intake, timeline from justice_cases where id = $1`,
      [CASE_ID]
    );
    expect(caseRow.rows[0].intake).toEqual({ company_name: "Corrected B" });
    expect(caseRow.rows[0].timeline).toHaveLength(2);
  });

  it("operator/operator race: a second, DIFFERENT correction against a stale token is refused (409-equivalent 'conflict'), and the first correction's write is never overwritten", async () => {
    const t0 = await caseUpdatedAt(db, CASE_ID);
    const winner = await repair(db, {
      caseId: CASE_ID,
      taskId: TASK_ID,
      userId: USER_ID,
      expectedUpdatedAt: t0,
      intake: { company_name: "Winner" },
      actor: "operator_winner",
    });
    expect(winner.status).toBe("applied");
    // Guarantee the row's updated_at has genuinely advanced past t0 before the loser's stale
    // request races in — PGlite's clock can otherwise report the same instant for two statements
    // executed back-to-back with no real I/O between them.
    await new Promise((resolve) => setTimeout(resolve, 5));

    const loser = await repair(db, {
      caseId: CASE_ID,
      taskId: TASK_ID,
      userId: USER_ID,
      expectedUpdatedAt: t0, // stale — never learned about the winner's commit
      intake: { company_name: "Loser" },
      actor: "operator_loser",
    });
    expect(loser.status).toBe("conflict");

    const caseRow = await db.query<{ intake: unknown }>(`select intake from justice_cases where id = $1`, [
      CASE_ID,
    ]);
    expect(caseRow.rows[0].intake).toEqual({ company_name: "Winner" });
    const audit = await db.query<{ n: number }>(`select count(*)::int as n from justice_case_audit_events`);
    expect(audit.rows[0].n).toBe(1);
  });

  it("operator/consumer race: an unrelated direct write to justice_cases.intake (simulating a consumer PATCH landing in between) makes the operator's stale retry conflict rather than clobber the consumer's newer data", async () => {
    const t0 = await caseUpdatedAt(db, CASE_ID);
    const opResult = await repair(db, {
      caseId: CASE_ID,
      taskId: TASK_ID,
      userId: USER_ID,
      expectedUpdatedAt: t0,
      intake: { company_name: "Operator correction" },
      actor: OPERATOR,
    });
    expect(opResult.status).toBe("applied");
    await new Promise((resolve) => setTimeout(resolve, 5));

    // A consumer writes their own (now CAS-protected, but here simulated directly at the SQL
    // level) newer intake in between.
    await db.query(`update justice_cases set intake = $1 where id = $2`, [
      JSON.stringify({ company_name: "Consumer edit" }),
      CASE_ID,
    ]);

    // Operator retries their original (now doubly stale) request.
    const retry = await repair(db, {
      caseId: CASE_ID,
      taskId: TASK_ID,
      userId: USER_ID,
      expectedUpdatedAt: t0,
      intake: { company_name: "Operator correction" },
      actor: OPERATOR,
    });
    expect(retry.status).toBe("conflict");

    const caseRow = await db.query<{ intake: unknown }>(`select intake from justice_cases where id = $1`, [
      CASE_ID,
    ]);
    expect(caseRow.rows[0].intake).toEqual({ company_name: "Consumer edit" });
  });

  it("consumer cannot erase audit history: a direct, blind rewrite of intake and timeline never touches justice_case_audit_events", async () => {
    const t0 = await caseUpdatedAt(db, CASE_ID);
    await repair(db, {
      caseId: CASE_ID,
      taskId: TASK_ID,
      userId: USER_ID,
      expectedUpdatedAt: t0,
      intake: { company_name: "Corrected" },
      actor: OPERATOR,
    });
    const before = await db.query<{ n: number }>(`select count(*)::int as n from justice_case_audit_events`);
    expect(before.rows[0].n).toBe(1);

    // Simulate the worst case: a caller blindly overwrites BOTH intake and timeline (exactly the
    // pre-fix consumer PATCH shape), wiping the visible mirror entirely.
    await db.query(`update justice_cases set intake = '{"x":1}'::jsonb, timeline = '[]'::jsonb where id = $1`, [
      CASE_ID,
    ]);

    const after = await db.query<{ n: number }>(`select count(*)::int as n from justice_case_audit_events`);
    expect(after.rows[0].n).toBe(1);
  });

  it("immutability is enforced by privilege, not convention: service_role itself cannot UPDATE or DELETE audit rows", async () => {
    const t0 = await caseUpdatedAt(db, CASE_ID);
    await repair(db, {
      caseId: CASE_ID,
      taskId: TASK_ID,
      userId: USER_ID,
      expectedUpdatedAt: t0,
      intake: { company_name: "Corrected" },
      actor: OPERATOR,
    });

    await expect(db.query(`update justice_case_audit_events set actor = 'tampered'`)).rejects.toThrow(
      /permission denied/i
    );
    await expect(db.query(`delete from justice_case_audit_events`)).rejects.toThrow(/permission denied/i);

    const audit = await db.query<{ actor: string }>(`select actor from justice_case_audit_events`);
    expect(audit.rows[0].actor).toBe(OPERATOR);
  });

  it("rejects with 'task_conflict' when no open, correctly-marked task binds this case (task missing, completed, wrong case, or wrong marker)", async () => {
    const t0 = await caseUpdatedAt(db, CASE_ID);
    const base = {
      caseId: CASE_ID,
      userId: USER_ID,
      expectedUpdatedAt: t0,
      intake: { company_name: "X" },
      actor: OPERATOR,
    };

    const missing = await repair(db, { ...base, taskId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" });
    expect(missing.status).toBe("task_conflict");

    await db.query(`update justice_case_tasks set completed_at = now() where id = $1`, [TASK_ID]);
    const completed = await repair(db, { ...base, taskId: TASK_ID });
    expect(completed.status).toBe("task_conflict");
    await db.query(`update justice_case_tasks set completed_at = null where id = $1`, [TASK_ID]);

    await db.query(`update justice_case_tasks set notes = $1 where id = $2`, [
      "state_ag_filing_queue:" + CASE_ID,
      TASK_ID,
    ]);
    const wrongMarker = await repair(db, { ...base, taskId: TASK_ID });
    expect(wrongMarker.status).toBe("task_conflict");

    const audit = await db.query<{ n: number }>(`select count(*)::int as n from justice_case_audit_events`);
    expect(audit.rows[0].n).toBe(0);
  });

  it("returns 'not_found' when the case does not exist for the given user_id", async () => {
    const result = await repair(db, {
      caseId: CASE_ID,
      taskId: TASK_ID,
      userId: "someone_else",
      expectedUpdatedAt: await caseUpdatedAt(db, CASE_ID),
      intake: { company_name: "X" },
      actor: OPERATOR,
    });
    expect(result.status).toBe("not_found");
  });
});

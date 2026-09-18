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
 *
 * Every test in this file uses justice_cases.case_version — a monotonic bigint bumped by exactly
 * 1 on every UPDATE by the bump_justice_cases_case_version trigger — as the sole optimistic-
 * concurrency token, never updated_at. A prior audit round proved empirically against this same
 * PGlite engine that updated_at (a wall-clock timestamp) is NOT strictly monotonic under rapid or
 * racing writes: two writers sharing a stale updated_at token both "succeeded" (a silent lost
 * update) in roughly a third to half of trials with no sleep involved, purely from millisecond-
 * level clock collisions. None of the tests below use pg_sleep or any other wall-clock wait —
 * case_version's correctness does not depend on real time passing between writes.
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
  case_version?: number;
  case_intake?: unknown;
  audit_event_id?: string;
};

async function repair(
  db: PGlite,
  args: {
    caseId: string;
    taskId: string;
    userId: string;
    expectedCaseVersion: number | null;
    intake: unknown;
    actor: string;
  }
): Promise<RepairResult> {
  const r = await db.query<{ result: RepairResult }>(
    `select repair_orphaned_paid_case_approval_intake($1,$2,$3,$4,$5,$6) as result`,
    [args.caseId, args.taskId, args.userId, args.expectedCaseVersion, JSON.stringify(args.intake), args.actor]
  );
  return r.rows[0].result;
}

async function caseVersion(db: PGlite, caseId: string): Promise<number> {
  const r = await db.query<{ case_version: number }>(
    `select case_version from justice_cases where id = $1`,
    [caseId]
  );
  return r.rows[0].case_version;
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

  it("new case_version defaults to 1", async () => {
    expect(await caseVersion(db, CASE_ID)).toBe(1);
  });

  it("applies the correction and records exactly one immutable audit event in the same transaction", async () => {
    const t0 = await caseVersion(db, CASE_ID);
    const intake = { company_name: "Corrected A" };
    const result = await repair(db, {
      caseId: CASE_ID,
      taskId: TASK_ID,
      userId: USER_ID,
      expectedCaseVersion: t0,
      intake,
      actor: OPERATOR,
    });
    expect(result.status).toBe("applied");
    expect(result.audit_event_id).toBeTruthy();
    expect(result.case_version).toBe(t0 + 1);

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
    const t0 = await caseVersion(db, CASE_ID);
    const result = await repair(db, {
      caseId: CASE_ID,
      taskId: TASK_ID,
      userId: USER_ID,
      expectedCaseVersion: t0,
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

  it("atomic rollback: if the final write fails after the audit insert, the audit insert is rolled back too — never left dangling, and case_version never advances", async () => {
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
      const t0 = await caseVersion(db, CASE_ID);
      await expect(
        repair(db, {
          caseId: CASE_ID,
          taskId: TASK_ID,
          userId: USER_ID,
          expectedCaseVersion: t0,
          intake: { __force_fail__: true },
          actor: OPERATOR,
        })
      ).rejects.toThrow();

      const audit = await db.query<{ n: number }>(`select count(*)::int as n from justice_case_audit_events`);
      expect(audit.rows[0].n).toBe(0);
      const caseRow = await db.query<{ intake: unknown; case_version: number }>(
        `select intake, case_version from justice_cases where id = $1`,
        [CASE_ID]
      );
      expect(caseRow.rows[0].intake).toEqual({ invalid: true });
      // Exact integer equality — no Date parsing/precision involved, unlike the updated_at this
      // replaced: a rolled-back transaction must leave case_version byte-for-byte unchanged.
      expect(caseRow.rows[0].case_version).toBe(t0);
    } finally {
      await db.exec(`reset role;`);
      await db.exec(`alter table justice_cases drop constraint chk_test_poison_intake;`);
      await db.exec(`set role service_role;`);
    }
  });

  it("an exact retry with unchanged content deduplicates to a single audit event, even against a stale expected_case_version", async () => {
    const t0 = await caseVersion(db, CASE_ID);
    const intake = { company_name: "Corrected A" };
    const first = await repair(db, {
      caseId: CASE_ID,
      taskId: TASK_ID,
      userId: USER_ID,
      expectedCaseVersion: t0,
      intake,
      actor: OPERATOR,
    });
    expect(first.status).toBe("applied");

    // Retried with the SAME (now stale) t0 token — simulates a client that never learned the
    // first attempt succeeded (a lost-response retry).
    const retry = await repair(db, {
      caseId: CASE_ID,
      taskId: TASK_ID,
      userId: USER_ID,
      expectedCaseVersion: t0,
      intake,
      actor: OPERATOR,
    });
    expect(retry.status).toBe("already_applied");
    expect(retry.audit_event_id).toBe(first.audit_event_id);

    const audit = await db.query<{ n: number }>(`select count(*)::int as n from justice_case_audit_events`);
    expect(audit.rows[0].n).toBe(1);
  });

  it("two distinct corrections on the same still-open task each get their own audit event and their own timeline entry", async () => {
    const t0 = await caseVersion(db, CASE_ID);
    const a = await repair(db, {
      caseId: CASE_ID,
      taskId: TASK_ID,
      userId: USER_ID,
      expectedCaseVersion: t0,
      intake: { company_name: "Corrected A" },
      actor: OPERATOR,
    });
    expect(a.status).toBe("applied");
    const t1 = await caseVersion(db, CASE_ID);
    expect(t1).toBe(t0 + 1);

    const b = await repair(db, {
      caseId: CASE_ID,
      taskId: TASK_ID,
      userId: USER_ID,
      expectedCaseVersion: t1,
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

  it("A -> B -> A: three genuine, sequentially-versioned corrections apply successfully and produce three audit events and three distinct timeline entries — content alone never dedupes a real transition", async () => {
    const A = { company_name: "A" };
    const B = { company_name: "B" };

    const t0 = await caseVersion(db, CASE_ID);
    const r1 = await repair(db, {
      caseId: CASE_ID,
      taskId: TASK_ID,
      userId: USER_ID,
      expectedCaseVersion: t0,
      intake: A,
      actor: OPERATOR,
    });
    expect(r1.status).toBe("applied");

    const t1 = await caseVersion(db, CASE_ID);
    // Exact +1, not merely "different" — the monotonic-integer guarantee this migration exists
    // to provide, in place of updated_at's "usually different, but not always" timestamp.
    expect(t1).toBe(t0 + 1);
    const r2 = await repair(db, {
      caseId: CASE_ID,
      taskId: TASK_ID,
      userId: USER_ID,
      expectedCaseVersion: t1,
      intake: B,
      actor: OPERATOR,
    });
    expect(r2.status).toBe("applied");

    // Third call reverts to A's exact content, but with a FRESH, correct expected_case_version —
    // a genuine, intentional, distinct transition, not a retry of call 1.
    const t2 = await caseVersion(db, CASE_ID);
    expect(t2).toBe(t1 + 1);
    const r3 = await repair(db, {
      caseId: CASE_ID,
      taskId: TASK_ID,
      userId: USER_ID,
      expectedCaseVersion: t2,
      intake: A,
      actor: OPERATOR,
    });
    expect(r3.status).toBe("applied");
    expect(r3.case_intake).toEqual(A);

    // Never conflates with call 1's audit event, despite identical content.
    expect(r3.audit_event_id).not.toBe(r1.audit_event_id);
    expect(new Set([r1.audit_event_id, r2.audit_event_id, r3.audit_event_id]).size).toBe(3);

    const audit = await db.query<{ n: number }>(`select count(*)::int as n from justice_case_audit_events`);
    expect(audit.rows[0].n).toBe(3);

    const caseRow = await db.query<{ intake: unknown; timeline: { id: string }[] }>(
      `select intake, timeline from justice_cases where id = $1`,
      [CASE_ID]
    );
    expect(caseRow.rows[0].intake).toEqual(A);
    expect(caseRow.rows[0].timeline).toHaveLength(3);
    expect(new Set(caseRow.rows[0].timeline.map((e) => e.id)).size).toBe(3);
  });

  it("case_version keeps advancing even when updated_at is frozen identical across writes — the migration's core guarantee is fully independent of wall-clock behavior", async () => {
    // Disable the pre-existing updated_at trigger and pin updated_at to one fixed value across
    // two separate corrections, simulating the exact clock-collision conditions a prior audit
    // round proved happen for real (millisecond-level updated_at collisions under rapid writes).
    // No pg_sleep anywhere in this test — case_version does not need real time to pass.
    await db.exec(`reset role;`);
    await db.exec(`alter table justice_cases disable trigger set_justice_cases_updated_at;`);
    const FROZEN = "2026-01-01T00:00:00.000Z";
    await db.query(`update justice_cases set updated_at = $1 where id = $2`, [FROZEN, CASE_ID]);
    await db.exec(`set role service_role;`);
    try {
      // With set_justice_cases_updated_at disabled, NOTHING in this block — including the RPC's
      // own internal justice_cases.update() — ever stamps a fresh updated_at, so it stays frozen
      // at FROZEN across both writes below with no need to re-set it in between.
      const t0 = await caseVersion(db, CASE_ID);
      const r1 = await repair(db, {
        caseId: CASE_ID,
        taskId: TASK_ID,
        userId: USER_ID,
        expectedCaseVersion: t0,
        intake: { company_name: "First" },
        actor: OPERATOR,
      });
      expect(r1.status).toBe("applied");
      expect(r1.case_version).toBe(t0 + 1);

      const t1 = await caseVersion(db, CASE_ID);
      expect(t1).toBe(t0 + 1);
      const r2 = await repair(db, {
        caseId: CASE_ID,
        taskId: TASK_ID,
        userId: USER_ID,
        expectedCaseVersion: t1,
        intake: { company_name: "Second" },
        actor: OPERATOR,
      });
      expect(r2.status).toBe("applied");
      expect(r2.case_version).toBe(t1 + 1);

      const finalRow = await db.query<{ updated_at: string; case_version: number }>(
        `select updated_at, case_version from justice_cases where id = $1`,
        [CASE_ID]
      );
      // updated_at is byte-identical to what it was before either write (proving this test's
      // "frozen clock" setup genuinely held) — yet case_version still strictly advanced twice.
      expect(new Date(finalRow.rows[0].updated_at).toISOString()).toBe(new Date(FROZEN).toISOString());
      expect(finalRow.rows[0].case_version).toBe(t0 + 2);
    } finally {
      await db.exec(`reset role;`);
      await db.exec(`alter table justice_cases enable trigger set_justice_cases_updated_at;`);
      await db.exec(`set role service_role;`);
    }
  });

  it("rapid writes, zero pg_sleep: a tight sequential loop of corrections never loses an update and case_version advances by exactly 1 each time", async () => {
    let expected = await caseVersion(db, CASE_ID);
    for (let i = 1; i <= 20; i++) {
      const result = await repair(db, {
        caseId: CASE_ID,
        taskId: TASK_ID,
        userId: USER_ID,
        expectedCaseVersion: expected,
        intake: { company_name: `Rapid ${i}` },
        actor: OPERATOR,
      });
      expect(result.status).toBe("applied");
      expected += 1;
      expect(result.case_version).toBe(expected);
    }
    const audit = await db.query<{ n: number }>(`select count(*)::int as n from justice_case_audit_events`);
    expect(audit.rows[0].n).toBe(20);
    const caseRow = await db.query<{ intake: unknown }>(`select intake from justice_cases where id = $1`, [
      CASE_ID,
    ]);
    expect(caseRow.rows[0].intake).toEqual({ company_name: "Rapid 20" });
  });

  it("same-token racing writers: many concurrent corrections sharing the identical stale expected_case_version — exactly one applies, the rest conflict, and no audit event is lost or duplicated", async () => {
    const t0 = await caseVersion(db, CASE_ID);
    const TRIALS = 25;
    const results = await Promise.all(
      Array.from({ length: TRIALS }, (_, i) =>
        repair(db, {
          caseId: CASE_ID,
          taskId: TASK_ID,
          userId: USER_ID,
          expectedCaseVersion: t0,
          intake: { company_name: `Racer ${i}` },
          actor: `operator_${i}`,
        })
      )
    );
    const applied = results.filter((r) => r.status === "applied");
    const conflicted = results.filter((r) => r.status === "conflict");
    expect(applied).toHaveLength(1);
    expect(conflicted).toHaveLength(TRIALS - 1);

    const audit = await db.query<{ n: number }>(`select count(*)::int as n from justice_case_audit_events`);
    expect(audit.rows[0].n).toBe(1);
    expect(await caseVersion(db, CASE_ID)).toBe(t0 + 1);
  });

  it("rejects with invalid_input when expected_case_version (or any other required argument) is missing", async () => {
    const r = await db.query<{ result: { status: string } }>(
      `select repair_orphaned_paid_case_approval_intake($1,$2,$3,$4,$5,$6) as result`,
      [CASE_ID, TASK_ID, USER_ID, null, JSON.stringify({ company_name: "X" }), OPERATOR]
    );
    expect(r.rows[0].result.status).toBe("invalid_input");

    const audit = await db.query<{ n: number }>(`select count(*)::int as n from justice_case_audit_events`);
    expect(audit.rows[0].n).toBe(0);
    const caseRow = await db.query<{ intake: unknown }>(`select intake from justice_cases where id = $1`, [
      CASE_ID,
    ]);
    expect(caseRow.rows[0].intake).toEqual({ invalid: true });
  });

  it("operator/operator race: a second, DIFFERENT correction against a stale token is refused ('conflict'), and the first correction's write is never overwritten", async () => {
    const t0 = await caseVersion(db, CASE_ID);
    const winner = await repair(db, {
      caseId: CASE_ID,
      taskId: TASK_ID,
      userId: USER_ID,
      expectedCaseVersion: t0,
      intake: { company_name: "Winner" },
      actor: "operator_winner",
    });
    expect(winner.status).toBe("applied");

    const loser = await repair(db, {
      caseId: CASE_ID,
      taskId: TASK_ID,
      userId: USER_ID,
      expectedCaseVersion: t0, // stale — never learned about the winner's commit
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
    const t0 = await caseVersion(db, CASE_ID);
    const opResult = await repair(db, {
      caseId: CASE_ID,
      taskId: TASK_ID,
      userId: USER_ID,
      expectedCaseVersion: t0,
      intake: { company_name: "Operator correction" },
      actor: OPERATOR,
    });
    expect(opResult.status).toBe("applied");

    // A consumer writes their own (now CAS-protected, but here simulated directly at the SQL
    // level) newer intake in between. Any UPDATE — even one that never mentions case_version —
    // advances it via the trigger, exactly like a real consumer PATCH would.
    await db.query(`update justice_cases set intake = $1 where id = $2`, [
      JSON.stringify({ company_name: "Consumer edit" }),
      CASE_ID,
    ]);

    // Operator retries their original (now doubly stale) request.
    const retry = await repair(db, {
      caseId: CASE_ID,
      taskId: TASK_ID,
      userId: USER_ID,
      expectedCaseVersion: t0,
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
    const t0 = await caseVersion(db, CASE_ID);
    await repair(db, {
      caseId: CASE_ID,
      taskId: TASK_ID,
      userId: USER_ID,
      expectedCaseVersion: t0,
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
    const t0 = await caseVersion(db, CASE_ID);
    await repair(db, {
      caseId: CASE_ID,
      taskId: TASK_ID,
      userId: USER_ID,
      expectedCaseVersion: t0,
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
    const t0 = await caseVersion(db, CASE_ID);
    const base = {
      caseId: CASE_ID,
      userId: USER_ID,
      expectedCaseVersion: t0,
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
      expectedCaseVersion: await caseVersion(db, CASE_ID),
      intake: { company_name: "X" },
      actor: OPERATOR,
    });
    expect(result.status).toBe("not_found");
  });
});

/**
 * Real-Postgres proof for the exact database mechanism api/justice/cases/[id]/route.ts's PATCH
 * handler (and every other justice_cases CAS call site — updateClientStateIfUnchanged, used by
 * all ten complete*OperatorFiling.ts files, finalizePaidPreparedPacketApproval.ts, and route.ts's
 * own client_state/archived_at CAS) relies on for end-to-end optimistic concurrency: an
 *   UPDATE ... SET <col> = $x WHERE id = $id AND user_id = $user AND case_version = $expected
 * statement, using the CLIENT- or caller-supplied expected_case_version, never a value read
 * during the same request. Every one of these call sites issues the identical .eq("case_version",
 * X) shape against the same table and the same trigger, so proving this WHERE clause's behavior
 * once — for both the intake column (this file) and the client_state column (the dedicated test
 * below) — is proof for all of them; duplicating the same assertion once per call site would add
 * lines, not confidence. The route itself is Next.js/supabase-js orchestration covered by the
 * mocked suite in route.test.ts; what genuinely needs real Postgres is whether this WHERE clause
 * actually rejects a stale token and actually accepts a fresh one.
 */
describe("justice_cases CAS — the real UPDATE...WHERE...case_version mechanism every call site depends on", () => {
  let db: PGlite;
  const CASE_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const TASK_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const USER_ID = "consumer_1";
  const OPERATOR = "operator_1";

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
    await db.query(`delete from justice_cases`);
    await db.query(
      `insert into justice_cases (id, user_id, intake) values ($1, $2, '{"invalid": true}'::jsonb)`,
      [CASE_ID, USER_ID]
    );
    await db.query(
      `insert into justice_case_tasks (id, user_id, case_id, title, notes) values ($1, $2, $3, 'Review', $4)`,
      [TASK_ID, USER_ID, CASE_ID, `orphaned_paid_case_approval_queue:${CASE_ID}\nreason: invalid_intake`]
    );
  });

  async function casUpdateIntake(expectedCaseVersion: number, intake: unknown) {
    // Exactly the statement shape route.ts issues via supabase-js for an intake-bearing PATCH:
    // .update({intake}).eq("id", id).eq("user_id", userId).eq("case_version", casToken).select(...)
    return db.query<{ intake: unknown; case_version: number }>(
      `update justice_cases set intake = $1
       where id = $2 and user_id = $3 and case_version = $4
       returning intake, case_version`,
      [JSON.stringify(intake), CASE_ID, USER_ID, expectedCaseVersion]
    );
  }

  async function casUpdateClientState(expectedCaseVersion: number, clientState: unknown) {
    // Exactly the statement shape updateClientStateIfUnchanged issues via supabase-js — the
    // shared helper behind all ten complete*OperatorFiling.ts files and
    // finalizePaidPreparedPacketApproval.ts.
    return db.query<{ client_state: unknown; case_version: number }>(
      `update justice_cases set client_state = $1
       where id = $2 and user_id = $3 and case_version = $4
       returning client_state, case_version`,
      [JSON.stringify(clientState), CASE_ID, USER_ID, expectedCaseVersion]
    );
  }

  it("create -> first save: a freshly-inserted case defaults to case_version 1, and the very first subsequent PATCH using expected_case_version=1 succeeds", async () => {
    expect(await caseVersion(db, CASE_ID)).toBe(1);
    const firstSave = await casUpdateIntake(1, { company_name: "First save after create" });
    expect(firstSave.rows).toHaveLength(1);
    expect(firstSave.rows[0].case_version).toBe(2);
  });

  it("stale-GET -> operator-repair -> late-consumer-PATCH: a write built from data read BEFORE an operator correction is rejected AFTER it, never overwriting the correction", async () => {
    // Consumer's GET happens here — this is the version their PATCH will carry.
    const consumerReadCaseVersion = await caseVersion(db, CASE_ID);

    // Operator's atomic RPC correction lands next.
    const opResult = await repair(db, {
      caseId: CASE_ID,
      taskId: TASK_ID,
      userId: USER_ID,
      expectedCaseVersion: consumerReadCaseVersion,
      intake: { company_name: "Corrected by operator" },
      actor: OPERATOR,
    });
    expect(opResult.status).toBe("applied");

    // The consumer's PATCH now arrives, carrying the version from their GET — genuinely stale,
    // through no fault of a same-request race.
    const staleWrite = await casUpdateIntake(consumerReadCaseVersion, { company_name: "Stale consumer edit" });
    expect(staleWrite.rows).toHaveLength(0); // zero rows matched — rejected, not silently applied

    const finalRow = await db.query<{ intake: unknown }>(`select intake from justice_cases where id = $1`, [
      CASE_ID,
    ]);
    expect(finalRow.rows[0].intake).toEqual({ company_name: "Corrected by operator" });
  });

  it("reload / missing cache: a fresh GET always reflects the true current case_version, and a write using a cached version from before a since-applied change is rejected while one using the freshly-reloaded version succeeds", async () => {
    const cachedVersion = await caseVersion(db, CASE_ID); // what a tab's session storage last saw

    // Another tab (or an operator) advances the case while this tab was in the background.
    await db.query(`update justice_cases set intake = $1 where id = $2`, [
      JSON.stringify({ company_name: "Changed elsewhere" }),
      CASE_ID,
    ]);

    // This tab reloads: GET returns the fresh version, distinct from what was cached.
    const reloaded = await db.query<{ intake: unknown; case_version: number }>(
      `select intake, case_version from justice_cases where id = $1`,
      [CASE_ID]
    );
    expect(reloaded.rows[0].case_version).not.toBe(cachedVersion);

    // A write still carrying the STALE cached version (as if the reload never happened) fails.
    const staleWrite = await casUpdateIntake(cachedVersion, { company_name: "Built on stale cache" });
    expect(staleWrite.rows).toHaveLength(0);

    // A write built on the freshly-reloaded version succeeds.
    const freshWrite = await casUpdateIntake(reloaded.rows[0].case_version, { company_name: "Built on reload" });
    expect(freshWrite.rows).toHaveLength(1);
  });

  it("sequential saves: each write's returned case_version is exactly the token the next write must use — a chain of three succeeds only when each uses the immediately-prior version", async () => {
    const t0 = await caseVersion(db, CASE_ID);
    const w1 = await casUpdateIntake(t0, { company_name: "First" });
    expect(w1.rows).toHaveLength(1);
    // Chain directly off the value the write itself returned — the true, authoritative new
    // version, never a separately re-queried one — and exactly +1, not merely "different".
    const t1 = w1.rows[0].case_version;
    expect(t1).toBe(t0 + 1);

    const w2 = await casUpdateIntake(t1, { company_name: "Second" });
    expect(w2.rows).toHaveLength(1);
    const t2 = w2.rows[0].case_version;
    expect(t2).toBe(t1 + 1);

    const w3 = await casUpdateIntake(t2, { company_name: "Third" });
    expect(w3.rows).toHaveLength(1);
    expect(w3.rows[0].intake).toEqual({ company_name: "Third" });
    expect(w3.rows[0].case_version).toBe(t2 + 1);

    // Reusing an EARLIER token (as if a save skipped the version update in between) fails.
    const stale = await casUpdateIntake(t0, { company_name: "Using stale t0" });
    expect(stale.rows).toHaveLength(0);
  });

  it("lost-response retry: an exact retry (same stale token resent after the client never saw the first response) is rejected at the database level — reconciliation happens at the application layer, not via a silent DB-side bypass", async () => {
    const t0 = await caseVersion(db, CASE_ID);
    const first = await casUpdateIntake(t0, { company_name: "Same content" });
    expect(first.rows).toHaveLength(1);

    // Client never learned the first attempt succeeded (e.g. the response was lost to a network
    // error) and resends the identical request with the SAME (now stale) token.
    const retry = await casUpdateIntake(t0, { company_name: "Same content" });
    expect(retry.rows).toHaveLength(0);

    // Content is unaffected either way — the retry neither corrupted nor duplicated anything.
    const finalRow = await db.query<{ intake: unknown }>(`select intake from justice_cases where id = $1`, [
      CASE_ID,
    ]);
    expect(finalRow.rows[0].intake).toEqual({ company_name: "Same content" });
  });

  it("multi-tab conflict: two tabs both load case_version=1; tab A saves first and wins; tab B's save (still believing version 1) is rejected; tab B then reloads and its next save — built on the fresh version — succeeds", async () => {
    const loadedByBothTabs = await caseVersion(db, CASE_ID);

    const tabASave = await casUpdateIntake(loadedByBothTabs, { company_name: "Tab A's edit" });
    expect(tabASave.rows).toHaveLength(1);

    const tabBSave = await casUpdateIntake(loadedByBothTabs, { company_name: "Tab B's edit" });
    expect(tabBSave.rows).toHaveLength(0); // tab B's stale save is rejected, not merged or applied

    // Tab B reloads (a real GET) and gets the true current state, including tab A's edit.
    const tabBReload = await db.query<{ intake: unknown; case_version: number }>(
      `select intake, case_version from justice_cases where id = $1`,
      [CASE_ID]
    );
    expect(tabBReload.rows[0].intake).toEqual({ company_name: "Tab A's edit" });

    // Tab B's next save, built on the reloaded version, succeeds normally.
    const tabBRetry = await casUpdateIntake(tabBReload.rows[0].case_version, { company_name: "Tab B's edit, retried" });
    expect(tabBRetry.rows).toHaveLength(1);

    const finalRow = await db.query<{ intake: unknown }>(`select intake from justice_cases where id = $1`, [
      CASE_ID,
    ]);
    expect(finalRow.rows[0].intake).toEqual({ company_name: "Tab B's edit, retried" });
  });

  it("same-token racing writers: many concurrent writes sharing the identical case_version — exactly one succeeds, never a torn or merged result", async () => {
    // PGlite is a single WASM connection, not a real multi-connection server, so genuine
    // wall-clock-concurrent statements can't be faithfully simulated here (a real race is
    // resolved by Postgres row-level locking, not by which JS Promise happens to be issued
    // first). What's actually verified is the invariant any real concurrent set reduces to
    // exactly once resolved: of many writers sharing one version, exactly one gets a matched row.
    const t0 = await caseVersion(db, CASE_ID);
    const TRIALS = 25;
    const results = await Promise.all(
      Array.from({ length: TRIALS }, (_, i) => casUpdateIntake(t0, { company_name: `Writer ${i}` }))
    );
    const winners = results.filter((r) => r.rows.length === 1);
    expect(winners).toHaveLength(1);
    expect(await caseVersion(db, CASE_ID)).toBe(t0 + 1);
  });

  it("the client_state CAS shape (updateClientStateIfUnchanged, shared by every complete*OperatorFiling.ts call site and finalizePaidPreparedPacketApproval.ts) behaves identically: stale version rejected, fresh version accepted, case_version still advances by exactly 1", async () => {
    const t0 = await caseVersion(db, CASE_ID);
    const stale = await casUpdateClientState(t0 + 999, { approved_next_action: { status: "approved" } });
    expect(stale.rows).toHaveLength(0);

    const applied = await casUpdateClientState(t0, { approved_next_action: { status: "approved" } });
    expect(applied.rows).toHaveLength(1);
    expect(applied.rows[0].case_version).toBe(t0 + 1);

    // A second writer racing on the now-stale t0 (e.g. two operator completions racing each
    // other) is rejected, never silently clobbering the winner's client_state.
    const loser = await casUpdateClientState(t0, { approved_next_action: { status: "completed" } });
    expect(loser.rows).toHaveLength(0);
    const finalRow = await db.query<{ client_state: unknown }>(
      `select client_state from justice_cases where id = $1`,
      [CASE_ID]
    );
    expect(finalRow.rows[0].client_state).toEqual({ approved_next_action: { status: "approved" } });
  });
});

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

/**
 * Guarantees updated_at will genuinely advance on the next real write, by sleeping via the
 * database engine's own clock (pg_sleep) rather than a JS setTimeout: a JS-side wait races
 * against whatever wall-clock source now() reads from and was observed to occasionally not be
 * enough under load from many other tests in the same run, since set_updated_at() unconditionally
 * stamps new.updated_at = now() on every write regardless of what the statement tried to set —
 * there is no way to force the timestamp without waiting for real time to pass from Postgres's
 * own perspective.
 */
async function ensureUpdatedAtWillAdvance(db: PGlite): Promise<void> {
  await db.query(`select pg_sleep(0.05)`);
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

  it("A -> B -> A: three genuine, distinctly-versioned corrections apply successfully and produce three audit events and three distinct timeline entries — content alone never dedupes a real transition", async () => {
    const A = { company_name: "A" };
    const B = { company_name: "B" };

    const t0 = await caseUpdatedAt(db, CASE_ID);
    const r1 = await repair(db, {
      caseId: CASE_ID,
      taskId: TASK_ID,
      userId: USER_ID,
      expectedUpdatedAt: t0,
      intake: A,
      actor: OPERATOR,
    });
    expect(r1.status).toBe("applied");

    const t1 = await caseUpdatedAt(db, CASE_ID);
    expect(t1).not.toBe(t0);
    const r2 = await repair(db, {
      caseId: CASE_ID,
      taskId: TASK_ID,
      userId: USER_ID,
      expectedUpdatedAt: t1,
      intake: B,
      actor: OPERATOR,
    });
    expect(r2.status).toBe("applied");

    // Third call reverts to A's exact content, but with a FRESH, correct expected_updated_at —
    // a genuine, intentional, distinct transition, not a retry of call 1.
    const t2 = await caseUpdatedAt(db, CASE_ID);
    expect(t2).not.toBe(t1);
    const r3 = await repair(db, {
      caseId: CASE_ID,
      taskId: TASK_ID,
      userId: USER_ID,
      expectedUpdatedAt: t2,
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

  it("rejects with invalid_input when expected_updated_at (or any other required argument) is missing", async () => {
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

  it("operator/operator race: a second, DIFFERENT correction against a stale token is refused (409-equivalent 'conflict'), and the first correction's write is never overwritten", async () => {
    const t0 = await caseUpdatedAt(db, CASE_ID);
    // Guarantee the winner's OWN write lands at a genuinely later instant than t0 (sleeping AFTER
    // the winner writes would not help — its timestamp is already fixed by then).
    await ensureUpdatedAtWillAdvance(db);
    const winner = await repair(db, {
      caseId: CASE_ID,
      taskId: TASK_ID,
      userId: USER_ID,
      expectedUpdatedAt: t0,
      intake: { company_name: "Winner" },
      actor: "operator_winner",
    });
    expect(winner.status).toBe("applied");

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
    await ensureUpdatedAtWillAdvance(db);
    const opResult = await repair(db, {
      caseId: CASE_ID,
      taskId: TASK_ID,
      userId: USER_ID,
      expectedUpdatedAt: t0,
      intake: { company_name: "Operator correction" },
      actor: OPERATOR,
    });
    expect(opResult.status).toBe("applied");

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

/**
 * Real-Postgres proof for the exact database mechanism api/justice/cases/[id]/route.ts's PATCH
 * handler relies on for intake's end-to-end optimistic concurrency: an
 * UPDATE ... SET intake = $x WHERE id = $id AND user_id = $user AND updated_at = $expected
 * statement, using the CLIENT-supplied expected_updated_at, never a value read during the same
 * request. The route itself is Next.js/supabase-js orchestration covered by the mocked suite in
 * route.test.ts; what genuinely needs real Postgres is whether this WHERE clause actually rejects
 * a stale token and actually accepts a fresh one — proven directly here, including the exact
 * scenario a release audit named: a consumer request built from data read BEFORE an operator's
 * correction, arriving AFTER it.
 */
describe("justice_cases intake CAS — the real UPDATE...WHERE...updated_at mechanism the consumer route depends on", () => {
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

  async function casUpdate(expectedUpdatedAt: string, intake: unknown) {
    // Exactly the statement shape route.ts issues via supabase-js:
    // .update({intake}).eq("id", id).eq("user_id", userId).eq("updated_at", casToken).select(...)
    return db.query<{ intake: unknown; updated_at: string }>(
      `update justice_cases set intake = $1
       where id = $2 and user_id = $3 and updated_at = $4
       returning intake, updated_at`,
      [JSON.stringify(intake), CASE_ID, USER_ID, expectedUpdatedAt]
    );
  }

  it("stale-GET -> operator-repair -> late-consumer-PATCH: a write built from data read BEFORE an operator correction is rejected AFTER it, never overwriting the correction", async () => {
    // Consumer's GET happens here — this is the version their PATCH will carry.
    const consumerReadUpdatedAt = await caseUpdatedAt(db, CASE_ID);
    // Guarantee the operator's OWN write lands at a genuinely later instant.
    await ensureUpdatedAtWillAdvance(db);

    // Operator's atomic RPC correction lands next.
    const opResult = await repair(db, {
      caseId: CASE_ID,
      taskId: TASK_ID,
      userId: USER_ID,
      expectedUpdatedAt: consumerReadUpdatedAt,
      intake: { company_name: "Corrected by operator" },
      actor: OPERATOR,
    });
    expect(opResult.status).toBe("applied");

    // The consumer's PATCH now arrives, carrying the version from their GET — genuinely stale,
    // through no fault of a same-request race.
    const staleWrite = await casUpdate(consumerReadUpdatedAt, { company_name: "Stale consumer edit" });
    expect(staleWrite.rows).toHaveLength(0); // zero rows matched — rejected, not silently applied

    const finalRow = await db.query<{ intake: unknown }>(`select intake from justice_cases where id = $1`, [
      CASE_ID,
    ]);
    expect(finalRow.rows[0].intake).toEqual({ company_name: "Corrected by operator" });
  });

  it("sequential saves: each write's returned updated_at is exactly the token the next write must use — a chain of three succeeds only when each uses the immediately-prior version", async () => {
    const t0 = await caseUpdatedAt(db, CASE_ID);
    // Guarantee w1's OWN write lands at a genuinely later instant than t0 — sleeping later would
    // not help, since by then w1's timestamp is already fixed. Every later value in the chain is
    // transitively >= w1's, so this single sleep covers the whole chain and the final stale-t0
    // check below.
    await ensureUpdatedAtWillAdvance(db);
    const w1 = await casUpdate(t0, { company_name: "First" });
    expect(w1.rows).toHaveLength(1);
    // Chain directly off the value the write itself returned — the true, authoritative new
    // version, never a separately re-queried one.
    const t1 = w1.rows[0].updated_at;

    const w2 = await casUpdate(t1, { company_name: "Second" });
    expect(w2.rows).toHaveLength(1);
    const t2 = w2.rows[0].updated_at;

    const w3 = await casUpdate(t2, { company_name: "Third" });
    expect(w3.rows).toHaveLength(1);
    expect(w3.rows[0].intake).toEqual({ company_name: "Third" });

    // Reusing an EARLIER token (as if a save skipped the version update in between) fails.
    const stale = await casUpdate(t0, { company_name: "Using stale t0" });
    expect(stale.rows).toHaveLength(0);
  });

  it("an exact retry (same stale token resent after a lost response) is rejected at the database level — reconciliation happens at the application layer, not via a silent DB-side bypass", async () => {
    const t0 = await caseUpdatedAt(db, CASE_ID);
    // Guarantee the first write's OWN timestamp is genuinely later than t0.
    await ensureUpdatedAtWillAdvance(db);
    const first = await casUpdate(t0, { company_name: "Same content" });
    expect(first.rows).toHaveLength(1);

    // Client never learned the first attempt succeeded and resends the identical request with the
    // SAME (now stale) token.
    const retry = await casUpdate(t0, { company_name: "Same content" });
    expect(retry.rows).toHaveLength(0);

    // Content is unaffected either way — the retry neither corrupted nor duplicated anything.
    const finalRow = await db.query<{ intake: unknown }>(`select intake from justice_cases where id = $1`, [
      CASE_ID,
    ]);
    expect(finalRow.rows[0].intake).toEqual({ company_name: "Same content" });
  });

  it("concurrent transitions: two writers racing on the same version — whichever commits first wins, the second (now stale) gets zero rows, never a torn/merged result", async () => {
    // PGlite is a single WASM connection, not a real multi-connection server, so genuine
    // wall-clock-concurrent statements can't be faithfully simulated here (a real race is
    // resolved by Postgres row-level locking, not by which JS Promise happens to be issued
    // first). What's actually verified is the INVARIANT any real concurrent pair reduces to
    // exactly once resolved: whichever write is NOT based on the row's current version must get
    // zero matched rows, never a merge and never a second silent success.
    const t0 = await caseUpdatedAt(db, CASE_ID);
    // Guarantee writer A's OWN write lands at a genuinely later instant than t0.
    await ensureUpdatedAtWillAdvance(db);
    const writerA = await casUpdate(t0, { company_name: "Writer A" });
    expect(writerA.rows).toHaveLength(1);

    // Writer B raced on the SAME version t0 but loses — by the time its statement is evaluated,
    // the row has already moved on.
    const writerB = await casUpdate(t0, { company_name: "Writer B" });
    expect(writerB.rows).toHaveLength(0);

    const finalRow = await db.query<{ intake: unknown }>(`select intake from justice_cases where id = $1`, [
      CASE_ID,
    ]);
    expect(finalRow.rows[0].intake).toEqual({ company_name: "Writer A" });
  });
});

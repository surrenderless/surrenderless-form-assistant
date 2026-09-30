import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { finalizePaidPreparedPacketApproval } from "@/lib/justice/finalizePaidPreparedPacketApproval";
import { buildJusticeIntakeFromParts, defaultBuildJusticeIntakeParts } from "@/lib/justice/buildJusticeIntake";
import { MANUAL_ACTION_TRACKING_REAL_STATE_AG_PREP_HREF } from "@/lib/justice/handlingTrackingProgress";
import { orphanedPaidCaseApprovalTaskNotesMarker } from "@/lib/justice/orphanedPaidCaseApprovalTask";
import { stateAgFilingTaskNotesMarker } from "@/lib/justice/stateAgFilingTask";

const CASE_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "user_1";

type CaseRow = {
  id: string;
  user_id: string;
  client_state: Record<string, unknown>;
  intake: unknown;
  paid_at: string | null;
  payment_dispute_draft?: unknown;
  timeline: unknown[];
  updated_at: string;
  case_version: number;
  orphan_recovery_confirmed_at?: string | null;
};
type TaskRow = {
  id: string;
  user_id: string;
  case_id: string;
  title: string;
  notes: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

type Store = {
  cases: CaseRow[];
  tasks: TaskRow[];
  nextTaskId?: number;
  /** Forces every justice_cases CAS write in this test to fail once with a stale-case_version
   *  conflict before succeeding — simulates a concurrent writer winning the race. */
  conflictOnFirstCaseWrite?: boolean;
  failTaskInsert?: boolean;
};

let taskCounter = 0;

function bumpUpdatedAt(): string {
  taskCounter += 1;
  return new Date(Date.parse("2026-08-01T00:00:00.000Z") + taskCounter * 1000).toISOString();
}

function makeSupabase(store: Store): SupabaseClient {
  const from = (table: string) => {
    if (table === "justice_cases") {
      const state: {
        op: "select" | "update";
        filters: Record<string, string | number>;
        isNullFilters: string[];
        payload?: Record<string, unknown>;
      } = { op: "select", filters: {}, isNullFilters: [] };

      const resolve = () => {
        if (state.op === "update") {
          const row = store.cases.find(
            (c) =>
              c.id === state.filters.id &&
              c.user_id === state.filters.user_id &&
              (state.filters.case_version === undefined || c.case_version === state.filters.case_version) &&
              state.isNullFilters.every(
                (col) => (c as unknown as Record<string, unknown>)[col] == null
              )
          );
          if (!row) return { data: null, error: null }; // CAS miss — updateClientStateIfUnchanged treats as conflict
          if (store.conflictOnFirstCaseWrite) {
            store.conflictOnFirstCaseWrite = false;
            return { data: null, error: null };
          }
          Object.assign(row, state.payload);
          row.updated_at = bumpUpdatedAt();
          row.case_version += 1;
          return { data: { id: row.id }, error: null };
        }
        const row = store.cases.find(
          (c) => c.id === state.filters.id && c.user_id === state.filters.user_id
        );
        return { data: row ? { ...row } : null, error: null };
      };

      const builder: Record<string, unknown> = {
        // A trailing .select("id") after .update(...) (for the returning row) must NOT reset
        // this back to a plain select — only the very first call in the chain decides the op.
        select: () => {
          if (state.op !== "update") state.op = "select";
          return builder;
        },
        update: (payload: Record<string, unknown>) => {
          state.op = "update";
          state.payload = payload;
          return builder;
        },
        eq: (col: string, val: string | number) => {
          state.filters[col] = val;
          return builder;
        },
        is: (col: string, val: unknown) => {
          if (val === null) state.isNullFilters.push(col);
          return builder;
        },
        maybeSingle: async () => resolve(),
        then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
          Promise.resolve(resolve()).then(onF, onR),
      };
      return builder as unknown as ReturnType<SupabaseClient["from"]>;
    }

    if (table === "justice_case_tasks") {
      const state: {
        op: "select" | "insert" | "update";
        filters: Record<string, string>;
        like: string | null;
        insertPayload?: Record<string, unknown>;
        updatePayload?: Record<string, unknown>;
      } = { op: "select", filters: {}, like: null };

      const resolveUpdate = () => {
        const row = store.tasks.find(
          (t) => t.id === state.filters.id && t.user_id === state.filters.user_id
        );
        if (!row) return { data: null, error: null };
        Object.assign(row, state.updatePayload);
        return { data: row, error: null };
      };

      const builder: Record<string, unknown> = {
        select: () => {
          if (state.op !== "update") state.op = "select";
          return builder;
        },
        eq: (col: string, val: string) => {
          state.filters[col] = val;
          return builder;
        },
        like: (_col: string, pattern: string) => {
          state.like = pattern;
          return builder;
        },
        is: () => builder,
        limit: async () => {
          const needle = state.like ? state.like.replace(/%/g, "") : "";
          const rows = store.tasks.filter(
            (t) =>
              t.case_id === state.filters.case_id &&
              t.user_id === state.filters.user_id &&
              !t.completed_at &&
              (!needle || t.notes.includes(needle))
          );
          return { data: rows, error: null };
        },
        insert: (payload: Record<string, unknown>) => {
          state.op = "insert";
          state.insertPayload = payload;
          return builder;
        },
        update: (payload: Record<string, unknown>) => {
          state.op = "update";
          state.updatePayload = payload;
          return builder;
        },
        maybeSingle: async () => resolveUpdate(),
        single: async () => {
          if (store.failTaskInsert) return { data: null, error: { message: "task insert down" } };
          store.nextTaskId = (store.nextTaskId ?? 0) + 1;
          const id = `task_${store.nextTaskId}`;
          const now = new Date().toISOString();
          const row: TaskRow = {
            id,
            user_id: String(state.insertPayload?.user_id),
            case_id: String(state.insertPayload?.case_id),
            title: String(state.insertPayload?.title ?? ""),
            notes: String(state.insertPayload?.notes ?? ""),
            completed_at: null,
            created_at: now,
            updated_at: now,
          };
          store.tasks.push(row);
          return { data: row, error: null };
        },
      };
      return builder as unknown as ReturnType<SupabaseClient["from"]>;
    }

    throw new Error(`unexpected table ${table}`);
  };
  return { from } as unknown as SupabaseClient;
}

function validIntake(): unknown {
  return buildJusticeIntakeFromParts({
    ...defaultBuildJusticeIntakeParts(),
    problem_category: "online_purchase",
    company_name: "Acme Retail",
    already_contacted: "yes",
  });
}

function baseCase(overrides: Partial<CaseRow> = {}): CaseRow {
  return {
    id: CASE_ID,
    user_id: USER_ID,
    client_state: {},
    intake: validIntake(),
    paid_at: new Date().toISOString(),
    timeline: [],
    updated_at: "2026-08-01T00:00:00.000Z",
    case_version: 1,
    ...overrides,
  };
}

const INTENDED_ACTION = {
  href: MANUAL_ACTION_TRACKING_REAL_STATE_AG_PREP_HREF,
  label: "State Attorney General (consumer)",
};

describe("finalizePaidPreparedPacketApproval", () => {
  it("finalizes a paid, unapproved case: writes prepared_packet_approved + approved_next_action and creates exactly one fulfillment task", async () => {
    const store: Store = { cases: [baseCase()], tasks: [] };
    const result = await finalizePaidPreparedPacketApproval(makeSupabase(store), {
      caseId: CASE_ID,
      userId: USER_ID,
      intendedAction: INTENDED_ACTION,
    });

    expect(result).toEqual({ status: "finalized" });
    expect(store.cases[0].client_state.prepared_packet_approved).toBe(true);
    expect(
      (store.cases[0].client_state.approved_next_action as { href?: string }).href
    ).toBe(MANUAL_ACTION_TRACKING_REAL_STATE_AG_PREP_HREF);
    expect(store.tasks).toHaveLength(1);
    expect(store.tasks[0].notes).toContain("state_ag_filing_queue");
  });

  it("state transition: durably marks the case orphan_recovery_confirmed_at exactly once confirmation succeeds", async () => {
    const store: Store = { cases: [baseCase()], tasks: [] };
    expect(store.cases[0].orphan_recovery_confirmed_at).toBeFalsy();
    const result = await finalizePaidPreparedPacketApproval(makeSupabase(store), {
      caseId: CASE_ID,
      userId: USER_ID,
      intendedAction: INTENDED_ACTION,
    });
    expect(result).toEqual({ status: "finalized" });
    expect(store.cases[0].orphan_recovery_confirmed_at).toBeTruthy();
  });

  it("no-repeat-side-effect: once orphan_recovery_confirmed_at is set, a later call short-circuits before ever reaching task-ensure or task-lookup work again", async () => {
    // failTaskInsert would break a real ensure attempt, and the store starts with zero tasks —
    // if the short-circuit did not hold, this call would either error out or leave a task
    // behind. Neither happens: the call must never even look.
    const store: Store = {
      cases: [
        baseCase({
          client_state: {
            prepared_packet_approved: true,
            approved_next_action: { href: INTENDED_ACTION.href, label: INTENDED_ACTION.label, status: "approved" },
          },
          orphan_recovery_confirmed_at: "2026-08-01T00:00:05.000Z",
        }),
      ],
      tasks: [],
      failTaskInsert: true,
    };
    const result = await finalizePaidPreparedPacketApproval(makeSupabase(store), {
      caseId: CASE_ID,
      userId: USER_ID,
      intendedAction: INTENDED_ACTION,
    });
    expect(result).toEqual({ status: "already_finalized" });
    expect(store.tasks).toHaveLength(0);
  });

  it("browser never returns: finalization succeeds purely server-side with no PATCH ever having been sent", async () => {
    // The fixture never mutates client_state via any client-style PATCH path — this call alone,
    // driven only by caseId/userId/intendedAction (exactly what the webhook has), is sufficient.
    const store: Store = { cases: [baseCase({ client_state: {} })], tasks: [] };
    const result = await finalizePaidPreparedPacketApproval(makeSupabase(store), {
      caseId: CASE_ID,
      userId: USER_ID,
      intendedAction: INTENDED_ACTION,
    });
    expect(result.status).toBe("finalized");
    expect(store.tasks).toHaveLength(1);
  });

  it("is a no-op for an already-approved case whose task already exists: returns already_finalized, writes nothing, creates no NEW task", async () => {
    const store: Store = {
      cases: [
        baseCase({
          client_state: {
            prepared_packet_approved: true,
            approved_next_action: { href: INTENDED_ACTION.href, label: INTENDED_ACTION.label, status: "approved" },
          },
        }),
      ],
      tasks: [
        {
          id: "task_existing",
          user_id: USER_ID,
          case_id: CASE_ID,
          title: "State AG filing",
          notes: stateAgFilingTaskNotesMarker(CASE_ID),
          completed_at: null,
          created_at: "2026-08-01T00:00:00.000Z",
          updated_at: "2026-08-01T00:00:00.000Z",
        },
      ],
    };
    const result = await finalizePaidPreparedPacketApproval(makeSupabase(store), {
      caseId: CASE_ID,
      userId: USER_ID,
      intendedAction: INTENDED_ACTION,
    });
    expect(result).toEqual({ status: "already_finalized" });
    expect(store.tasks).toHaveLength(1);
    expect(store.tasks[0].id).toBe("task_existing");
  });

  it("idempotent task-creation retry: a prior call that approved client_state but failed to create the task is retried on the next call and creates exactly one task", async () => {
    const store: Store = { cases: [baseCase()], tasks: [], failTaskInsert: true };
    const supabase = makeSupabase(store);

    const first = await finalizePaidPreparedPacketApproval(supabase, {
      caseId: CASE_ID,
      userId: USER_ID,
      intendedAction: INTENDED_ACTION,
    });
    expect(first.status).toBe("error");
    // The approval write already committed even though task creation failed.
    expect(store.cases[0].client_state.prepared_packet_approved).toBe(true);
    expect(store.tasks).toHaveLength(0);

    store.failTaskInsert = false;
    const second = await finalizePaidPreparedPacketApproval(supabase, {
      caseId: CASE_ID,
      userId: USER_ID,
      intendedAction: INTENDED_ACTION,
    });
    // client_state was already approved on this call, so this is "already_finalized" rather than
    // a fresh "finalized" — the important invariant is that the retry actually ensured the task.
    expect(second.status).toBe("already_finalized");
    expect(store.tasks).toHaveLength(1);
    expect(store.tasks[0].notes).toContain("state_ag_filing_queue");
  });

  it("automatic finalization closes any existing open orphaned-review task for the case", async () => {
    const store: Store = {
      cases: [baseCase()],
      tasks: [
        {
          id: "review_task",
          user_id: USER_ID,
          case_id: CASE_ID,
          title: "Paid case needs manual approval review",
          notes: orphanedPaidCaseApprovalTaskNotesMarker(CASE_ID) + "\nreason: no_routable_destination",
          completed_at: null,
          created_at: "2026-08-01T00:00:00.000Z",
          updated_at: "2026-08-01T00:00:00.000Z",
        },
      ],
    };
    const result = await finalizePaidPreparedPacketApproval(makeSupabase(store), {
      caseId: CASE_ID,
      userId: USER_ID,
      intendedAction: INTENDED_ACTION,
    });
    expect(result).toEqual({ status: "finalized" });
    const reviewTask = store.tasks.find((t) => t.id === "review_task");
    expect(reviewTask?.completed_at).toBeTruthy();
    // The fulfillment task for the actually-approved action was also created, independent of the
    // review-task closure.
    expect(store.tasks.some((t) => t.notes.includes("state_ag_filing_queue"))).toBe(true);
  });

  it("duplicate/out-of-order delivery: calling finalize twice in a row still leaves exactly one fulfillment task", async () => {
    const store: Store = { cases: [baseCase()], tasks: [] };
    const supabase = makeSupabase(store);

    const first = await finalizePaidPreparedPacketApproval(supabase, {
      caseId: CASE_ID,
      userId: USER_ID,
      intendedAction: INTENDED_ACTION,
    });
    expect(first).toEqual({ status: "finalized" });

    const second = await finalizePaidPreparedPacketApproval(supabase, {
      caseId: CASE_ID,
      userId: USER_ID,
      intendedAction: INTENDED_ACTION,
    });
    expect(second).toEqual({ status: "already_finalized" });
    expect(store.tasks).toHaveLength(1);
  });

  it("retries after a concurrent-write conflict and still finalizes exactly once", async () => {
    const store: Store = { cases: [baseCase()], tasks: [], conflictOnFirstCaseWrite: true };
    const result = await finalizePaidPreparedPacketApproval(makeSupabase(store), {
      caseId: CASE_ID,
      userId: USER_ID,
      intendedAction: INTENDED_ACTION,
    });
    expect(result).toEqual({ status: "finalized" });
    expect(store.cases[0].client_state.prepared_packet_approved).toBe(true);
    expect(store.tasks).toHaveLength(1);
  });

  it("exhausts retries and reports conflict_retries_exhausted under a permanent conflict", async () => {
    const store: Store = { cases: [baseCase()], tasks: [] };
    // Simulate a permanent stale-case_version mismatch: the row's case_version never matches what
    // any read will see, on every attempt.
    const original = store.cases[0];
    const brokenSupabase: SupabaseClient = {
      from: (table: string) => {
        if (table !== "justice_cases") return makeSupabase(store).from(table);
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: { ...original }, error: null }),
              }),
            }),
          }),
          update: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  select: () => ({
                    maybeSingle: async () => ({ data: null, error: null }), // always a CAS miss
                  }),
                }),
              }),
            }),
          }),
        } as unknown as ReturnType<SupabaseClient["from"]>;
      },
    } as unknown as SupabaseClient;

    const result = await finalizePaidPreparedPacketApproval(brokenSupabase, {
      caseId: CASE_ID,
      userId: USER_ID,
      intendedAction: INTENDED_ACTION,
      maxAttempts: 3,
    });
    expect(result).toEqual({ status: "conflict_retries_exhausted" });
  });

  it("mismatched case/user: reports case_not_found when the case belongs to a different user", async () => {
    const store: Store = { cases: [baseCase({ user_id: "someone-else" })], tasks: [] };
    const result = await finalizePaidPreparedPacketApproval(makeSupabase(store), {
      caseId: CASE_ID,
      userId: USER_ID,
      intendedAction: INTENDED_ACTION,
    });
    expect(result).toEqual({ status: "case_not_found" });
  });

  it("mismatched action: reports invalid_action for an empty href, without writing anything", async () => {
    const store: Store = { cases: [baseCase()], tasks: [] };
    const result = await finalizePaidPreparedPacketApproval(makeSupabase(store), {
      caseId: CASE_ID,
      userId: USER_ID,
      intendedAction: { href: "", label: "" },
    });
    expect(result).toEqual({ status: "invalid_action" });
    expect(store.cases[0].client_state.prepared_packet_approved).toBeUndefined();
  });

  it("reports not_paid and never finalizes an unpaid case — unchanged unpaid behavior", async () => {
    const store: Store = { cases: [baseCase({ paid_at: null })], tasks: [] };
    const result = await finalizePaidPreparedPacketApproval(makeSupabase(store), {
      caseId: CASE_ID,
      userId: USER_ID,
      intendedAction: INTENDED_ACTION,
    });
    expect(result).toEqual({ status: "not_paid" });
    expect(store.cases[0].client_state.prepared_packet_approved).toBeUndefined();
    expect(store.tasks).toHaveLength(0);
  });

  it("reports invalid_intake and writes nothing for a case with malformed intake", async () => {
    const store: Store = { cases: [baseCase({ intake: { not: "a real intake" } })], tasks: [] };
    const result = await finalizePaidPreparedPacketApproval(makeSupabase(store), {
      caseId: CASE_ID,
      userId: USER_ID,
      intendedAction: INTENDED_ACTION,
    });
    expect(result).toEqual({ status: "invalid_intake" });
    expect(store.tasks).toHaveLength(0);
  });

  it("concurrent finalize attempts converge to exactly one fulfillment task and one approved client_state", async () => {
    const store: Store = { cases: [baseCase()], tasks: [] };
    const supabase = makeSupabase(store);

    const [a, b] = await Promise.all([
      finalizePaidPreparedPacketApproval(supabase, { caseId: CASE_ID, userId: USER_ID, intendedAction: INTENDED_ACTION }),
      finalizePaidPreparedPacketApproval(supabase, { caseId: CASE_ID, userId: USER_ID, intendedAction: INTENDED_ACTION }),
    ]);

    const statuses = [a.status, b.status].sort();
    // Exactly one attempt wins the write; the other either finds it already_finalized on a fresh
    // read, or (less likely with this synchronous fake) also lands "finalized" via CAS retry —
    // either way the OUTCOME invariant that matters is a single durable approval and task.
    expect(statuses.every((s) => s === "finalized" || s === "already_finalized")).toBe(true);
    expect(store.cases[0].client_state.prepared_packet_approved).toBe(true);
    expect(store.tasks).toHaveLength(1);
  });
});

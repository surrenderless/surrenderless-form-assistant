import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { insertManagedFulfillmentTaskConflictSafe } from "@/lib/justice/managedFulfillmentTaskDedupe";

const CASE_ID = "case-1";
const USER_ID = "user-1";
const MARKER = "state_ag_filing_queue:case-1";

type TaskRow = {
  id: string;
  user_id: string;
  case_id: string;
  title: string;
  notes: string;
  dedupe_key: string | null;
  completed_at: string | null;
};

type Store = {
  tasks: TaskRow[];
  nextId?: number;
  /** Simulates the real partial unique index on (dedupe_key) WHERE completed_at IS NULL. */
  simulateUniqueViolationOnDedupeKey?: boolean;
};

function makeSupabase(store: Store): SupabaseClient {
  const from = (table: string) => {
    if (table !== "justice_case_tasks") throw new Error(`unexpected table ${table}`);

    const state: {
      op: "select" | "insert";
      filters: Record<string, string>;
      like: string | null;
      isNullFilters: string[];
      insertPayload?: Record<string, unknown>;
    } = { op: "select", filters: {}, like: null, isNullFilters: [] };

    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: (col: string, val: string) => {
        state.filters[col] = val;
        return builder;
      },
      like: (_col: string, pattern: string) => {
        state.like = pattern;
        return builder;
      },
      is: (col: string, val: unknown) => {
        if (val === null) state.isNullFilters.push(col);
        return builder;
      },
      limit: async () => {
        const needle = state.like ? state.like.replace(/%/g, "") : "";
        const rows = store.tasks.filter(
          (t) =>
            t.case_id === state.filters.case_id &&
            t.user_id === state.filters.user_id &&
            state.isNullFilters.every((col) => (t as unknown as Record<string, unknown>)[col] == null) &&
            (!needle || t.notes.includes(needle))
        );
        return { data: rows, error: null };
      },
      insert: (payload: Record<string, unknown>) => {
        state.op = "insert";
        state.insertPayload = payload;
        return builder;
      },
      single: async () => {
        const dedupeKey = state.insertPayload?.dedupe_key as string | null | undefined;
        const conflicts =
          dedupeKey != null &&
          store.tasks.some((t) => t.dedupe_key === dedupeKey && t.completed_at === null);
        if (conflicts || store.simulateUniqueViolationOnDedupeKey) {
          store.simulateUniqueViolationOnDedupeKey = false;
          return {
            data: null,
            error: { code: "23505", message: "duplicate key value violates unique constraint" },
          };
        }
        store.nextId = (store.nextId ?? 0) + 1;
        const row: TaskRow = {
          id: `task_${store.nextId}`,
          user_id: String(state.insertPayload?.user_id),
          case_id: String(state.insertPayload?.case_id),
          title: String(state.insertPayload?.title ?? ""),
          notes: String(state.insertPayload?.notes ?? ""),
          dedupe_key: dedupeKey ?? null,
          completed_at: null,
        };
        store.tasks.push(row);
        return { data: row, error: null };
      },
    };
    return builder as unknown as ReturnType<SupabaseClient["from"]>;
  };
  return { from } as unknown as SupabaseClient;
}

describe("insertManagedFulfillmentTaskConflictSafe", () => {
  it("inserts a new task with dedupe_key set to the marker when none exists", async () => {
    const store: Store = { tasks: [] };
    const result = await insertManagedFulfillmentTaskConflictSafe(makeSupabase(store), {
      userId: USER_ID,
      caseId: CASE_ID,
      marker: MARKER,
      title: "State AG filing",
      notes: `${MARKER}\ndraft`,
    });
    expect(result).toEqual({ ok: true, task: expect.objectContaining({ id: "task_1" }), created: true });
    expect(store.tasks).toHaveLength(1);
    expect(store.tasks[0].dedupe_key).toBe(MARKER);
  });

  it("recovers from a concurrent-insert conflict by returning the winner's row instead of failing", async () => {
    const store: Store = { tasks: [] };
    const supabase = makeSupabase(store);

    // Simulate two callers racing: the first insert wins normally...
    const first = await insertManagedFulfillmentTaskConflictSafe(supabase, {
      userId: USER_ID,
      caseId: CASE_ID,
      marker: MARKER,
      title: "State AG filing",
      notes: `${MARKER}\ndraft`,
    });
    expect(first.ok).toBe(true);

    // ...and the second, arriving after the winner but before it would have seen the row via its
    // own fast-path select (this helper is only reached once that fast-path already found
    // nothing), hits the real unique-constraint conflict this fake models via dedupe_key.
    const second = await insertManagedFulfillmentTaskConflictSafe(supabase, {
      userId: USER_ID,
      caseId: CASE_ID,
      marker: MARKER,
      title: "State AG filing",
      notes: `${MARKER}\ndraft`,
    });

    expect(second).toEqual({ ok: true, task: expect.objectContaining({ id: "task_1" }), created: false });
    expect(store.tasks).toHaveLength(1);
  });

  it("fails (does not throw) when the conflict-recovery re-select also errors", async () => {
    const store: Store = {
      tasks: [
        {
          id: "task_1",
          user_id: USER_ID,
          case_id: CASE_ID,
          title: "State AG filing",
          notes: `${MARKER}\ndraft`,
          dedupe_key: MARKER,
          completed_at: null,
        },
      ],
      simulateUniqueViolationOnDedupeKey: true,
    };
    const supabase = makeSupabase(store);
    // Force the recovery select to fail too, by breaking `limit` after the insert conflict.
    const brokenSupabase: SupabaseClient = {
      from: (table: string) => {
        const real = supabase.from(table) as unknown as { insert: unknown };
        return {
          insert: real.insert,
          select: () => ({
            eq: () => ({
              eq: () => ({
                like: () => ({
                  is: () => ({
                    limit: async () => ({ data: null, error: { message: "select down" } }),
                  }),
                }),
              }),
            }),
          }),
        } as unknown as ReturnType<SupabaseClient["from"]>;
      },
    } as unknown as SupabaseClient;

    const result = await insertManagedFulfillmentTaskConflictSafe(brokenSupabase, {
      userId: USER_ID,
      caseId: CASE_ID,
      marker: MARKER,
      title: "State AG filing",
      notes: `${MARKER}\ndraft`,
    });
    expect(result).toEqual({ ok: false, error: "select down" });
  });

  it("propagates a non-conflict insert error without attempting recovery", async () => {
    const failingSupabase: SupabaseClient = {
      from: () =>
        ({
          insert: () => ({
            select: () => ({
              single: async () => ({ data: null, error: { message: "insert down" } }),
            }),
          }),
        }) as unknown as ReturnType<SupabaseClient["from"]>,
    } as unknown as SupabaseClient;

    const result = await insertManagedFulfillmentTaskConflictSafe(failingSupabase, {
      userId: USER_ID,
      caseId: CASE_ID,
      marker: MARKER,
      title: "State AG filing",
      notes: `${MARKER}\ndraft`,
    });
    expect(result).toEqual({ ok: false, error: "insert down" });
  });

  it("reports an error rather than fabricating a task when a conflict occurs but no open task can be found on retry", async () => {
    // The forced conflict fires on an empty store, so the recovery re-select genuinely finds
    // nothing open under this marker — the narrow "conflict but the row is already gone" case.
    const store: Store = { tasks: [], simulateUniqueViolationOnDedupeKey: true };
    const result = await insertManagedFulfillmentTaskConflictSafe(makeSupabase(store), {
      userId: USER_ID,
      caseId: CASE_ID,
      marker: MARKER,
      title: "State AG filing",
      notes: `${MARKER}\ndraft`,
    });
    expect(result.ok).toBe(false);
  });
});

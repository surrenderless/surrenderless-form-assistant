import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  completeOrphanedPaidCaseApprovalTaskIfOpen,
  ensureOrphanedPaidCaseApprovalTask,
  orphanedPaidCaseApprovalTaskNotesMarker,
  taskNotesMatchOrphanedPaidCaseApprovalMarker,
} from "@/lib/justice/orphanedPaidCaseApprovalTask";

const CASE_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "user_1";

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
  tasks: TaskRow[];
  timeline: unknown[];
  failSelect?: boolean;
  failUpdate?: boolean;
};

function makeSupabase(store: Store): SupabaseClient {
  const from = (table: string) => {
    if (table === "justice_case_tasks") {
      const state: {
        op: "select" | "insert" | "update";
        filters: Record<string, string>;
        like: string | null;
        insertPayload?: Record<string, unknown>;
        updatePayload?: Record<string, unknown>;
      } = { op: "select", filters: {}, like: null };

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
          if (store.failSelect) return { data: null, error: { message: "select down" } };
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
        single: async () => {
          const id = `task_${store.tasks.length + 1}`;
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
        maybeSingle: async () => {
          if (store.failUpdate) return { data: null, error: { message: "update down" } };
          const row = store.tasks.find(
            (t) => t.id === state.filters.id && t.user_id === state.filters.user_id
          );
          if (!row) return { data: null, error: null };
          Object.assign(row, state.updatePayload);
          return { data: row, error: null };
        },
      };
      return builder as unknown as ReturnType<SupabaseClient["from"]>;
    }

    if (table === "justice_cases") {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { timeline: store.timeline }, error: null }),
            }),
          }),
        }),
        update: () => ({
          eq: () => ({
            eq: () => ({
              then: (onF: (v: unknown) => unknown) =>
                Promise.resolve({ data: null, error: null }).then(onF),
            }),
          }),
        }),
      } as unknown as ReturnType<SupabaseClient["from"]>;
    }

    throw new Error(`unexpected table ${table}`);
  };
  return { from } as unknown as SupabaseClient;
}

function openReviewTask(overrides: Partial<TaskRow> = {}): TaskRow {
  return {
    id: "review_task",
    user_id: USER_ID,
    case_id: CASE_ID,
    title: "Paid case needs manual approval review",
    notes: orphanedPaidCaseApprovalTaskNotesMarker(CASE_ID) + "\nreason: no_routable_destination",
    completed_at: null,
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("orphanedPaidCaseApprovalTaskNotesMarker / taskNotesMatchOrphanedPaidCaseApprovalMarker", () => {
  it("matches only its own case's marker", () => {
    const notes = orphanedPaidCaseApprovalTaskNotesMarker(CASE_ID) + "\nreason: x";
    expect(taskNotesMatchOrphanedPaidCaseApprovalMarker(notes, CASE_ID)).toBe(true);
    expect(taskNotesMatchOrphanedPaidCaseApprovalMarker(notes, "other-case")).toBe(false);
    expect(taskNotesMatchOrphanedPaidCaseApprovalMarker("unrelated", CASE_ID)).toBe(false);
  });
});

describe("ensureOrphanedPaidCaseApprovalTask", () => {
  it("creates a task with the reason recorded when none exists", async () => {
    const store: Store = { tasks: [], timeline: [] };
    const result = await ensureOrphanedPaidCaseApprovalTask(
      makeSupabase(store),
      USER_ID,
      CASE_ID,
      "durable_intent_mismatch"
    );
    expect(result.created).toBe(true);
    expect(store.tasks).toHaveLength(1);
    expect(store.tasks[0].notes).toContain("durable_intent_mismatch");
  });

  it("is idempotent: a second call finds the open task and creates no duplicate", async () => {
    const store: Store = { tasks: [], timeline: [] };
    const supabase = makeSupabase(store);
    await ensureOrphanedPaidCaseApprovalTask(supabase, USER_ID, CASE_ID, "reason_a");
    const second = await ensureOrphanedPaidCaseApprovalTask(supabase, USER_ID, CASE_ID, "reason_b");
    expect(second.created).toBe(false);
    expect(store.tasks).toHaveLength(1);
  });
});

describe("completeOrphanedPaidCaseApprovalTaskIfOpen", () => {
  it("is a no-op when no open review task exists for the case", async () => {
    const store: Store = { tasks: [], timeline: [] };
    const result = await completeOrphanedPaidCaseApprovalTaskIfOpen(
      makeSupabase(store),
      USER_ID,
      CASE_ID
    );
    expect(result).toEqual({ task: null, timeline: null, completed: false, failed: false });
  });

  it("completes an open review task and appends a timeline entry", async () => {
    const store: Store = { tasks: [openReviewTask()], timeline: [] };
    const result = await completeOrphanedPaidCaseApprovalTaskIfOpen(
      makeSupabase(store),
      USER_ID,
      CASE_ID
    );
    expect(result.completed).toBe(true);
    expect(result.failed).toBe(false);
    expect(store.tasks[0].completed_at).toBeTruthy();
  });

  it("never closes a task belonging to a different case", async () => {
    const store: Store = {
      tasks: [openReviewTask({ case_id: "other-case", notes: orphanedPaidCaseApprovalTaskNotesMarker("other-case") })],
      timeline: [],
    };
    const result = await completeOrphanedPaidCaseApprovalTaskIfOpen(
      makeSupabase(store),
      USER_ID,
      CASE_ID
    );
    expect(result.completed).toBe(false);
    expect(store.tasks[0].completed_at).toBeNull();
  });

  it("surfaces failed: true (never throws) when the lookup query errors", async () => {
    const store: Store = { tasks: [openReviewTask()], timeline: [], failSelect: true };
    const result = await completeOrphanedPaidCaseApprovalTaskIfOpen(
      makeSupabase(store),
      USER_ID,
      CASE_ID
    );
    expect(result).toEqual({ task: null, timeline: null, completed: false, failed: true });
  });

  it("surfaces failed: true (never throws) when the completion update errors", async () => {
    const store: Store = { tasks: [openReviewTask()], timeline: [], failUpdate: true };
    const result = await completeOrphanedPaidCaseApprovalTaskIfOpen(
      makeSupabase(store),
      USER_ID,
      CASE_ID
    );
    expect(result.failed).toBe(true);
    expect(result.completed).toBe(false);
  });

  it("is idempotent: completing an already-completed task is a safe no-op (nothing left open to match)", async () => {
    const store: Store = {
      tasks: [openReviewTask({ completed_at: "2026-08-02T00:00:00.000Z" })],
      timeline: [],
    };
    const result = await completeOrphanedPaidCaseApprovalTaskIfOpen(
      makeSupabase(store),
      USER_ID,
      CASE_ID
    );
    expect(result).toEqual({ task: null, timeline: null, completed: false, failed: false });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  followUpTaskNotesMarker,
  taskNotesMatchFollowUpMarker,
} from "@/lib/justice/followUpCaseTask";
import { reconcileMissingFollowUpCaseTasks } from "@/lib/justice/reconcileMissingFollowUpCaseTasks";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";
import type { TimelineEntry } from "@/lib/justice/types";

const CASE_ID = "550e8400-e29b-41d4-a716-446655440000";
const CASE_ID_2 = "550e8400-e29b-41d4-a716-446655440001";
const USER_ID = "user-owner-1";

const timelineStore: { entries: TimelineEntry[] } = { entries: [] };

vi.mock("@/server/justiceTimelineAppend", () => ({
  appendCaseTimelineEntry: vi.fn(
    async (
      _supabase: SupabaseClient,
      _userId: string,
      caseId: string,
      entry: { id: string; type: TimelineEntry["type"]; label: string; detail?: string; ts?: string }
    ) => {
      if (timelineStore.entries.some((row) => row.id === entry.id)) {
        return timelineStore.entries;
      }
      const next: TimelineEntry = {
        id: entry.id,
        case_id: caseId,
        type: entry.type,
        label: entry.label,
        ts: entry.ts ?? new Date().toISOString(),
        ...(entry.detail ? { detail: entry.detail } : {}),
      };
      timelineStore.entries = [...timelineStore.entries, next];
      return timelineStore.entries;
    }
  ),
}));

type CaseRow = {
  id: string;
  user_id: string;
  client_state: unknown;
  archived_at: string | null;
  updated_at: string;
};

type MockState = {
  cases: CaseRow[];
  tasks: JusticeCaseTaskRow[];
  insertCount: number;
  insertFailCaseIds: Set<string>;
};

function createReconcileSupabase(state: MockState): SupabaseClient {
  return {
    from: (table: string) => {
      if (table === "justice_cases") {
        return {
          select: () => ({
            is: () => ({
              order: () => ({
                limit: async () => ({
                  data: state.cases.filter((c) => !c.archived_at?.trim()),
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      if (table === "justice_case_tasks") {
        return {
          select: () => ({
            eq: (_col: string, userId: string) => ({
              eq: (_col2: string, caseId: string) => ({
                like: (_column: string, pattern: string) => ({
                  limit: async () => {
                    const prefix = String(pattern).replace(/%$/, "");
                    const matched = state.tasks.filter(
                      (task) =>
                        task.user_id === userId &&
                        task.case_id === caseId &&
                        (task.notes ?? "").startsWith(prefix)
                    );
                    return { data: matched.slice(0, 1), error: null };
                  },
                }),
              }),
            }),
          }),
          insert: (row: Record<string, unknown>) => ({
            select: () => ({
              single: async () => {
                const caseId = String(row.case_id ?? "");
                if (state.insertFailCaseIds.has(caseId)) {
                  return { data: null, error: { message: "insert failed" } };
                }
                state.insertCount += 1;
                const task: JusticeCaseTaskRow = {
                  id: `follow-up-${state.insertCount}`,
                  user_id: String(row.user_id ?? ""),
                  case_id: caseId,
                  title: String(row.title ?? ""),
                  due_date: typeof row.due_date === "string" ? row.due_date : null,
                  notes: typeof row.notes === "string" ? row.notes : null,
                  completed_at: null,
                  created_at: "2026-07-17T12:00:00.000Z",
                  updated_at: "2026-07-17T12:00:00.000Z",
                };
                state.tasks = [...state.tasks, task];
                return { data: task, error: null };
              },
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  } as unknown as SupabaseClient;
}

function followUpClientState(label = "Demand letter"): Record<string, unknown> {
  return {
    approved_next_action: {
      label,
      href: "/justice/demand-letter",
      status: "completed",
      follow_up_needed: true,
      follow_up_at: "2026-08-01T12:00:00.000Z",
    },
  };
}

describe("reconcileMissingFollowUpCaseTasks", () => {
  beforeEach(() => {
    timelineStore.entries = [];
  });

  it("creates a missing follow-up task for orphaned follow_up_needed cases", async () => {
    const state: MockState = {
      cases: [
        {
          id: CASE_ID,
          user_id: USER_ID,
          client_state: followUpClientState(),
          archived_at: null,
          updated_at: "2026-07-17T12:00:00.000Z",
        },
        {
          id: CASE_ID_2,
          user_id: USER_ID,
          client_state: { approved_next_action: { status: "approved" } },
          archived_at: null,
          updated_at: "2026-07-17T11:00:00.000Z",
        },
      ],
      tasks: [],
      insertCount: 0,
      insertFailCaseIds: new Set(),
    };

    const summary = await reconcileMissingFollowUpCaseTasks(createReconcileSupabase(state));

    expect(summary.scanned).toBe(2);
    expect(summary.needing_follow_up).toBe(1);
    expect(summary.created).toBe(1);
    expect(summary.already_present).toBe(0);
    expect(summary.failed).toBe(0);
    expect(state.insertCount).toBe(1);
    expect(state.tasks).toHaveLength(1);
    expect(taskNotesMatchFollowUpMarker(state.tasks[0].notes, CASE_ID)).toBe(true);
    expect(summary.results.some((r) => r.case_id === CASE_ID && r.kind === "created")).toBe(true);
  });

  it("does not duplicate when an open or completed follow-up task already exists", async () => {
    const marker = followUpTaskNotesMarker(CASE_ID);
    const existing: JusticeCaseTaskRow = {
      id: "existing-follow-up",
      user_id: USER_ID,
      case_id: CASE_ID,
      title: "Surrenderless follow-up: Demand letter",
      due_date: "2026-08-01",
      notes: marker,
      completed_at: "2026-07-10T00:00:00.000Z",
      created_at: "2026-07-01T00:00:00.000Z",
      updated_at: "2026-07-10T00:00:00.000Z",
    };
    const state: MockState = {
      cases: [
        {
          id: CASE_ID,
          user_id: USER_ID,
          client_state: followUpClientState(),
          archived_at: null,
          updated_at: "2026-07-17T12:00:00.000Z",
        },
      ],
      tasks: [existing],
      insertCount: 0,
      insertFailCaseIds: new Set(),
    };

    const summary = await reconcileMissingFollowUpCaseTasks(createReconcileSupabase(state));

    expect(summary.needing_follow_up).toBe(1);
    expect(summary.already_present).toBe(1);
    expect(summary.created).toBe(0);
    expect(state.insertCount).toBe(0);
    expect(state.tasks).toHaveLength(1);
  });

  it("reports failure when ensure cannot insert the missing task", async () => {
    const state: MockState = {
      cases: [
        {
          id: CASE_ID,
          user_id: USER_ID,
          client_state: followUpClientState(),
          archived_at: null,
          updated_at: "2026-07-17T12:00:00.000Z",
        },
      ],
      tasks: [],
      insertCount: 0,
      insertFailCaseIds: new Set([CASE_ID]),
    };

    const summary = await reconcileMissingFollowUpCaseTasks(createReconcileSupabase(state));

    expect(summary.created).toBe(0);
    expect(summary.failed).toBe(1);
    expect(summary.results[0]).toMatchObject({
      case_id: CASE_ID,
      kind: "failed",
      reason: "ensure_failed",
    });
  });

  it("is idempotent across repeated reconciliation runs", async () => {
    const state: MockState = {
      cases: [
        {
          id: CASE_ID,
          user_id: USER_ID,
          client_state: followUpClientState(),
          archived_at: null,
          updated_at: "2026-07-17T12:00:00.000Z",
        },
      ],
      tasks: [],
      insertCount: 0,
      insertFailCaseIds: new Set(),
    };

    const first = await reconcileMissingFollowUpCaseTasks(createReconcileSupabase(state));
    expect(first.created).toBe(1);
    expect(state.insertCount).toBe(1);

    const second = await reconcileMissingFollowUpCaseTasks(createReconcileSupabase(state));
    expect(second.created).toBe(0);
    expect(second.already_present).toBe(1);
    expect(state.insertCount).toBe(1);
  });
});

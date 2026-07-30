import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildHandlingRequestTaskNotes,
  buildHandlingRequestTaskTitle,
  completeHandlingRequestTaskIfOpen,
  ensureHandlingRequestTask,
  handlingRequestTaskCompletedTimelineId,
  handlingRequestTaskNotesMarker,
  isFirstFilingConfirmationTransition,
  taskNotesMatchHandlingRequestMarker,
} from "@/lib/justice/handlingRequestTask";
import { handlingRequestTimelineEntryId } from "@/lib/justice/handlingRequestTimeline";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";
import type { TimelineEntry } from "@/lib/justice/types";

const CASE_ID = "550e8400-e29b-41d4-a716-446655440000";
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

type MockState = {
  tasks: JusticeCaseTaskRow[];
  insertCount: number;
  insertFail: boolean;
};

function createHandlingRequestSupabase(state: MockState): SupabaseClient {
  return {
    from: (table: string) => {
      if (table !== "justice_case_tasks") {
        throw new Error(`unexpected table ${table}`);
      }
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              like: (_column: string, pattern: string) => ({
                is: () => ({
                  limit: async () => {
                    const prefix = String(pattern).replace(/%$/, "");
                    const matched = state.tasks.filter(
                      (task) =>
                        (task.notes ?? "").startsWith(prefix) && !task.completed_at?.trim()
                    );
                    return { data: matched.slice(0, 1), error: null };
                  },
                }),
                limit: async () => {
                  const prefix = String(pattern).replace(/%$/, "");
                  const matched = state.tasks.filter((task) =>
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
              if (state.insertFail) {
                return { data: null, error: { message: "insert failed" } };
              }
              state.insertCount += 1;
              const task: JusticeCaseTaskRow = {
                id: `handling-request-${state.insertCount}`,
                user_id: USER_ID,
                case_id: CASE_ID,
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
        update: (patch: Record<string, unknown>) => ({
          eq: (_col: string, taskId: string) => ({
            eq: () => ({
              select: () => ({
                maybeSingle: async () => {
                  const task = state.tasks.find((t) => t.id === taskId);
                  if (!task) return { data: null, error: null };
                  task.completed_at = String(patch.completed_at ?? "");
                  return { data: task, error: null };
                },
              }),
            }),
          }),
        }),
      };
    },
  } as unknown as SupabaseClient;
}

describe("handlingRequestTaskNotesMarker", () => {
  it("matches the handling-request timeline entry id", () => {
    expect(handlingRequestTaskNotesMarker(CASE_ID)).toBe(handlingRequestTimelineEntryId(CASE_ID));
    expect(handlingRequestTaskNotesMarker(CASE_ID)).toBe(`handling_request:${CASE_ID}`);
  });
});

describe("buildHandlingRequestTaskTitle", () => {
  it("uses the approved action label in the title", () => {
    expect(buildHandlingRequestTaskTitle({ label: "File BBB complaint" })).toBe(
      "Surrenderless handling: File BBB complaint"
    );
  });

  it("falls back when label is missing", () => {
    expect(buildHandlingRequestTaskTitle({})).toBe("Surrenderless handling: Approved next action");
  });
});

describe("buildHandlingRequestTaskNotes", () => {
  it("includes stable marker and optional handling request note", () => {
    expect(buildHandlingRequestTaskNotes(CASE_ID, { handling_request_note: "Please prioritize" })).toBe(
      `handling_request:${CASE_ID}\nPlease prioritize`
    );
  });

  it("uses marker only when request note is absent", () => {
    expect(buildHandlingRequestTaskNotes(CASE_ID, { label: "File BBB complaint" })).toBe(
      `handling_request:${CASE_ID}`
    );
  });
});

describe("taskNotesMatchHandlingRequestMarker", () => {
  it("matches marker-only and marker-plus-note notes", () => {
    expect(taskNotesMatchHandlingRequestMarker(`handling_request:${CASE_ID}`, CASE_ID)).toBe(true);
    expect(
      taskNotesMatchHandlingRequestMarker(`handling_request:${CASE_ID}\nPlease prioritize`, CASE_ID)
    ).toBe(true);
  });

  it("does not match unrelated notes", () => {
    expect(taskNotesMatchHandlingRequestMarker("Follow up with merchant", CASE_ID)).toBe(false);
  });
});

describe("isFirstFilingConfirmationTransition", () => {
  it("returns true when confirmation_number transitions from empty to present", () => {
    expect(isFirstFilingConfirmationTransition(null, "BBB-123")).toBe(true);
    expect(isFirstFilingConfirmationTransition("", "BBB-123")).toBe(true);
    expect(isFirstFilingConfirmationTransition("   ", "BBB-123")).toBe(true);
  });

  it("returns false when confirmation was already present or remains empty", () => {
    expect(isFirstFilingConfirmationTransition("BBB-123", "BBB-456")).toBe(false);
    expect(isFirstFilingConfirmationTransition(null, null)).toBe(false);
    expect(isFirstFilingConfirmationTransition("BBB-123", "")).toBe(false);
  });
});

describe("handlingRequestTaskCompletedTimelineId", () => {
  it("uses a stable idempotent id per task", () => {
    const taskId = "660e8400-e29b-41d4-a716-446655440001";
    expect(handlingRequestTaskCompletedTimelineId(taskId)).toBe(
      `handling_request_task_done:${taskId}`
    );
  });
});

describe("ensureHandlingRequestTask", () => {
  beforeEach(() => {
    timelineStore.entries = [];
  });

  it("creates a handling-request task when none exists", async () => {
    const state: MockState = { tasks: [], insertCount: 0, insertFail: false };
    const result = await ensureHandlingRequestTask(
      createHandlingRequestSupabase(state),
      USER_ID,
      CASE_ID,
      { label: "File BBB complaint" }
    );

    expect(result.created).toBe(true);
    expect(state.insertCount).toBe(1);
    expect(state.tasks).toHaveLength(1);
    expect(taskNotesMatchHandlingRequestMarker(state.tasks[0].notes, CASE_ID)).toBe(true);
  });

  it("is idempotent when an open handling-request task already exists", async () => {
    const marker = handlingRequestTaskNotesMarker(CASE_ID);
    const existing: JusticeCaseTaskRow = {
      id: "existing-handling-request",
      user_id: USER_ID,
      case_id: CASE_ID,
      title: "Surrenderless handling: File BBB complaint",
      due_date: null,
      notes: marker,
      completed_at: null,
      created_at: "2026-07-01T00:00:00.000Z",
      updated_at: "2026-07-01T00:00:00.000Z",
    };
    const state: MockState = { tasks: [existing], insertCount: 0, insertFail: false };

    const result = await ensureHandlingRequestTask(
      createHandlingRequestSupabase(state),
      USER_ID,
      CASE_ID,
      { label: "File BBB complaint" }
    );

    expect(result.created).toBe(false);
    expect(result.task?.id).toBe("existing-handling-request");
    expect(state.insertCount).toBe(0);
    expect(state.tasks).toHaveLength(1);
  });

  it("creates a fresh handling-request task when the only marker-matching task is already closed (prior escalation step's request)", async () => {
    const marker = handlingRequestTaskNotesMarker(CASE_ID);
    const closed: JusticeCaseTaskRow = {
      id: "closed-handling-request",
      user_id: USER_ID,
      case_id: CASE_ID,
      title: "Surrenderless handling: File BBB complaint",
      due_date: null,
      notes: marker,
      completed_at: "2026-06-05T00:00:00.000Z",
      created_at: "2026-05-01T00:00:00.000Z",
      updated_at: "2026-06-05T00:00:00.000Z",
    };
    const state: MockState = { tasks: [closed], insertCount: 0, insertFail: false };

    const result = await ensureHandlingRequestTask(
      createHandlingRequestSupabase(state),
      USER_ID,
      CASE_ID,
      { label: "State AG complaint" }
    );

    // A closed handling-request task from an earlier escalation step must not block tracking
    // the next one — the marker is case-scoped, so a new task is required rather than reusing
    // the closed row.
    expect(result.created).toBe(true);
    expect(result.task?.id).not.toBe("closed-handling-request");
    expect(state.insertCount).toBe(1);
    expect(state.tasks).toHaveLength(2);
    expect(state.tasks.at(-1)?.completed_at).toBeNull();
  });
});

describe("completeHandlingRequestTaskIfOpen", () => {
  beforeEach(() => {
    timelineStore.entries = [];
  });

  it("completes the current open handling-request task when a prior task is already closed", async () => {
    const marker = handlingRequestTaskNotesMarker(CASE_ID);
    const closed: JusticeCaseTaskRow = {
      id: "closed-handling-request",
      user_id: USER_ID,
      case_id: CASE_ID,
      title: "Surrenderless handling: File BBB complaint",
      due_date: null,
      notes: marker,
      completed_at: "2026-06-05T00:00:00.000Z",
      created_at: "2026-05-01T00:00:00.000Z",
      updated_at: "2026-06-05T00:00:00.000Z",
    };
    const open: JusticeCaseTaskRow = {
      id: "open-handling-request",
      user_id: USER_ID,
      case_id: CASE_ID,
      title: "Surrenderless handling: State AG complaint",
      due_date: null,
      notes: marker,
      completed_at: null,
      created_at: "2026-07-01T00:00:00.000Z",
      updated_at: "2026-07-01T00:00:00.000Z",
    };
    const state: MockState = { tasks: [closed, open], insertCount: 0, insertFail: false };

    const result = await completeHandlingRequestTaskIfOpen(
      createHandlingRequestSupabase(state),
      USER_ID,
      CASE_ID
    );

    // Discovery must target the current OPEN task, not non-deterministically pick the stale
    // closed row from an earlier escalation step.
    expect(result.completed).toBe(true);
    expect(result.task?.id).toBe("open-handling-request");
    expect(state.tasks.find((t) => t.id === "open-handling-request")?.completed_at).toBeTruthy();
    expect(state.tasks.find((t) => t.id === "closed-handling-request")?.completed_at).toBe(
      "2026-06-05T00:00:00.000Z"
    );
  });

  it("no-ops when only a closed handling-request task exists", async () => {
    const marker = handlingRequestTaskNotesMarker(CASE_ID);
    const closed: JusticeCaseTaskRow = {
      id: "closed-handling-request",
      user_id: USER_ID,
      case_id: CASE_ID,
      title: "Surrenderless handling: File BBB complaint",
      due_date: null,
      notes: marker,
      completed_at: "2026-06-05T00:00:00.000Z",
      created_at: "2026-05-01T00:00:00.000Z",
      updated_at: "2026-06-05T00:00:00.000Z",
    };
    const state: MockState = { tasks: [closed], insertCount: 0, insertFail: false };

    const result = await completeHandlingRequestTaskIfOpen(
      createHandlingRequestSupabase(state),
      USER_ID,
      CASE_ID
    );

    expect(result.completed).toBe(false);
    expect(result.task).toBeNull();
  });
});

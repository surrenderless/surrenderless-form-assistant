import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ensureFollowUpAfterOperatorClientStateWrite } from "@/lib/justice/ensureFollowUpAfterOperatorClientStateWrite";
import {
  followUpTaskNotesMarker,
  taskNotesMatchFollowUpMarker,
} from "@/lib/justice/followUpCaseTask";
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
};

function createFollowUpTaskSupabase(state: MockState): SupabaseClient {
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
              state.insertCount += 1;
              const task: JusticeCaseTaskRow = {
                id: `follow-up-${state.insertCount}`,
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
      };
    },
  } as unknown as SupabaseClient;
}

describe("ensureFollowUpAfterOperatorClientStateWrite", () => {
  beforeEach(() => {
    timelineStore.entries = [];
  });

  it("creates a follow-up task on false→true follow_up_needed after direct client_state write", async () => {
    const state: MockState = { tasks: [], insertCount: 0 };
    const result = await ensureFollowUpAfterOperatorClientStateWrite(
      createFollowUpTaskSupabase(state),
      {
        userId: USER_ID,
        caseId: CASE_ID,
        existingClientState: {
          approved_next_action: {
            label: "Small claims / demand letter",
            href: "/justice/demand-letter",
            status: "completed",
          },
        },
        nextClientState: {
          approved_next_action: {
            label: "Small claims / demand letter",
            href: "/justice/demand-letter",
            status: "completed",
            follow_up_needed: true,
            follow_up_at: "2026-08-01T12:00:00.000Z",
            outcome_note: "Escalation complete. Awaiting responses.",
            handling_requested_at: "2026-07-17T12:00:00.000Z",
          },
        },
      }
    );

    expect(result.created).toBe(true);
    expect(state.insertCount).toBe(1);
    expect(state.tasks).toHaveLength(1);
    expect(taskNotesMatchFollowUpMarker(state.tasks[0].notes, CASE_ID)).toBe(true);
    expect(state.tasks[0].due_date).toBe("2026-08-01");
    expect(result.timeline?.some((e) => e.type === "task_added")).toBe(true);
  });

  it("is idempotent when a follow-up task already exists", async () => {
    const marker = followUpTaskNotesMarker(CASE_ID);
    const existing: JusticeCaseTaskRow = {
      id: "existing-follow-up",
      user_id: USER_ID,
      case_id: CASE_ID,
      title: "Surrenderless follow-up: Small claims / demand letter",
      due_date: "2026-08-01",
      notes: marker,
      completed_at: null,
      created_at: "2026-07-01T00:00:00.000Z",
      updated_at: "2026-07-01T00:00:00.000Z",
    };
    const state: MockState = { tasks: [existing], insertCount: 0 };

    const result = await ensureFollowUpAfterOperatorClientStateWrite(
      createFollowUpTaskSupabase(state),
      {
        userId: USER_ID,
        caseId: CASE_ID,
        existingClientState: { approved_next_action: { status: "completed" } },
        nextClientState: {
          approved_next_action: {
            status: "completed",
            follow_up_needed: true,
            follow_up_at: "2026-08-01T12:00:00.000Z",
            label: "Small claims / demand letter",
            href: "/justice/demand-letter",
          },
        },
      }
    );

    expect(result.created).toBe(false);
    expect(state.insertCount).toBe(0);
    expect(state.tasks).toHaveLength(1);
  });

  it("does nothing when follow_up_needed does not newly become true", async () => {
    const state: MockState = { tasks: [], insertCount: 0 };
    const alreadyTrue = {
      approved_next_action: {
        status: "completed" as const,
        follow_up_needed: true as const,
        href: "/justice/demand-letter",
      },
    };
    const noTransition = await ensureFollowUpAfterOperatorClientStateWrite(
      createFollowUpTaskSupabase(state),
      {
        userId: USER_ID,
        caseId: CASE_ID,
        existingClientState: alreadyTrue,
        nextClientState: alreadyTrue,
      }
    );
    expect(noTransition.created).toBe(false);
    expect(state.insertCount).toBe(0);

    const stillFalse = await ensureFollowUpAfterOperatorClientStateWrite(
      createFollowUpTaskSupabase(state),
      {
        userId: USER_ID,
        caseId: CASE_ID,
        existingClientState: { approved_next_action: { status: "approved" } },
        nextClientState: { approved_next_action: { status: "completed" } },
      }
    );
    expect(stillFalse.created).toBe(false);
    expect(state.insertCount).toBe(0);
  });
});

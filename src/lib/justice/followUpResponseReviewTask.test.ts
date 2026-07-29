import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildJusticeIntakeFromParts, defaultBuildJusticeIntakeParts } from "@/lib/justice/buildJusticeIntake";
import {
  ensureFollowUpResponseReviewTask,
  followUpResponseReviewTaskNotesMarker,
  taskNotesMatchFollowUpResponseReviewMarker,
} from "@/lib/justice/followUpResponseReviewTask";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";
import type { JusticeIntake, TimelineEntry } from "@/lib/justice/types";

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

function retailIntake(): JusticeIntake {
  return buildJusticeIntakeFromParts({
    ...defaultBuildJusticeIntakeParts(),
    problem_category: "online_purchase",
    company_name: "Acme Retail",
    purchase_or_signup: "widget order",
    story: "Ordered a widget that never arrived and merchant refused a refund.",
    money_amount: "$89.00",
    pay_or_order_date: "2026-01-10",
    already_contacted: "yes",
    contact_method: "email",
    contact_date: "2026-01-15",
    merchant_response_type: "refused_help",
    user_display_name: "Jordan Lee",
    reply_email: "e2e@example.com",
    consumer_us_state: "CA",
  });
}

type MockState = {
  tasks: JusticeCaseTaskRow[];
  insertCount: number;
  insertFail: boolean;
};

function createResponseReviewSupabase(state: MockState): SupabaseClient {
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
                id: `response-review-${state.insertCount}`,
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

describe("ensureFollowUpResponseReviewTask", () => {
  beforeEach(() => {
    timelineStore.entries = [];
  });

  it("creates a response-review task when none exists", async () => {
    const state: MockState = { tasks: [], insertCount: 0, insertFail: false };
    const result = await ensureFollowUpResponseReviewTask(
      createResponseReviewSupabase(state),
      USER_ID,
      CASE_ID,
      retailIntake()
    );

    expect(result.created).toBe(true);
    expect(state.insertCount).toBe(1);
    expect(state.tasks).toHaveLength(1);
    expect(taskNotesMatchFollowUpResponseReviewMarker(state.tasks[0].notes, CASE_ID)).toBe(true);
    expect(result.timeline?.some((e) => e.type === "task_added")).toBe(true);
  });

  it("is idempotent when an open response-review task already exists", async () => {
    const marker = followUpResponseReviewTaskNotesMarker(CASE_ID);
    const existing: JusticeCaseTaskRow = {
      id: "existing-review",
      user_id: USER_ID,
      case_id: CASE_ID,
      title: "Follow-up response review: Acme Retail",
      due_date: null,
      notes: marker,
      completed_at: null,
      created_at: "2026-07-01T00:00:00.000Z",
      updated_at: "2026-07-01T00:00:00.000Z",
    };
    const state: MockState = { tasks: [existing], insertCount: 0, insertFail: false };

    const result = await ensureFollowUpResponseReviewTask(
      createResponseReviewSupabase(state),
      USER_ID,
      CASE_ID,
      retailIntake()
    );

    expect(result.created).toBe(false);
    expect(result.task?.id).toBe("existing-review");
    expect(state.insertCount).toBe(0);
    expect(state.tasks).toHaveLength(1);
  });

  it("creates a fresh response-review task when the only marker-matching task is already closed (prior escalation step's review)", async () => {
    const marker = followUpResponseReviewTaskNotesMarker(CASE_ID);
    const closed: JusticeCaseTaskRow = {
      id: "closed-review",
      user_id: USER_ID,
      case_id: CASE_ID,
      title: "Follow-up response review: Acme Retail",
      due_date: null,
      notes: marker,
      completed_at: "2026-06-05T00:00:00.000Z",
      created_at: "2026-05-01T00:00:00.000Z",
      updated_at: "2026-06-05T00:00:00.000Z",
    };
    const state: MockState = { tasks: [closed], insertCount: 0, insertFail: false };

    const result = await ensureFollowUpResponseReviewTask(
      createResponseReviewSupabase(state),
      USER_ID,
      CASE_ID,
      retailIntake()
    );

    // A closed response-review task from an earlier escalation step must not block tracking
    // the next one — the marker is case-scoped, so a new task is required rather than reusing
    // the closed row.
    expect(result.created).toBe(true);
    expect(result.task?.id).not.toBe("closed-review");
    expect(state.insertCount).toBe(1);
    expect(state.tasks).toHaveLength(2);
    expect(state.tasks.at(-1)?.completed_at).toBeNull();
  });

  it("returns no task without inserting when insert fails", async () => {
    const state: MockState = { tasks: [], insertCount: 0, insertFail: true };
    const result = await ensureFollowUpResponseReviewTask(
      createResponseReviewSupabase(state),
      USER_ID,
      CASE_ID,
      retailIntake()
    );

    expect(result.task).toBeNull();
    expect(result.created).toBe(false);
    expect(state.insertCount).toBe(0);
  });
});

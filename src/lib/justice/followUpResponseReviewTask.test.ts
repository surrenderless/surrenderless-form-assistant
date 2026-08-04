import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildJusticeIntakeFromParts, defaultBuildJusticeIntakeParts } from "@/lib/justice/buildJusticeIntake";
import {
  appendSupersededLaneReviewDecisionToNotes,
  buildSupersededLaneResponseReviewTaskNotes,
  ensureFollowUpResponseReviewTask,
  ensureSupersededLaneResponseReviewTask,
  followUpResponseReviewTaskNotesMarker,
  isSupersededLaneReviewOutcome,
  supersededLaneReviewLinkedFollowUpTaskId,
  supersededLaneReviewOutcomeFromNotes,
  taskNotesMatchFollowUpResponseReviewMarker,
  taskNotesMatchSupersededLaneReviewMarker,
} from "@/lib/justice/followUpResponseReviewTask";
import { followUpTaskOwnerHref } from "@/lib/justice/followUpCaseTask";
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

const DEMAND_LETTER_HREF = "/justice/demand-letter";
const FOLLOW_UP_TASK_ID_1 = "550e8400-e29b-41d4-a716-446655440101";
const FOLLOW_UP_TASK_ID_2 = "550e8400-e29b-41d4-a716-446655440102";

describe("superseded-lane response review notes/marker/outcome helpers", () => {
  it("marker matches only this case's superseded-lane review notes", () => {
    const notes = buildSupersededLaneResponseReviewTaskNotes(
      CASE_ID,
      DEMAND_LETTER_HREF,
      FOLLOW_UP_TASK_ID_1,
      "Small claims / demand letter"
    );
    expect(taskNotesMatchSupersededLaneReviewMarker(notes, CASE_ID)).toBe(true);
    expect(taskNotesMatchSupersededLaneReviewMarker(notes, "other-case")).toBe(false);
    expect(taskNotesMatchSupersededLaneReviewMarker("unrelated", CASE_ID)).toBe(false);
    // Never confused with the case-scoped follow_up_response_review marker.
    expect(taskNotesMatchFollowUpResponseReviewMarker(notes, CASE_ID)).toBe(false);
  });

  it("carries a parseable owner_href via followUpTaskOwnerHref, reused unmodified from the follow-up marker convention", () => {
    const notes = buildSupersededLaneResponseReviewTaskNotes(
      CASE_ID,
      DEMAND_LETTER_HREF,
      FOLLOW_UP_TASK_ID_1,
      "Small claims / demand letter"
    );
    expect(followUpTaskOwnerHref(notes)).toBe(DEMAND_LETTER_HREF);
  });

  it("carries a parseable linked follow-up task id, distinct from owner_href", () => {
    const notes = buildSupersededLaneResponseReviewTaskNotes(
      CASE_ID,
      DEMAND_LETTER_HREF,
      FOLLOW_UP_TASK_ID_1,
      "Small claims / demand letter"
    );
    expect(supersededLaneReviewLinkedFollowUpTaskId(notes)).toBe(FOLLOW_UP_TASK_ID_1);
    expect(supersededLaneReviewLinkedFollowUpTaskId("unrelated")).toBeNull();
    expect(supersededLaneReviewLinkedFollowUpTaskId(null)).toBeNull();
  });

  it("validates the two-value outcome enum", () => {
    expect(isSupersededLaneReviewOutcome("response_received")).toBe(true);
    expect(isSupersededLaneReviewOutcome("no_response")).toBe(true);
    expect(isSupersededLaneReviewOutcome("resolved")).toBe(false);
    expect(isSupersededLaneReviewOutcome(null)).toBe(false);
  });

  it("round-trips a decision through the notes: append then parse recovers the exact outcome", () => {
    const base = buildSupersededLaneResponseReviewTaskNotes(
      CASE_ID,
      DEMAND_LETTER_HREF,
      FOLLOW_UP_TASK_ID_1,
      "Small claims / demand letter"
    );
    expect(supersededLaneReviewOutcomeFromNotes(base)).toBeNull();

    const withDecision = appendSupersededLaneReviewDecisionToNotes(
      base,
      "response_received",
      "Consumer confirmed a reply arrived by mail."
    );
    expect(supersededLaneReviewOutcomeFromNotes(withDecision)).toBe("response_received");
    expect(withDecision).toContain("Consumer confirmed a reply arrived by mail.");
    // Owner_href/marker/linked follow-up id are all preserved — the decision is additive, not a
    // replacement of identity.
    expect(taskNotesMatchSupersededLaneReviewMarker(withDecision, CASE_ID)).toBe(true);
    expect(followUpTaskOwnerHref(withDecision)).toBe(DEMAND_LETTER_HREF);
    expect(supersededLaneReviewLinkedFollowUpTaskId(withDecision)).toBe(FOLLOW_UP_TASK_ID_1);
  });

  it("replaces (never duplicates) a prior decision line on a retry with a different outcome", () => {
    const base = buildSupersededLaneResponseReviewTaskNotes(
      CASE_ID,
      DEMAND_LETTER_HREF,
      FOLLOW_UP_TASK_ID_1,
      "Small claims / demand letter"
    );
    const first = appendSupersededLaneReviewDecisionToNotes(base, "no_response");
    const corrected = appendSupersededLaneReviewDecisionToNotes(first, "response_received");

    expect(supersededLaneReviewOutcomeFromNotes(corrected)).toBe("response_received");
    expect((corrected.match(/^decision:/gm) ?? []).length).toBe(1);
  });
});

describe("ensureSupersededLaneResponseReviewTask", () => {
  beforeEach(() => {
    timelineStore.entries = [];
  });

  function createSupersededLaneSupabase(state: MockState): SupabaseClient {
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
                    return { data: matched, error: null };
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
                  id: `superseded-review-${state.insertCount}`,
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

  it("creates a pending (uncompleted) review scoped to this exact owner_href and follow-up id — real production path, not seeded state", async () => {
    const state: MockState = { tasks: [], insertCount: 0, insertFail: false };
    const result = await ensureSupersededLaneResponseReviewTask(
      createSupersededLaneSupabase(state),
      USER_ID,
      CASE_ID,
      DEMAND_LETTER_HREF,
      FOLLOW_UP_TASK_ID_1,
      "Small claims / demand letter"
    );

    expect(result.created).toBe(true);
    expect(result.task?.completed_at).toBeNull();
    expect(taskNotesMatchSupersededLaneReviewMarker(result.task?.notes, CASE_ID)).toBe(true);
    expect(followUpTaskOwnerHref(result.task?.notes)).toBe(DEMAND_LETTER_HREF);
    expect(supersededLaneReviewLinkedFollowUpTaskId(result.task?.notes)).toBe(FOLLOW_UP_TASK_ID_1);
  });

  it("is idempotent per (case, owner_href, follow_up_task_id): a second ensure for the SAME attempt reuses the same row instead of creating a duplicate — true webhook replay", async () => {
    const state: MockState = { tasks: [], insertCount: 0, insertFail: false };
    const supabase = createSupersededLaneSupabase(state);
    const first = await ensureSupersededLaneResponseReviewTask(
      supabase,
      USER_ID,
      CASE_ID,
      DEMAND_LETTER_HREF,
      FOLLOW_UP_TASK_ID_1,
      "Small claims / demand letter"
    );
    const second = await ensureSupersededLaneResponseReviewTask(
      supabase,
      USER_ID,
      CASE_ID,
      DEMAND_LETTER_HREF,
      FOLLOW_UP_TASK_ID_1,
      "Small claims / demand letter"
    );

    expect(second.created).toBe(false);
    expect(second.task?.id).toBe(first.task?.id);
    expect(state.insertCount).toBe(1);
  });

  it("creates a SEPARATE review for a different owner_href on the same case", async () => {
    const state: MockState = { tasks: [], insertCount: 0, insertFail: false };
    const supabase = createSupersededLaneSupabase(state);
    const demandLetter = await ensureSupersededLaneResponseReviewTask(
      supabase,
      USER_ID,
      CASE_ID,
      DEMAND_LETTER_HREF,
      FOLLOW_UP_TASK_ID_1,
      "Small claims / demand letter"
    );
    const paymentDispute = await ensureSupersededLaneResponseReviewTask(
      supabase,
      USER_ID,
      CASE_ID,
      "/justice/payment-dispute",
      FOLLOW_UP_TASK_ID_2,
      "Payment dispute (bank/card)"
    );

    expect(demandLetter.task?.id).not.toBe(paymentDispute.task?.id);
    expect(state.insertCount).toBe(2);
  });

  it("does NOT reuse an older, already-completed review from a prior attempt on the SAME lane when the follow-up id differs — a genuinely new remediation attempt always gets its own review", async () => {
    const oldCompletedReview: JusticeCaseTaskRow = {
      id: "old-review",
      user_id: USER_ID,
      case_id: CASE_ID,
      title: "Follow-up response review: Small claims / demand letter",
      due_date: null,
      notes: appendSupersededLaneReviewDecisionToNotes(
        buildSupersededLaneResponseReviewTaskNotes(
          CASE_ID,
          DEMAND_LETTER_HREF,
          FOLLOW_UP_TASK_ID_1,
          "Small claims / demand letter"
        ),
        "no_response"
      ),
      completed_at: "2026-06-01T00:00:00.000Z",
      created_at: "2026-05-01T00:00:00.000Z",
      updated_at: "2026-06-01T00:00:00.000Z",
    };
    const state: MockState = { tasks: [oldCompletedReview], insertCount: 0, insertFail: false };
    const supabase = createSupersededLaneSupabase(state);

    // A genuinely new remediation attempt on the same lane produces a NEW follow-up id — its
    // ensure call must create a fresh, pending review, never silently reuse the old decided one.
    const result = await ensureSupersededLaneResponseReviewTask(
      supabase,
      USER_ID,
      CASE_ID,
      DEMAND_LETTER_HREF,
      FOLLOW_UP_TASK_ID_2,
      "Small claims / demand letter"
    );

    expect(result.created).toBe(true);
    expect(result.task?.id).not.toBe("old-review");
    expect(result.task?.completed_at).toBeNull();
    expect(supersededLaneReviewLinkedFollowUpTaskId(result.task?.notes)).toBe(FOLLOW_UP_TASK_ID_2);
    // The old review is untouched — it remains as-is, a historical record of the prior attempt.
    expect(oldCompletedReview.completed_at).toBe("2026-06-01T00:00:00.000Z");
    expect(state.tasks).toHaveLength(2);
  });

  it("DOES reuse the old completed review when the follow-up id matches exactly — idempotent replay of the same attempt's completion", async () => {
    const oldCompletedReview: JusticeCaseTaskRow = {
      id: "old-review",
      user_id: USER_ID,
      case_id: CASE_ID,
      title: "Follow-up response review: Small claims / demand letter",
      due_date: null,
      notes: appendSupersededLaneReviewDecisionToNotes(
        buildSupersededLaneResponseReviewTaskNotes(
          CASE_ID,
          DEMAND_LETTER_HREF,
          FOLLOW_UP_TASK_ID_1,
          "Small claims / demand letter"
        ),
        "response_received"
      ),
      completed_at: "2026-06-01T00:00:00.000Z",
      created_at: "2026-05-01T00:00:00.000Z",
      updated_at: "2026-06-01T00:00:00.000Z",
    };
    const state: MockState = { tasks: [oldCompletedReview], insertCount: 0, insertFail: false };
    const supabase = createSupersededLaneSupabase(state);

    const result = await ensureSupersededLaneResponseReviewTask(
      supabase,
      USER_ID,
      CASE_ID,
      DEMAND_LETTER_HREF,
      FOLLOW_UP_TASK_ID_1,
      "Small claims / demand letter"
    );

    expect(result.created).toBe(false);
    expect(result.task?.id).toBe("old-review");
    expect(state.insertCount).toBe(0);
  });
});

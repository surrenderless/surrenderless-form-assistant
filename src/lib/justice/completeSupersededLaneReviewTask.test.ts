import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildSupersededLaneResponseReviewTaskNotes,
  buildSupersededLaneResponseReviewTaskTitle,
  supersededLaneReviewOutcomeFromNotes,
} from "@/lib/justice/followUpResponseReviewTask";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";
import type { TimelineEntry } from "@/lib/justice/types";

const CASE_ID = "550e8400-e29b-41d4-a716-446655440000";
const OTHER_CASE_ID = "550e8400-e29b-41d4-a716-446655440999";
const USER_ID = "user-owner-1";
const TASK_ID = "550e8400-e29b-41d4-a716-446655440080";
const LINKED_FOLLOW_UP_ID = "550e8400-e29b-41d4-a716-446655440090";
const OTHER_FOLLOW_UP_ID = "550e8400-e29b-41d4-a716-446655440091";
const OWNER_HREF = "/justice/demand-letter";

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

import { completeSupersededLaneReviewTask } from "@/lib/justice/completeSupersededLaneReviewTask";

function reviewTaskRow(overrides: Partial<JusticeCaseTaskRow> = {}): JusticeCaseTaskRow {
  return {
    id: TASK_ID,
    user_id: USER_ID,
    case_id: CASE_ID,
    title: buildSupersededLaneResponseReviewTaskTitle("Small claims / demand letter"),
    due_date: null,
    notes: buildSupersededLaneResponseReviewTaskNotes(
      CASE_ID,
      OWNER_HREF,
      LINKED_FOLLOW_UP_ID,
      "Small claims / demand letter"
    ),
    completed_at: null,
    created_at: "2026-07-05T00:00:00.000Z",
    updated_at: "2026-07-05T00:00:00.000Z",
    ...overrides,
  };
}

/** The follow-up task this review is linked to — its own due_date is what gates whether
 * "no_response" may be recorded. Dates are chosen far in the past/future so due/not-due status
 * never depends on when the test suite happens to run. */
function linkedFollowUpRow(params: {
  id?: string;
  caseId?: string;
  ownerHref?: string;
  dueDate: string | null;
  completedAt?: string | null;
}): JusticeCaseTaskRow {
  const caseId = params.caseId ?? CASE_ID;
  const ownerHref = params.ownerHref ?? OWNER_HREF;
  return {
    id: params.id ?? LINKED_FOLLOW_UP_ID,
    user_id: USER_ID,
    case_id: caseId,
    title: "Surrenderless follow-up",
    due_date: params.dueDate,
    notes: `follow_up:${caseId}\nowner_href:${ownerHref}`,
    completed_at: params.completedAt ?? null,
    created_at: "2026-06-01T00:00:00.000Z",
    updated_at: "2026-06-01T00:00:00.000Z",
  };
}

type MockState = {
  task: JusticeCaseTaskRow | null;
  archived_at: string | null;
  updateFail: boolean;
  linkedFollowUp?: JusticeCaseTaskRow | null;
  /** Extra rows the exact-id lookup can also resolve — e.g. an old, unrelated follow-up id that
   * must NOT be found when the review links to a different one, or a same-id row in another case. */
  extraTasks?: JusticeCaseTaskRow[];
};

function createSupabase(state: MockState): SupabaseClient {
  return {
    from: (table: string) => {
      if (table === "justice_cases") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: state.task
                    ? { id: CASE_ID, user_id: USER_ID, archived_at: state.archived_at }
                    : null,
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
            eq: (col1: string, val1: string) => ({
              eq: (col2: string, val2: string) => ({
                eq: (col3: string, val3: string) => ({
                  maybeSingle: async () => {
                    const filters: Record<string, string> = {
                      [col1]: val1,
                      [col2]: val2,
                      [col3]: val3,
                    };
                    const candidates = [
                      state.task,
                      state.linkedFollowUp,
                      ...(state.extraTasks ?? []),
                    ].filter((t): t is JusticeCaseTaskRow => Boolean(t));
                    const row = candidates.find((t) =>
                      Object.entries(filters).every(
                        ([col, val]) => (t as unknown as Record<string, unknown>)[col] === val
                      )
                    );
                    return { data: row ?? null, error: null };
                  },
                }),
              }),
            }),
          }),
          update: (patch: Record<string, unknown>) => ({
            eq: () => ({
              eq: () => ({
                select: () => ({
                  maybeSingle: async () => {
                    if (state.updateFail) {
                      return { data: null, error: { message: "update failed" } };
                    }
                    if (!state.task) return { data: null, error: null };
                    state.task = {
                      ...state.task,
                      ...(typeof patch.notes === "string" ? { notes: patch.notes } : {}),
                      ...(typeof patch.completed_at === "string"
                        ? { completed_at: patch.completed_at }
                        : {}),
                    };
                    return { data: state.task, error: null };
                  },
                }),
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  } as unknown as SupabaseClient;
}

describe("completeSupersededLaneReviewTask", () => {
  beforeEach(() => {
    timelineStore.entries = [];
  });

  it("records the decision durably in notes and completes the task atomically", async () => {
    const state: MockState = {
      task: reviewTaskRow(),
      archived_at: null,
      updateFail: false,
      linkedFollowUp: linkedFollowUpRow({ dueDate: "2099-01-01" }),
    };
    const result = await completeSupersededLaneReviewTask(createSupabase(state), USER_ID, {
      caseId: CASE_ID,
      taskId: TASK_ID,
      ownerHref: OWNER_HREF,
      outcome: "response_received",
      notes: "Consumer received a mailed reply.",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome).toBe("response_received");
    expect(result.idempotent).toBe(false);
    expect(result.task.completed_at).toBeTruthy();
    expect(supersededLaneReviewOutcomeFromNotes(result.task.notes)).toBe("response_received");
    expect(result.task.notes).toContain("Consumer received a mailed reply.");
    expect(timelineStore.entries.some((e) => e.type === "outcome_recorded")).toBe(true);
  });

  it("records no_response identically to response_received, just with the other outcome — once its linked follow-up is actually due", async () => {
    const state: MockState = {
      task: reviewTaskRow(),
      archived_at: null,
      updateFail: false,
      linkedFollowUp: linkedFollowUpRow({ dueDate: "2000-01-01" }),
    };
    const result = await completeSupersededLaneReviewTask(createSupabase(state), USER_ID, {
      caseId: CASE_ID,
      taskId: TASK_ID,
      ownerHref: OWNER_HREF,
      outcome: "no_response",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome).toBe("no_response");
    expect(supersededLaneReviewOutcomeFromNotes(result.task.notes)).toBe("no_response");
  });

  it("permits response_received at any time, even when the linked follow-up isn't due yet", async () => {
    const state: MockState = {
      task: reviewTaskRow(),
      archived_at: null,
      updateFail: false,
      linkedFollowUp: linkedFollowUpRow({ dueDate: "2099-01-01" }),
    };
    const result = await completeSupersededLaneReviewTask(createSupabase(state), USER_ID, {
      caseId: CASE_ID,
      taskId: TASK_ID,
      ownerHref: OWNER_HREF,
      outcome: "response_received",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome).toBe("response_received");
    expect(result.task.completed_at).toBeTruthy();
  });

  it("rejects no_response before the linked follow-up's own due date — the deadline hasn't actually passed yet", async () => {
    const state: MockState = {
      task: reviewTaskRow(),
      archived_at: null,
      updateFail: false,
      linkedFollowUp: linkedFollowUpRow({ dueDate: "2099-01-01" }),
    };
    const result = await completeSupersededLaneReviewTask(createSupabase(state), USER_ID, {
      caseId: CASE_ID,
      taskId: TASK_ID,
      ownerHref: OWNER_HREF,
      outcome: "no_response",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);
    expect(result.error).toMatch(/not due yet/i);
    // Rejected before ever touching the row — no partial state, task stays fully open.
    expect(state.task?.completed_at).toBeNull();
    expect(supersededLaneReviewOutcomeFromNotes(state.task?.notes)).toBeNull();
  });

  it("rejects (both outcomes) when the linked follow-up task cannot be found at all — never assumes due, and never proceeds, without confirming the schedule", async () => {
    for (const outcome of ["no_response", "response_received"] as const) {
      const state: MockState = {
        task: reviewTaskRow(),
        archived_at: null,
        updateFail: false,
        linkedFollowUp: null,
      };
      const result = await completeSupersededLaneReviewTask(createSupabase(state), USER_ID, {
        caseId: CASE_ID,
        taskId: TASK_ID,
        ownerHref: OWNER_HREF,
        outcome,
      });

      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.status).toBe(400);
      expect(result.error).toMatch(/linked follow-up/i);
      expect(state.task?.completed_at).toBeNull();
    }
  });

  it("rejects when the review's notes have no linked follow-up id at all (malformed/legacy row) — fails safely, no mutation", async () => {
    const state: MockState = {
      task: reviewTaskRow({
        // Pre-linkage-fix shape: no follow_up_task_id line at all.
        notes: `superseded_lane_review:${CASE_ID}\nowner_href:${OWNER_HREF}\ncase_id: ${CASE_ID}`,
      }),
      archived_at: null,
      updateFail: false,
      linkedFollowUp: linkedFollowUpRow({ dueDate: "2000-01-01" }),
    };
    const result = await completeSupersededLaneReviewTask(createSupabase(state), USER_ID, {
      caseId: CASE_ID,
      taskId: TASK_ID,
      ownerHref: OWNER_HREF,
      outcome: "response_received",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);
    expect(result.error).toMatch(/missing its linked follow-up/i);
    expect(state.task?.completed_at).toBeNull();
  });

  it("rejects when the linked follow-up id points at a row in a DIFFERENT case (cross-case linkage) — the exact-id lookup is scoped by case_id and finds nothing", async () => {
    const state: MockState = {
      task: reviewTaskRow(),
      archived_at: null,
      updateFail: false,
      // A row with the linked id exists, but it belongs to another case — must never resolve.
      extraTasks: [
        linkedFollowUpRow({ id: LINKED_FOLLOW_UP_ID, caseId: OTHER_CASE_ID, dueDate: "2000-01-01" }),
      ],
    };
    const result = await completeSupersededLaneReviewTask(createSupabase(state), USER_ID, {
      caseId: CASE_ID,
      taskId: TASK_ID,
      ownerHref: OWNER_HREF,
      outcome: "response_received",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);
    expect(state.task?.completed_at).toBeNull();
  });

  it("rejects when the linked follow-up's own owner_href does not match this review's owner_href (mismatched linkage) — fails safely, no mutation", async () => {
    const state: MockState = {
      task: reviewTaskRow(),
      archived_at: null,
      updateFail: false,
      linkedFollowUp: linkedFollowUpRow({
        ownerHref: "/justice/payment-dispute",
        dueDate: "2000-01-01",
      }),
    };
    const result = await completeSupersededLaneReviewTask(createSupabase(state), USER_ID, {
      caseId: CASE_ID,
      taskId: TASK_ID,
      ownerHref: OWNER_HREF,
      outcome: "response_received",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);
    expect(result.error).toMatch(/does not match this review's owner_href/i);
    expect(state.task?.completed_at).toBeNull();
  });

  it("is idempotent: replaying against an already-completed review returns the persisted decision without re-updating or re-fetching the linked follow-up", async () => {
    const completed = reviewTaskRow({
      completed_at: "2026-07-16T00:00:00.000Z",
      notes: `${buildSupersededLaneResponseReviewTaskNotes(CASE_ID, OWNER_HREF, LINKED_FOLLOW_UP_ID, "Small claims / demand letter")}\ndecision:response_received`,
    });
    // No linkedFollowUp provided at all — proves the idempotent early-return never needs it.
    const state: MockState = { task: completed, archived_at: null, updateFail: false };
    const result = await completeSupersededLaneReviewTask(createSupabase(state), USER_ID, {
      caseId: CASE_ID,
      taskId: TASK_ID,
      ownerHref: OWNER_HREF,
      // Even a conflicting requested outcome on replay must not overwrite the durable decision.
      outcome: "no_response",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.idempotent).toBe(true);
    expect(result.outcome).toBe("response_received");
    expect(result.timeline).toBeNull();
  });

  it("rejects when the task's owner_href does not match the given owner_href", async () => {
    const state: MockState = { task: reviewTaskRow(), archived_at: null, updateFail: false };
    const result = await completeSupersededLaneReviewTask(createSupabase(state), USER_ID, {
      caseId: CASE_ID,
      taskId: TASK_ID,
      ownerHref: "/justice/payment-dispute",
      outcome: "response_received",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);
    expect(result.error).toMatch(/owner_href/i);
    expect(state.task?.completed_at).toBeNull();
  });

  it("rejects a task that isn't a superseded-lane review at all", async () => {
    const state: MockState = {
      task: { ...reviewTaskRow(), notes: "some other task" },
      archived_at: null,
      updateFail: false,
    };
    const result = await completeSupersededLaneReviewTask(createSupabase(state), USER_ID, {
      caseId: CASE_ID,
      taskId: TASK_ID,
      ownerHref: OWNER_HREF,
      outcome: "response_received",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);
    expect(result.error).toMatch(/not a superseded-lane response review/i);
  });

  it("rejects an invalid outcome before touching the database", async () => {
    const state: MockState = { task: reviewTaskRow(), archived_at: null, updateFail: false };
    const result = await completeSupersededLaneReviewTask(createSupabase(state), USER_ID, {
      caseId: CASE_ID,
      taskId: TASK_ID,
      ownerHref: OWNER_HREF,
      outcome: "maybe" as never,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);
  });

  it("returns 404 when the case does not belong to this user", async () => {
    const state: MockState = { task: null, archived_at: null, updateFail: false };
    const result = await completeSupersededLaneReviewTask(createSupabase(state), USER_ID, {
      caseId: CASE_ID,
      taskId: TASK_ID,
      ownerHref: OWNER_HREF,
      outcome: "response_received",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(404);
  });

  it("rejects when the case is archived", async () => {
    const state: MockState = { task: reviewTaskRow(), archived_at: "2026-07-20T00:00:00.000Z", updateFail: false };
    const result = await completeSupersededLaneReviewTask(createSupabase(state), USER_ID, {
      caseId: CASE_ID,
      taskId: TASK_ID,
      ownerHref: OWNER_HREF,
      outcome: "response_received",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(409);
  });

  it("retries on a real database failure instead of silently succeeding — leaves the task open with no decision recorded", async () => {
    const state: MockState = {
      task: reviewTaskRow(),
      archived_at: null,
      updateFail: true,
      linkedFollowUp: linkedFollowUpRow({ dueDate: "2099-01-01" }),
    };
    const result = await completeSupersededLaneReviewTask(createSupabase(state), USER_ID, {
      caseId: CASE_ID,
      taskId: TASK_ID,
      ownerHref: OWNER_HREF,
      outcome: "response_received",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(500);
    expect(state.task?.completed_at).toBeNull();
    expect(supersededLaneReviewOutcomeFromNotes(state.task?.notes)).toBeNull();
  });

  it("never reads or requires client_state — this endpoint is fully scoped to the review task alone", async () => {
    // No justice_cases columns beyond id/user_id/archived_at are ever selected — confirmed by
    // createSupabase's justice_cases mock, which returns no client_state/approved_next_action at
    // all, yet completion still succeeds.
    const state: MockState = {
      task: reviewTaskRow(),
      archived_at: null,
      updateFail: false,
      linkedFollowUp: linkedFollowUpRow({ dueDate: "2099-01-01" }),
    };
    const result = await completeSupersededLaneReviewTask(createSupabase(state), USER_ID, {
      caseId: CASE_ID,
      taskId: TASK_ID,
      ownerHref: OWNER_HREF,
      outcome: "response_received",
    });
    expect(result.ok).toBe(true);
  });

  it("never mistakes an unrelated same-lane follow-up id for the linked one — only the exact linked id resolves", async () => {
    const state: MockState = {
      task: reviewTaskRow(), // linked to LINKED_FOLLOW_UP_ID
      archived_at: null,
      updateFail: false,
      // A DIFFERENT follow-up row for the SAME lane/case exists (e.g. an older attempt) but is
      // NOT the one this review is linked to — it must never be picked up as a substitute.
      extraTasks: [linkedFollowUpRow({ id: OTHER_FOLLOW_UP_ID, dueDate: "2000-01-01" })],
    };
    const result = await completeSupersededLaneReviewTask(createSupabase(state), USER_ID, {
      caseId: CASE_ID,
      taskId: TASK_ID,
      ownerHref: OWNER_HREF,
      outcome: "no_response",
    });

    // The linked id (LINKED_FOLLOW_UP_ID) resolves to nothing in this state — the unrelated
    // OTHER_FOLLOW_UP_ID row must not be substituted, so this fails safely rather than
    // incorrectly evaluating due-status against the wrong attempt.
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);
    expect(state.task?.completed_at).toBeNull();
  });
});

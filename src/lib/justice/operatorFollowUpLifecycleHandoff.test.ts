import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildJusticeIntakeFromParts, defaultBuildJusticeIntakeParts } from "@/lib/justice/buildJusticeIntake";
import {
  OPERATOR_RESOLVED_OUTCOME_MARKER,
} from "@/lib/justice/completeFollowUpResponseReview";
import { ensureFollowUpAfterOperatorClientStateWrite } from "@/lib/justice/ensureFollowUpAfterOperatorClientStateWrite";
import {
  followUpTaskNotesMarker,
  taskNotesMatchFollowUpMarker,
} from "@/lib/justice/followUpCaseTask";
import { followUpResponseReviewTaskNotesMarker } from "@/lib/justice/followUpResponseReviewTask";
import { MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF } from "@/lib/justice/handlingTrackingProgress";
import { detectOperatorOwnedClosableCase } from "@/lib/justice/operatorOwnedCaseArchive";
import {
  NO_RESPONSE_OUTCOME_MARKER,
  processDueFollowUps,
} from "@/lib/justice/processDueFollowUps";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";
import type { JusticeIntake, TimelineEntry } from "@/lib/justice/types";

const CASE_ID = "550e8400-e29b-41d4-a716-446655440000";
const USER_ID = "user-owner-1";
const FOLLOW_UP_TASK_ID = "550e8400-e29b-41d4-a716-446655440070";
const REVIEW_TASK_ID = "550e8400-e29b-41d4-a716-446655440071";

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

vi.mock("@/lib/justice/demandLetterEmailDelivery", () => ({
  attemptAutomatedDemandLetterEmailDeliveryAfterEnsure: vi.fn(
    async (
      _supabase: SupabaseClient,
      _userId: string,
      _caseId: string,
      timeline: TimelineEntry[] | null
    ) => ({ timeline, result: { status: "skipped" as const } })
  ),
}));

function retailIntake(): JusticeIntake {
  return buildJusticeIntakeFromParts({
    ...defaultBuildJusticeIntakeParts(),
    problem_category: "online_purchase",
    company_name: "Acme Retail",
    purchase_or_signup: "widget order",
    story: "Ordered a widget that never arrived.",
    money_amount: "$89.00",
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
  followUpTask: JusticeCaseTaskRow | null;
  client_state: Record<string, unknown>;
  intake: JusticeIntake;
  responseReviewInserted: number;
  casePatched: number;
};

/** Same capable shape as processDueFollowUps.integration.test, plus follow-up insert for the finalizer. */
function createCapableSupabase(state: MockState): SupabaseClient {
  const listFollowUpTasks = async () => ({
    data: state.followUpTask && !state.followUpTask.completed_at?.trim() ? [state.followUpTask] : [],
    error: null,
  });

  const responseReviewRow = (): JusticeCaseTaskRow => ({
    id: REVIEW_TASK_ID,
    user_id: USER_ID,
    case_id: CASE_ID,
    title: "Follow-up response review: Acme Retail",
    due_date: null,
    notes: followUpResponseReviewTaskNotesMarker(CASE_ID),
    completed_at: null,
    created_at: "2026-07-15T14:00:00.000Z",
    updated_at: "2026-07-15T14:00:00.000Z",
  });

  const rowsMatchingLike = (_column: string, pattern: string) => {
    const prefix = pattern.endsWith("%") ? pattern.slice(0, -1) : pattern;
    const rows: JusticeCaseTaskRow[] = [];
    if (
      state.followUpTask &&
      !state.followUpTask.completed_at?.trim() &&
      (state.followUpTask.notes ?? "").startsWith(prefix)
    ) {
      rows.push(state.followUpTask);
    }
    if (state.responseReviewInserted > 0) {
      const review = responseReviewRow();
      if ((review.notes ?? "").startsWith(prefix)) rows.push(review);
    }
    return rows;
  };

  const selectTasksChain = () => {
    const like = (column: string, pattern: string) => ({
      limit: async () => ({ data: rowsMatchingLike(column, pattern), error: null }),
      order: () => ({ limit: listFollowUpTasks }),
    });

    const eqCase = () => ({
      like,
      eq: () => ({
        like,
        limit: async () => ({
          data: state.followUpTask ? [state.followUpTask] : [],
          error: null,
        }),
        maybeSingle: async () => ({ data: state.followUpTask, error: null }),
      }),
      limit: async () => ({
        data: state.followUpTask ? [state.followUpTask] : [],
        error: null,
      }),
      maybeSingle: async () => ({ data: state.followUpTask, error: null }),
    });

    return {
      is: () => ({
        like: () => ({
          order: () => ({ limit: listFollowUpTasks }),
        }),
      }),
      eq: () => ({
        eq: eqCase,
        like,
        maybeSingle: async () => ({ data: state.followUpTask, error: null }),
      }),
    };
  };

  return {
    from: (table: string) => {
      if (table === "justice_case_tasks") {
        return {
          select: selectTasksChain,
          update: (patch: Record<string, unknown>) => ({
            eq: () => ({
              eq: () => ({
                select: () => ({
                  maybeSingle: async () => {
                    if (!state.followUpTask) {
                      return { data: null, error: { message: "missing" } };
                    }
                    state.followUpTask = {
                      ...state.followUpTask,
                      completed_at:
                        typeof patch.completed_at === "string"
                          ? patch.completed_at
                          : state.followUpTask.completed_at,
                      updated_at: "2026-07-15T14:05:00.000Z",
                    };
                    return { data: state.followUpTask, error: null };
                  },
                }),
              }),
            }),
          }),
          insert: (row: Record<string, unknown>) => ({
            select: () => ({
              single: async () => {
                const notes = typeof row.notes === "string" ? row.notes : "";
                if (notes.startsWith(followUpResponseReviewTaskNotesMarker(CASE_ID))) {
                  state.responseReviewInserted += 1;
                  return { data: responseReviewRow(), error: null };
                }
                if (notes.startsWith(followUpTaskNotesMarker(CASE_ID))) {
                  const task: JusticeCaseTaskRow = {
                    id: FOLLOW_UP_TASK_ID,
                    user_id: USER_ID,
                    case_id: CASE_ID,
                    title: String(row.title ?? ""),
                    due_date: typeof row.due_date === "string" ? row.due_date : null,
                    notes,
                    completed_at: null,
                    created_at: "2026-07-17T12:00:00.000Z",
                    updated_at: "2026-07-17T12:00:00.000Z",
                  };
                  state.followUpTask = task;
                  return { data: task, error: null };
                }
                return { data: null, error: { message: "unexpected insert" } };
              },
            }),
          }),
        };
      }

      if (table === "justice_cases") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    id: CASE_ID,
                    user_id: USER_ID,
                    intake: state.intake,
                    client_state: state.client_state,
                    archived_at: null,
                  },
                  error: null,
                }),
              }),
            }),
          }),
          update: (patch: Record<string, unknown>) => ({
            eq: () => ({
              eq: async () => {
                state.casePatched += 1;
                if (patch.client_state) {
                  state.client_state = patch.client_state as Record<string, unknown>;
                }
                return { error: null };
              },
            }),
          }),
        };
      }

      throw new Error(`unexpected table ${table}`);
    },
  } as unknown as SupabaseClient;
}

describe("terminal operator filing → follow-up lifecycle handoff", () => {
  beforeEach(() => {
    timelineStore.entries = [];
  });

  it("finalizer seeds follow-up task; due processing queues response review; resolved review is archive-eligible", async () => {
    const state: MockState = {
      intake: retailIntake(),
      followUpTask: null,
      responseReviewInserted: 0,
      casePatched: 0,
      client_state: {
        prepared_packet_approved: true,
        approved_next_action: {
          label: "Small claims / demand letter",
          href: MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF,
          status: "completed",
          completed_at: "2026-06-01T00:00:00.000Z",
        },
      },
    };

    const nextClientState = {
      prepared_packet_approved: true,
      approved_next_action: {
        label: "Small claims / demand letter",
        href: MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF,
        status: "completed" as const,
        completed_at: "2026-06-01T00:00:00.000Z",
        follow_up_needed: true as const,
        follow_up_at: "2026-07-01T12:00:00.000Z",
        outcome_note: "Escalation complete. Awaiting responses.",
        handling_requested_at: "2026-06-01T00:00:00.000Z",
      },
    };

    const ensured = await ensureFollowUpAfterOperatorClientStateWrite(createCapableSupabase(state), {
      userId: USER_ID,
      caseId: CASE_ID,
      existingClientState: state.client_state,
      nextClientState,
    });
    expect(ensured.ok).toBe(true);
    if (!ensured.ok) return;
    expect(ensured.created).toBe(true);
    expect(state.followUpTask).not.toBeNull();
    expect(taskNotesMatchFollowUpMarker(state.followUpTask!.notes, CASE_ID)).toBe(true);
    state.client_state = nextClientState;

    // Idempotent re-run does not duplicate.
    const again = await ensureFollowUpAfterOperatorClientStateWrite(createCapableSupabase(state), {
      userId: USER_ID,
      caseId: CASE_ID,
      existingClientState: nextClientState,
      nextClientState,
    });
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.created).toBe(false);

    const due = await processDueFollowUps(createCapableSupabase(state), {
      now: new Date("2026-07-15T16:00:00.000Z"),
    });
    expect(due.terminal_response_review).toBe(1);
    expect(state.responseReviewInserted).toBe(1);
    expect(state.followUpTask?.completed_at).toBeTruthy();

    const next = state.client_state.approved_next_action as {
      follow_up_needed?: boolean;
      outcome_note?: string;
      handling_acknowledged_at?: string;
    };
    expect(next.follow_up_needed).toBe(false);
    expect(next.outcome_note).toContain(NO_RESPONSE_OUTCOME_MARKER);

    next.outcome_note = `${OPERATOR_RESOLVED_OUTCOME_MARKER}. Confirmed refund.`;
    next.handling_acknowledged_at = "2026-07-15T18:00:00.000Z";

    expect(
      detectOperatorOwnedClosableCase({
        caseId: CASE_ID,
        archivedAt: null,
        clientState: state.client_state,
        tasks: [
          state.followUpTask!,
          {
            ...responseReviewRowForArchive(),
            completed_at: "2026-07-15T18:00:00.000Z",
          },
        ],
      })
    ).toBe(true);
  });
});

function responseReviewRowForArchive(): JusticeCaseTaskRow {
  return {
    id: REVIEW_TASK_ID,
    user_id: USER_ID,
    case_id: CASE_ID,
    title: "Follow-up response review: Acme Retail",
    due_date: null,
    notes: followUpResponseReviewTaskNotesMarker(CASE_ID),
    completed_at: "2026-07-15T18:00:00.000Z",
    created_at: "2026-07-15T14:00:00.000Z",
    updated_at: "2026-07-15T18:00:00.000Z",
  };
}

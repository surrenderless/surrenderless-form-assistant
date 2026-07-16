import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildJusticeIntakeFromParts, defaultBuildJusticeIntakeParts } from "@/lib/justice/buildJusticeIntake";
import {
  completeFollowUpResponseReview,
  OPERATOR_RESOLVED_OUTCOME_MARKER,
} from "@/lib/justice/completeFollowUpResponseReview";
import { followUpResponseReviewTaskNotesMarker } from "@/lib/justice/followUpResponseReviewTask";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";
import type { JusticeIntake, TimelineEntry } from "@/lib/justice/types";

const CASE_ID = "550e8400-e29b-41d4-a716-446655440000";
const USER_ID = "user-owner-1";
const TASK_ID = "550e8400-e29b-41d4-a716-446655440080";

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

function retailIntake(overrides: Record<string, unknown> = {}): JusticeIntake {
  return buildJusticeIntakeFromParts({
    ...defaultBuildJusticeIntakeParts(),
    problem_category: "online_purchase",
    company_name: "Acme Retail",
    purchase_or_signup: "widget order",
    story: "Ordered a widget that never arrived.",
    money_amount: "$89.00",
    pay_or_order_date: "2026-01-10",
    already_contacted: "yes",
    contact_method: "email",
    contact_date: "2026-01-15",
    merchant_response_type: "refused_help",
    user_display_name: "Jordan Lee",
    reply_email: "e2e@example.com",
    consumer_us_state: "CA",
    ...overrides,
  });
}

type MockState = {
  task: JusticeCaseTaskRow;
  client_state: Record<string, unknown>;
  intake: JusticeIntake;
  archived_at: string | null;
  casePatched: number;
  lastPatch: Record<string, unknown> | null;
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
                  data: {
                    id: CASE_ID,
                    user_id: USER_ID,
                    intake: state.intake,
                    client_state: state.client_state,
                    archived_at: state.archived_at,
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
                state.lastPatch = patch;
                if (patch.client_state) {
                  state.client_state = patch.client_state as Record<string, unknown>;
                }
                if (patch.intake) {
                  state.intake = patch.intake as JusticeIntake;
                }
                expect(patch).not.toHaveProperty("archived_at");
                return { error: null };
              },
            }),
          }),
        };
      }
      if (table === "justice_case_tasks") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({ data: state.task, error: null }),
                  limit: async () => ({ data: [state.task], error: null }),
                }),
                maybeSingle: async () => ({ data: state.task, error: null }),
                like: () => ({
                  limit: async () => ({ data: [state.task], error: null }),
                }),
                limit: async () => ({ data: [state.task], error: null }),
              }),
            }),
          }),
          update: (patch: Record<string, unknown>) => ({
            eq: () => ({
              eq: () => ({
                select: () => ({
                  maybeSingle: async () => {
                    if (typeof patch.completed_at === "string") {
                      state.task = { ...state.task, completed_at: patch.completed_at };
                    }
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

describe("completeFollowUpResponseReview", () => {
  beforeEach(() => {
    timelineStore.entries = [];
  });

  it("completes the task, marks intake resolved, and never archives", async () => {
    const marker = followUpResponseReviewTaskNotesMarker(CASE_ID);
    const state: MockState = {
      intake: retailIntake(),
      archived_at: null,
      casePatched: 0,
      lastPatch: null,
      client_state: {
        prepared_packet_approved: true,
        approved_next_action: {
          label: "Small claims / demand letter",
          href: "/justice/demand-letter",
          status: "completed",
          completed_at: "2026-06-01T00:00:00.000Z",
          follow_up_needed: false,
          outcome_note: "No response recorded by follow-up date.",
          handling_requested_at: "2026-06-01T00:00:00.000Z",
        },
      },
      task: {
        id: TASK_ID,
        user_id: USER_ID,
        case_id: CASE_ID,
        title: "Follow-up response review: Acme Retail",
        due_date: null,
        notes: marker,
        completed_at: null,
        created_at: "2026-07-01T00:00:00.000Z",
        updated_at: "2026-07-01T00:00:00.000Z",
      },
    };

    const result = await completeFollowUpResponseReview(createSupabase(state), USER_ID, {
      caseId: CASE_ID,
      taskId: TASK_ID,
      outcome: "resolved",
      notes: "Full refund received.",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.archived).toBe(false);
    expect(result.idempotent).toBe(false);
    expect(state.task.completed_at).toBeTruthy();
    expect(state.intake.merchant_response_type).toBe("resolved");
    expect(state.casePatched).toBe(1);
    expect(state.lastPatch).not.toHaveProperty("archived_at");
    const next = state.client_state.approved_next_action as {
      outcome_note?: string;
      follow_up_needed?: boolean;
    };
    expect(next.outcome_note).toContain(OPERATOR_RESOLVED_OUTCOME_MARKER);
    expect(next.follow_up_needed).toBe(false);
    expect(timelineStore.entries.some((e) => e.type === "outcome_recorded")).toBe(true);
    expect(timelineStore.entries.some((e) => e.type === "task_completed")).toBe(true);
  });

  it("is idempotent when the response-review task is already completed", async () => {
    const marker = followUpResponseReviewTaskNotesMarker(CASE_ID);
    const state: MockState = {
      intake: retailIntake({ merchant_response_type: "resolved" }),
      archived_at: null,
      casePatched: 0,
      lastPatch: null,
      client_state: {
        prepared_packet_approved: true,
        approved_next_action: {
          label: "Demand letter",
          href: "/justice/demand-letter",
          status: "completed",
          outcome_note: OPERATOR_RESOLVED_OUTCOME_MARKER,
        },
      },
      task: {
        id: TASK_ID,
        user_id: USER_ID,
        case_id: CASE_ID,
        title: "Follow-up response review: Acme Retail",
        due_date: null,
        notes: marker,
        completed_at: "2026-07-15T12:00:00.000Z",
        created_at: "2026-07-01T00:00:00.000Z",
        updated_at: "2026-07-15T12:00:00.000Z",
      },
    };

    const result = await completeFollowUpResponseReview(createSupabase(state), USER_ID, {
      caseId: CASE_ID,
      taskId: TASK_ID,
      outcome: "resolved",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.idempotent).toBe(true);
    expect(state.casePatched).toBe(0);
  });
});

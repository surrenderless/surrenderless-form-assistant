import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildJusticeIntakeFromParts, defaultBuildJusticeIntakeParts } from "@/lib/justice/buildJusticeIntake";
import {
  MANUAL_ACTION_TRACKING_REAL_PAYMENT_DISPUTE_PREP_HREF,
  canonicalFilingDestinationForApprovedActionHref,
} from "@/lib/justice/handlingTrackingProgress";
import {
  paymentDisputeFilingTaskNotesMarker,
  shouldQueuePaymentDisputeFilingTask,
} from "@/lib/justice/paymentDisputeFilingTask";
import { buildPaymentDisputeOperatorFilingWorkspace } from "@/lib/justice/paymentDisputeOperatorFilingWorkspace";
import type { JusticeCaseFilingRow } from "@/lib/justice/filings";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";
import type { JusticeIntake, TimelineEntry } from "@/lib/justice/types";

const CASE_ID = "550e8400-e29b-41d4-a716-446655440000";
const USER_ID = "user-owner-1";
const TASK_ID = "550e8400-e29b-41d4-a716-446655440099";

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

import { completePaymentDisputeOperatorFiling } from "@/lib/justice/completePaymentDisputeOperatorFiling";

function paymentIntake(overrides: Partial<JusticeIntake> = {}): JusticeIntake {
  return buildJusticeIntakeFromParts({
    ...defaultBuildJusticeIntakeParts(),
    problem_category: "charge_dispute",
    company_name: "Acme Retail",
    purchase_or_signup: "widget order",
    story: "Ordered a widget that never arrived and merchant refused a refund.",
    money_involved: "$89.00",
    pay_or_order_date: "2026-01-10",
    already_contacted: "yes",
    contact_method: "email",
    contact_date: "2026-01-15",
    merchant_response_type: "refused_help",
    user_display_name: "Jordan Lee",
    reply_email: "e2e@example.com",
    consumer_us_state: "CA",
    card_issuer_contact_email: "disputes@bank.example",
    ...overrides,
  });
}

type MockCaseState = {
  intake: JusticeIntake;
  client_state: Record<string, unknown>;
  filings: JusticeCaseFilingRow[];
  task: JusticeCaseTaskRow;
  filingInsertCount: number;
};

function createPaymentCompleteSupabase(state: MockCaseState): SupabaseClient {
  return {
    from: (table: string) => {
      if (table === "justice_cases") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    intake: state.intake,
                    client_state: state.client_state,
                    timeline: timelineStore.entries,
                    payment_dispute_draft: null,
                  },
                  error: null,
                }),
              }),
            }),
          }),
          update: (patch: Record<string, unknown>) => ({
            eq: () => ({
              eq: async () => {
                if (patch.client_state) {
                  state.client_state = patch.client_state as Record<string, unknown>;
                }
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
                  limit: async () => ({ data: [state.task], error: null }),
                  maybeSingle: async () => ({ data: state.task, error: null }),
                }),
                like: () => ({
                  limit: async () => ({ data: [state.task], error: null }),
                }),
                limit: async () => ({ data: [state.task], error: null }),
                maybeSingle: async () => ({ data: state.task, error: null }),
              }),
              like: () => ({
                limit: async () => ({ data: [state.task], error: null }),
              }),
              maybeSingle: async () => ({ data: state.task, error: null }),
            }),
          }),
          update: (patch: Record<string, unknown>) => ({
            eq: () => ({
              eq: () => ({
                select: () => ({
                  maybeSingle: async () => {
                    state.task = {
                      ...state.task,
                      completed_at:
                        typeof patch.completed_at === "string"
                          ? patch.completed_at
                          : state.task.completed_at,
                      updated_at: "2026-06-22T12:05:00.000Z",
                    };
                    return { data: state.task, error: null };
                  },
                }),
              }),
            }),
          }),
        };
      }

      if (table === "justice_case_filings") {
        return {
          select: () => ({
            eq: () => ({
              eq: async () => ({ data: state.filings, error: null }),
            }),
          }),
          insert: (row: Record<string, unknown>) => ({
            select: () => ({
              single: async () => {
                state.filingInsertCount += 1;
                const filing: JusticeCaseFilingRow = {
                  id: `fil-${state.filingInsertCount}`,
                  user_id: USER_ID,
                  case_id: CASE_ID,
                  destination: String(row.destination ?? ""),
                  filed_at: typeof row.filed_at === "string" ? row.filed_at : null,
                  confirmation_number:
                    typeof row.confirmation_number === "string" ? row.confirmation_number : null,
                  filing_url: null,
                  notes: typeof row.notes === "string" ? row.notes : null,
                  created_at: "2026-06-22T12:00:00.000Z",
                  updated_at: "2026-06-22T12:00:00.000Z",
                };
                state.filings = [...state.filings, filing];
                return { data: filing, error: null };
              },
            }),
          }),
        };
      }

      if (table === "justice_case_evidence") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                order: () => ({
                  limit: async () => ({ data: [], error: null }),
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

describe("payment-dispute workspace completion behavior", () => {
  beforeEach(() => {
    timelineStore.entries = [];
  });

  it("keeps workspace is_submitted false while requiring the same confirmation fields as the complete API", () => {
    const workspace = buildPaymentDisputeOperatorFilingWorkspace({
      intake: paymentIntake(),
      caseId: CASE_ID,
    });
    expect(workspace.is_submitted).toBe(false);
    expect(workspace.filing_destination).toBe(
      canonicalFilingDestinationForApprovedActionHref(
        MANUAL_ACTION_TRACKING_REAL_PAYMENT_DISPUTE_PREP_HREF
      )
    );
    expect(workspace.confirmation_capture).toEqual({
      requires_filed_at: true,
      requires_confirmation_number: true,
      requires_destination: true,
    });
  });

  it("rejects completion without confirmation number (no false submitted state)", async () => {
    const marker = paymentDisputeFilingTaskNotesMarker(CASE_ID);
    const state: MockCaseState = {
      intake: paymentIntake(),
      client_state: {
        prepared_packet_approved: true,
        approved_next_action: {
          label: "Payment dispute (bank/card)",
          href: MANUAL_ACTION_TRACKING_REAL_PAYMENT_DISPUTE_PREP_HREF,
          status: "approved",
        },
      },
      filings: [],
      task: {
        id: TASK_ID,
        user_id: USER_ID,
        case_id: CASE_ID,
        title: "Payment dispute: Acme Retail",
        due_date: null,
        notes: `${marker}\ncase_id: ${CASE_ID}\ndraft:\nDISPUTE`,
        completed_at: null,
        created_at: "2026-06-01T00:00:00.000Z",
        updated_at: "2026-06-01T00:00:00.000Z",
      },
      filingInsertCount: 0,
    };
    const result = await completePaymentDisputeOperatorFiling(
      createPaymentCompleteSupabase(state),
      USER_ID,
      {
        caseId: CASE_ID,
        taskId: TASK_ID,
        destination: "Payment dispute (bank/card)",
        filedAt: "2026-06-15",
        confirmationNumber: "",
      }
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/confirmation/i);
    }
    expect(state.filings).toHaveLength(0);
    expect(state.task.completed_at).toBeNull();
  });

  it("records filing through the existing payment-dispute completion path after send confirmation", async () => {
    const marker = paymentDisputeFilingTaskNotesMarker(CASE_ID);
    const workspace = buildPaymentDisputeOperatorFilingWorkspace({
      intake: paymentIntake(),
      caseId: CASE_ID,
    });
    const state: MockCaseState = {
      intake: paymentIntake(),
      client_state: {
        prepared_packet_approved: true,
        approved_next_action: {
          label: "Payment dispute (bank/card)",
          href: MANUAL_ACTION_TRACKING_REAL_PAYMENT_DISPUTE_PREP_HREF,
          status: "approved",
        },
      },
      filings: [],
      task: {
        id: TASK_ID,
        user_id: USER_ID,
        case_id: CASE_ID,
        title: "Payment dispute: Acme Retail",
        due_date: null,
        notes: `${marker}\ncase_id: ${CASE_ID}\ndraft:\nDISPUTE`,
        completed_at: null,
        created_at: "2026-06-01T00:00:00.000Z",
        updated_at: "2026-06-01T00:00:00.000Z",
      },
      filingInsertCount: 0,
    };

    expect(workspace.is_submitted).toBe(false);

    const result = await completePaymentDisputeOperatorFiling(
      createPaymentCompleteSupabase(state),
      USER_ID,
      {
        caseId: CASE_ID,
        taskId: TASK_ID,
        destination: workspace.filing_destination,
        filedAt: "2026-06-15",
        confirmationNumber: "PD-SEND-998877",
        notes: "Filed via guided workspace",
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.filing.confirmation_number).toBe("PD-SEND-998877");
    expect(result.filing.destination).toBe("Payment dispute (bank/card)");
    expect(result.task.completed_at).toBeTruthy();
    expect(shouldQueuePaymentDisputeFilingTask(state.client_state)).toBe(false);
    expect(workspace.is_submitted).toBe(false);
  });
});

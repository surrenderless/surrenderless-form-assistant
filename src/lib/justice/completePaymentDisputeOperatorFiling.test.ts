import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildJusticeIntakeFromParts, defaultBuildJusticeIntakeParts } from "@/lib/justice/buildJusticeIntake";
import {
  MANUAL_ACTION_TRACKING_REAL_MERCHANT_PREP_HREF,
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
import { upsertPaymentDisputeEmailDeliveryNotes } from "@/lib/justice/paymentDisputeEmailDelivery";
import { followUpTaskOwnerHref, taskNotesMatchFollowUpMarker } from "@/lib/justice/followUpCaseTask";
import {
  supersededLaneReviewLinkedFollowUpTaskId,
  taskNotesMatchSupersededLaneReviewMarker,
} from "@/lib/justice/followUpResponseReviewTask";
import { taskNotesMatchAnyOperatorFulfillmentMarker } from "@/lib/justice/operatorEvidenceFileAccess";
import { classifyOpenOperatorTask } from "@/lib/justice/operatorFulfillmentQueue";

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
  followUpTasks: JusticeCaseTaskRow[];
  /** Owner_href-scoped superseded-lane review rows, created by the real
   * ensureSupersededLaneResponseReviewTask call inside the bounce-remediation branch. */
  supersededLaneReviews?: JusticeCaseTaskRow[];
  filingInsertCount: number;
  filingInsertShouldFail?: boolean;
  evidence?: Array<{ file_name: string | null; mime_type: string | null; file_size_bytes: number | null }>;
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
                    updated_at: "2026-02-01T00:00:00.000Z",
                  },
                  error: null,
                }),
              }),
            }),
          }),
          update: (patch: Record<string, unknown>) => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  select: () => ({
                    maybeSingle: async () => {
                      if (patch.client_state) {
                        state.client_state = patch.client_state as Record<string, unknown>;
                      }
                      return { data: { id: CASE_ID }, error: null };
                    },
                  }),
                }),
              }),
            }),
          }),
        };
      }

      if (table === "justice_case_tasks") {
        const tasksMatchingLike = (pattern: string) => {
          const prefix = String(pattern).replace(/%$/, "");
          const all = [state.task, ...state.followUpTasks, ...(state.supersededLaneReviews ?? [])];
          return all.filter((task) => (task.notes ?? "").startsWith(prefix));
        };
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  limit: async () => ({ data: [state.task], error: null }),
                  maybeSingle: async () => ({ data: state.task, error: null }),
                }),
                like: (_column: string, pattern: string) => ({
                  is: () => ({
                    // No slice(0, N) — a real .limit() in ensureFollowUpCaseTask/
                    // findOpenFollowUpCaseTasks may need to see every currently-open follow-up
                    // (one per lane can coexist) to dedupe by owner_href, not just the first one.
                    limit: async () => ({
                      data: tasksMatchingLike(pattern).filter((task) => !task.completed_at?.trim()),
                      error: null,
                    }),
                  }),
                  limit: async () => {
                    // ensureSupersededLaneResponseReviewTask's own dedupe scan (.eq().eq().like()
                    // .limit(), no .is()) needs every matching row — open or already completed —
                    // to tell "still pending" from "decision already recorded" apart. Other
                    // markers keep the pre-existing single-row .limit(1) semantics.
                    const matched = tasksMatchingLike(pattern);
                    const data = String(pattern).startsWith("superseded_lane_review:")
                      ? matched
                      : matched.slice(0, 1);
                    return { data, error: null };
                  },
                }),
                limit: async () => ({ data: [state.task], error: null }),
                maybeSingle: async () => ({ data: state.task, error: null }),
              }),
              like: (_column: string, pattern: string) => ({
                is: () => ({
                  limit: async () => ({
                    data: tasksMatchingLike(pattern).filter((task) => !task.completed_at?.trim()),
                    error: null,
                  }),
                }),
                limit: async () => ({
                  data: tasksMatchingLike(pattern).slice(0, 1),
                  error: null,
                }),
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
          insert: (row: Record<string, unknown>) => ({
            select: () => ({
              single: async () => {
                const notes = typeof row.notes === "string" ? row.notes : "";
                if (notes.startsWith("superseded_lane_review:")) {
                  const review: JusticeCaseTaskRow = {
                    id: `superseded-review-${(state.supersededLaneReviews?.length ?? 0) + 1}`,
                    user_id: USER_ID,
                    case_id: CASE_ID,
                    title: String(row.title ?? ""),
                    due_date: typeof row.due_date === "string" ? row.due_date : null,
                    notes,
                    completed_at: null,
                    created_at: "2026-06-22T12:06:30.000Z",
                    updated_at: "2026-06-22T12:06:30.000Z",
                  };
                  state.supersededLaneReviews = [...(state.supersededLaneReviews ?? []), review];
                  return { data: review, error: null };
                }
                const task: JusticeCaseTaskRow = {
                  id: `follow-up-${state.followUpTasks.length + 1}`,
                  user_id: USER_ID,
                  case_id: CASE_ID,
                  title: String(row.title ?? ""),
                  due_date: typeof row.due_date === "string" ? row.due_date : null,
                  notes,
                  completed_at: null,
                  created_at: "2026-06-22T12:06:00.000Z",
                  updated_at: "2026-06-22T12:06:00.000Z",
                };
                state.followUpTasks = [...state.followUpTasks, task];
                return { data: task, error: null };
              },
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
                if (state.filingInsertShouldFail) {
                  return { data: null, error: { message: "filing insert failed" } };
                }
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
                  limit: async () => ({ data: state.evidence ?? [], error: null }),
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
      followUpTasks: [],
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
      followUpTasks: [],
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

describe("payment-dispute completion ladder advance", () => {
  it("advances to CFPB after payment dispute completes through the real completion path only when a real uploaded evidence file exists (CFPB priority 28 is downstream of payment dispute priority 20) — proves both the query-to-recompute wiring and the ladder outcome together", async () => {
    const buildState = (evidence: MockCaseState["evidence"]): MockCaseState => ({
      intake: paymentIntake({ contact_proof_type: "upload", contact_proof_text: "" }),
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
        notes: `${paymentDisputeFilingTaskNotesMarker(CASE_ID)}\ncase_id: ${CASE_ID}\ndraft:\nDISPUTE`,
        completed_at: null,
        created_at: "2026-06-01T00:00:00.000Z",
        updated_at: "2026-06-01T00:00:00.000Z",
      },
      followUpTasks: [],
      filingInsertCount: 0,
      evidence,
    });

    const withFile = buildState([
      { file_name: "bank-statement.png", mime_type: "image/png", file_size_bytes: 2048 },
    ]);
    const resultWithFile = await completePaymentDisputeOperatorFiling(
      createPaymentCompleteSupabase(withFile),
      USER_ID,
      {
        caseId: CASE_ID,
        taskId: TASK_ID,
        destination: "Payment dispute (bank/card)",
        filedAt: "2026-06-15",
        confirmationNumber: "PD-998877",
      }
    );
    expect(resultWithFile.ok).toBe(true);
    if (!resultWithFile.ok) return;
    expect(
      (resultWithFile.clientState.approved_next_action as { href?: string }).href
    ).toBe("/justice/cfpb");

    const withoutFile = buildState([]);
    const resultWithoutFile = await completePaymentDisputeOperatorFiling(
      createPaymentCompleteSupabase(withoutFile),
      USER_ID,
      {
        caseId: CASE_ID,
        taskId: TASK_ID,
        destination: "Payment dispute (bank/card)",
        filedAt: "2026-06-15",
        confirmationNumber: "PD-998877",
      }
    );
    expect(resultWithoutFile.ok).toBe(true);
    if (!resultWithoutFile.ok) return;
    expect(
      (resultWithoutFile.clientState.approved_next_action as { href?: string }).href
    ).not.toBe("/justice/cfpb");
  });
});

function bouncedPaymentDisputeFiling(): JusticeCaseFilingRow {
  return {
    id: "fil-original-bounced",
    user_id: USER_ID,
    case_id: CASE_ID,
    destination: "Payment dispute (bank/card)",
    filed_at: "2026-06-01",
    confirmation_number: "re_original_1",
    filing_url: null,
    notes: upsertPaymentDisputeEmailDeliveryNotes(null, {
      delivery_state: "bounced" as never,
      provider: "resend",
      recipient: "disputes@bank.example",
      provider_message_id: "re_original_1",
    }),
    created_at: "2026-06-01T00:00:00.000Z",
    updated_at: "2026-06-01T00:00:00.000Z",
  };
}

describe("completePaymentDisputeOperatorFiling bounce remediation", () => {
  beforeEach(() => {
    timelineStore.entries = [];
  });

  it("creates a fresh filing after a bounce, closes the reopened task, and starts a fresh follow-up — preserving the bounced filing untouched", async () => {
    const marker = paymentDisputeFilingTaskNotesMarker(CASE_ID);
    const bounced = bouncedPaymentDisputeFiling();
    const state: MockCaseState = {
      intake: paymentIntake(),
      client_state: {
        prepared_packet_approved: true,
        approved_next_action: {
          label: "Payment dispute (bank/card)",
          href: MANUAL_ACTION_TRACKING_REAL_PAYMENT_DISPUTE_PREP_HREF,
          status: "completed",
          follow_up_needed: true,
        },
      },
      filings: [bounced],
      task: {
        id: TASK_ID,
        user_id: USER_ID,
        case_id: CASE_ID,
        title: "[Needs manual follow-up — bounced] Payment dispute: Acme Retail",
        due_date: null,
        notes: `${marker}\ncase_id: ${CASE_ID}\ndraft:\nDISPUTE`,
        completed_at: null,
        created_at: "2026-06-01T00:00:00.000Z",
        updated_at: "2026-06-20T00:00:00.000Z",
      },
      followUpTasks: [],
      filingInsertCount: 0,
    };

    const result = await completePaymentDisputeOperatorFiling(
      createPaymentCompleteSupabase(state),
      USER_ID,
      {
        caseId: CASE_ID,
        taskId: TASK_ID,
        destination: "Payment dispute (bank/card)",
        filedAt: "2026-06-21",
        confirmationNumber: "PD-REMEDIATED-456",
        notes: "Re-filed by phone after email bounce",
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.idempotent).toBe(false);
    expect(result.filing.confirmation_number).toBe("PD-REMEDIATED-456");
    expect(result.filing.id).not.toBe(bounced.id);
    expect(result.task.completed_at).toBeTruthy();

    expect(state.filings).toHaveLength(2);
    const preservedBounced = state.filings.find((f) => f.id === bounced.id);
    expect(preservedBounced?.confirmation_number).toBe("re_original_1");
    expect(preservedBounced?.notes).toBe(bounced.notes);

    const followUp = state.followUpTasks.find((t) => taskNotesMatchFollowUpMarker(t.notes, CASE_ID));
    expect(followUp).toBeDefined();
  });

  it("still reuses an existing non-bounced confirmed filing as idempotent (unchanged regression)", async () => {
    const marker = paymentDisputeFilingTaskNotesMarker(CASE_ID);
    const existing: JusticeCaseFilingRow = {
      id: "fil-accepted-1",
      user_id: USER_ID,
      case_id: CASE_ID,
      destination: "Payment dispute (bank/card)",
      filed_at: "2026-06-15",
      confirmation_number: "PD-SEND-998877",
      filing_url: null,
      notes: upsertPaymentDisputeEmailDeliveryNotes(null, {
        delivery_state: "accepted",
        provider: "resend",
        recipient: "disputes@bank.example",
        provider_message_id: "PD-SEND-998877",
      }),
      created_at: "2026-06-15T00:00:00.000Z",
      updated_at: "2026-06-15T00:00:00.000Z",
    };
    const state: MockCaseState = {
      intake: paymentIntake(),
      client_state: {
        prepared_packet_approved: true,
        approved_next_action: {
          label: "Payment dispute (bank/card)",
          href: MANUAL_ACTION_TRACKING_REAL_PAYMENT_DISPUTE_PREP_HREF,
          status: "completed",
        },
      },
      filings: [existing],
      task: {
        id: TASK_ID,
        user_id: USER_ID,
        case_id: CASE_ID,
        title: "Payment dispute: Acme Retail",
        due_date: null,
        notes: `${marker}\ncase_id: ${CASE_ID}\ndraft:\nDISPUTE`,
        completed_at: "2026-06-15T00:00:00.000Z",
        created_at: "2026-06-01T00:00:00.000Z",
        updated_at: "2026-06-15T00:00:00.000Z",
      },
      followUpTasks: [],
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
        confirmationNumber: "PD-SEND-998877",
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.idempotent).toBe(true);
    expect(result.filing.id).toBe("fil-accepted-1");
    expect(state.filings).toHaveLength(1);
  });

  it("does not complete the task or start a follow-up when the remediation filing insert fails", async () => {
    const marker = paymentDisputeFilingTaskNotesMarker(CASE_ID);
    const bounced = bouncedPaymentDisputeFiling();
    const state: MockCaseState = {
      intake: paymentIntake(),
      client_state: {
        prepared_packet_approved: true,
        approved_next_action: {
          label: "Payment dispute (bank/card)",
          href: MANUAL_ACTION_TRACKING_REAL_PAYMENT_DISPUTE_PREP_HREF,
          status: "completed",
          follow_up_needed: true,
        },
      },
      filings: [bounced],
      task: {
        id: TASK_ID,
        user_id: USER_ID,
        case_id: CASE_ID,
        title: "[Needs manual follow-up — bounced] Payment dispute: Acme Retail",
        due_date: null,
        notes: `${marker}\ncase_id: ${CASE_ID}\ndraft:\nDISPUTE`,
        completed_at: null,
        created_at: "2026-06-01T00:00:00.000Z",
        updated_at: "2026-06-20T00:00:00.000Z",
      },
      followUpTasks: [],
      filingInsertCount: 0,
      filingInsertShouldFail: true,
    };

    const result = await completePaymentDisputeOperatorFiling(
      createPaymentCompleteSupabase(state),
      USER_ID,
      {
        caseId: CASE_ID,
        taskId: TASK_ID,
        destination: "Payment dispute (bank/card)",
        filedAt: "2026-06-21",
        confirmationNumber: "PD-REMEDIATED-456",
      }
    );

    expect(result.ok).toBe(false);
    expect(state.task.completed_at).toBeNull();
    expect(state.followUpTasks).toHaveLength(0);
    expect(state.filings).toHaveLength(1);
  });

  it("after the ladder has advanced to merchant contact, builds payment dispute's own fresh follow-up without touching merchant contact's or the ladder — and doesn't duplicate on retry", async () => {
    const marker = paymentDisputeFilingTaskNotesMarker(CASE_ID);
    const bounced = bouncedPaymentDisputeFiling();
    const merchantFollowUp: JusticeCaseTaskRow = {
      id: "followup-merchant-contact",
      user_id: USER_ID,
      case_id: CASE_ID,
      title: "Surrenderless follow-up: Merchant contact",
      due_date: "2026-07-01",
      notes: "follow_up:" + CASE_ID + "\nowner_href:" + MANUAL_ACTION_TRACKING_REAL_MERCHANT_PREP_HREF,
      completed_at: null,
      created_at: "2026-06-25T00:00:00.000Z",
      updated_at: "2026-06-25T00:00:00.000Z",
    };
    const state: MockCaseState = {
      intake: paymentIntake(),
      client_state: {
        prepared_packet_approved: true,
        // The escalation ladder already advanced past payment dispute to merchant contact before
        // payment dispute's delayed bounce arrived and reopened its task.
        approved_next_action: {
          label: "Merchant contact",
          href: MANUAL_ACTION_TRACKING_REAL_MERCHANT_PREP_HREF,
          // "completed" — merchant contact already filed successfully (that's how its own open
          // follow-up exists) — so this fixture doesn't also need to model the unrelated
          // owned-filing-task queue (ensureOwnedFilingTaskAfterClientStateWrite), which only
          // queues a fresh operator task while an action is still "approved", not "completed".
          status: "completed",
          follow_up_needed: true,
          follow_up_at: merchantFollowUp.due_date,
        },
      },
      filings: [bounced],
      task: {
        id: TASK_ID,
        user_id: USER_ID,
        case_id: CASE_ID,
        title: "[Needs manual follow-up — bounced] Payment dispute: Acme Retail",
        due_date: null,
        notes: `${marker}\ncase_id: ${CASE_ID}\ndraft:\nDISPUTE`,
        completed_at: null,
        created_at: "2026-06-01T00:00:00.000Z",
        updated_at: "2026-06-20T00:00:00.000Z",
      },
      followUpTasks: [merchantFollowUp],
      filingInsertCount: 0,
    };
    const clientStateBefore = JSON.parse(JSON.stringify(state.client_state));

    const result = await completePaymentDisputeOperatorFiling(
      createPaymentCompleteSupabase(state),
      USER_ID,
      {
        caseId: CASE_ID,
        taskId: TASK_ID,
        destination: "Payment dispute (bank/card)",
        filedAt: "2026-06-21",
        confirmationNumber: "PD-REMEDIATED-456",
        notes: "Re-filed after email bounce",
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.idempotent).toBe(false);
    expect(result.task.completed_at).toBeTruthy();
    // approved_next_action's identity must be left exactly as it was — still merchant contact's,
    // not rewound to payment dispute and not advanced to some third lane. (Unrelated, pre-existing
    // resolution-tracking metadata may still be merged in alongside it — that's independent of
    // this fix and not what "do not rewind or overwrite" is about.)
    const approvedNextAfter = (state.client_state as { approved_next_action?: Record<string, unknown> })
      .approved_next_action;
    expect(approvedNextAfter).toMatchObject(
      (clientStateBefore as { approved_next_action: Record<string, unknown> }).approved_next_action
    );

    const stillMerchantContact = state.followUpTasks.find((t) => t.id === "followup-merchant-contact");
    expect(stillMerchantContact?.completed_at).toBeNull();
    expect(stillMerchantContact?.due_date).toBe("2026-07-01");
    expect(followUpTaskOwnerHref(stillMerchantContact?.notes)).toBe(
      MANUAL_ACTION_TRACKING_REAL_MERCHANT_PREP_HREF
    );

    expect(state.followUpTasks).toHaveLength(2);
    const paymentDisputeFollowUp = state.followUpTasks.find((t) => t.id !== "followup-merchant-contact");
    expect(paymentDisputeFollowUp).toBeDefined();
    expect(paymentDisputeFollowUp?.completed_at).toBeNull();
    expect(followUpTaskOwnerHref(paymentDisputeFollowUp?.notes)).toBe(
      MANUAL_ACTION_TRACKING_REAL_PAYMENT_DISPUTE_PREP_HREF
    );
    expect(taskNotesMatchFollowUpMarker(paymentDisputeFollowUp?.notes, CASE_ID)).toBe(true);
    // It carries its own valid due_date, scheduled from the remediation filing's own filedAt
    // (2026-06-21 + 45 days) — never inherited from merchant contact's due_date (2026-07-01), and
    // never left null, or processDueFollowUps could never process it.
    expect(paymentDisputeFollowUp?.due_date).toBe("2026-08-05");
    expect(paymentDisputeFollowUp?.due_date).not.toBe(stillMerchantContact?.due_date);

    // Remediation also immediately creates payment dispute's own owner_href-scoped review — real
    // production code, not a test-only helper — real-listing reachable through the exact
    // marker/classifier the operator queue and generic PATCH route use.
    expect(state.supersededLaneReviews).toHaveLength(1);
    const review = state.supersededLaneReviews?.[0];
    expect(review?.completed_at).toBeNull();
    expect(taskNotesMatchSupersededLaneReviewMarker(review?.notes, CASE_ID)).toBe(true);
    expect(followUpTaskOwnerHref(review?.notes)).toBe(MANUAL_ACTION_TRACKING_REAL_PAYMENT_DISPUTE_PREP_HREF);
    // Durably linked to the exact fresh follow-up attempt just created — never merely to
    // (case, owner_href) — so a later, genuinely new remediation cycle can never have this
    // review silently answer for it.
    expect(supersededLaneReviewLinkedFollowUpTaskId(review?.notes)).toBe(paymentDisputeFollowUp?.id);
    expect(taskNotesMatchAnyOperatorFulfillmentMarker(review?.notes, CASE_ID)).toBe(true);
    expect(classifyOpenOperatorTask(review!, state.intake)?.step).toBe("superseded_lane_review");

    const retry = await completePaymentDisputeOperatorFiling(
      createPaymentCompleteSupabase(state),
      USER_ID,
      {
        caseId: CASE_ID,
        taskId: TASK_ID,
        destination: "Payment dispute (bank/card)",
        filedAt: "2026-06-21",
        confirmationNumber: "PD-REMEDIATED-456",
      }
    );
    expect(retry.ok).toBe(true);
    if (!retry.ok) return;
    expect(retry.idempotent).toBe(true);
    expect(state.followUpTasks).toHaveLength(2);
    expect(state.supersededLaneReviews).toHaveLength(1);
  });

  it("a prior remediation cycle's OLD completed follow-up/review for payment dispute never gets reused by a genuinely NEW remediation attempt on the same lane", async () => {
    const marker = paymentDisputeFilingTaskNotesMarker(CASE_ID);
    const bounced = bouncedPaymentDisputeFiling();
    // A PRIOR remediation cycle already ran to completion on payment dispute itself: its
    // follow-up closed, and its review was decided — both are historical, closed rows.
    const oldPaymentDisputeFollowUp: JusticeCaseTaskRow = {
      id: "followup-payment-dispute-old",
      user_id: USER_ID,
      case_id: CASE_ID,
      title: "Surrenderless follow-up: payment dispute (old attempt)",
      due_date: "2026-04-01",
      notes: `follow_up:${CASE_ID}\nowner_href:${MANUAL_ACTION_TRACKING_REAL_PAYMENT_DISPUTE_PREP_HREF}`,
      completed_at: "2026-04-02T00:00:00.000Z",
      created_at: "2026-03-01T00:00:00.000Z",
      updated_at: "2026-04-02T00:00:00.000Z",
    };
    const oldPaymentDisputeReview: JusticeCaseTaskRow = {
      id: "review-payment-dispute-old",
      user_id: USER_ID,
      case_id: CASE_ID,
      title: "Follow-up response review: payment dispute (old attempt)",
      due_date: null,
      notes: [
        `superseded_lane_review:${CASE_ID}`,
        `owner_href:${MANUAL_ACTION_TRACKING_REAL_PAYMENT_DISPUTE_PREP_HREF}`,
        "follow_up_task_id:followup-payment-dispute-old",
        `case_id: ${CASE_ID}`,
        "guidance:",
        "prior attempt",
        "decision:no_response",
      ].join("\n"),
      completed_at: "2026-04-02T00:00:00.000Z",
      created_at: "2026-03-01T00:00:00.000Z",
      updated_at: "2026-04-02T00:00:00.000Z",
    };
    // Current lane's own open follow-up, pre-existing — keeps the unrelated current-lane-ensure
    // machinery a no-op (idempotent reuse), so this test stays focused on the bounce-remediation
    // branch for payment dispute specifically.
    const currentLaneFollowUp: JusticeCaseTaskRow = {
      id: "followup-merchant-contact-current",
      user_id: USER_ID,
      case_id: CASE_ID,
      title: "Surrenderless follow-up: Merchant contact",
      due_date: "2026-07-01",
      notes: `follow_up:${CASE_ID}\nowner_href:${MANUAL_ACTION_TRACKING_REAL_MERCHANT_PREP_HREF}`,
      completed_at: null,
      created_at: "2026-06-01T00:00:00.000Z",
      updated_at: "2026-06-01T00:00:00.000Z",
    };
    const state: MockCaseState = {
      intake: paymentIntake(),
      client_state: {
        prepared_packet_approved: true,
        approved_next_action: {
          label: "Merchant contact",
          href: MANUAL_ACTION_TRACKING_REAL_MERCHANT_PREP_HREF,
          // "completed" — merchant contact already filed successfully (that's how its own open
          // follow-up exists) — so this fixture doesn't also need to model the unrelated
          // owned-filing-task queue (ensureOwnedFilingTaskAfterClientStateWrite), which only
          // queues a fresh operator task while an action is still "approved", not "completed".
          status: "completed",
          follow_up_needed: true,
          follow_up_at: currentLaneFollowUp.due_date,
        },
      },
      filings: [bounced],
      task: {
        id: TASK_ID,
        user_id: USER_ID,
        case_id: CASE_ID,
        title: "[Needs manual follow-up — bounced] Payment dispute: Acme Retail",
        due_date: null,
        notes: `${marker}\ncase_id: ${CASE_ID}\ndraft:\nDISPUTE`,
        completed_at: null,
        created_at: "2026-06-01T00:00:00.000Z",
        updated_at: "2026-06-20T00:00:00.000Z",
      },
      followUpTasks: [oldPaymentDisputeFollowUp, currentLaneFollowUp],
      supersededLaneReviews: [oldPaymentDisputeReview],
      filingInsertCount: 0,
    };

    const result = await completePaymentDisputeOperatorFiling(
      createPaymentCompleteSupabase(state),
      USER_ID,
      {
        caseId: CASE_ID,
        taskId: TASK_ID,
        destination: "Payment dispute (bank/card)",
        filedAt: "2026-06-21",
        confirmationNumber: "PD-REMEDIATED-SECOND-789",
        notes: "Re-filed again after a second bounce",
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(state.followUpTasks).toHaveLength(3);
    const newFollowUp = state.followUpTasks.find(
      (t) =>
        followUpTaskOwnerHref(t.notes) === MANUAL_ACTION_TRACKING_REAL_PAYMENT_DISPUTE_PREP_HREF &&
        t.id !== "followup-payment-dispute-old"
    );
    expect(newFollowUp).toBeDefined();
    expect(newFollowUp?.completed_at).toBeNull();
    expect(currentLaneFollowUp.completed_at).toBeNull();

    expect(state.supersededLaneReviews).toHaveLength(2);
    const newReview = state.supersededLaneReviews?.find((t) => t.id !== "review-payment-dispute-old");
    expect(newReview).toBeDefined();
    expect(newReview?.completed_at).toBeNull();
    expect(supersededLaneReviewLinkedFollowUpTaskId(newReview?.notes)).toBe(newFollowUp?.id);
    expect(supersededLaneReviewLinkedFollowUpTaskId(newReview?.notes)).not.toBe(
      "followup-payment-dispute-old"
    );

    expect(oldPaymentDisputeFollowUp.completed_at).toBe("2026-04-02T00:00:00.000Z");
    expect(oldPaymentDisputeReview.completed_at).toBe("2026-04-02T00:00:00.000Z");
    expect(oldPaymentDisputeReview.notes).toContain("decision:no_response");
  });
});

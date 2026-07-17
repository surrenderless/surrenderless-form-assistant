import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildJusticeIntakeFromParts, defaultBuildJusticeIntakeParts } from "@/lib/justice/buildJusticeIntake";
import { buildUpdatedIntakeAfterMerchantContact } from "@/lib/justice/documentMerchantContact";
import {
  MANUAL_ACTION_TRACKING_REAL_MERCHANT_PREP_HREF,
  canonicalFilingDestinationForApprovedActionHref,
} from "@/lib/justice/handlingTrackingProgress";
import {
  merchantContactFilingTaskNotesMarker,
  shouldQueueMerchantContactFilingTask,
} from "@/lib/justice/merchantContactFilingTask";
import { advanceApprovedNextActionAfterCompleted } from "@/lib/justice/recomputeApprovedNextActionAfterIntake";
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

import { completeMerchantContactOperatorFiling } from "@/lib/justice/completeMerchantContactOperatorFiling";
import { buildMerchantContactOperatorFilingWorkspace } from "@/lib/justice/merchantContactOperatorFilingWorkspace";

function retailIntake(overrides: Partial<JusticeIntake> = {}): JusticeIntake {
  return buildJusticeIntakeFromParts({
    ...defaultBuildJusticeIntakeParts(),
    problem_category: "online_purchase",
    company_name: "Acme Retail",
    purchase_or_signup: "widget order",
    story: "Ordered a widget that never arrived and merchant refused a refund.",
    money_involved: "$89.00",
    pay_or_order_date: "2026-01-10",
    already_contacted: "no",
    user_display_name: "Jordan Lee",
    reply_email: "e2e@example.com",
    consumer_us_state: "CA",
    ...overrides,
  });
}

describe("completeMerchantContactOperatorFiling prerequisites", () => {
  it("uses canonical merchant contact filing destination", () => {
    expect(
      canonicalFilingDestinationForApprovedActionHref(MANUAL_ACTION_TRACKING_REAL_MERCHANT_PREP_HREF)
    ).toBe("Merchant contact");
  });

  it("queues merchant contact when client_state advances to merchant step", () => {
    expect(
      shouldQueueMerchantContactFilingTask({
        prepared_packet_approved: true,
        approved_next_action: {
          label: "Merchant contact",
          href: "/justice/merchant",
          status: "approved",
        },
      })
    ).toBe(true);
    expect(
      shouldQueueMerchantContactFilingTask({
        prepared_packet_approved: true,
        approved_next_action: {
          label: "Merchant contact",
          href: "/justice/merchant",
          status: "completed",
        },
      })
    ).toBe(false);
  });
});

describe("merchant contact completion ladder advance", () => {
  it("refused_help with money advances to payment dispute", () => {
    const prior = retailIntake();
    const updated = buildUpdatedIntakeAfterMerchantContact(prior, {
      contactMethod: "email",
      contactDate: "2026-06-22",
      merchantResponseType: "refused_help",
      contactProofType: "ticket",
      contactProofText: "ref-1",
    });
    const next = advanceApprovedNextActionAfterCompleted(updated, "/justice/merchant", {
      existing: {
        label: "Merchant contact",
        href: "/justice/merchant",
        status: "completed",
        completed_at: "2026-06-22T12:00:00.000Z",
      },
    });
    expect(next?.href).toBe("/justice/payment-dispute");
    expect(next?.status).toBe("approved");
  });

  it("refused_help without money advances to FTC when eligible", () => {
    const prior = retailIntake({
      money_involved: "not sure",
      pay_or_order_date: "",
    });
    const updated = buildUpdatedIntakeAfterMerchantContact(prior, {
      contactMethod: "email",
      contactDate: "2026-06-22",
      merchantResponseType: "refused_help",
      contactProofType: "ticket",
      contactProofText: "ref-2",
    });
    const next = advanceApprovedNextActionAfterCompleted(updated, "/justice/merchant", {
      existing: {
        label: "Merchant contact",
        href: "/justice/merchant",
        status: "completed",
        completed_at: "2026-06-22T12:00:00.000Z",
      },
    });
    expect(next?.href).toBe("/justice/ftc");
    expect(next?.status).toBe("approved");
  });
});

type MockCaseState = {
  intake: JusticeIntake;
  client_state: Record<string, unknown>;
  filings: JusticeCaseFilingRow[];
  task: JusticeCaseTaskRow;
  filingInsertCount: number;
};

function createMerchantCompleteSupabase(state: MockCaseState): SupabaseClient {
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
                if (patch.intake) state.intake = patch.intake as JusticeIntake;
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

describe("completeMerchantContactOperatorFiling idempotency", () => {
  beforeEach(() => {
    timelineStore.entries = [];
  });

  it("records one filing/contact and marks subsequent completions idempotent without duplicates", async () => {
    const intake = retailIntake({ money_involved: "not sure", pay_or_order_date: "" });
    const marker = merchantContactFilingTaskNotesMarker(CASE_ID);
    const state: MockCaseState = {
      intake,
      client_state: {
        prepared_packet_approved: true,
        approved_next_action: {
          label: "Merchant contact",
          href: "/justice/merchant",
          status: "approved",
          approved_at: "2026-06-21T00:00:10.000Z",
        },
      },
      filings: [],
      task: {
        id: TASK_ID,
        user_id: USER_ID,
        case_id: CASE_ID,
        title: "Merchant contact: Acme Retail",
        due_date: null,
        notes: `${marker}\ncase_id: ${CASE_ID}\ndraft:\nHi`,
        completed_at: null,
        created_at: "2026-06-21T00:00:00.000Z",
        updated_at: "2026-06-21T00:00:00.000Z",
      },
      filingInsertCount: 0,
    };

    const supabase = createMerchantCompleteSupabase(state);
    const input = {
      caseId: CASE_ID,
      taskId: TASK_ID,
      destination: "Merchant contact",
      filedAt: "2026-06-22",
      confirmationNumber: "e2e-merchant-dup-1",
      contactMethod: "email" as const,
      merchantResponseType: "refused_help" as const,
      recipient: "Acme Retail",
      notes: "Called support",
    };

    const first = await completeMerchantContactOperatorFiling(supabase, USER_ID, input);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.idempotent).toBe(false);
    expect(first.advanced).toBe(true);
    expect((first.clientState.approved_next_action as { href?: string })?.href).toBe(
      "/justice/ftc"
    );
    expect(state.filingInsertCount).toBe(1);
    expect(state.filings).toHaveLength(1);
    expect(state.task.completed_at).toBeTruthy();
    expect(state.intake.already_contacted).toBe("yes");
    expect(state.intake.merchant_response_type).toBe("refused_help");

    const filingIds = timelineStore.entries
      .filter((e) => e.type === "filing_recorded")
      .map((e) => e.id);
    const contactIds = timelineStore.entries
      .filter((e) => e.type === "merchant_contact_saved")
      .map((e) => e.id);
    expect(filingIds).toHaveLength(1);
    expect(contactIds).toHaveLength(1);

    const second = await completeMerchantContactOperatorFiling(supabase, USER_ID, input);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.idempotent).toBe(true);
    expect(state.filingInsertCount).toBe(1);
    expect(state.filings).toHaveLength(1);

    expect(timelineStore.entries.filter((e) => e.type === "filing_recorded")).toHaveLength(1);
    expect(timelineStore.entries.filter((e) => e.type === "merchant_contact_saved")).toHaveLength(1);
    expect(
      timelineStore.entries.filter((e) => e.type === "merchant_contact_saved")[0]?.id
    ).toBe(contactIds[0]);
  });
});

describe("merchant-contact workspace completion behavior", () => {
  beforeEach(() => {
    timelineStore.entries = [];
  });

  it("keeps workspace is_submitted false while requiring the same confirmation fields as the complete API", () => {
    const workspace = buildMerchantContactOperatorFilingWorkspace({
      intake: retailIntake({ company_contact_email: "support@acme.example" }),
    });
    expect(workspace.is_submitted).toBe(false);
    expect(workspace.filing_destination).toBe(
      canonicalFilingDestinationForApprovedActionHref(MANUAL_ACTION_TRACKING_REAL_MERCHANT_PREP_HREF)
    );
    expect(workspace.confirmation_capture).toEqual({
      requires_filed_at: true,
      requires_confirmation_number: true,
      requires_destination: true,
      requires_contact_method: true,
      requires_merchant_response_type: true,
      requires_recipient: true,
    });
  });

  it("rejects completion without confirmation number (no false submitted state)", async () => {
    const marker = merchantContactFilingTaskNotesMarker(CASE_ID);
    const state: MockCaseState = {
      intake: retailIntake(),
      client_state: {
        prepared_packet_approved: true,
        approved_next_action: {
          label: "Merchant contact",
          href: MANUAL_ACTION_TRACKING_REAL_MERCHANT_PREP_HREF,
          status: "approved",
        },
      },
      filings: [],
      task: {
        id: TASK_ID,
        user_id: USER_ID,
        case_id: CASE_ID,
        title: "Merchant contact: Acme Retail",
        due_date: null,
        notes: `${marker}\ncase_id: ${CASE_ID}\ndraft:\nHi`,
        completed_at: null,
        created_at: "2026-06-01T00:00:00.000Z",
        updated_at: "2026-06-01T00:00:00.000Z",
      },
      filingInsertCount: 0,
    };
    const result = await completeMerchantContactOperatorFiling(
      createMerchantCompleteSupabase(state),
      USER_ID,
      {
        caseId: CASE_ID,
        taskId: TASK_ID,
        destination: "Merchant contact",
        filedAt: "2026-06-15",
        confirmationNumber: "",
        contactMethod: "email",
        merchantResponseType: "no_response",
        recipient: "Acme Retail",
      }
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/confirmation/i);
    }
    expect(state.filings).toHaveLength(0);
    expect(state.task.completed_at).toBeNull();
  });

  it("records filing through the existing merchant-contact completion path after outreach confirmation", async () => {
    const marker = merchantContactFilingTaskNotesMarker(CASE_ID);
    const workspace = buildMerchantContactOperatorFilingWorkspace({
      intake: retailIntake({ company_contact_email: "support@acme.example" }),
    });
    const state: MockCaseState = {
      intake: retailIntake({ money_involved: "not sure", pay_or_order_date: "" }),
      client_state: {
        prepared_packet_approved: true,
        approved_next_action: {
          label: "Merchant contact",
          href: MANUAL_ACTION_TRACKING_REAL_MERCHANT_PREP_HREF,
          status: "approved",
        },
      },
      filings: [],
      task: {
        id: TASK_ID,
        user_id: USER_ID,
        case_id: CASE_ID,
        title: "Merchant contact: Acme Retail",
        due_date: null,
        notes: `${marker}\ncase_id: ${CASE_ID}\ndraft:\nHi`,
        completed_at: null,
        created_at: "2026-06-01T00:00:00.000Z",
        updated_at: "2026-06-01T00:00:00.000Z",
      },
      filingInsertCount: 0,
    };

    expect(workspace.is_submitted).toBe(false);

    const result = await completeMerchantContactOperatorFiling(
      createMerchantCompleteSupabase(state),
      USER_ID,
      {
        caseId: CASE_ID,
        taskId: TASK_ID,
        destination: workspace.filing_destination,
        filedAt: "2026-06-15",
        confirmationNumber: "MC-SEND-998877",
        contactMethod: "email",
        merchantResponseType: "no_response",
        recipient: workspace.delivery.recipient_email ?? "Acme Retail",
        notes: "Filed via guided workspace",
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.filing.confirmation_number).toBe("MC-SEND-998877");
    expect(result.filing.destination).toBe("Merchant contact");
    expect(result.task.completed_at).toBeTruthy();
    expect(shouldQueueMerchantContactFilingTask(state.client_state)).toBe(false);
    expect(workspace.is_submitted).toBe(false);
  });
});

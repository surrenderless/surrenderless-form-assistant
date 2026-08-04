import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildJusticeIntakeFromParts, defaultBuildJusticeIntakeParts } from "@/lib/justice/buildJusticeIntake";
import { buildUpdatedIntakeAfterMerchantContact } from "@/lib/justice/documentMerchantContact";
import {
  MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF,
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

// Wraps the real implementation (still calls through, so ladder-logic behavior for every
// existing test is unchanged) purely so its call arguments can be inspected — the correct
// boundary for proving this file threads real per-case evidence through, since this
// completion path always records "ticket" contact proof internally (see the comment on
// the direct advanceApprovedNextActionAfterCompleted test above), which means the CFPB
// destination outcome itself can never depend on hasUploadedEvidenceFile here.
vi.mock("@/lib/justice/recomputeApprovedNextActionAfterIntake", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/lib/justice/recomputeApprovedNextActionAfterIntake")
  >();
  return {
    ...actual,
    advanceApprovedNextActionAfterCompleted: vi.fn(actual.advanceApprovedNextActionAfterCompleted),
  };
});

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
import { upsertMerchantContactEmailDeliveryNotes } from "@/lib/justice/merchantContactEmailDelivery";
import { followUpTaskOwnerHref, taskNotesMatchFollowUpMarker } from "@/lib/justice/followUpCaseTask";
import {
  supersededLaneReviewLinkedFollowUpTaskId,
  taskNotesMatchSupersededLaneReviewMarker,
} from "@/lib/justice/followUpResponseReviewTask";
import { taskNotesMatchAnyOperatorFulfillmentMarker } from "@/lib/justice/operatorEvidenceFileAccess";
import { classifyOpenOperatorTask } from "@/lib/justice/operatorFulfillmentQueue";

function retailIntake(overrides: Partial<JusticeIntake> = {}): JusticeIntake {
  return buildJusticeIntakeFromParts({
    ...defaultBuildJusticeIntakeParts(),
    problem_category: "online_purchase",
    company_name: "Acme Retail",
    purchase_or_signup: "widget order",
    story: "Ordered a widget that never arrived and merchant refused a refund.",
    money_amount: "$89.00",
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
      money_amount: "not sure",
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

  it("[ladder primitive, not this file's own proof shape — completeMerchantContactOperatorFiling always records 'ticket' proof internally, see the wiring test below] advanceApprovedNextActionAfterCompleted picks CFPB after merchant contact only when a real uploaded evidence file exists (CFPB priority 28 is downstream of merchant contact priority 10)", () => {
    const prior = retailIntake({
      problem_category: "financial_account_issue",
      money_amount: "not sure",
      pay_or_order_date: "",
    });
    const updated = buildUpdatedIntakeAfterMerchantContact(prior, {
      contactMethod: "email",
      contactDate: "2026-06-22",
      merchantResponseType: "refused_help",
      contactProofType: "upload",
      contactProofText: "",
    });
    const existing = {
      label: "Merchant contact",
      href: "/justice/merchant",
      status: "completed" as const,
      completed_at: "2026-06-22T12:00:00.000Z",
    };

    const withFile = advanceApprovedNextActionAfterCompleted(updated, "/justice/merchant", {
      existing,
      hasUploadedEvidenceFile: true,
    });
    expect(withFile?.href).toBe("/justice/cfpb");
    expect(withFile?.status).toBe("approved");

    const withoutFile = advanceApprovedNextActionAfterCompleted(updated, "/justice/merchant", {
      existing,
      hasUploadedEvidenceFile: false,
    });
    expect(withoutFile?.href).not.toBe("/justice/cfpb");
  });
});

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
  evidence?: Array<{
    id?: string;
    file_name: string | null;
    mime_type: string | null;
    file_size_bytes: number | null;
    evidence_type?: string;
    title?: string;
  }>;
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
                    updated_at: "2026-02-01T00:00:00.000Z",
                  },
                  error: null,
                }),
              }),
            }),
          }),
          update: (patch: Record<string, unknown>) => {
            if (Object.prototype.hasOwnProperty.call(patch, "client_state")) {
              return {
                eq: () => ({
                  eq: () => ({
                    eq: () => ({
                      select: () => ({
                        maybeSingle: async () => {
                          state.client_state = patch.client_state as Record<string, unknown>;
                          return { data: { id: CASE_ID }, error: null };
                        },
                      }),
                    }),
                  }),
                }),
              };
            }
            return {
              eq: () => ({
                eq: async () => {
                  if (patch.intake) state.intake = patch.intake as JusticeIntake;
                  return { error: null };
                },
              }),
            };
          },
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
      followUpTasks: [],
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

  it("threads a hasUploadedEvidenceFile value derived from real evidence rows into the advance-after-completed call (shared boundary — this path always records 'ticket' contact proof internally, so the destination outcome itself is independent of evidence, but the value passed through must still reflect real per-case rows)", async () => {
    const marker = merchantContactFilingTaskNotesMarker(CASE_ID);
    const buildState = (evidence: MockCaseState["evidence"]): MockCaseState => ({
      intake: retailIntake({ money_involved: "not sure", pay_or_order_date: "" }),
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
      followUpTasks: [],
      filingInsertCount: 0,
      evidence,
    });
    const input = {
      caseId: CASE_ID,
      taskId: TASK_ID,
      destination: "Merchant contact",
      filedAt: "2026-06-22",
      confirmationNumber: "e2e-merchant-wiring-1",
      contactMethod: "email" as const,
      merchantResponseType: "refused_help" as const,
      recipient: "Acme Retail",
      notes: "Called support",
    };
    const spy = vi.mocked(advanceApprovedNextActionAfterCompleted);

    spy.mockClear();
    const withFile = buildState([
      {
        id: "550e8400-e29b-41d4-a716-446655449999",
        file_name: "bank-statement.png",
        mime_type: "image/png",
        file_size_bytes: 2048,
        evidence_type: "other",
        title: "Bank statement",
      },
    ]);
    await completeMerchantContactOperatorFiling(createMerchantCompleteSupabase(withFile), USER_ID, input);
    expect(spy).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ hasUploadedEvidenceFile: true })
    );

    spy.mockClear();
    const withoutFile = buildState([]);
    await completeMerchantContactOperatorFiling(
      createMerchantCompleteSupabase(withoutFile),
      USER_ID,
      input
    );
    expect(spy).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ hasUploadedEvidenceFile: false })
    );
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
      followUpTasks: [],
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
      followUpTasks: [],
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

function bouncedMerchantContactFiling(): JusticeCaseFilingRow {
  return {
    id: "fil-original-bounced",
    user_id: USER_ID,
    case_id: CASE_ID,
    destination: "Merchant contact",
    filed_at: "2026-06-01",
    confirmation_number: "re_original_1",
    filing_url: null,
    notes: upsertMerchantContactEmailDeliveryNotes(null, {
      delivery_state: "bounced" as never,
      provider: "resend",
      recipient: "support@acme.example",
      provider_message_id: "re_original_1",
    }),
    created_at: "2026-06-01T00:00:00.000Z",
    updated_at: "2026-06-01T00:00:00.000Z",
  };
}

describe("completeMerchantContactOperatorFiling bounce remediation", () => {
  beforeEach(() => {
    timelineStore.entries = [];
  });

  it("creates a fresh filing after a bounce, closes the reopened task, and starts a fresh follow-up — preserving the bounced filing untouched", async () => {
    const marker = merchantContactFilingTaskNotesMarker(CASE_ID);
    const bounced = bouncedMerchantContactFiling();
    const state: MockCaseState = {
      intake: retailIntake(),
      client_state: {
        prepared_packet_approved: true,
        approved_next_action: {
          label: "Merchant contact",
          href: MANUAL_ACTION_TRACKING_REAL_MERCHANT_PREP_HREF,
          status: "completed",
          follow_up_needed: true,
        },
      },
      filings: [bounced],
      task: {
        id: TASK_ID,
        user_id: USER_ID,
        case_id: CASE_ID,
        title: "[Needs manual follow-up — bounced] Merchant contact: Acme Retail",
        due_date: null,
        notes: `${marker}\ncase_id: ${CASE_ID}\ndraft:\nHi`,
        completed_at: null,
        created_at: "2026-06-01T00:00:00.000Z",
        updated_at: "2026-06-20T00:00:00.000Z",
      },
      followUpTasks: [],
      filingInsertCount: 0,
    };

    const result = await completeMerchantContactOperatorFiling(
      createMerchantCompleteSupabase(state),
      USER_ID,
      {
        caseId: CASE_ID,
        taskId: TASK_ID,
        destination: "Merchant contact",
        filedAt: "2026-06-21",
        confirmationNumber: "MC-REMEDIATED-456",
        contactMethod: "phone",
        merchantResponseType: "no_response",
        recipient: "Acme Retail",
        notes: "Re-contacted by phone after email bounce",
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.idempotent).toBe(false);
    expect(result.filing.confirmation_number).toBe("MC-REMEDIATED-456");
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
    const marker = merchantContactFilingTaskNotesMarker(CASE_ID);
    const existing: JusticeCaseFilingRow = {
      id: "fil-accepted-1",
      user_id: USER_ID,
      case_id: CASE_ID,
      destination: "Merchant contact",
      filed_at: "2026-06-15",
      confirmation_number: "MC-SEND-998877",
      filing_url: null,
      notes: upsertMerchantContactEmailDeliveryNotes(null, {
        delivery_state: "accepted",
        provider: "resend",
        recipient: "support@acme.example",
        provider_message_id: "MC-SEND-998877",
      }),
      created_at: "2026-06-15T00:00:00.000Z",
      updated_at: "2026-06-15T00:00:00.000Z",
    };
    const state: MockCaseState = {
      intake: retailIntake(),
      client_state: {
        prepared_packet_approved: true,
        approved_next_action: {
          label: "Merchant contact",
          href: MANUAL_ACTION_TRACKING_REAL_MERCHANT_PREP_HREF,
          status: "completed",
        },
      },
      filings: [existing],
      task: {
        id: TASK_ID,
        user_id: USER_ID,
        case_id: CASE_ID,
        title: "Merchant contact: Acme Retail",
        due_date: null,
        notes: `${marker}\ncase_id: ${CASE_ID}\ndraft:\nHi`,
        completed_at: "2026-06-15T00:00:00.000Z",
        created_at: "2026-06-01T00:00:00.000Z",
        updated_at: "2026-06-15T00:00:00.000Z",
      },
      followUpTasks: [],
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
        confirmationNumber: "MC-SEND-998877",
        contactMethod: "email",
        merchantResponseType: "no_response",
        recipient: "Acme Retail",
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.idempotent).toBe(true);
    expect(result.filing.id).toBe("fil-accepted-1");
    expect(state.filings).toHaveLength(1);
  });

  it("does not complete the task or start a follow-up when the remediation filing insert fails", async () => {
    const marker = merchantContactFilingTaskNotesMarker(CASE_ID);
    const bounced = bouncedMerchantContactFiling();
    const state: MockCaseState = {
      intake: retailIntake(),
      client_state: {
        prepared_packet_approved: true,
        approved_next_action: {
          label: "Merchant contact",
          href: MANUAL_ACTION_TRACKING_REAL_MERCHANT_PREP_HREF,
          status: "completed",
          follow_up_needed: true,
        },
      },
      filings: [bounced],
      task: {
        id: TASK_ID,
        user_id: USER_ID,
        case_id: CASE_ID,
        title: "[Needs manual follow-up — bounced] Merchant contact: Acme Retail",
        due_date: null,
        notes: `${marker}\ncase_id: ${CASE_ID}\ndraft:\nHi`,
        completed_at: null,
        created_at: "2026-06-01T00:00:00.000Z",
        updated_at: "2026-06-20T00:00:00.000Z",
      },
      followUpTasks: [],
      filingInsertCount: 0,
      filingInsertShouldFail: true,
    };

    const result = await completeMerchantContactOperatorFiling(
      createMerchantCompleteSupabase(state),
      USER_ID,
      {
        caseId: CASE_ID,
        taskId: TASK_ID,
        destination: "Merchant contact",
        filedAt: "2026-06-21",
        confirmationNumber: "MC-REMEDIATED-456",
        contactMethod: "phone",
        merchantResponseType: "no_response",
        recipient: "Acme Retail",
      }
    );

    expect(result.ok).toBe(false);
    expect(state.task.completed_at).toBeNull();
    expect(state.followUpTasks).toHaveLength(0);
    expect(state.filings).toHaveLength(1);
  });

  it("after the ladder has advanced to demand letter, builds merchant contact's own fresh follow-up without touching demand letter's or the ladder — and doesn't duplicate on retry", async () => {
    const marker = merchantContactFilingTaskNotesMarker(CASE_ID);
    const bounced = bouncedMerchantContactFiling();
    const demandLetterFollowUp: JusticeCaseTaskRow = {
      id: "followup-demand-letter",
      user_id: USER_ID,
      case_id: CASE_ID,
      title: "Surrenderless follow-up: Small claims / demand letter",
      due_date: "2026-07-01",
      notes: "follow_up:" + CASE_ID + "\nowner_href:" + MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF,
      completed_at: null,
      created_at: "2026-06-25T00:00:00.000Z",
      updated_at: "2026-06-25T00:00:00.000Z",
    };
    const state: MockCaseState = {
      intake: retailIntake(),
      client_state: {
        prepared_packet_approved: true,
        // The escalation ladder already advanced past merchant contact to demand letter before
        // merchant contact's delayed bounce arrived and reopened its task. "completed" — demand
        // letter already filed successfully (that's how its own open follow-up exists) — so this
        // fixture doesn't also need to model the unrelated owned-filing-task queue.
        approved_next_action: {
          label: "Small claims / demand letter",
          href: MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF,
          status: "completed",
          follow_up_needed: true,
          follow_up_at: demandLetterFollowUp.due_date,
        },
      },
      filings: [bounced],
      task: {
        id: TASK_ID,
        user_id: USER_ID,
        case_id: CASE_ID,
        title: "[Needs manual follow-up — bounced] Merchant contact: Acme Retail",
        due_date: null,
        notes: `${marker}\ncase_id: ${CASE_ID}\ndraft:\nHi`,
        completed_at: null,
        created_at: "2026-06-01T00:00:00.000Z",
        updated_at: "2026-06-20T00:00:00.000Z",
      },
      followUpTasks: [demandLetterFollowUp],
      filingInsertCount: 0,
    };
    const clientStateBefore = JSON.parse(JSON.stringify(state.client_state));

    const result = await completeMerchantContactOperatorFiling(
      createMerchantCompleteSupabase(state),
      USER_ID,
      {
        caseId: CASE_ID,
        taskId: TASK_ID,
        destination: "Merchant contact",
        filedAt: "2026-06-21",
        confirmationNumber: "MC-REMEDIATED-456",
        contactMethod: "phone",
        merchantResponseType: "no_response",
        recipient: "Acme Retail",
        notes: "Re-contacted by phone after email bounce",
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.idempotent).toBe(false);
    expect(result.task.completed_at).toBeTruthy();
    // approved_next_action's identity must be left exactly as it was — still demand letter's, not
    // rewound to merchant contact and not advanced to some third lane.
    const approvedNextAfter = (state.client_state as { approved_next_action?: Record<string, unknown> })
      .approved_next_action;
    expect(approvedNextAfter).toMatchObject(
      (clientStateBefore as { approved_next_action: Record<string, unknown> }).approved_next_action
    );

    const stillDemandLetter = state.followUpTasks.find((t) => t.id === "followup-demand-letter");
    expect(stillDemandLetter?.completed_at).toBeNull();
    expect(stillDemandLetter?.due_date).toBe("2026-07-01");
    expect(followUpTaskOwnerHref(stillDemandLetter?.notes)).toBe(
      MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF
    );

    expect(state.followUpTasks).toHaveLength(2);
    const merchantFollowUp = state.followUpTasks.find((t) => t.id !== "followup-demand-letter");
    expect(merchantFollowUp).toBeDefined();
    expect(merchantFollowUp?.completed_at).toBeNull();
    expect(followUpTaskOwnerHref(merchantFollowUp?.notes)).toBe(
      MANUAL_ACTION_TRACKING_REAL_MERCHANT_PREP_HREF
    );
    expect(taskNotesMatchFollowUpMarker(merchantFollowUp?.notes, CASE_ID)).toBe(true);
    // It carries its own valid due_date, scheduled from the remediation filing's own filedAt
    // (2026-06-21 + 45 days) — never inherited from demand letter's due_date (2026-07-01), and
    // never left null, or processDueFollowUps could never process it.
    expect(merchantFollowUp?.due_date).toBe("2026-08-05");
    expect(merchantFollowUp?.due_date).not.toBe(stillDemandLetter?.due_date);

    // Remediation also immediately creates merchant contact's own owner_href-scoped review —
    // real production code, not a test-only helper — real-listing reachable through the exact
    // marker/classifier the operator queue and generic PATCH route use.
    expect(state.supersededLaneReviews).toHaveLength(1);
    const review = state.supersededLaneReviews?.[0];
    expect(review?.completed_at).toBeNull();
    expect(taskNotesMatchSupersededLaneReviewMarker(review?.notes, CASE_ID)).toBe(true);
    expect(followUpTaskOwnerHref(review?.notes)).toBe(MANUAL_ACTION_TRACKING_REAL_MERCHANT_PREP_HREF);
    // Durably linked to the exact fresh follow-up attempt just created — never merely to
    // (case, owner_href) — so a later, genuinely new remediation cycle can never have this
    // review silently answer for it.
    expect(supersededLaneReviewLinkedFollowUpTaskId(review?.notes)).toBe(merchantFollowUp?.id);
    expect(taskNotesMatchAnyOperatorFulfillmentMarker(review?.notes, CASE_ID)).toBe(true);
    expect(classifyOpenOperatorTask(review!, state.intake)?.step).toBe("superseded_lane_review");

    const retry = await completeMerchantContactOperatorFiling(
      createMerchantCompleteSupabase(state),
      USER_ID,
      {
        caseId: CASE_ID,
        taskId: TASK_ID,
        destination: "Merchant contact",
        filedAt: "2026-06-21",
        confirmationNumber: "MC-REMEDIATED-456",
        contactMethod: "phone",
        merchantResponseType: "no_response",
        recipient: "Acme Retail",
      }
    );
    expect(retry.ok).toBe(true);
    if (!retry.ok) return;
    expect(retry.idempotent).toBe(true);
    expect(state.followUpTasks).toHaveLength(2);
    expect(state.supersededLaneReviews).toHaveLength(1);
  });

  it("a prior remediation cycle's OLD completed follow-up/review for merchant contact never gets reused by a genuinely NEW remediation attempt on the same lane", async () => {
    const marker = merchantContactFilingTaskNotesMarker(CASE_ID);
    const bounced = bouncedMerchantContactFiling();
    // A PRIOR remediation cycle already ran to completion on merchant contact itself: its
    // follow-up closed, and its review was decided — both are historical, closed rows.
    const oldMerchantFollowUp: JusticeCaseTaskRow = {
      id: "followup-merchant-contact-old",
      user_id: USER_ID,
      case_id: CASE_ID,
      title: "Surrenderless follow-up: merchant contact (old attempt)",
      due_date: "2026-04-01",
      notes: `follow_up:${CASE_ID}\nowner_href:${MANUAL_ACTION_TRACKING_REAL_MERCHANT_PREP_HREF}`,
      completed_at: "2026-04-02T00:00:00.000Z",
      created_at: "2026-03-01T00:00:00.000Z",
      updated_at: "2026-04-02T00:00:00.000Z",
    };
    const oldMerchantReview: JusticeCaseTaskRow = {
      id: "review-merchant-contact-old",
      user_id: USER_ID,
      case_id: CASE_ID,
      title: "Follow-up response review: merchant contact (old attempt)",
      due_date: null,
      notes: [
        `superseded_lane_review:${CASE_ID}`,
        `owner_href:${MANUAL_ACTION_TRACKING_REAL_MERCHANT_PREP_HREF}`,
        "follow_up_task_id:followup-merchant-contact-old",
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
    // branch for merchant contact specifically.
    const currentLaneFollowUp: JusticeCaseTaskRow = {
      id: "followup-demand-letter-current",
      user_id: USER_ID,
      case_id: CASE_ID,
      title: "Surrenderless follow-up: Small claims / demand letter",
      due_date: "2026-07-01",
      notes: `follow_up:${CASE_ID}\nowner_href:${MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF}`,
      completed_at: null,
      created_at: "2026-06-01T00:00:00.000Z",
      updated_at: "2026-06-01T00:00:00.000Z",
    };
    const state: MockCaseState = {
      intake: retailIntake(),
      client_state: {
        prepared_packet_approved: true,
        approved_next_action: {
          label: "Small claims / demand letter",
          href: MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF,
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
        title: "[Needs manual follow-up — bounced] Merchant contact: Acme Retail",
        due_date: null,
        notes: `${marker}\ncase_id: ${CASE_ID}\ndraft:\nHi`,
        completed_at: null,
        created_at: "2026-06-01T00:00:00.000Z",
        updated_at: "2026-06-20T00:00:00.000Z",
      },
      followUpTasks: [oldMerchantFollowUp, currentLaneFollowUp],
      supersededLaneReviews: [oldMerchantReview],
      filingInsertCount: 0,
    };

    const result = await completeMerchantContactOperatorFiling(
      createMerchantCompleteSupabase(state),
      USER_ID,
      {
        caseId: CASE_ID,
        taskId: TASK_ID,
        destination: "Merchant contact",
        filedAt: "2026-06-21",
        confirmationNumber: "MC-REMEDIATED-SECOND-789",
        contactMethod: "phone",
        merchantResponseType: "no_response",
        recipient: "Acme Retail",
        notes: "Re-contacted again after a second bounce",
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(state.followUpTasks).toHaveLength(3);
    const newFollowUp = state.followUpTasks.find(
      (t) =>
        followUpTaskOwnerHref(t.notes) === MANUAL_ACTION_TRACKING_REAL_MERCHANT_PREP_HREF &&
        t.id !== "followup-merchant-contact-old"
    );
    expect(newFollowUp).toBeDefined();
    expect(newFollowUp?.completed_at).toBeNull();
    expect(currentLaneFollowUp.completed_at).toBeNull();

    expect(state.supersededLaneReviews).toHaveLength(2);
    const newReview = state.supersededLaneReviews?.find((t) => t.id !== "review-merchant-contact-old");
    expect(newReview).toBeDefined();
    expect(newReview?.completed_at).toBeNull();
    expect(supersededLaneReviewLinkedFollowUpTaskId(newReview?.notes)).toBe(newFollowUp?.id);
    expect(supersededLaneReviewLinkedFollowUpTaskId(newReview?.notes)).not.toBe(
      "followup-merchant-contact-old"
    );

    expect(oldMerchantFollowUp.completed_at).toBe("2026-04-02T00:00:00.000Z");
    expect(oldMerchantReview.completed_at).toBe("2026-04-02T00:00:00.000Z");
    expect(oldMerchantReview.notes).toContain("decision:no_response");
  });
});

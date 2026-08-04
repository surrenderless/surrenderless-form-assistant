import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildJusticeIntakeFromParts, defaultBuildJusticeIntakeParts } from "@/lib/justice/buildJusticeIntake";
import {
  MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF,
  MANUAL_ACTION_TRACKING_REAL_PAYMENT_DISPUTE_PREP_HREF,
  canonicalFilingDestinationForApprovedActionHref,
} from "@/lib/justice/handlingTrackingProgress";
import {
  demandLetterFilingTaskNotesMarker,
  shouldQueueDemandLetterFilingTask,
} from "@/lib/justice/demandLetterFilingTask";
import { buildDemandLetterOperatorFilingWorkspace } from "@/lib/justice/demandLetterOperatorFilingWorkspace";
import type { JusticeCaseFilingRow } from "@/lib/justice/filings";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";
import type { JusticeIntake, TimelineEntry } from "@/lib/justice/types";

const CASE_ID = "550e8400-e29b-41d4-a716-446655440000";
const USER_ID = "user-owner-1";
const TASK_ID = "550e8400-e29b-41d4-a716-446655440088";

const timelineStore: { entries: TimelineEntry[] } = { entries: [] };

// Wraps the real implementation (still calls through, so ladder-logic behavior for every
// existing test is unchanged) purely so its call arguments can be inspected — the correct,
// ladder-independent boundary for proving this file threads real per-case evidence through,
// rather than a hardcoded or stale value.
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

import { completeDemandLetterOperatorFiling } from "@/lib/justice/completeDemandLetterOperatorFiling";
import { advanceApprovedNextActionAfterCompleted } from "@/lib/justice/recomputeApprovedNextActionAfterIntake";
import { FOLLOW_UP_TASK_ENSURE_RETRYABLE_ERROR } from "@/lib/justice/ensureFollowUpAfterOperatorClientStateWrite";
import { followUpTaskOwnerHref, taskNotesMatchFollowUpMarker } from "@/lib/justice/followUpCaseTask";
import {
  supersededLaneReviewLinkedFollowUpTaskId,
  taskNotesMatchSupersededLaneReviewMarker,
} from "@/lib/justice/followUpResponseReviewTask";
import { taskNotesMatchAnyOperatorFulfillmentMarker } from "@/lib/justice/operatorEvidenceFileAccess";
import { classifyOpenOperatorTask } from "@/lib/justice/operatorFulfillmentQueue";
import { upsertDemandLetterEmailDeliveryNotes } from "@/lib/justice/demandLetterEmailDelivery";

function demandLetterIntake(): JusticeIntake {
  return buildJusticeIntakeFromParts({
    ...defaultBuildJusticeIntakeParts(),
    problem_category: "online_purchase",
    company_name: "Acme Retail",
    company_contact_email: "support@acme.example",
    purchase_or_signup: "Wireless earbuds",
    story: "Paid for earbuds that never shipped.",
    money_amount: "$129.00",
    pay_or_order_date: "2026-05-01",
    already_contacted: "yes",
    contact_method: "email",
    contact_date: "2026-05-05",
    merchant_response_type: "no_response",
    user_display_name: "Jordan Lee",
    reply_email: "e2e@example.com",
    consumer_us_state: "CA",
  });
}

/** CFPB-relevant variant proving the hasUploadedEvidenceFile wiring doesn't wrongly
 * pick CFPB after the demand letter completes — CFPB's priority (28) is below the
 * demand letter's (90), so it's excluded from the downstream ladder regardless of evidence. */
function cfpbRelevantDemandLetterIntake(): JusticeIntake {
  return buildJusticeIntakeFromParts({
    ...defaultBuildJusticeIntakeParts(),
    problem_category: "financial_account_issue",
    company_name: "North Bank",
    company_contact_email: "support@northbank.example",
    purchase_or_signup: "checking account",
    story: "Unauthorized charge on my checking account, bank won't reverse it.",
    already_contacted: "yes",
    contact_method: "email",
    contact_date: "2026-05-05",
    merchant_response_type: "refused_help",
    contact_proof_type: "upload",
    contact_proof_text: "",
    user_display_name: "Jordan Lee",
    reply_email: "e2e@example.com",
    consumer_us_state: "CA",
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
  followUpInsertFail: boolean;
  filingInsertShouldFail?: boolean;
  evidence?: Array<{ file_name: string | null; mime_type: string | null; file_size_bytes: number | null }>;
};

function createDemandLetterCompleteSupabase(state: MockCaseState): SupabaseClient {
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
                      updated_at: "2026-06-15T12:05:00.000Z",
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
                  if (state.followUpInsertFail) {
                    return { data: null, error: { message: "review insert failed" } };
                  }
                  const review: JusticeCaseTaskRow = {
                    id: `superseded-review-${(state.supersededLaneReviews?.length ?? 0) + 1}`,
                    user_id: USER_ID,
                    case_id: CASE_ID,
                    title: String(row.title ?? ""),
                    due_date: typeof row.due_date === "string" ? row.due_date : null,
                    notes,
                    completed_at: null,
                    created_at: "2026-06-15T12:06:30.000Z",
                    updated_at: "2026-06-15T12:06:30.000Z",
                  };
                  state.supersededLaneReviews = [...(state.supersededLaneReviews ?? []), review];
                  return { data: review, error: null };
                }
                if (!notes.startsWith("follow_up:")) {
                  return { data: null, error: { message: "unexpected task insert" } };
                }
                if (state.followUpInsertFail) {
                  return { data: null, error: { message: "follow-up insert failed" } };
                }
                const task: JusticeCaseTaskRow = {
                  id: `follow-up-${state.followUpTasks.length + 1}`,
                  user_id: USER_ID,
                  case_id: CASE_ID,
                  title: String(row.title ?? ""),
                  due_date: typeof row.due_date === "string" ? row.due_date : null,
                  notes,
                  completed_at: null,
                  created_at: "2026-06-15T12:06:00.000Z",
                  updated_at: "2026-06-15T12:06:00.000Z",
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
                  created_at: "2026-06-15T12:00:00.000Z",
                  updated_at: "2026-06-15T12:00:00.000Z",
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

describe("completeDemandLetterOperatorFiling prerequisites", () => {
  it("uses canonical demand letter filing destination", () => {
    expect(
      canonicalFilingDestinationForApprovedActionHref(
        MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF
      )
    ).toBe("Small claims / demand letter");
  });

  it("queues demand letter when client_state advances to demand letter step", () => {
    expect(
      shouldQueueDemandLetterFilingTask({
        prepared_packet_approved: true,
        approved_next_action: {
          label: "Small claims / demand letter",
          href: "/justice/demand-letter",
          status: "approved",
        },
      })
    ).toBe(true);
    expect(
      shouldQueueDemandLetterFilingTask({
        prepared_packet_approved: true,
        approved_next_action: {
          label: "Small claims / demand letter",
          href: "/justice/demand-letter",
          status: "completed",
        },
      })
    ).toBe(false);
  });
});

describe("demand-letter workspace completion behavior", () => {
  beforeEach(() => {
    timelineStore.entries = [];
  });

  it("keeps workspace is_submitted false while requiring the same confirmation fields as the complete API", () => {
    const workspace = buildDemandLetterOperatorFilingWorkspace({ intake: demandLetterIntake() });
    expect(workspace.is_submitted).toBe(false);
    expect(workspace.filing_destination).toBe(
      canonicalFilingDestinationForApprovedActionHref(
        MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF
      )
    );
    expect(workspace.confirmation_capture).toEqual({
      requires_filed_at: true,
      requires_confirmation_number: true,
      requires_destination: true,
    });
  });

  it("rejects completion without confirmation number (no false submitted state)", async () => {
    const marker = demandLetterFilingTaskNotesMarker(CASE_ID);
    const state: MockCaseState = {
      intake: demandLetterIntake(),
      client_state: {
        prepared_packet_approved: true,
        approved_next_action: {
          label: "Small claims / demand letter",
          href: MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF,
          status: "approved",
        },
      },
      filings: [],
      task: {
        id: TASK_ID,
        user_id: USER_ID,
        case_id: CASE_ID,
        title: "Demand letter: Acme Retail",
        due_date: null,
        notes: `${marker}\ncase_id: ${CASE_ID}\ndraft:\nLetter`,
        completed_at: null,
        created_at: "2026-06-01T00:00:00.000Z",
        updated_at: "2026-06-01T00:00:00.000Z",
      },
      followUpTasks: [],
      filingInsertCount: 0,
      followUpInsertFail: false,
    };
    const result = await completeDemandLetterOperatorFiling(
      createDemandLetterCompleteSupabase(state),
      USER_ID,
      {
        caseId: CASE_ID,
        taskId: TASK_ID,
        destination: "Small claims / demand letter",
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

  it("records filing through the existing demand-letter completion path after send confirmation", async () => {
    const marker = demandLetterFilingTaskNotesMarker(CASE_ID);
    const workspace = buildDemandLetterOperatorFilingWorkspace({ intake: demandLetterIntake() });
    const state: MockCaseState = {
      intake: demandLetterIntake(),
      client_state: {
        prepared_packet_approved: true,
        approved_next_action: {
          label: "Small claims / demand letter",
          href: MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF,
          status: "approved",
        },
      },
      filings: [],
      task: {
        id: TASK_ID,
        user_id: USER_ID,
        case_id: CASE_ID,
        title: "Demand letter: Acme Retail",
        due_date: null,
        notes: `${marker}\ncase_id: ${CASE_ID}\ndraft:\nLetter`,
        completed_at: null,
        created_at: "2026-06-01T00:00:00.000Z",
        updated_at: "2026-06-01T00:00:00.000Z",
      },
      followUpTasks: [],
      filingInsertCount: 0,
      followUpInsertFail: false,
    };

    expect(workspace.is_submitted).toBe(false);

    const result = await completeDemandLetterOperatorFiling(
      createDemandLetterCompleteSupabase(state),
      USER_ID,
      {
        caseId: CASE_ID,
        taskId: TASK_ID,
        destination: workspace.filing_destination,
        filedAt: "2026-06-15",
        confirmationNumber: "DL-SEND-998877",
        notes: "Filed via guided workspace",
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.filing.confirmation_number).toBe("DL-SEND-998877");
    expect(result.filing.destination).toBe("Small claims / demand letter");
    expect(result.task.completed_at).toBeTruthy();
    expect(shouldQueueDemandLetterFilingTask(state.client_state)).toBe(false);
    expect(state.followUpTasks).toHaveLength(1);
    expect(taskNotesMatchFollowUpMarker(state.followUpTasks[0].notes, CASE_ID)).toBe(true);
  });

  it("returns retriable failure when follow-up task ensure fails after client_state write", async () => {
    const marker = demandLetterFilingTaskNotesMarker(CASE_ID);
    const workspace = buildDemandLetterOperatorFilingWorkspace({ intake: demandLetterIntake() });
    const state: MockCaseState = {
      intake: demandLetterIntake(),
      client_state: {
        prepared_packet_approved: true,
        approved_next_action: {
          label: "Small claims / demand letter",
          href: MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF,
          status: "approved",
        },
      },
      filings: [],
      task: {
        id: TASK_ID,
        user_id: USER_ID,
        case_id: CASE_ID,
        title: "Demand letter: Acme Retail",
        due_date: null,
        notes: `${marker}\ncase_id: ${CASE_ID}\ndraft:\nLetter`,
        completed_at: null,
        created_at: "2026-06-01T00:00:00.000Z",
        updated_at: "2026-06-01T00:00:00.000Z",
      },
      followUpTasks: [],
      filingInsertCount: 0,
      followUpInsertFail: true,
    };

    const result = await completeDemandLetterOperatorFiling(
      createDemandLetterCompleteSupabase(state),
      USER_ID,
      {
        caseId: CASE_ID,
        taskId: TASK_ID,
        destination: workspace.filing_destination,
        filedAt: "2026-06-15",
        confirmationNumber: "DL-SEND-998877",
      }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(FOLLOW_UP_TASK_ENSURE_RETRYABLE_ERROR);
      expect(result.status).toBe(500);
    }
    expect(state.followUpTasks).toHaveLength(0);
    expect(
      (state.client_state.approved_next_action as { follow_up_needed?: boolean } | undefined)
        ?.follow_up_needed
    ).toBe(true);
  });

  it("threads a hasUploadedEvidenceFile value derived from real evidence rows into the advance-after-completed call (shared boundary — independent of whether CFPB is reachable from this ladder position)", async () => {
    const marker = demandLetterFilingTaskNotesMarker(CASE_ID);
    const buildState = (evidence: MockCaseState["evidence"]): MockCaseState => ({
      intake: cfpbRelevantDemandLetterIntake(),
      client_state: {
        prepared_packet_approved: true,
        approved_next_action: {
          label: "Small claims / demand letter",
          href: MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF,
          status: "approved",
        },
      },
      filings: [],
      task: {
        id: TASK_ID,
        user_id: USER_ID,
        case_id: CASE_ID,
        title: "Demand letter: North Bank",
        due_date: null,
        notes: `${marker}\ncase_id: ${CASE_ID}\ndraft:\nLetter`,
        completed_at: null,
        created_at: "2026-06-01T00:00:00.000Z",
        updated_at: "2026-06-01T00:00:00.000Z",
      },
      followUpTasks: [],
      filingInsertCount: 0,
      followUpInsertFail: false,
      evidence,
    });
    const spy = vi.mocked(advanceApprovedNextActionAfterCompleted);

    spy.mockClear();
    const withFile = buildState([
      { file_name: "bank-statement.png", mime_type: "image/png", file_size_bytes: 2048 },
    ]);
    await completeDemandLetterOperatorFiling(createDemandLetterCompleteSupabase(withFile), USER_ID, {
      caseId: CASE_ID,
      taskId: TASK_ID,
      destination: "Small claims / demand letter",
      filedAt: "2026-06-15",
      confirmationNumber: "DL-SEND-998877",
    });
    expect(spy).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ hasUploadedEvidenceFile: true })
    );

    spy.mockClear();
    const withoutFile = buildState([]);
    await completeDemandLetterOperatorFiling(createDemandLetterCompleteSupabase(withoutFile), USER_ID, {
      caseId: CASE_ID,
      taskId: TASK_ID,
      destination: "Small claims / demand letter",
      filedAt: "2026-06-15",
      confirmationNumber: "DL-SEND-998877",
    });
    expect(spy).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ hasUploadedEvidenceFile: false })
    );
  });
});

function bouncedDemandLetterFiling(): JusticeCaseFilingRow {
  return {
    id: "fil-original-bounced",
    user_id: USER_ID,
    case_id: CASE_ID,
    destination: "Small claims / demand letter",
    filed_at: "2026-06-01",
    confirmation_number: "re_original_1",
    filing_url: null,
    notes: upsertDemandLetterEmailDeliveryNotes(null, {
      delivery_state: "bounced" as never,
      provider: "resend",
      recipient: "support@acme.example",
      provider_message_id: "re_original_1",
    }),
    created_at: "2026-06-01T00:00:00.000Z",
    updated_at: "2026-06-01T00:00:00.000Z",
  };
}

describe("completeDemandLetterOperatorFiling bounce remediation", () => {
  beforeEach(() => {
    timelineStore.entries = [];
  });

  it("creates a fresh filing after a bounce, closes the reopened task, and starts a fresh follow-up — preserving the bounced filing untouched", async () => {
    const marker = demandLetterFilingTaskNotesMarker(CASE_ID);
    const bounced = bouncedDemandLetterFiling();
    const state: MockCaseState = {
      intake: demandLetterIntake(),
      client_state: {
        prepared_packet_approved: true,
        approved_next_action: {
          label: "Small claims / demand letter",
          href: MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF,
          status: "completed",
          follow_up_needed: true,
        },
      },
      filings: [bounced],
      task: {
        id: TASK_ID,
        user_id: USER_ID,
        case_id: CASE_ID,
        title: "[Needs manual follow-up — bounced] Demand letter: Acme Retail",
        due_date: null,
        notes: `${marker}\ncase_id: ${CASE_ID}\ndraft:\nLetter`,
        completed_at: null,
        created_at: "2026-06-01T00:00:00.000Z",
        updated_at: "2026-06-20T00:00:00.000Z",
      },
      followUpTasks: [],
      filingInsertCount: 0,
      followUpInsertFail: false,
    };

    const result = await completeDemandLetterOperatorFiling(
      createDemandLetterCompleteSupabase(state),
      USER_ID,
      {
        caseId: CASE_ID,
        taskId: TASK_ID,
        destination: "Small claims / demand letter",
        filedAt: "2026-06-21",
        confirmationNumber: "DL-REMEDIATED-456",
        notes: "Re-sent via certified mail after email bounce",
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.idempotent).toBe(false);
    expect(result.filing.confirmation_number).toBe("DL-REMEDIATED-456");
    expect(result.filing.id).not.toBe(bounced.id);
    expect(result.task.completed_at).toBeTruthy();

    expect(state.filings).toHaveLength(2);
    const preservedBounced = state.filings.find((f) => f.id === bounced.id);
    expect(preservedBounced?.confirmation_number).toBe("re_original_1");
    expect(preservedBounced?.notes).toBe(bounced.notes);

    expect(state.followUpTasks).toHaveLength(1);
    expect(taskNotesMatchFollowUpMarker(state.followUpTasks[0].notes, CASE_ID)).toBe(true);
  });

  it("still reuses an existing non-bounced confirmed filing as idempotent (unchanged regression)", async () => {
    const marker = demandLetterFilingTaskNotesMarker(CASE_ID);
    const existing: JusticeCaseFilingRow = {
      id: "fil-accepted-1",
      user_id: USER_ID,
      case_id: CASE_ID,
      destination: "Small claims / demand letter",
      filed_at: "2026-06-15",
      confirmation_number: "DL-SEND-998877",
      filing_url: null,
      notes: upsertDemandLetterEmailDeliveryNotes(null, {
        delivery_state: "accepted",
        provider: "resend",
        recipient: "support@acme.example",
        provider_message_id: "DL-SEND-998877",
      }),
      created_at: "2026-06-15T00:00:00.000Z",
      updated_at: "2026-06-15T00:00:00.000Z",
    };
    const state: MockCaseState = {
      intake: demandLetterIntake(),
      client_state: {
        prepared_packet_approved: true,
        approved_next_action: {
          label: "Small claims / demand letter",
          href: MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF,
          status: "completed",
        },
      },
      filings: [existing],
      task: {
        id: TASK_ID,
        user_id: USER_ID,
        case_id: CASE_ID,
        title: "Demand letter: Acme Retail",
        due_date: null,
        notes: `${marker}\ncase_id: ${CASE_ID}\ndraft:\nLetter`,
        completed_at: "2026-06-15T00:00:00.000Z",
        created_at: "2026-06-01T00:00:00.000Z",
        updated_at: "2026-06-15T00:00:00.000Z",
      },
      followUpTasks: [],
      filingInsertCount: 0,
      followUpInsertFail: false,
    };

    const result = await completeDemandLetterOperatorFiling(
      createDemandLetterCompleteSupabase(state),
      USER_ID,
      {
        caseId: CASE_ID,
        taskId: TASK_ID,
        destination: "Small claims / demand letter",
        filedAt: "2026-06-15",
        confirmationNumber: "DL-SEND-998877",
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.idempotent).toBe(true);
    expect(result.filing.id).toBe("fil-accepted-1");
    expect(state.filings).toHaveLength(1);
  });

  it("does not complete the task or start a follow-up when the remediation filing insert fails", async () => {
    const marker = demandLetterFilingTaskNotesMarker(CASE_ID);
    const bounced = bouncedDemandLetterFiling();
    const state: MockCaseState = {
      intake: demandLetterIntake(),
      client_state: {
        prepared_packet_approved: true,
        approved_next_action: {
          label: "Small claims / demand letter",
          href: MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF,
          status: "completed",
          follow_up_needed: true,
        },
      },
      filings: [bounced],
      task: {
        id: TASK_ID,
        user_id: USER_ID,
        case_id: CASE_ID,
        title: "[Needs manual follow-up — bounced] Demand letter: Acme Retail",
        due_date: null,
        notes: `${marker}\ncase_id: ${CASE_ID}\ndraft:\nLetter`,
        completed_at: null,
        created_at: "2026-06-01T00:00:00.000Z",
        updated_at: "2026-06-20T00:00:00.000Z",
      },
      followUpTasks: [],
      filingInsertCount: 0,
      followUpInsertFail: false,
      filingInsertShouldFail: true,
    };

    const result = await completeDemandLetterOperatorFiling(
      createDemandLetterCompleteSupabase(state),
      USER_ID,
      {
        caseId: CASE_ID,
        taskId: TASK_ID,
        destination: "Small claims / demand letter",
        filedAt: "2026-06-21",
        confirmationNumber: "DL-REMEDIATED-456",
      }
    );

    expect(result.ok).toBe(false);
    expect(state.task.completed_at).toBeNull();
    expect(state.followUpTasks).toHaveLength(0);
    expect(state.filings).toHaveLength(1);
  });

  it("after the ladder has advanced to payment dispute, builds demand letter's own fresh follow-up without touching payment dispute's or the ladder — and doesn't duplicate on retry", async () => {
    const marker = demandLetterFilingTaskNotesMarker(CASE_ID);
    const bounced = bouncedDemandLetterFiling();
    const paymentDisputeFollowUp: JusticeCaseTaskRow = {
      id: "followup-payment-dispute",
      user_id: USER_ID,
      case_id: CASE_ID,
      title: "Surrenderless follow-up: Payment dispute (bank/card)",
      due_date: "2026-07-01",
      notes: "follow_up:" + CASE_ID + "\nowner_href:" + MANUAL_ACTION_TRACKING_REAL_PAYMENT_DISPUTE_PREP_HREF,
      completed_at: null,
      created_at: "2026-06-25T00:00:00.000Z",
      updated_at: "2026-06-25T00:00:00.000Z",
    };
    const state: MockCaseState = {
      intake: demandLetterIntake(),
      client_state: {
        prepared_packet_approved: true,
        // The escalation ladder already advanced past demand letter to payment dispute before
        // demand letter's delayed bounce arrived and reopened its task.
        approved_next_action: {
          label: "Payment dispute (bank/card)",
          href: MANUAL_ACTION_TRACKING_REAL_PAYMENT_DISPUTE_PREP_HREF,
          status: "approved",
          follow_up_needed: true,
          follow_up_at: paymentDisputeFollowUp.due_date,
        },
      },
      filings: [bounced],
      task: {
        id: TASK_ID,
        user_id: USER_ID,
        case_id: CASE_ID,
        title: "[Needs manual follow-up — bounced] Demand letter: Acme Retail",
        due_date: null,
        notes: `${marker}\ncase_id: ${CASE_ID}\ndraft:\nLetter`,
        completed_at: null,
        created_at: "2026-06-01T00:00:00.000Z",
        updated_at: "2026-06-20T00:00:00.000Z",
      },
      followUpTasks: [paymentDisputeFollowUp],
      filingInsertCount: 0,
      followUpInsertFail: false,
    };
    const clientStateBefore = JSON.parse(JSON.stringify(state.client_state));

    const result = await completeDemandLetterOperatorFiling(
      createDemandLetterCompleteSupabase(state),
      USER_ID,
      {
        caseId: CASE_ID,
        taskId: TASK_ID,
        destination: "Small claims / demand letter",
        filedAt: "2026-06-21",
        confirmationNumber: "DL-REMEDIATED-456",
        notes: "Re-sent via certified mail after email bounce",
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.idempotent).toBe(false);
    expect(result.advanced).toBe(false);
    expect(result.task.completed_at).toBeTruthy();
    // approved_next_action must be left exactly as it was — still payment dispute's, not
    // rewound to demand letter and not advanced any further.
    expect(state.client_state).toEqual(clientStateBefore);

    // Payment dispute's own follow-up is completely untouched.
    const stillPaymentDispute = state.followUpTasks.find((t) => t.id === "followup-payment-dispute");
    expect(stillPaymentDispute?.completed_at).toBeNull();
    expect(stillPaymentDispute?.due_date).toBe("2026-07-01");
    expect(followUpTaskOwnerHref(stillPaymentDispute?.notes)).toBe(
      MANUAL_ACTION_TRACKING_REAL_PAYMENT_DISPUTE_PREP_HREF
    );

    // A distinct, fresh, demand-letter-owned follow-up now also exists, open.
    expect(state.followUpTasks).toHaveLength(2);
    const demandLetterFollowUp = state.followUpTasks.find((t) => t.id !== "followup-payment-dispute");
    expect(demandLetterFollowUp).toBeDefined();
    expect(demandLetterFollowUp?.completed_at).toBeNull();
    expect(followUpTaskOwnerHref(demandLetterFollowUp?.notes)).toBe(
      MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF
    );
    expect(taskNotesMatchFollowUpMarker(demandLetterFollowUp?.notes, CASE_ID)).toBe(true);
    // It carries its own valid due_date, scheduled from the remediation filing's own filedAt
    // (2026-06-21 + 45 days) — never inherited from payment dispute's due_date (2026-07-01), and
    // never left null, or processDueFollowUps could never process it.
    expect(demandLetterFollowUp?.due_date).toBe("2026-08-05");
    expect(demandLetterFollowUp?.due_date).not.toBe(stillPaymentDispute?.due_date);

    // Remediation also immediately creates demand letter's own owner_href-scoped review — real
    // production code, not a test-only helper — so a response arriving well before the
    // follow-up's due date has somewhere to be recorded. It is real-listing reachable through
    // the exact marker/classifier the operator queue and generic PATCH route use.
    expect(state.supersededLaneReviews).toHaveLength(1);
    const review = state.supersededLaneReviews?.[0];
    expect(review?.completed_at).toBeNull();
    expect(taskNotesMatchSupersededLaneReviewMarker(review?.notes, CASE_ID)).toBe(true);
    expect(followUpTaskOwnerHref(review?.notes)).toBe(MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF);
    // Durably linked to the exact fresh follow-up attempt just created — never merely to
    // (case, owner_href) — so a later, genuinely new remediation cycle can never have this
    // review silently answer for it.
    expect(supersededLaneReviewLinkedFollowUpTaskId(review?.notes)).toBe(demandLetterFollowUp?.id);
    expect(taskNotesMatchAnyOperatorFulfillmentMarker(review?.notes, CASE_ID)).toBe(true);
    expect(classifyOpenOperatorTask(review!, state.intake)?.step).toBe("superseded_lane_review");

    // Retry (e.g. a webhook replay hitting the now-idempotent completion again) must not
    // duplicate demand letter's fresh follow-up or its review.
    const retry = await completeDemandLetterOperatorFiling(
      createDemandLetterCompleteSupabase(state),
      USER_ID,
      {
        caseId: CASE_ID,
        taskId: TASK_ID,
        destination: "Small claims / demand letter",
        filedAt: "2026-06-21",
        confirmationNumber: "DL-REMEDIATED-456",
      }
    );
    expect(retry.ok).toBe(true);
    if (!retry.ok) return;
    expect(retry.idempotent).toBe(true);
    expect(state.followUpTasks).toHaveLength(2);
    expect(state.supersededLaneReviews).toHaveLength(1);
  });

  it("a prior remediation cycle's OLD completed follow-up/review for demand letter never gets reused by a genuinely NEW remediation attempt on the same lane", async () => {
    const marker = demandLetterFilingTaskNotesMarker(CASE_ID);
    const bounced = bouncedDemandLetterFiling();
    // A PRIOR remediation cycle already ran to completion on demand letter itself: its follow-up
    // closed, and its review was decided — both are historical, closed rows for an OLDER attempt.
    const oldDemandLetterFollowUp: JusticeCaseTaskRow = {
      id: "followup-demand-letter-old",
      user_id: USER_ID,
      case_id: CASE_ID,
      title: "Surrenderless follow-up: demand letter (old attempt)",
      due_date: "2026-04-01",
      notes: `follow_up:${CASE_ID}\nowner_href:${MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF}`,
      completed_at: "2026-04-02T00:00:00.000Z",
      created_at: "2026-03-01T00:00:00.000Z",
      updated_at: "2026-04-02T00:00:00.000Z",
    };
    const oldDemandLetterReview: JusticeCaseTaskRow = {
      id: "review-demand-letter-old",
      user_id: USER_ID,
      case_id: CASE_ID,
      title: "Follow-up response review: demand letter (old attempt)",
      due_date: null,
      notes: [
        `superseded_lane_review:${CASE_ID}`,
        `owner_href:${MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF}`,
        "follow_up_task_id:followup-demand-letter-old",
        `case_id: ${CASE_ID}`,
        "guidance:",
        "prior attempt",
        "decision:no_response",
      ].join("\n"),
      completed_at: "2026-04-02T00:00:00.000Z",
      created_at: "2026-03-01T00:00:00.000Z",
      updated_at: "2026-04-02T00:00:00.000Z",
    };
    // Current lane's own open follow-up, pre-existing — keeps the unrelated
    // resolution-tracking/current-lane-ensure machinery a no-op (idempotent reuse), so this test
    // stays focused purely on the demand-letter bounce-remediation branch.
    const currentLaneFollowUp: JusticeCaseTaskRow = {
      id: "followup-payment-dispute-current",
      user_id: USER_ID,
      case_id: CASE_ID,
      title: "Surrenderless follow-up: Payment dispute (bank/card)",
      due_date: "2026-07-01",
      notes: `follow_up:${CASE_ID}\nowner_href:${MANUAL_ACTION_TRACKING_REAL_PAYMENT_DISPUTE_PREP_HREF}`,
      completed_at: null,
      created_at: "2026-06-01T00:00:00.000Z",
      updated_at: "2026-06-01T00:00:00.000Z",
    };
    const state: MockCaseState = {
      intake: demandLetterIntake(),
      client_state: {
        prepared_packet_approved: true,
        approved_next_action: {
          label: "Payment dispute (bank/card)",
          href: MANUAL_ACTION_TRACKING_REAL_PAYMENT_DISPUTE_PREP_HREF,
          status: "approved",
          follow_up_needed: true,
          follow_up_at: currentLaneFollowUp.due_date,
        },
      },
      filings: [bounced],
      task: {
        id: TASK_ID,
        user_id: USER_ID,
        case_id: CASE_ID,
        title: "[Needs manual follow-up — bounced] Demand letter: Acme Retail",
        due_date: null,
        notes: `${marker}\ncase_id: ${CASE_ID}\ndraft:\nLetter`,
        completed_at: null,
        created_at: "2026-06-01T00:00:00.000Z",
        updated_at: "2026-06-20T00:00:00.000Z",
      },
      followUpTasks: [oldDemandLetterFollowUp, currentLaneFollowUp],
      supersededLaneReviews: [oldDemandLetterReview],
      filingInsertCount: 0,
      followUpInsertFail: false,
    };

    const result = await completeDemandLetterOperatorFiling(
      createDemandLetterCompleteSupabase(state),
      USER_ID,
      {
        caseId: CASE_ID,
        taskId: TASK_ID,
        destination: "Small claims / demand letter",
        filedAt: "2026-06-21",
        confirmationNumber: "DL-REMEDIATED-SECOND-789",
        notes: "Re-sent again after a second bounce",
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // A brand-new demand-letter follow-up was created (the old one is completed, so dedup never
    // blocks this) — the pre-existing current-lane (payment dispute) follow-up is reused as-is.
    expect(state.followUpTasks).toHaveLength(3);
    const newFollowUp = state.followUpTasks.find(
      (t) => followUpTaskOwnerHref(t.notes) === MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF && t.id !== "followup-demand-letter-old"
    );
    expect(newFollowUp).toBeDefined();
    expect(newFollowUp?.completed_at).toBeNull();
    expect(currentLaneFollowUp.completed_at).toBeNull();

    // A brand-new review was created too — linked to the NEW follow-up id — never the old
    // completed review reused, even though it's the exact same lane on the exact same case.
    expect(state.supersededLaneReviews).toHaveLength(2);
    const newReview = state.supersededLaneReviews?.find((t) => t.id !== "review-demand-letter-old");
    expect(newReview).toBeDefined();
    expect(newReview?.completed_at).toBeNull();
    expect(supersededLaneReviewLinkedFollowUpTaskId(newReview?.notes)).toBe(newFollowUp?.id);
    expect(supersededLaneReviewLinkedFollowUpTaskId(newReview?.notes)).not.toBe(
      "followup-demand-letter-old"
    );

    // The old attempt's rows are byte-for-byte untouched.
    expect(oldDemandLetterFollowUp.completed_at).toBe("2026-04-02T00:00:00.000Z");
    expect(oldDemandLetterReview.completed_at).toBe("2026-04-02T00:00:00.000Z");
    expect(oldDemandLetterReview.notes).toContain("decision:no_response");
  });
});

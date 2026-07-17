import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildJusticeIntakeFromParts, defaultBuildJusticeIntakeParts } from "@/lib/justice/buildJusticeIntake";
import { followUpTaskNotesMarker } from "@/lib/justice/followUpCaseTask";
import { followUpResponseReviewTaskNotesMarker } from "@/lib/justice/followUpResponseReviewTask";
import { OWNED_FILING_TASK_ENSURE_RETRYABLE_ERROR } from "@/lib/justice/ensureOwnedFilingTaskAfterClientStateWrite";
import {
  FOLLOW_UP_RESPONSE_REVIEW_ENSURE_RETRYABLE_ERROR,
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

function retailIntake(overrides: Record<string, unknown> = {}): JusticeIntake {
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
    ...overrides,
  });
}

type MockState = {
  followUpTask: JusticeCaseTaskRow;
  client_state: Record<string, unknown>;
  intake: JusticeIntake;
  archived_at: string | null;
  responseReviewInserted: number;
  casePatched: number;
  /** When true, owned filing-task inserts fail (simulates ensure failure). */
  failOwnedFilingInsert?: boolean;
  /** When true, response-review task inserts fail (simulates ensure failure). */
  failResponseReviewInsert?: boolean;
  ownedFilingInserted: number;
};

/**
 * Capable supabase mock for processDueFollowUps: task list, case load/patch,
 * follow-up complete, and response-review / filing ensure inserts.
 */
function createCapableSupabase(state: MockState): SupabaseClient {
  const listFollowUpTasks = async () => ({
    data: state.followUpTask.completed_at?.trim() ? [] : [state.followUpTask],
    error: null,
  });

  const responseReviewRow = () => ({
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
        limit: async () => ({ data: [state.followUpTask], error: null }),
        maybeSingle: async () => ({ data: state.followUpTask, error: null }),
      }),
      limit: async () => ({ data: [state.followUpTask], error: null }),
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
                    if (typeof patch.completed_at === "string") {
                      state.followUpTask = {
                        ...state.followUpTask,
                        completed_at: patch.completed_at,
                      };
                    }
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
                if (notes.startsWith(`follow_up_response_review:${CASE_ID}`)) {
                  if (state.failResponseReviewInsert) {
                    return {
                      data: null,
                      error: { message: "simulated response review insert failure" },
                    };
                  }
                  state.responseReviewInserted += 1;
                  return {
                    data: {
                      id: REVIEW_TASK_ID,
                      user_id: USER_ID,
                      case_id: CASE_ID,
                      title: String(row.title ?? ""),
                      due_date: null,
                      notes,
                      completed_at: null,
                      created_at: "2026-07-15T14:00:00.000Z",
                      updated_at: "2026-07-15T14:00:00.000Z",
                    },
                    error: null,
                  };
                }
                const isOwnedFilingInsert =
                  notes.startsWith(`state_ag_filing_queue:${CASE_ID}`) ||
                  notes.startsWith(`bbb_filing_queue:${CASE_ID}`) ||
                  notes.startsWith(`cfpb_filing_queue:${CASE_ID}`) ||
                  notes.startsWith(`demand_letter_filing_queue:${CASE_ID}`) ||
                  notes.startsWith(`merchant_contact_queue:${CASE_ID}`) ||
                  notes.startsWith(`payment_dispute_filing_queue:${CASE_ID}`) ||
                  notes.startsWith(`fcc_filing_queue:${CASE_ID}`) ||
                  notes.startsWith(`ftc_filing_queue:${CASE_ID}`) ||
                  notes.startsWith(`dot_filing_queue:${CASE_ID}`);
                if (isOwnedFilingInsert && state.failOwnedFilingInsert) {
                  return {
                    data: null,
                    error: { message: "simulated owned filing insert failure" },
                  };
                }
                if (isOwnedFilingInsert) {
                  state.ownedFilingInserted += 1;
                }
                return {
                  data: {
                    id: "queued-other-task",
                    user_id: USER_ID,
                    case_id: CASE_ID,
                    title: String(row.title ?? ""),
                    due_date: null,
                    notes,
                    completed_at: null,
                    created_at: "2026-07-15T14:00:00.000Z",
                    updated_at: "2026-07-15T14:00:00.000Z",
                  },
                  error: null,
                };
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
                    archived_at: state.archived_at,
                    payment_dispute_draft: null,
                    timeline: timelineStore.entries,
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

describe("processDueFollowUps", () => {
  beforeEach(() => {
    timelineStore.entries = [];
  });

  it("records no response, clears follow-up, and queues terminal response-review", async () => {
    const marker = followUpTaskNotesMarker(CASE_ID);
    const state: MockState = {
      intake: retailIntake(),
      archived_at: null,
      responseReviewInserted: 0,
      casePatched: 0,
      ownedFilingInserted: 0,
      client_state: {
        prepared_packet_approved: true,
        approved_next_action: {
          label: "Small claims / demand letter",
          href: "/justice/demand-letter",
          status: "completed",
          completed_at: "2026-06-01T00:00:00.000Z",
          follow_up_needed: true,
          follow_up_at: "2026-07-01T12:00:00.000Z",
          outcome_note: "Escalation complete. Awaiting responses.",
          handling_requested_at: "2026-06-01T00:00:00.000Z",
        },
      },
      followUpTask: {
        id: FOLLOW_UP_TASK_ID,
        user_id: USER_ID,
        case_id: CASE_ID,
        title: "Surrenderless follow-up: Small claims / demand letter",
        due_date: "2026-07-01",
        notes: `${marker}\nEscalation complete.`,
        completed_at: null,
        created_at: "2026-06-01T00:00:00.000Z",
        updated_at: "2026-06-01T00:00:00.000Z",
      },
    };

    const summary = await processDueFollowUps(createCapableSupabase(state), {
      now: new Date("2026-07-15T16:00:00.000Z"),
    });

    expect(summary.terminal_response_review).toBe(1);
    expect(summary.advanced).toBe(0);
    expect(state.casePatched).toBe(1);
    expect(state.responseReviewInserted).toBe(1);
    expect(state.followUpTask.completed_at).toBeTruthy();
    const next = state.client_state.approved_next_action as {
      follow_up_needed?: boolean;
      outcome_note?: string;
    };
    expect(next.follow_up_needed).toBe(false);
    expect(next.outcome_note).toContain(NO_RESPONSE_OUTCOME_MARKER);
    expect(timelineStore.entries.some((e) => e.type === "outcome_recorded")).toBe(true);
  });

  it("skips resolved cases and does not archive or invent resolution", async () => {
    const marker = followUpTaskNotesMarker(CASE_ID);
    const state: MockState = {
      intake: retailIntake({ merchant_response_type: "resolved" }),
      archived_at: null,
      responseReviewInserted: 0,
      casePatched: 0,
      ownedFilingInserted: 0,
      client_state: {
        prepared_packet_approved: true,
        approved_next_action: {
          label: "Demand letter",
          href: "/justice/demand-letter",
          status: "completed",
          follow_up_needed: true,
          follow_up_at: "2026-07-01T12:00:00.000Z",
        },
      },
      followUpTask: {
        id: FOLLOW_UP_TASK_ID,
        user_id: USER_ID,
        case_id: CASE_ID,
        title: "Surrenderless follow-up: Demand letter",
        due_date: "2026-07-01",
        notes: marker,
        completed_at: null,
        created_at: "2026-06-01T00:00:00.000Z",
        updated_at: "2026-06-01T00:00:00.000Z",
      },
    };

    const summary = await processDueFollowUps(createCapableSupabase(state), {
      now: new Date("2026-07-15T16:00:00.000Z"),
    });
    expect(summary.skipped).toBe(1);
    expect(summary.processed).toBe(0);
    expect(state.casePatched).toBe(0);
    expect(state.responseReviewInserted).toBe(0);
    expect(state.followUpTask.completed_at).toBeNull();
  });

  it("is idempotent on repeated runs after terminal processing", async () => {
    const marker = followUpTaskNotesMarker(CASE_ID);
    const state: MockState = {
      intake: retailIntake(),
      archived_at: null,
      responseReviewInserted: 0,
      casePatched: 0,
      ownedFilingInserted: 0,
      client_state: {
        prepared_packet_approved: true,
        approved_next_action: {
          label: "Small claims / demand letter",
          href: "/justice/demand-letter",
          status: "completed",
          completed_at: "2026-06-01T00:00:00.000Z",
          follow_up_needed: true,
          follow_up_at: "2026-07-01T12:00:00.000Z",
          outcome_note: "Escalation complete. Awaiting responses.",
          handling_requested_at: "2026-06-01T00:00:00.000Z",
        },
      },
      followUpTask: {
        id: FOLLOW_UP_TASK_ID,
        user_id: USER_ID,
        case_id: CASE_ID,
        title: "Surrenderless follow-up: Small claims / demand letter",
        due_date: "2026-07-01",
        notes: marker,
        completed_at: null,
        created_at: "2026-06-01T00:00:00.000Z",
        updated_at: "2026-06-01T00:00:00.000Z",
      },
    };

    const supabase = createCapableSupabase(state);
    const first = await processDueFollowUps(supabase, {
      now: new Date("2026-07-15T16:00:00.000Z"),
    });
    expect(first.terminal_response_review).toBe(1);
    expect(state.responseReviewInserted).toBe(1);

    const second = await processDueFollowUps(supabase, {
      now: new Date("2026-07-15T16:00:00.000Z"),
    });
    // Follow-up task already completed → not scanned again.
    expect(second.scanned).toBe(0);
    expect(state.responseReviewInserted).toBe(1);
    expect(state.casePatched).toBe(1);
  });

  it("does not complete follow-up or count advanced when owned filing ensure fails after advance", async () => {
    const marker = followUpTaskNotesMarker(CASE_ID);
    const state: MockState = {
      intake: retailIntake(),
      archived_at: null,
      responseReviewInserted: 0,
      casePatched: 0,
      ownedFilingInserted: 0,
      failOwnedFilingInsert: true,
      client_state: {
        prepared_packet_approved: true,
        approved_next_action: {
          label: "Better Business Bureau",
          href: "/justice/bbb",
          status: "completed",
          completed_at: "2026-05-01T00:00:00.000Z",
          follow_up_needed: true,
          follow_up_at: "2026-06-15T12:00:00.000Z",
          outcome_note: "BBB filing recorded. Awaiting response.",
          handling_requested_at: "2026-05-01T00:00:00.000Z",
        },
      },
      followUpTask: {
        id: FOLLOW_UP_TASK_ID,
        user_id: USER_ID,
        case_id: CASE_ID,
        title: "Surrenderless follow-up: Better Business Bureau",
        due_date: "2026-06-15",
        notes: marker,
        completed_at: null,
        created_at: "2026-05-01T00:00:00.000Z",
        updated_at: "2026-05-01T00:00:00.000Z",
      },
    };

    const summary = await processDueFollowUps(createCapableSupabase(state), {
      now: new Date("2026-07-15T16:00:00.000Z"),
    });

    expect(summary.failed_retryable).toBe(1);
    expect(summary.advanced).toBe(0);
    expect(summary.processed).toBe(0);
    expect(summary.results[0]).toMatchObject({
      kind: "failed_retryable",
      error: OWNED_FILING_TASK_ENSURE_RETRYABLE_ERROR,
    });
    expect(state.casePatched).toBe(1);
    expect(state.ownedFilingInserted).toBe(0);
    expect(state.followUpTask.completed_at).toBeNull();
    const next = state.client_state.approved_next_action as {
      href?: string;
      status?: string;
      follow_up_needed?: boolean;
    };
    expect(next.href).not.toBe("/justice/bbb");
    expect(next.status).toBe("approved");
    expect(next.follow_up_needed).not.toBe(true);
  });

  it("on already_processed, re-runs owned ensure and leaves follow-up open when ensure fails", async () => {
    const marker = followUpTaskNotesMarker(CASE_ID);
    const state: MockState = {
      intake: retailIntake(),
      archived_at: null,
      responseReviewInserted: 0,
      casePatched: 0,
      ownedFilingInserted: 0,
      failOwnedFilingInsert: true,
      client_state: {
        prepared_packet_approved: true,
        approved_next_action: {
          label: "State Attorney General (consumer)",
          href: "/justice/state-ag",
          status: "approved",
          follow_up_needed: false,
          outcome_note: `${NO_RESPONSE_OUTCOME_MARKER} (due 2026-06-15). Follow-up check completed by Surrenderless — case remains open; no automatic resolution applied.`,
          handling_requested_at: "2026-05-01T00:00:00.000Z",
        },
      },
      followUpTask: {
        id: FOLLOW_UP_TASK_ID,
        user_id: USER_ID,
        case_id: CASE_ID,
        title: "Surrenderless follow-up: Better Business Bureau",
        due_date: "2026-06-15",
        notes: marker,
        completed_at: null,
        created_at: "2026-05-01T00:00:00.000Z",
        updated_at: "2026-05-01T00:00:00.000Z",
      },
    };

    const summary = await processDueFollowUps(createCapableSupabase(state), {
      now: new Date("2026-07-15T16:00:00.000Z"),
    });

    expect(summary.failed_retryable).toBe(1);
    expect(summary.skipped).toBe(0);
    expect(summary.advanced).toBe(0);
    expect(summary.results[0]).toMatchObject({
      kind: "failed_retryable",
      error: OWNED_FILING_TASK_ENSURE_RETRYABLE_ERROR,
    });
    expect(state.casePatched).toBe(0);
    expect(state.ownedFilingInserted).toBe(0);
    expect(state.followUpTask.completed_at).toBeNull();
  });

  it("does not complete follow-up or count terminal when response-review ensure fails", async () => {
    const marker = followUpTaskNotesMarker(CASE_ID);
    const state: MockState = {
      intake: retailIntake(),
      archived_at: null,
      responseReviewInserted: 0,
      casePatched: 0,
      ownedFilingInserted: 0,
      failResponseReviewInsert: true,
      client_state: {
        prepared_packet_approved: true,
        approved_next_action: {
          label: "Small claims / demand letter",
          href: "/justice/demand-letter",
          status: "completed",
          completed_at: "2026-06-01T00:00:00.000Z",
          follow_up_needed: true,
          follow_up_at: "2026-07-01T12:00:00.000Z",
          outcome_note: "Escalation complete. Awaiting responses.",
          handling_requested_at: "2026-06-01T00:00:00.000Z",
        },
      },
      followUpTask: {
        id: FOLLOW_UP_TASK_ID,
        user_id: USER_ID,
        case_id: CASE_ID,
        title: "Surrenderless follow-up: Small claims / demand letter",
        due_date: "2026-07-01",
        notes: marker,
        completed_at: null,
        created_at: "2026-06-01T00:00:00.000Z",
        updated_at: "2026-06-01T00:00:00.000Z",
      },
    };

    const summary = await processDueFollowUps(createCapableSupabase(state), {
      now: new Date("2026-07-15T16:00:00.000Z"),
    });

    expect(summary.failed_retryable).toBe(1);
    expect(summary.terminal_response_review).toBe(0);
    expect(summary.processed).toBe(0);
    expect(summary.results[0]).toMatchObject({
      kind: "failed_retryable",
      error: FOLLOW_UP_RESPONSE_REVIEW_ENSURE_RETRYABLE_ERROR,
    });
    expect(state.casePatched).toBe(1);
    expect(state.responseReviewInserted).toBe(0);
    expect(state.followUpTask.completed_at).toBeNull();
    const next = state.client_state.approved_next_action as {
      follow_up_needed?: boolean;
      outcome_note?: string;
    };
    expect(next.follow_up_needed).toBe(false);
    expect(next.outcome_note).toContain(NO_RESPONSE_OUTCOME_MARKER);
  });

  it("on already_processed terminal recovery, re-runs response-review ensure then closes follow-up", async () => {
    const marker = followUpTaskNotesMarker(CASE_ID);
    const state: MockState = {
      intake: retailIntake(),
      archived_at: null,
      responseReviewInserted: 0,
      casePatched: 0,
      ownedFilingInserted: 0,
      failResponseReviewInsert: true,
      client_state: {
        prepared_packet_approved: true,
        approved_next_action: {
          label: "Small claims / demand letter",
          href: "/justice/demand-letter",
          status: "completed",
          completed_at: "2026-06-01T00:00:00.000Z",
          follow_up_needed: true,
          follow_up_at: "2026-07-01T12:00:00.000Z",
          outcome_note: "Escalation complete. Awaiting responses.",
          handling_requested_at: "2026-06-01T00:00:00.000Z",
        },
      },
      followUpTask: {
        id: FOLLOW_UP_TASK_ID,
        user_id: USER_ID,
        case_id: CASE_ID,
        title: "Surrenderless follow-up: Small claims / demand letter",
        due_date: "2026-07-01",
        notes: marker,
        completed_at: null,
        created_at: "2026-06-01T00:00:00.000Z",
        updated_at: "2026-06-01T00:00:00.000Z",
      },
    };

    const supabase = createCapableSupabase(state);
    const first = await processDueFollowUps(supabase, {
      now: new Date("2026-07-15T16:00:00.000Z"),
    });
    expect(first.failed_retryable).toBe(1);
    expect(first.terminal_response_review).toBe(0);
    expect(state.followUpTask.completed_at).toBeNull();
    expect(state.responseReviewInserted).toBe(0);

    state.failResponseReviewInsert = false;
    const second = await processDueFollowUps(supabase, {
      now: new Date("2026-07-15T16:00:00.000Z"),
    });
    expect(second.failed_retryable).toBe(0);
    expect(second.skipped).toBe(1);
    expect(second.results[0]).toMatchObject({
      kind: "skipped",
      reason: "already_processed",
    });
    expect(second.terminal_response_review).toBe(0);
    expect(state.responseReviewInserted).toBe(1);
    expect(state.followUpTask.completed_at).toBeTruthy();
  });

  it("on already_processed terminal recovery, leaves follow-up open when response-review ensure fails", async () => {
    const marker = followUpTaskNotesMarker(CASE_ID);
    const state: MockState = {
      intake: retailIntake(),
      archived_at: null,
      responseReviewInserted: 0,
      casePatched: 0,
      ownedFilingInserted: 0,
      failResponseReviewInsert: true,
      client_state: {
        prepared_packet_approved: true,
        approved_next_action: {
          label: "Small claims / demand letter",
          href: "/justice/demand-letter",
          status: "completed",
          completed_at: "2026-06-01T00:00:00.000Z",
          follow_up_needed: false,
          outcome_note: `${NO_RESPONSE_OUTCOME_MARKER} (due 2026-07-01). Follow-up check completed by Surrenderless — case remains open; no automatic resolution applied.`,
          handling_requested_at: "2026-06-01T00:00:00.000Z",
        },
      },
      followUpTask: {
        id: FOLLOW_UP_TASK_ID,
        user_id: USER_ID,
        case_id: CASE_ID,
        title: "Surrenderless follow-up: Small claims / demand letter",
        due_date: "2026-07-01",
        notes: marker,
        completed_at: null,
        created_at: "2026-06-01T00:00:00.000Z",
        updated_at: "2026-06-01T00:00:00.000Z",
      },
    };

    const summary = await processDueFollowUps(createCapableSupabase(state), {
      now: new Date("2026-07-15T16:00:00.000Z"),
    });

    expect(summary.failed_retryable).toBe(1);
    expect(summary.skipped).toBe(0);
    expect(summary.terminal_response_review).toBe(0);
    expect(summary.results[0]).toMatchObject({
      kind: "failed_retryable",
      error: FOLLOW_UP_RESPONSE_REVIEW_ENSURE_RETRYABLE_ERROR,
    });
    expect(state.casePatched).toBe(0);
    expect(state.responseReviewInserted).toBe(0);
    expect(state.followUpTask.completed_at).toBeNull();
  });
});

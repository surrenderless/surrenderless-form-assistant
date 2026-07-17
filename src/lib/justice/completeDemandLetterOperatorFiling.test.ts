import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildJusticeIntakeFromParts, defaultBuildJusticeIntakeParts } from "@/lib/justice/buildJusticeIntake";
import {
  MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF,
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
import { FOLLOW_UP_TASK_ENSURE_RETRYABLE_ERROR } from "@/lib/justice/ensureFollowUpAfterOperatorClientStateWrite";
import { taskNotesMatchFollowUpMarker } from "@/lib/justice/followUpCaseTask";

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

type MockCaseState = {
  intake: JusticeIntake;
  client_state: Record<string, unknown>;
  filings: JusticeCaseFilingRow[];
  task: JusticeCaseTaskRow;
  followUpTasks: JusticeCaseTaskRow[];
  filingInsertCount: number;
  followUpInsertFail: boolean;
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
        const tasksMatchingLike = (pattern: string) => {
          const prefix = String(pattern).replace(/%$/, "");
          const all = [state.task, ...state.followUpTasks];
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
                  limit: async () => ({
                    data: tasksMatchingLike(pattern).slice(0, 1),
                    error: null,
                  }),
                }),
                limit: async () => ({ data: [state.task], error: null }),
                maybeSingle: async () => ({ data: state.task, error: null }),
              }),
              like: (_column: string, pattern: string) => ({
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
});

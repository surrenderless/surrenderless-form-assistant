import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildJusticeIntakeFromParts, defaultBuildJusticeIntakeParts } from "@/lib/justice/buildJusticeIntake";
import {
  MANUAL_ACTION_TRACKING_REAL_FTC_PREP_HREF,
  canonicalFilingDestinationForApprovedActionHref,
} from "@/lib/justice/handlingTrackingProgress";
import {
  ftcFilingTaskNotesMarker,
  shouldQueueFtcFilingTask,
} from "@/lib/justice/ftcFilingTask";
import { buildFtcOperatorFilingWorkspace } from "@/lib/justice/ftcOperatorFilingWorkspace";
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

import { completeFtcOperatorFiling } from "@/lib/justice/completeFtcOperatorFiling";

function retailIntake(): JusticeIntake {
  return buildJusticeIntakeFromParts({
    ...defaultBuildJusticeIntakeParts(),
    problem_category: "online_purchase",
    company_name: "Scam Gadgets",
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
  filingInsertCount: number;
};

function createFtcCompleteSupabase(state: MockCaseState): SupabaseClient {
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
                      updated_at: "2026-05-15T12:05:00.000Z",
                    };
                    return { data: state.task, error: null };
                  },
                }),
              }),
            }),
          }),
          insert: () => ({
            select: () => ({
              single: async () => ({ data: null, error: { message: "unexpected task insert" } }),
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
                  created_at: "2026-05-15T12:00:00.000Z",
                  updated_at: "2026-05-15T12:00:00.000Z",
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

describe("FTC workspace completion behavior", () => {
  beforeEach(() => {
    timelineStore.entries = [];
  });

  it("keeps workspace is_submitted false while requiring the same confirmation fields as the complete API", () => {
    const workspace = buildFtcOperatorFilingWorkspace({ intake: retailIntake() });
    expect(workspace.is_submitted).toBe(false);
    expect(workspace.filing_destination).toBe(
      canonicalFilingDestinationForApprovedActionHref(MANUAL_ACTION_TRACKING_REAL_FTC_PREP_HREF)
    );
    expect(workspace.confirmation_capture).toEqual({
      requires_filed_at: true,
      requires_confirmation_number: true,
      requires_destination: true,
    });
  });

  it("rejects completion without confirmation number (no false submitted state)", async () => {
    const marker = ftcFilingTaskNotesMarker(CASE_ID);
    const state: MockCaseState = {
      intake: retailIntake(),
      client_state: {
        prepared_packet_approved: true,
        approved_next_action: {
          label: "FTC (consumer complaint)",
          href: MANUAL_ACTION_TRACKING_REAL_FTC_PREP_HREF,
          status: "approved",
        },
      },
      filings: [],
      task: {
        id: TASK_ID,
        user_id: USER_ID,
        case_id: CASE_ID,
        title: "FTC filing: Scam Gadgets",
        due_date: null,
        notes: `${marker}\ncase_id: ${CASE_ID}\ndraft:\nComplaint`,
        completed_at: null,
        created_at: "2026-05-01T00:00:00.000Z",
        updated_at: "2026-05-01T00:00:00.000Z",
      },
      filingInsertCount: 0,
    };
    const result = await completeFtcOperatorFiling(createFtcCompleteSupabase(state), USER_ID, {
      caseId: CASE_ID,
      taskId: TASK_ID,
      destination: "FTC (consumer complaint)",
      filedAt: "2026-05-15",
      confirmationNumber: "",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/confirmation/i);
    }
    expect(state.filings).toHaveLength(0);
    expect(state.task.completed_at).toBeNull();
  });

  it("records filing through the existing FTC completion path after portal confirmation", async () => {
    const marker = ftcFilingTaskNotesMarker(CASE_ID);
    const workspace = buildFtcOperatorFilingWorkspace({ intake: retailIntake() });
    const state: MockCaseState = {
      intake: retailIntake(),
      client_state: {
        prepared_packet_approved: true,
        approved_next_action: {
          label: "FTC (consumer complaint)",
          href: MANUAL_ACTION_TRACKING_REAL_FTC_PREP_HREF,
          status: "approved",
        },
      },
      filings: [],
      task: {
        id: TASK_ID,
        user_id: USER_ID,
        case_id: CASE_ID,
        title: "FTC filing: Scam Gadgets",
        due_date: null,
        notes: `${marker}\ncase_id: ${CASE_ID}\ndraft:\nComplaint`,
        completed_at: null,
        created_at: "2026-05-01T00:00:00.000Z",
        updated_at: "2026-05-01T00:00:00.000Z",
      },
      filingInsertCount: 0,
    };

    expect(workspace.is_submitted).toBe(false);

    const result = await completeFtcOperatorFiling(createFtcCompleteSupabase(state), USER_ID, {
      caseId: CASE_ID,
      taskId: TASK_ID,
      destination: workspace.filing_destination,
      filedAt: "2026-05-15",
      confirmationNumber: "FTC-998877",
      notes: "Filed via guided workspace",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.filing.confirmation_number).toBe("FTC-998877");
    expect(result.filing.destination).toBe("FTC (consumer complaint)");
    expect(result.task.completed_at).toBeTruthy();
    expect(shouldQueueFtcFilingTask(state.client_state)).toBe(false);
  });
});

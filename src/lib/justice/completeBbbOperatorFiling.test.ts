import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildJusticeIntakeFromParts, defaultBuildJusticeIntakeParts } from "@/lib/justice/buildJusticeIntake";
import {
  MANUAL_ACTION_TRACKING_REAL_BBB_PREP_HREF,
  canonicalFilingDestinationForApprovedActionHref,
} from "@/lib/justice/handlingTrackingProgress";
import {
  bbbFilingTaskNotesMarker,
  shouldQueueBbbFilingTask,
} from "@/lib/justice/bbbFilingTask";
import { buildBbbOperatorFilingWorkspace } from "@/lib/justice/bbbOperatorFilingWorkspace";
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

vi.mock("@/lib/justice/stateAgFilingTask", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/justice/stateAgFilingTask")>();
  return {
    ...mod,
    ensureStateAgFilingTask: vi.fn(async () => ({
      task: null,
      created: false,
      timeline: null,
    })),
  };
});

vi.mock("@/lib/justice/paymentDisputeFilingTask", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/justice/paymentDisputeFilingTask")>();
  return {
    ...mod,
    ensurePaymentDisputeFilingTask: vi.fn(async () => ({
      task: null,
      created: false,
      timeline: null,
    })),
  };
});

vi.mock("@/lib/justice/cfpbFilingTask", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/justice/cfpbFilingTask")>();
  return {
    ...mod,
    ensureCfpbFilingTask: vi.fn(async () => ({ task: null, created: false, timeline: null })),
  };
});

vi.mock("@/lib/justice/fccFilingTask", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/justice/fccFilingTask")>();
  return {
    ...mod,
    ensureFccFilingTask: vi.fn(async () => ({ task: null, created: false, timeline: null })),
  };
});

vi.mock("@/lib/justice/dotFilingTask", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/justice/dotFilingTask")>();
  return {
    ...mod,
    ensureDotFilingTask: vi.fn(async () => ({ task: null, created: false, timeline: null })),
  };
});

vi.mock("@/lib/justice/ftcFilingTask", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/justice/ftcFilingTask")>();
  return {
    ...mod,
    ensureFtcFilingTask: vi.fn(async () => ({ task: null, created: false, timeline: null })),
  };
});

vi.mock("@/lib/justice/demandLetterFilingTask", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/justice/demandLetterFilingTask")>();
  return {
    ...mod,
    ensureDemandLetterFilingTask: vi.fn(async () => ({
      task: null,
      created: false,
      timeline: null,
    })),
  };
});

import { completeBbbOperatorFiling } from "@/lib/justice/completeBbbOperatorFiling";

function bbbIntake(): JusticeIntake {
  return buildJusticeIntakeFromParts({
    ...defaultBuildJusticeIntakeParts(),
    problem_category: "online_purchase",
    company_name: "Acme Retail",
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

function createBbbCompleteSupabase(state: MockCaseState): SupabaseClient {
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
                      updated_at: "2026-06-15T12:05:00.000Z",
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

describe("BBB workspace completion behavior", () => {
  beforeEach(() => {
    timelineStore.entries = [];
  });

  it("keeps workspace is_submitted false while requiring the same confirmation fields as the complete API", () => {
    const workspace = buildBbbOperatorFilingWorkspace({ intake: bbbIntake() });
    expect(workspace.is_submitted).toBe(false);
    expect(workspace.filing_destination).toBe(
      canonicalFilingDestinationForApprovedActionHref(MANUAL_ACTION_TRACKING_REAL_BBB_PREP_HREF)
    );
    expect(workspace.confirmation_capture).toEqual({
      requires_filed_at: true,
      requires_confirmation_number: true,
      requires_destination: true,
    });
  });

  it("rejects completion without confirmation number (no false submitted state)", async () => {
    const marker = bbbFilingTaskNotesMarker(CASE_ID);
    const state: MockCaseState = {
      intake: bbbIntake(),
      client_state: {
        prepared_packet_approved: true,
        approved_next_action: {
          label: "Better Business Bureau",
          href: MANUAL_ACTION_TRACKING_REAL_BBB_PREP_HREF,
          status: "approved",
        },
      },
      filings: [],
      task: {
        id: TASK_ID,
        user_id: USER_ID,
        case_id: CASE_ID,
        title: "BBB filing: Acme Retail",
        due_date: null,
        notes: `${marker}\ncase_id: ${CASE_ID}\ndraft:\nComplaint`,
        completed_at: null,
        created_at: "2026-06-01T00:00:00.000Z",
        updated_at: "2026-06-01T00:00:00.000Z",
      },
      filingInsertCount: 0,
    };
    const result = await completeBbbOperatorFiling(createBbbCompleteSupabase(state), USER_ID, {
      caseId: CASE_ID,
      taskId: TASK_ID,
      destination: "Better Business Bureau",
      filedAt: "2026-06-15",
      confirmationNumber: "",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/confirmation/i);
    }
    expect(state.filings).toHaveLength(0);
    expect(state.task.completed_at).toBeNull();
  });

  it("records filing through the existing BBB completion path after portal confirmation", async () => {
    const marker = bbbFilingTaskNotesMarker(CASE_ID);
    const workspace = buildBbbOperatorFilingWorkspace({ intake: bbbIntake() });
    const state: MockCaseState = {
      intake: bbbIntake(),
      client_state: {
        prepared_packet_approved: true,
        approved_next_action: {
          label: "Better Business Bureau",
          href: MANUAL_ACTION_TRACKING_REAL_BBB_PREP_HREF,
          status: "approved",
        },
      },
      filings: [],
      task: {
        id: TASK_ID,
        user_id: USER_ID,
        case_id: CASE_ID,
        title: "BBB filing: Acme Retail",
        due_date: null,
        notes: `${marker}\ncase_id: ${CASE_ID}\ndraft:\nComplaint`,
        completed_at: null,
        created_at: "2026-06-01T00:00:00.000Z",
        updated_at: "2026-06-01T00:00:00.000Z",
      },
      filingInsertCount: 0,
    };

    expect(workspace.is_submitted).toBe(false);

    const result = await completeBbbOperatorFiling(createBbbCompleteSupabase(state), USER_ID, {
      caseId: CASE_ID,
      taskId: TASK_ID,
      destination: workspace.filing_destination,
      filedAt: "2026-06-15",
      confirmationNumber: "BBB-998877",
      notes: "Filed via guided workspace fallback",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.filing.confirmation_number).toBe("BBB-998877");
    expect(result.filing.destination).toBe("Better Business Bureau");
    expect(result.task.completed_at).toBeTruthy();
    expect(shouldQueueBbbFilingTask(state.client_state)).toBe(false);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildJusticeIntakeFromParts, defaultBuildJusticeIntakeParts } from "@/lib/justice/buildJusticeIntake";
import {
  demandLetterFilingTaskNotesMarker,
  taskNotesMatchDemandLetterFilingMarker,
} from "@/lib/justice/demandLetterFilingTask";
import {
  ensureOwnedFilingTaskAfterClientStateWrite,
  OWNED_FILING_TASK_ENSURE_RETRYABLE_ERROR,
  resolveRequiredOwnedFilingTaskKind,
} from "@/lib/justice/ensureOwnedFilingTaskAfterClientStateWrite";
import {
  MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF,
  MANUAL_ACTION_TRACKING_REAL_PAYMENT_DISPUTE_PREP_HREF,
} from "@/lib/justice/handlingTrackingProgress";
import {
  taskNotesMatchPaymentDisputeFilingMarker,
} from "@/lib/justice/paymentDisputeFilingTask";
import {
  taskNotesMatchStateAgFilingMarker,
} from "@/lib/justice/stateAgFilingTask";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";
import type { JusticeIntake, TimelineEntry } from "@/lib/justice/types";

const CASE_ID = "550e8400-e29b-41d4-a716-446655440000";
const USER_ID = "user-owner-1";

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

const paymentDisputeEmailAfterEnsure = vi.hoisted(() =>
  vi.fn(
    async (
      _supabase: SupabaseClient,
      _userId: string,
      _caseId: string,
      timeline: TimelineEntry[] | null
    ): Promise<{
      timeline: TimelineEntry[] | null;
      result:
        | { status: "skipped"; reason: string }
        | { status: "failed"; recipient: string; error: string }
        | { status: "accepted"; messageId: string; recipient: string; idempotent: boolean };
    }> => ({ timeline, result: { status: "skipped" as const, reason: "mocked" } })
  )
);

vi.mock("@/lib/justice/paymentDisputeEmailDelivery", () => ({
  attemptAutomatedPaymentDisputeEmailDeliveryAfterEnsure: (
    ...args: Parameters<typeof paymentDisputeEmailAfterEnsure>
  ) => paymentDisputeEmailAfterEnsure(...args),
}));

import { attemptAutomatedDemandLetterEmailDeliveryAfterEnsure } from "@/lib/justice/demandLetterEmailDelivery";

type MockState = {
  tasks: JusticeCaseTaskRow[];
  insertCount: number;
  insertFail: boolean;
};

function createTaskSupabase(state: MockState): SupabaseClient {
  return {
    from: (table: string) => {
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
      if (table !== "justice_case_tasks") {
        throw new Error(`unexpected table ${table}`);
      }
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              like: (_column: string, pattern: string) => ({
                limit: async () => {
                  const prefix = String(pattern).replace(/%$/, "");
                  const matched = state.tasks.filter((task) =>
                    (task.notes ?? "").startsWith(prefix)
                  );
                  return { data: matched.slice(0, 1), error: null };
                },
              }),
            }),
          }),
        }),
        insert: (row: Record<string, unknown>) => ({
          select: () => ({
            single: async () => {
              if (state.insertFail) {
                return { data: null, error: { message: "insert failed" } };
              }
              state.insertCount += 1;
              const task: JusticeCaseTaskRow = {
                id: `owned-${state.insertCount}`,
                user_id: USER_ID,
                case_id: CASE_ID,
                title: String(row.title ?? ""),
                due_date: typeof row.due_date === "string" ? row.due_date : null,
                notes: typeof row.notes === "string" ? row.notes : null,
                completed_at: null,
                created_at: "2026-07-17T12:00:00.000Z",
                updated_at: "2026-07-17T12:00:00.000Z",
              };
              state.tasks = [...state.tasks, task];
              return { data: task, error: null };
            },
          }),
        }),
      };
    },
  } as unknown as SupabaseClient;
}

function intake(): JusticeIntake {
  return buildJusticeIntakeFromParts({
    ...defaultBuildJusticeIntakeParts(),
    problem_category: "online_purchase",
    company_name: "Acme Retail",
    purchase_or_signup: "widget",
    story: "Never arrived.",
    money_amount: "$50.00",
    already_contacted: "yes",
    contact_method: "email",
    contact_date: "2026-01-15",
    merchant_response_type: "refused_help",
    user_display_name: "Jordan Lee",
    reply_email: "e2e@example.com",
    consumer_us_state: "CA",
  });
}

describe("resolveRequiredOwnedFilingTaskKind", () => {
  it("resolves State AG, demand letter, and payment dispute from approved client_state", () => {
    expect(
      resolveRequiredOwnedFilingTaskKind({
        prepared_packet_approved: true,
        approved_next_action: {
          href: "/justice/state-ag",
          status: "approved",
        },
      })
    ).toBe("state_ag");
    expect(
      resolveRequiredOwnedFilingTaskKind({
        prepared_packet_approved: true,
        approved_next_action: {
          href: MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF,
          status: "approved",
        },
      })
    ).toBe("demand_letter");
    expect(
      resolveRequiredOwnedFilingTaskKind({
        prepared_packet_approved: true,
        approved_next_action: {
          href: MANUAL_ACTION_TRACKING_REAL_PAYMENT_DISPUTE_PREP_HREF,
          status: "approved",
        },
      })
    ).toBe("payment_dispute");
    expect(
      resolveRequiredOwnedFilingTaskKind({
        prepared_packet_approved: true,
        approved_next_action: {
          href: MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF,
          status: "completed",
        },
      })
    ).toBeNull();
  });
});

describe("ensureOwnedFilingTaskAfterClientStateWrite", () => {
  beforeEach(() => {
    timelineStore.entries = [];
    paymentDisputeEmailAfterEnsure.mockClear();
    paymentDisputeEmailAfterEnsure.mockImplementation(
      async (
        _supabase: SupabaseClient,
        _userId: string,
        _caseId: string,
        timeline: TimelineEntry[] | null
      ) => ({ timeline, result: { status: "skipped" as const, reason: "mocked" } })
    );
    vi.mocked(attemptAutomatedDemandLetterEmailDeliveryAfterEnsure).mockClear();
  });

  it("creates a demand-letter task when client_state advances to demand letter", async () => {
    const state: MockState = { tasks: [], insertCount: 0, insertFail: false };
    const clientState = {
      prepared_packet_approved: true,
      approved_next_action: {
        label: "Small claims / demand letter",
        href: MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF,
        status: "approved" as const,
      },
    };

    const result = await ensureOwnedFilingTaskAfterClientStateWrite(createTaskSupabase(state), {
      userId: USER_ID,
      caseId: CASE_ID,
      clientState,
      intake: intake(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.kind).toBe("demand_letter");
    expect(result.created).toBe(true);
    expect(state.insertCount).toBe(1);
    expect(taskNotesMatchDemandLetterFilingMarker(state.tasks[0].notes, CASE_ID)).toBe(true);
    expect(paymentDisputeEmailAfterEnsure).not.toHaveBeenCalled();
  });

  it("creates a payment-dispute task and attempts automated email after ensure", async () => {
    const state: MockState = { tasks: [], insertCount: 0, insertFail: false };
    const clientState = {
      prepared_packet_approved: true,
      approved_next_action: {
        label: "Payment dispute",
        href: MANUAL_ACTION_TRACKING_REAL_PAYMENT_DISPUTE_PREP_HREF,
        status: "approved" as const,
      },
    };

    const result = await ensureOwnedFilingTaskAfterClientStateWrite(createTaskSupabase(state), {
      userId: USER_ID,
      caseId: CASE_ID,
      clientState,
      intake: intake(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.kind).toBe("payment_dispute");
    expect(result.created).toBe(true);
    expect(taskNotesMatchPaymentDisputeFilingMarker(state.tasks[0].notes, CASE_ID)).toBe(true);
    expect(paymentDisputeEmailAfterEnsure).toHaveBeenCalledTimes(1);
    expect(paymentDisputeEmailAfterEnsure).toHaveBeenCalledWith(
      expect.anything(),
      USER_ID,
      CASE_ID,
      expect.anything()
    );
    // Email skip/failure must not invent ensure failure.
    expect(result.ok).toBe(true);
  });

  it("skips payment-dispute email when attemptPaymentDisputeEmail is false", async () => {
    const state: MockState = { tasks: [], insertCount: 0, insertFail: false };
    const result = await ensureOwnedFilingTaskAfterClientStateWrite(createTaskSupabase(state), {
      userId: USER_ID,
      caseId: CASE_ID,
      clientState: {
        prepared_packet_approved: true,
        approved_next_action: {
          href: MANUAL_ACTION_TRACKING_REAL_PAYMENT_DISPUTE_PREP_HREF,
          status: "approved",
        },
      },
      intake: intake(),
      attemptPaymentDisputeEmail: false,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.kind).toBe("payment_dispute");
    expect(paymentDisputeEmailAfterEnsure).not.toHaveBeenCalled();
  });

  it("still succeeds when payment-dispute email attempt reports failed", async () => {
    paymentDisputeEmailAfterEnsure.mockImplementation(
      async (
        _supabase: SupabaseClient,
        _userId: string,
        _caseId: string,
        timeline: TimelineEntry[] | null
      ) => ({
        timeline,
        result: { status: "failed" as const, recipient: "bank@example.com", error: "smtp down" },
      })
    );
    const state: MockState = { tasks: [], insertCount: 0, insertFail: false };
    const result = await ensureOwnedFilingTaskAfterClientStateWrite(createTaskSupabase(state), {
      userId: USER_ID,
      caseId: CASE_ID,
      clientState: {
        prepared_packet_approved: true,
        approved_next_action: {
          href: MANUAL_ACTION_TRACKING_REAL_PAYMENT_DISPUTE_PREP_HREF,
          status: "approved",
        },
      },
      intake: intake(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.kind).toBe("payment_dispute");
    expect(result.task).toBeTruthy();
    expect(paymentDisputeEmailAfterEnsure).toHaveBeenCalledTimes(1);
  });

  it("creates a State AG task when client_state advances to State AG (BBB → AG handoff)", async () => {
    const state: MockState = { tasks: [], insertCount: 0, insertFail: false };
    const clientState = {
      prepared_packet_approved: true,
      approved_next_action: {
        label: "State Attorney General (consumer)",
        href: "/justice/state-ag",
        status: "approved" as const,
      },
    };

    const result = await ensureOwnedFilingTaskAfterClientStateWrite(createTaskSupabase(state), {
      userId: USER_ID,
      caseId: CASE_ID,
      clientState,
      intake: intake(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.kind).toBe("state_ag");
    expect(result.created).toBe(true);
    expect(taskNotesMatchStateAgFilingMarker(state.tasks[0].notes, CASE_ID)).toBe(true);
    expect(paymentDisputeEmailAfterEnsure).not.toHaveBeenCalled();
  });

  it("is idempotent when the marker task already exists", async () => {
    const marker = demandLetterFilingTaskNotesMarker(CASE_ID);
    const existing: JusticeCaseTaskRow = {
      id: "existing-dl",
      user_id: USER_ID,
      case_id: CASE_ID,
      title: "Demand letter: Acme Retail",
      due_date: null,
      notes: marker,
      completed_at: null,
      created_at: "2026-07-01T00:00:00.000Z",
      updated_at: "2026-07-01T00:00:00.000Z",
    };
    const state: MockState = { tasks: [existing], insertCount: 0, insertFail: false };
    const result = await ensureOwnedFilingTaskAfterClientStateWrite(createTaskSupabase(state), {
      userId: USER_ID,
      caseId: CASE_ID,
      clientState: {
        prepared_packet_approved: true,
        approved_next_action: {
          href: MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF,
          status: "approved",
        },
      },
      intake: intake(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.created).toBe(false);
    expect(result.task?.id).toBe("existing-dl");
    expect(state.insertCount).toBe(0);
  });

  it("returns retriable failure when ensure cannot create the required task", async () => {
    const state: MockState = { tasks: [], insertCount: 0, insertFail: true };
    const result = await ensureOwnedFilingTaskAfterClientStateWrite(createTaskSupabase(state), {
      userId: USER_ID,
      caseId: CASE_ID,
      clientState: {
        prepared_packet_approved: true,
        approved_next_action: {
          href: "/justice/state-ag",
          status: "approved",
        },
      },
      intake: intake(),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe(OWNED_FILING_TASK_ENSURE_RETRYABLE_ERROR);
    expect(result.kind).toBe("state_ag");
    expect(state.tasks).toHaveLength(0);
    expect(paymentDisputeEmailAfterEnsure).not.toHaveBeenCalled();
  });

  it("does nothing when no owned filing step is required", async () => {
    const state: MockState = { tasks: [], insertCount: 0, insertFail: false };
    const result = await ensureOwnedFilingTaskAfterClientStateWrite(createTaskSupabase(state), {
      userId: USER_ID,
      caseId: CASE_ID,
      clientState: {
        prepared_packet_approved: true,
        approved_next_action: {
          href: MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF,
          status: "completed",
        },
      },
      intake: intake(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.kind).toBeNull();
    expect(state.insertCount).toBe(0);
    expect(paymentDisputeEmailAfterEnsure).not.toHaveBeenCalled();
  });
});

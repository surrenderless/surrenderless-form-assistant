import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { EmailSendRequest, EmailSendResult } from "@/lib/email/emailProvider";
import { buildJusticeIntakeFromParts, defaultBuildJusticeIntakeParts } from "@/lib/justice/buildJusticeIntake";
import { demandLetterFilingTaskNotesMarker } from "@/lib/justice/demandLetterFilingTask";
import {
  MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF,
  MANUAL_ACTION_TRACKING_REAL_MERCHANT_PREP_HREF,
} from "@/lib/justice/handlingTrackingProgress";
import { merchantContactFilingTaskNotesMarker as merchantContactMarker } from "@/lib/justice/merchantContactFilingTask";
import { hasRecipientRequiredReminderBeenSent } from "@/lib/justice/recipientRequiredReminderState";
import { keysetPaginatedTerminal } from "@/lib/justice/reconcilerKeysetPaginationTestSupport";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";
import type { JusticeIntake } from "@/lib/justice/types";

type ProviderResolution =
  | { ok: true; provider: { name: string; send: (r: EmailSendRequest) => Promise<EmailSendResult> }; from: string }
  | { ok: false; reason: string };

let providerResolution: ProviderResolution;
const send = vi.fn(
  async (req: EmailSendRequest): Promise<EmailSendResult> => ({
    ok: true,
    messageId: `msg_${req.idempotencyKey}`,
  })
);

vi.mock("@/lib/email/resolveMerchantOutreachEmailProvider", () => ({
  resolveMerchantOutreachEmailProvider: () => providerResolution,
}));

import { reconcileRecipientRequiredConsumerReminders } from "@/lib/justice/reconcileRecipientRequiredConsumerReminders";

const CASE_ID = "550e8400-e29b-41d4-a716-446655440000";
const CASE_ID_2 = "550e8400-e29b-41d4-a716-446655440001";
const USER_ID = "user-owner-1";
const NOW = Date.parse("2026-02-01T00:00:00.000Z");
const STALE_CREATED_AT = new Date(NOW - 25 * 60 * 60 * 1000).toISOString();
const FRESH_CREATED_AT = new Date(NOW - 1 * 60 * 60 * 1000).toISOString();

type CaseRow = {
  id: string;
  user_id: string;
  intake: JusticeIntake;
  client_state: unknown;
  archived_at: string | null;
  updated_at: string;
};

type MockState = {
  cases: CaseRow[];
  tasks: JusticeCaseTaskRow[];
  failTaskSelectForCaseId?: string;
  failUpdate?: boolean;
};

function intakeWithRecipient(overrides: Partial<JusticeIntake> = {}): JusticeIntake {
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
    reply_email: "consumer@example.com",
    consumer_us_state: "CA",
    company_contact_email: "",
    ...overrides,
  });
}

function merchantContactClientState(opts: { status?: string; fallback?: boolean } = {}) {
  return {
    prepared_packet_approved: true,
    approved_next_action: {
      href: MANUAL_ACTION_TRACKING_REAL_MERCHANT_PREP_HREF,
      status: opts.status ?? "approved",
    },
    ...(opts.fallback ? { merchant_contact_operator_fallback: true } : {}),
  };
}

function demandLetterClientState(opts: { status?: string; fallback?: boolean } = {}) {
  return {
    prepared_packet_approved: true,
    approved_next_action: {
      href: MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF,
      status: opts.status ?? "approved",
    },
    ...(opts.fallback ? { merchant_contact_operator_fallback: true } : {}),
  };
}

function createSupabase(state: MockState): SupabaseClient {
  return {
    from: (table: string) => {
      if (table === "justice_cases") {
        return {
          select: () => ({
            is: () => keysetPaginatedTerminal(() => state.cases.filter((c) => !c.archived_at?.trim())),
          }),
        };
      }
      if (table === "justice_case_tasks") {
        return {
          select: () => ({
            eq: (_c1: string, userId: string) => ({
              eq: (_c2: string, caseId: string) => ({
                is: async () => {
                  if (state.failTaskSelectForCaseId === caseId) {
                    return { data: null, error: { message: "select down" } };
                  }
                  const matched = state.tasks.filter(
                    (t) => t.user_id === userId && t.case_id === caseId && !t.completed_at?.trim()
                  );
                  return { data: matched, error: null };
                },
              }),
            }),
          }),
          update: (payload: Record<string, unknown>) => ({
            eq: (_c1: string, taskId: string) => ({
              eq: async (_c2: string, userId: string) => {
                if (state.failUpdate) return { data: null, error: { message: "update down" } };
                const task = state.tasks.find((t) => t.id === taskId && t.user_id === userId);
                if (task) task.notes = String(payload.notes);
                return { data: null, error: null };
              },
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  } as unknown as SupabaseClient;
}

function merchantTask(overrides: Partial<JusticeCaseTaskRow> = {}): JusticeCaseTaskRow {
  return {
    id: "merchant-task-1",
    user_id: USER_ID,
    case_id: CASE_ID,
    title: "Merchant contact: Acme Retail",
    due_date: null,
    notes: merchantContactMarker(CASE_ID),
    completed_at: null,
    created_at: STALE_CREATED_AT,
    updated_at: STALE_CREATED_AT,
    ...overrides,
  };
}

function demandLetterTask(overrides: Partial<JusticeCaseTaskRow> = {}): JusticeCaseTaskRow {
  return {
    id: "demand-letter-task-1",
    user_id: USER_ID,
    case_id: CASE_ID,
    title: "Demand letter: Acme Retail",
    due_date: null,
    notes: demandLetterFilingTaskNotesMarker(CASE_ID),
    completed_at: null,
    created_at: STALE_CREATED_AT,
    updated_at: STALE_CREATED_AT,
    ...overrides,
  };
}

describe("reconcileRecipientRequiredConsumerReminders", () => {
  beforeEach(() => {
    send.mockClear();
    providerResolution = { ok: true, provider: { name: "mock", send }, from: "outreach@surrenderless.test" };
  });

  it("sends one reminder for a stale, recipient-missing merchant-contact action", async () => {
    const state: MockState = {
      cases: [
        {
          id: CASE_ID,
          user_id: USER_ID,
          intake: intakeWithRecipient(),
          client_state: merchantContactClientState(),
          archived_at: null,
          updated_at: STALE_CREATED_AT,
        },
      ],
      tasks: [merchantTask()],
    };

    const summary = await reconcileRecipientRequiredConsumerReminders(createSupabase(state), { nowMs: NOW });

    expect(summary.sent).toBe(1);
    expect(summary.attempted).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].to).toBe("consumer@example.com");
    expect(send.mock.calls[0][0].idempotencyKey).toBe("recipient-required-reminder:merchant-task-1");
    expect(hasRecipientRequiredReminderBeenSent(state.tasks[0].notes, "merchant-task-1")).toBe(true);
  });

  it("sends one reminder for a stale, recipient-missing demand-letter action", async () => {
    const state: MockState = {
      cases: [
        {
          id: CASE_ID,
          user_id: USER_ID,
          intake: intakeWithRecipient(),
          client_state: demandLetterClientState(),
          archived_at: null,
          updated_at: STALE_CREATED_AT,
        },
      ],
      tasks: [demandLetterTask()],
    };

    const summary = await reconcileRecipientRequiredConsumerReminders(createSupabase(state), { nowMs: NOW });

    expect(summary.sent).toBe(1);
    expect(send.mock.calls[0][0].to).toBe("consumer@example.com");
  });

  it("does not remind before the 24h threshold", async () => {
    const state: MockState = {
      cases: [
        {
          id: CASE_ID,
          user_id: USER_ID,
          intake: intakeWithRecipient(),
          client_state: merchantContactClientState(),
          archived_at: null,
          updated_at: FRESH_CREATED_AT,
        },
      ],
      tasks: [merchantTask({ created_at: FRESH_CREATED_AT, updated_at: FRESH_CREATED_AT })],
    };

    const summary = await reconcileRecipientRequiredConsumerReminders(createSupabase(state), { nowMs: NOW });

    expect(summary.sent).toBe(0);
    expect(summary.skipped).toBe(1);
    expect(summary.results[0].reason).toBe("not_yet_stale");
    expect(send).not.toHaveBeenCalled();
  });

  it("is idempotent — a second run sends nothing more once already reminded", async () => {
    const state: MockState = {
      cases: [
        {
          id: CASE_ID,
          user_id: USER_ID,
          intake: intakeWithRecipient(),
          client_state: merchantContactClientState(),
          archived_at: null,
          updated_at: STALE_CREATED_AT,
        },
      ],
      tasks: [merchantTask()],
    };

    const first = await reconcileRecipientRequiredConsumerReminders(createSupabase(state), { nowMs: NOW });
    expect(first.sent).toBe(1);

    const second = await reconcileRecipientRequiredConsumerReminders(createSupabase(state), { nowMs: NOW });
    expect(second.sent).toBe(0);
    expect(second.results[0].reason).toBe("already_reminded");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("sends nothing once the recipient has been supplied (live re-check)", async () => {
    const state: MockState = {
      cases: [
        {
          id: CASE_ID,
          user_id: USER_ID,
          intake: intakeWithRecipient({ company_contact_email: "billing@acme.example.com" }),
          client_state: merchantContactClientState(),
          archived_at: null,
          updated_at: STALE_CREATED_AT,
        },
      ],
      tasks: [merchantTask()],
    };

    const summary = await reconcileRecipientRequiredConsumerReminders(createSupabase(state), { nowMs: NOW });

    expect(summary.sent).toBe(0);
    expect(summary.attempted).toBe(0);
    expect(summary.results).toHaveLength(0);
    expect(send).not.toHaveBeenCalled();
  });

  it("sends nothing once operator fallback has been chosen", async () => {
    const state: MockState = {
      cases: [
        {
          id: CASE_ID,
          user_id: USER_ID,
          intake: intakeWithRecipient(),
          client_state: merchantContactClientState({ fallback: true }),
          archived_at: null,
          updated_at: STALE_CREATED_AT,
        },
      ],
      tasks: [merchantTask()],
    };

    const summary = await reconcileRecipientRequiredConsumerReminders(createSupabase(state), { nowMs: NOW });

    expect(summary.sent).toBe(0);
    expect(summary.results).toHaveLength(0);
    expect(send).not.toHaveBeenCalled();
  });

  it("ignores a completed approved_next_action", async () => {
    const state: MockState = {
      cases: [
        {
          id: CASE_ID,
          user_id: USER_ID,
          intake: intakeWithRecipient(),
          client_state: merchantContactClientState({ status: "completed" }),
          archived_at: null,
          updated_at: STALE_CREATED_AT,
        },
      ],
      tasks: [merchantTask({ completed_at: STALE_CREATED_AT })],
    };

    const summary = await reconcileRecipientRequiredConsumerReminders(createSupabase(state), { nowMs: NOW });

    expect(summary.sent).toBe(0);
    expect(summary.results).toHaveLength(0);
    expect(send).not.toHaveBeenCalled();
  });

  it("skips when no open anchor task exists yet", async () => {
    const state: MockState = {
      cases: [
        {
          id: CASE_ID,
          user_id: USER_ID,
          intake: intakeWithRecipient(),
          client_state: merchantContactClientState(),
          archived_at: null,
          updated_at: STALE_CREATED_AT,
        },
      ],
      tasks: [],
    };

    const summary = await reconcileRecipientRequiredConsumerReminders(createSupabase(state), { nowMs: NOW });

    expect(summary.sent).toBe(0);
    expect(summary.skipped).toBe(1);
    expect(summary.results[0].reason).toBe("no_open_task");
  });

  it("reports failure for a case with invalid intake", async () => {
    const state: MockState = {
      cases: [
        {
          id: CASE_ID,
          user_id: USER_ID,
          intake: { not: "an intake" } as unknown as JusticeIntake,
          client_state: merchantContactClientState(),
          archived_at: null,
          updated_at: STALE_CREATED_AT,
        },
      ],
      tasks: [merchantTask()],
    };

    const summary = await reconcileRecipientRequiredConsumerReminders(createSupabase(state), { nowMs: NOW });

    expect(summary.failed).toBe(1);
    expect(summary.results[0].reason).toBe("invalid_intake");
    expect(send).not.toHaveBeenCalled();
  });

  it("reports failure when the consumer's own reply_email cannot be resolved", async () => {
    const state: MockState = {
      cases: [
        {
          id: CASE_ID,
          user_id: USER_ID,
          intake: intakeWithRecipient({ reply_email: "" }),
          client_state: merchantContactClientState(),
          archived_at: null,
          updated_at: STALE_CREATED_AT,
        },
      ],
      tasks: [merchantTask()],
    };

    const summary = await reconcileRecipientRequiredConsumerReminders(createSupabase(state), { nowMs: NOW });

    expect(summary.failed).toBe(1);
    expect(summary.results[0].reason).toBe("consumer_recipient_unresolved");
    expect(send).not.toHaveBeenCalled();
  });

  it("does not mark sent when the provider send fails, so the next run can retry", async () => {
    send.mockResolvedValueOnce({ ok: false, error: "boom", retryable: true });
    const state: MockState = {
      cases: [
        {
          id: CASE_ID,
          user_id: USER_ID,
          intake: intakeWithRecipient(),
          client_state: merchantContactClientState(),
          archived_at: null,
          updated_at: STALE_CREATED_AT,
        },
      ],
      tasks: [merchantTask()],
    };

    const summary = await reconcileRecipientRequiredConsumerReminders(createSupabase(state), { nowMs: NOW });

    expect(summary.failed).toBe(1);
    expect(hasRecipientRequiredReminderBeenSent(state.tasks[0].notes, "merchant-task-1")).toBe(false);
  });

  it("sends nothing and marks nothing when the email provider is unavailable", async () => {
    providerResolution = { ok: false, reason: "no api key" };
    const state: MockState = {
      cases: [
        {
          id: CASE_ID,
          user_id: USER_ID,
          intake: intakeWithRecipient(),
          client_state: merchantContactClientState(),
          archived_at: null,
          updated_at: STALE_CREATED_AT,
        },
      ],
      tasks: [merchantTask()],
    };

    const summary = await reconcileRecipientRequiredConsumerReminders(createSupabase(state), { nowMs: NOW });

    expect(summary).toEqual({ scanned: 0, attempted: 0, sent: 0, skipped: 0, failed: 0, results: [] });
    expect(send).not.toHaveBeenCalled();
  });

  it("reaches and processes an eligible case beyond the first page", async () => {
    const ineligible = { approved_next_action: { status: "completed" } };
    const cases: CaseRow[] = Array.from({ length: 5 }, (_, i) => ({
      id: `case-page-${i}`,
      user_id: USER_ID,
      intake: intakeWithRecipient(),
      client_state: ineligible,
      archived_at: null,
      updated_at: `2026-01-0${i + 1}T12:00:00.000Z`,
    }));
    cases[4].client_state = merchantContactClientState();
    const state: MockState = {
      cases,
      tasks: [
        merchantTask({
          case_id: "case-page-4",
          id: "merchant-task-page-4",
          notes: merchantContactMarker("case-page-4"),
        }),
      ],
    };

    const summary = await reconcileRecipientRequiredConsumerReminders(createSupabase(state), {
      nowMs: NOW,
      limit: 2,
    });

    expect(summary.scanned).toBe(5);
    expect(summary.sent).toBe(1);
    expect(send.mock.calls[0][0].idempotencyKey).toBe("recipient-required-reminder:merchant-task-page-4");
  });

  it("propagates a task-lookup failure as a failed result", async () => {
    const state: MockState = {
      cases: [
        {
          id: CASE_ID,
          user_id: USER_ID,
          intake: intakeWithRecipient(),
          client_state: merchantContactClientState(),
          archived_at: null,
          updated_at: STALE_CREATED_AT,
        },
      ],
      tasks: [merchantTask()],
      failTaskSelectForCaseId: CASE_ID,
    };

    const summary = await reconcileRecipientRequiredConsumerReminders(createSupabase(state), { nowMs: NOW });

    expect(summary.failed).toBe(1);
    expect(summary.results[0].reason).toBe("list_tasks_failed");
    expect(send).not.toHaveBeenCalled();
  });

  it("skips a second, unrelated case with no approved next action", async () => {
    const state: MockState = {
      cases: [
        {
          id: CASE_ID,
          user_id: USER_ID,
          intake: intakeWithRecipient(),
          client_state: merchantContactClientState(),
          archived_at: null,
          updated_at: STALE_CREATED_AT,
        },
        {
          id: CASE_ID_2,
          user_id: USER_ID,
          intake: intakeWithRecipient(),
          client_state: {},
          archived_at: null,
          updated_at: "2026-01-15T00:00:00.000Z",
        },
      ],
      tasks: [merchantTask()],
    };

    const summary = await reconcileRecipientRequiredConsumerReminders(createSupabase(state), { nowMs: NOW });

    expect(summary.scanned).toBe(2);
    expect(summary.sent).toBe(1);
  });
});

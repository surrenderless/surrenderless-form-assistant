import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { EmailProvider } from "@/lib/email/emailProvider";
import { createMockMerchantOutreachEmailProvider } from "@/lib/email/resolveMerchantOutreachEmailProvider";
import {
  buildMerchantOutreachEmailSubject,
  isMerchantContactEmailFailed,
  isMerchantContactEmailSending,
  merchantContactEmailBounceState,
  merchantContactEmailIdempotencyKey,
  parseMerchantContactEmailDeliveryRecord,
  recordMerchantContactEmailBounceEvent,
  resolveMerchantOutreachRecipientEmail,
  upsertMerchantContactEmailDeliveryNotes,
} from "@/lib/justice/merchantContactEmailDelivery";
import type { JusticeIntake } from "@/lib/justice/types";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";
import {
  isValidMerchantOutreachEmailAddress,
  resolveMerchantOutreachEmailEnv,
} from "@/lib/email/merchantOutreachEmailEnv";
import { MANUAL_ACTION_TRACKING_REAL_MERCHANT_PREP_HREF } from "@/lib/justice/handlingTrackingProgress";

vi.mock("@/lib/justice/merchantContactFilingTask", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/justice/merchantContactFilingTask")>();
  return { ...actual, reopenMerchantContactFilingTaskForBounce: vi.fn() };
});

vi.mock("@/lib/justice/followUpCaseTask", () => ({
  completeFollowUpCaseTaskIfOwnedByAction: vi.fn(),
}));

import { reopenMerchantContactFilingTaskForBounce } from "@/lib/justice/merchantContactFilingTask";
import { completeFollowUpCaseTaskIfOwnedByAction } from "@/lib/justice/followUpCaseTask";

const baseIntake = (): JusticeIntake => ({
  problem_category: "online_purchase",
  company_name: "Acme Retail",
  company_website: "https://acme.example",
  purchase_or_signup: "widget",
  story: "Never arrived",
  money_involved: "$50",
  pay_or_order_date: "2026-01-01",
  order_confirmation_details: "ORD-1",
  user_display_name: "Pat Consumer",
  reply_email: "pat@example.com",
  already_contacted: "no",
});

describe("merchantContactEmailDelivery helpers", () => {
  it("resolves company_contact_email only when valid", () => {
    expect(resolveMerchantOutreachRecipientEmail(baseIntake())).toBeNull();
    expect(
      resolveMerchantOutreachRecipientEmail({
        ...baseIntake(),
        company_contact_email: "support@acme.example",
      })
    ).toBe("support@acme.example");
    expect(
      resolveMerchantOutreachRecipientEmail({
        ...baseIntake(),
        company_contact_email: "not-an-email",
      })
    ).toBeNull();
  });

  it("round-trips delivery records in task notes without dropping the draft", () => {
    const notes = `merchant_contact_queue:case-1\ndraft:\nHello company`;
    const withSending = upsertMerchantContactEmailDeliveryNotes(notes, {
      delivery_state: "sending",
      provider: "resend",
      recipient: "support@acme.example",
      sent_at: "2026-07-14T12:00:00.000Z",
    });
    expect(withSending).toContain("draft:\nHello company");
    expect(parseMerchantContactEmailDeliveryRecord(withSending)).toEqual({
      delivery_state: "sending",
      provider: "resend",
      recipient: "support@acme.example",
      sent_at: "2026-07-14T12:00:00.000Z",
    });

    const withFailed = upsertMerchantContactEmailDeliveryNotes(withSending, {
      delivery_state: "failed",
      provider: "resend",
      recipient: "support@acme.example",
      sent_at: "2026-07-14T12:01:00.000Z",
      failure_detail: "mailbox unavailable",
    });
    expect(parseMerchantContactEmailDeliveryRecord(withFailed)?.delivery_state).toBe("failed");
    expect(withFailed).toContain("Hello company");
  });

  it("detects sending and failed states on open tasks", () => {
    const sendingTask: JusticeCaseTaskRow = {
      id: "t1",
      user_id: "u1",
      case_id: "c1",
      title: "Merchant contact",
      due_date: null,
      notes: upsertMerchantContactEmailDeliveryNotes("marker", {
        delivery_state: "sending",
        provider: "resend",
        recipient: "a@b.co",
      }),
      completed_at: null,
      created_at: "2026-07-14T00:00:00.000Z",
      updated_at: "2026-07-14T00:00:00.000Z",
    };
    expect(isMerchantContactEmailSending(sendingTask)).toBe(true);
    expect(isMerchantContactEmailFailed(sendingTask)).toBe(false);

    const failedTask = {
      ...sendingTask,
      notes: upsertMerchantContactEmailDeliveryNotes(sendingTask.notes, {
        delivery_state: "failed",
        provider: "resend",
        recipient: "a@b.co",
        failure_detail: "bounce",
      }),
    };
    expect(isMerchantContactEmailSending(failedTask)).toBe(false);
    expect(isMerchantContactEmailFailed(failedTask)).toBe(true);
  });

  it("builds a stable subject and idempotency key", () => {
    expect(buildMerchantOutreachEmailSubject(baseIntake())).toContain("Acme Retail");
    expect(merchantContactEmailIdempotencyKey("  case-uuid  ")).toBe(
      "merchant-contact-email:case-uuid"
    );
  });
});

describe("merchantOutreachEmailEnv", () => {
  it("validates email addresses", () => {
    expect(isValidMerchantOutreachEmailAddress("a@b.co")).toBe(true);
    expect(isValidMerchantOutreachEmailAddress("nope")).toBe(false);
  });

  it("disables provider when required env is missing", () => {
    const prevKey = process.env.RESEND_API_KEY;
    const prevFrom = process.env.MERCHANT_OUTREACH_FROM_EMAIL;
    const prevEnabled = process.env.MERCHANT_OUTREACH_EMAIL_ENABLED;
    delete process.env.RESEND_API_KEY;
    delete process.env.MERCHANT_OUTREACH_FROM_EMAIL;
    delete process.env.MERCHANT_OUTREACH_EMAIL_ENABLED;
    expect(resolveMerchantOutreachEmailEnv().enabled).toBe(false);
    process.env.RESEND_API_KEY = prevKey;
    process.env.MERCHANT_OUTREACH_FROM_EMAIL = prevFrom;
    process.env.MERCHANT_OUTREACH_EMAIL_ENABLED = prevEnabled;
  });
});

describe("mock merchant outreach email provider", () => {
  it("returns deterministic message ids and can force failure", async () => {
    const provider: EmailProvider = createMockMerchantOutreachEmailProvider();
    const ok = await provider.send({
      from: "from@test",
      to: "support@acme.example",
      subject: "Hi",
      text: "Body",
      idempotencyKey: "merchant-contact-email:case-1",
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.messageId).toContain("mock_resend_");
    }

    const failed = await provider.send({
      from: "from@test",
      to: "fail-delivery@acme.example",
      subject: "Hi",
      text: "Body",
      idempotencyKey: "k1",
    });
    expect(failed.ok).toBe(false);
  });
});

describe("recordMerchantContactEmailBounceEvent", () => {
  const CASE_ID = "case-mc-1";
  const USER_ID = "user-mc-1";

  beforeEach(() => {
    vi.mocked(reopenMerchantContactFilingTaskForBounce).mockResolvedValue({
      task: null,
      timeline: null,
      reopened: true,
    });
    vi.mocked(completeFollowUpCaseTaskIfOwnedByAction).mockResolvedValue({
      task: null,
      timeline: null,
      completed: true,
      skippedNotOwned: false,
      error: false,
    });
  });

  afterEach(() => {
    vi.mocked(reopenMerchantContactFilingTaskForBounce).mockReset();
    vi.mocked(completeFollowUpCaseTaskIfOwnedByAction).mockReset();
  });

  function makeBounceSupabase(filingNotes: string) {
    const filing = { id: "filing-1", user_id: USER_ID, case_id: CASE_ID, notes: filingNotes };
    const caseRow = { id: CASE_ID, user_id: USER_ID, timeline: [] as unknown[] };

    return {
      from(table: string) {
        if (table === "justice_case_filings") {
          return {
            select: () => ({
              like: () => ({
                limit: async () => ({ data: [filing], error: null }),
              }),
              eq: () => ({
                eq: async () => ({ data: [filing], error: null }),
              }),
            }),
            update: (payload: Record<string, unknown>) => ({
              eq: () => ({
                eq: () => {
                  filing.notes = String(payload.notes);
                  return { data: null, error: null };
                },
              }),
            }),
          };
        }
        if (table === "justice_case_tasks") {
          return { select: () => ({ like: () => ({ limit: async () => ({ data: [], error: null }) }) }) };
        }
        if (table === "justice_cases") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({ maybeSingle: async () => ({ data: { timeline: caseRow.timeline }, error: null }) }),
              }),
            }),
            update: (payload: Record<string, unknown>) => ({
              eq: () => ({
                eq: () => {
                  caseRow.timeline = payload.timeline as unknown[];
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

  it("flags a bounce on the completed filing as actionable, reopens the operator task, and stops the follow-up countdown", async () => {
    const notes = upsertMerchantContactEmailDeliveryNotes(null, {
      delivery_state: "accepted",
      provider: "resend",
      recipient: "support@acme.example",
      provider_message_id: "re_mc_1",
    });
    const supabase = makeBounceSupabase(notes);

    const result = await recordMerchantContactEmailBounceEvent(supabase, {
      messageId: "re_mc_1",
      eventType: "email.bounced",
    });

    expect(result).toEqual({
      status: "recorded",
      caseId: CASE_ID,
      state: "bounced",
    });
    expect(reopenMerchantContactFilingTaskForBounce).toHaveBeenCalledWith(
      supabase,
      USER_ID,
      CASE_ID,
      "bounced"
    );
    expect(completeFollowUpCaseTaskIfOwnedByAction).toHaveBeenCalledWith(
      supabase,
      USER_ID,
      CASE_ID,
      MANUAL_ACTION_TRACKING_REAL_MERCHANT_PREP_HREF
    );
  });

  it("returns an error on the initial bounce when task reopen fails, without hiding it as success", async () => {
    vi.mocked(reopenMerchantContactFilingTaskForBounce).mockResolvedValue({
      task: null,
      timeline: null,
      reopened: false,
    });
    const notes = upsertMerchantContactEmailDeliveryNotes(null, {
      delivery_state: "accepted",
      provider: "resend",
      recipient: "support@acme.example",
      provider_message_id: "re_mc_4",
    });

    const result = await recordMerchantContactEmailBounceEvent(makeBounceSupabase(notes), {
      messageId: "re_mc_4",
      eventType: "email.bounced",
    });

    expect(result).toEqual({ status: "error", reason: "task_reopen_failed" });
  });

  it("repairs an incomplete action on a replay: retries and succeeds once the task reopen works", async () => {
    vi.mocked(reopenMerchantContactFilingTaskForBounce).mockResolvedValue({
      task: null,
      timeline: null,
      reopened: false,
    });
    const notes = upsertMerchantContactEmailDeliveryNotes(null, {
      delivery_state: "accepted",
      provider: "resend",
      recipient: "support@acme.example",
      provider_message_id: "re_mc_5",
    });
    const supabase = makeBounceSupabase(notes);

    const first = await recordMerchantContactEmailBounceEvent(supabase, {
      messageId: "re_mc_5",
      eventType: "email.bounced",
    });
    expect(first).toEqual({ status: "error", reason: "task_reopen_failed" });

    vi.mocked(reopenMerchantContactFilingTaskForBounce).mockResolvedValue({
      task: null,
      timeline: null,
      reopened: true,
    });
    const second = await recordMerchantContactEmailBounceEvent(supabase, {
      messageId: "re_mc_5",
      eventType: "email.bounced",
    });

    expect(second).toEqual({ status: "recorded", caseId: CASE_ID, state: "bounced" });
    expect(reopenMerchantContactFilingTaskForBounce).toHaveBeenCalledTimes(2);
  });

  it("is harmless on a later replay once everything is already satisfied", async () => {
    const notes = upsertMerchantContactEmailDeliveryNotes(null, {
      delivery_state: "accepted",
      provider: "resend",
      recipient: "support@acme.example",
      provider_message_id: "re_mc_6",
    });
    const supabase = makeBounceSupabase(notes);

    const first = await recordMerchantContactEmailBounceEvent(supabase, {
      messageId: "re_mc_6",
      eventType: "email.bounced",
    });
    const second = await recordMerchantContactEmailBounceEvent(supabase, {
      messageId: "re_mc_6",
      eventType: "email.bounced",
    });

    expect(first).toEqual({ status: "recorded", caseId: CASE_ID, state: "bounced" });
    expect(second).toEqual({ status: "recorded", caseId: CASE_ID, state: "bounced" });
    expect(reopenMerchantContactFilingTaskForBounce).toHaveBeenCalledTimes(2);
    expect(completeFollowUpCaseTaskIfOwnedByAction).toHaveBeenCalledTimes(2);
  });

  it("falls back to a still-open task when no filing matches yet", async () => {
    const notes = upsertMerchantContactEmailDeliveryNotes(null, {
      delivery_state: "accepted",
      provider: "resend",
      recipient: "support@acme.example",
      provider_message_id: "re_mc_2",
    });
    const task = { id: "task-1", user_id: USER_ID, case_id: CASE_ID, notes };
    const caseRow = { id: CASE_ID, user_id: USER_ID, timeline: [] as unknown[] };
    const supabase = {
      from(table: string) {
        if (table === "justice_case_filings") {
          return {
            select: () => ({
              like: () => ({ limit: async () => ({ data: [], error: null }) }),
              eq: () => ({ eq: async () => ({ data: [], error: null }) }),
            }),
          };
        }
        if (table === "justice_case_tasks") {
          return {
            select: () => ({
              like: () => ({
                limit: async () => ({ data: [task], error: null }),
              }),
            }),
            update: (payload: Record<string, unknown>) => ({
              eq: () => ({
                eq: () => {
                  task.notes = String(payload.notes);
                  return { data: null, error: null };
                },
              }),
            }),
          };
        }
        if (table === "justice_cases") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({ maybeSingle: async () => ({ data: { timeline: caseRow.timeline }, error: null }) }),
              }),
            }),
            update: (payload: Record<string, unknown>) => ({
              eq: () => ({
                eq: () => {
                  caseRow.timeline = payload.timeline as unknown[];
                  return { data: null, error: null };
                },
              }),
            }),
          };
        }
        throw new Error(`unexpected table ${table}`);
      },
    } as unknown as SupabaseClient;

    const result = await recordMerchantContactEmailBounceEvent(supabase, {
      messageId: "re_mc_2",
      eventType: "email.bounced",
    });

    expect(result).toEqual({
      status: "recorded",
      caseId: CASE_ID,
      state: "bounced",
    });
    expect(parseMerchantContactEmailDeliveryRecord(task.notes)?.delivery_state).toBe("bounced");
  });

  it("ignores an unknown message id", async () => {
    const notes = upsertMerchantContactEmailDeliveryNotes(null, {
      delivery_state: "accepted",
      provider: "resend",
      recipient: "support@acme.example",
      provider_message_id: "re_mc_3",
    });

    const result = await recordMerchantContactEmailBounceEvent(makeBounceSupabase(notes), {
      messageId: "re_does_not_exist",
      eventType: "email.bounced",
    });

    expect(result).toEqual({ status: "ignored_unknown" });
    expect(reopenMerchantContactFilingTaskForBounce).not.toHaveBeenCalled();
    expect(completeFollowUpCaseTaskIfOwnedByAction).not.toHaveBeenCalled();
  });
});

describe("merchantContactEmailBounceState", () => {
  it("reads bounced/complained off the filing, distinct from a genuinely accepted send", () => {
    const complained = upsertMerchantContactEmailDeliveryNotes(null, {
      delivery_state: "complained" as never,
      provider: "resend",
      recipient: "support@acme.example",
      provider_message_id: "re_1",
    });
    const accepted = upsertMerchantContactEmailDeliveryNotes(null, {
      delivery_state: "accepted",
      provider: "resend",
      recipient: "support@acme.example",
      provider_message_id: "re_2",
    });

    expect(merchantContactEmailBounceState({ notes: complained })).toBe("complained");
    expect(merchantContactEmailBounceState({ notes: accepted })).toBeNull();
    expect(merchantContactEmailBounceState(undefined)).toBeNull();
  });
});

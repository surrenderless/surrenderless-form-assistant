import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { EmailProvider } from "@/lib/email/emailProvider";
import {
  resolvePaymentDisputeOutreachEmailEnv,
} from "@/lib/email/paymentDisputeOutreachEmailEnv";
import { createMockPaymentDisputeOutreachEmailProvider } from "@/lib/email/resolvePaymentDisputeOutreachEmailProvider";
import {
  buildPaymentDisputeOutreachEmailSubject,
  formatPaymentDisputeOutreachEmailBody,
  isPaymentDisputeEmailFailed,
  isPaymentDisputeEmailSending,
  paymentDisputeEmailBounceState,
  paymentDisputeEmailIdempotencyKey,
  parsePaymentDisputeEmailDeliveryRecord,
  recordPaymentDisputeEmailBounceEvent,
  resolvePaymentDisputeRecipientEmail,
  upsertPaymentDisputeEmailDeliveryNotes,
} from "@/lib/justice/paymentDisputeEmailDelivery";
import type { JusticeIntake } from "@/lib/justice/types";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";
import {
  buildJusticeIntakeFromParts,
  defaultBuildJusticeIntakeParts,
} from "@/lib/justice/buildJusticeIntake";
import { MANUAL_ACTION_TRACKING_REAL_PAYMENT_DISPUTE_PREP_HREF } from "@/lib/justice/handlingTrackingProgress";

vi.mock("@/lib/justice/paymentDisputeFilingTask", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/justice/paymentDisputeFilingTask")>();
  return { ...actual, reopenPaymentDisputeFilingTaskForBounce: vi.fn() };
});

vi.mock("@/lib/justice/followUpCaseTask", () => ({
  completeFollowUpCaseTaskIfOwnedByAction: vi.fn(),
}));

import { reopenPaymentDisputeFilingTaskForBounce } from "@/lib/justice/paymentDisputeFilingTask";
import { completeFollowUpCaseTaskIfOwnedByAction } from "@/lib/justice/followUpCaseTask";

const baseIntake = (): JusticeIntake => ({
  problem_category: "charge_dispute",
  company_name: "Acme Retail",
  company_website: "https://acme.example",
  purchase_or_signup: "widget",
  story: "Unauthorized charge",
  money_involved: "$50",
  pay_or_order_date: "2026-01-01",
  order_confirmation_details: "ORD-1",
  user_display_name: "Pat Consumer",
  reply_email: "pat@example.com",
  already_contacted: "no",
});

describe("paymentDisputeEmailDelivery helpers", () => {
  it("resolves card_issuer_contact_email only when valid", () => {
    expect(resolvePaymentDisputeRecipientEmail(baseIntake())).toBeNull();
    expect(
      resolvePaymentDisputeRecipientEmail({
        ...baseIntake(),
        card_issuer_contact_email: "disputes@issuer.example",
      })
    ).toBe("disputes@issuer.example");
    expect(
      resolvePaymentDisputeRecipientEmail({
        ...baseIntake(),
        card_issuer_contact_email: "not-an-email",
      })
    ).toBeNull();
  });

  it("round-trips delivery records in task notes without dropping the draft", () => {
    const notes = `payment_dispute_filing_queue:case-1\ndraft:\nDISPUTE REQUEST`;
    const withSending = upsertPaymentDisputeEmailDeliveryNotes(notes, {
      delivery_state: "sending",
      provider: "resend",
      recipient: "disputes@issuer.example",
      sent_at: "2026-07-14T12:00:00.000Z",
    });
    expect(withSending).toContain("draft:\nDISPUTE REQUEST");
    expect(parsePaymentDisputeEmailDeliveryRecord(withSending)).toEqual({
      delivery_state: "sending",
      provider: "resend",
      recipient: "disputes@issuer.example",
      sent_at: "2026-07-14T12:00:00.000Z",
    });

    const withFailed = upsertPaymentDisputeEmailDeliveryNotes(withSending, {
      delivery_state: "failed",
      provider: "resend",
      recipient: "disputes@issuer.example",
      sent_at: "2026-07-14T12:01:00.000Z",
      failure_detail: "mailbox unavailable",
    });
    expect(parsePaymentDisputeEmailDeliveryRecord(withFailed)?.delivery_state).toBe("failed");
    expect(withFailed).toContain("DISPUTE REQUEST");
  });

  it("detects sending and failed states on open tasks", () => {
    const sendingTask: JusticeCaseTaskRow = {
      id: "t1",
      user_id: "u1",
      case_id: "c1",
      title: "Payment dispute",
      due_date: null,
      notes: upsertPaymentDisputeEmailDeliveryNotes("marker", {
        delivery_state: "sending",
        provider: "resend",
        recipient: "a@b.co",
      }),
      completed_at: null,
      created_at: "2026-07-14T00:00:00.000Z",
      updated_at: "2026-07-14T00:00:00.000Z",
    };
    expect(isPaymentDisputeEmailSending(sendingTask)).toBe(true);
    expect(isPaymentDisputeEmailFailed(sendingTask)).toBe(false);

    const failedTask = {
      ...sendingTask,
      notes: upsertPaymentDisputeEmailDeliveryNotes(sendingTask.notes, {
        delivery_state: "failed",
        provider: "resend",
        recipient: "a@b.co",
        failure_detail: "bounce",
      }),
    };
    expect(isPaymentDisputeEmailSending(failedTask)).toBe(false);
    expect(isPaymentDisputeEmailFailed(failedTask)).toBe(true);
  });

  it("builds subject, idempotency key, and outbound body framing", () => {
    expect(buildPaymentDisputeOutreachEmailSubject(baseIntake())).toContain("Acme Retail");
    expect(paymentDisputeEmailIdempotencyKey("  case-uuid  ")).toBe(
      "payment-dispute-email:case-uuid"
    );
    expect(
      formatPaymentDisputeOutreachEmailBody(
        "DISPUTE REQUEST — copy into your bank/card issuer message or dispute form\n\nPlease reverse this charge."
      )
    ).toBe("DISPUTE REQUEST\n\nPlease reverse this charge.");
    expect(
      formatPaymentDisputeOutreachEmailBody(
        "DISPUTE REQUEST (operator filing packet — paste into bank/card issuer dispute channel)\n\nPlease reverse this charge."
      )
    ).toBe("DISPUTE REQUEST\n\nPlease reverse this charge.");
  });
});

describe("card_issuer_contact_email intake persistence", () => {
  it("persists valid card_issuer_contact_email onto JusticeIntake", () => {
    const intake = buildJusticeIntakeFromParts({
      ...defaultBuildJusticeIntakeParts(),
      company_name: "Acme",
      purchase_or_signup: "widget",
      story: "charge",
      reply_email: "user@example.com",
      card_issuer_contact_email: "Disputes@Issuer.Example",
    });
    expect(intake.card_issuer_contact_email).toBe("disputes@issuer.example");
  });
});

describe("paymentDisputeOutreachEmailEnv", () => {
  it("disables provider when required env is missing", () => {
    const prevKey = process.env.RESEND_API_KEY;
    const prevFrom = process.env.PAYMENT_DISPUTE_OUTREACH_FROM_EMAIL;
    const prevMerchantFrom = process.env.MERCHANT_OUTREACH_FROM_EMAIL;
    const prevEnabled = process.env.PAYMENT_DISPUTE_OUTREACH_EMAIL_ENABLED;
    delete process.env.RESEND_API_KEY;
    delete process.env.PAYMENT_DISPUTE_OUTREACH_FROM_EMAIL;
    delete process.env.MERCHANT_OUTREACH_FROM_EMAIL;
    delete process.env.PAYMENT_DISPUTE_OUTREACH_EMAIL_ENABLED;
    expect(resolvePaymentDisputeOutreachEmailEnv().enabled).toBe(false);
    process.env.RESEND_API_KEY = prevKey;
    process.env.PAYMENT_DISPUTE_OUTREACH_FROM_EMAIL = prevFrom;
    process.env.MERCHANT_OUTREACH_FROM_EMAIL = prevMerchantFrom;
    process.env.PAYMENT_DISPUTE_OUTREACH_EMAIL_ENABLED = prevEnabled;
  });
});

describe("mock payment dispute outreach email provider", () => {
  it("returns deterministic message ids and can force failure", async () => {
    const provider: EmailProvider = createMockPaymentDisputeOutreachEmailProvider();
    const ok = await provider.send({
      from: "from@test",
      to: "disputes@issuer.example",
      subject: "Hi",
      text: "Body",
      idempotencyKey: "payment-dispute-email:case-1",
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.messageId).toContain("mock_resend_");
    }

    const failed = await provider.send({
      from: "from@test",
      to: "fail-delivery@issuer.example",
      subject: "Hi",
      text: "Body",
      idempotencyKey: "k1",
    });
    expect(failed.ok).toBe(false);
  });
});

describe("recordPaymentDisputeEmailBounceEvent", () => {
  const CASE_ID = "case-pd-1";
  const USER_ID = "user-pd-1";

  beforeEach(() => {
    vi.mocked(reopenPaymentDisputeFilingTaskForBounce).mockResolvedValue({
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
    vi.mocked(reopenPaymentDisputeFilingTaskForBounce).mockReset();
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
    const notes = upsertPaymentDisputeEmailDeliveryNotes(null, {
      delivery_state: "accepted",
      provider: "resend",
      recipient: "disputes@issuer.example",
      provider_message_id: "re_pd_1",
    });
    const supabase = makeBounceSupabase(notes);

    const result = await recordPaymentDisputeEmailBounceEvent(supabase, {
      messageId: "re_pd_1",
      eventType: "email.bounced",
    });

    expect(result).toEqual({
      status: "recorded",
      caseId: CASE_ID,
      state: "bounced",
    });
    expect(reopenPaymentDisputeFilingTaskForBounce).toHaveBeenCalledWith(
      supabase,
      USER_ID,
      CASE_ID,
      "bounced"
    );
    expect(completeFollowUpCaseTaskIfOwnedByAction).toHaveBeenCalledWith(
      supabase,
      USER_ID,
      CASE_ID,
      MANUAL_ACTION_TRACKING_REAL_PAYMENT_DISPUTE_PREP_HREF
    );
  });

  it("returns an error on the initial complaint when follow-up stop fails, without hiding it as success", async () => {
    vi.mocked(completeFollowUpCaseTaskIfOwnedByAction).mockResolvedValue({
      task: { id: "follow-up-1" } as never,
      timeline: null,
      completed: false,
      skippedNotOwned: false,
      error: false,
    });
    const notes = upsertPaymentDisputeEmailDeliveryNotes(null, {
      delivery_state: "accepted",
      provider: "resend",
      recipient: "disputes@issuer.example",
      provider_message_id: "re_pd_2",
    });

    const result = await recordPaymentDisputeEmailBounceEvent(makeBounceSupabase(notes), {
      messageId: "re_pd_2",
      eventType: "email.complained",
    });

    expect(result).toEqual({ status: "error", reason: "follow_up_stop_failed" });
  });

  it("repairs an incomplete action on a replay: retries and succeeds once follow-up stop works", async () => {
    vi.mocked(completeFollowUpCaseTaskIfOwnedByAction).mockResolvedValue({
      task: { id: "follow-up-1" } as never,
      timeline: null,
      completed: false,
      skippedNotOwned: false,
      error: false,
    });
    const notes = upsertPaymentDisputeEmailDeliveryNotes(null, {
      delivery_state: "accepted",
      provider: "resend",
      recipient: "disputes@issuer.example",
      provider_message_id: "re_pd_3",
    });
    const supabase = makeBounceSupabase(notes);

    const first = await recordPaymentDisputeEmailBounceEvent(supabase, {
      messageId: "re_pd_3",
      eventType: "email.complained",
    });
    expect(first).toEqual({ status: "error", reason: "follow_up_stop_failed" });

    vi.mocked(completeFollowUpCaseTaskIfOwnedByAction).mockResolvedValue({
      task: { id: "follow-up-1" } as never,
      timeline: null,
      completed: true,
      skippedNotOwned: false,
      error: false,
    });
    const second = await recordPaymentDisputeEmailBounceEvent(supabase, {
      messageId: "re_pd_3",
      eventType: "email.complained",
    });

    expect(second).toEqual({ status: "recorded", caseId: CASE_ID, state: "complained" });
    expect(completeFollowUpCaseTaskIfOwnedByAction).toHaveBeenCalledTimes(2);
  });

  it("is harmless on a later replay once everything is already satisfied", async () => {
    const notes = upsertPaymentDisputeEmailDeliveryNotes(null, {
      delivery_state: "accepted",
      provider: "resend",
      recipient: "disputes@issuer.example",
      provider_message_id: "re_pd_4",
    });
    const supabase = makeBounceSupabase(notes);

    const first = await recordPaymentDisputeEmailBounceEvent(supabase, {
      messageId: "re_pd_4",
      eventType: "email.complained",
    });
    const second = await recordPaymentDisputeEmailBounceEvent(supabase, {
      messageId: "re_pd_4",
      eventType: "email.complained",
    });

    expect(first).toEqual({ status: "recorded", caseId: CASE_ID, state: "complained" });
    expect(second).toEqual({ status: "recorded", caseId: CASE_ID, state: "complained" });
    expect(reopenPaymentDisputeFilingTaskForBounce).toHaveBeenCalledTimes(2);
    expect(completeFollowUpCaseTaskIfOwnedByAction).toHaveBeenCalledTimes(2);
  });
});

describe("paymentDisputeEmailBounceState", () => {
  it("reads bounced/complained off the filing, distinct from a genuinely accepted send", () => {
    const bounced = upsertPaymentDisputeEmailDeliveryNotes(null, {
      delivery_state: "bounced" as never,
      provider: "resend",
      recipient: "disputes@issuer.example",
      provider_message_id: "re_1",
    });
    const accepted = upsertPaymentDisputeEmailDeliveryNotes(null, {
      delivery_state: "accepted",
      provider: "resend",
      recipient: "disputes@issuer.example",
      provider_message_id: "re_2",
    });

    expect(paymentDisputeEmailBounceState({ notes: bounced })).toBe("bounced");
    expect(paymentDisputeEmailBounceState({ notes: accepted })).toBeNull();
    expect(paymentDisputeEmailBounceState(undefined)).toBeNull();
  });
});

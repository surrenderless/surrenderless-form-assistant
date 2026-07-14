import { describe, expect, it } from "vitest";
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
  paymentDisputeEmailIdempotencyKey,
  parsePaymentDisputeEmailDeliveryRecord,
  resolvePaymentDisputeRecipientEmail,
  upsertPaymentDisputeEmailDeliveryNotes,
} from "@/lib/justice/paymentDisputeEmailDelivery";
import type { JusticeIntake } from "@/lib/justice/types";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";
import {
  buildJusticeIntakeFromParts,
  defaultBuildJusticeIntakeParts,
} from "@/lib/justice/buildJusticeIntake";

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

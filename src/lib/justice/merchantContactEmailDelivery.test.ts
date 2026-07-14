import { describe, expect, it } from "vitest";
import type { EmailProvider } from "@/lib/email/emailProvider";
import { createMockMerchantOutreachEmailProvider } from "@/lib/email/resolveMerchantOutreachEmailProvider";
import {
  buildMerchantOutreachEmailSubject,
  isMerchantContactEmailFailed,
  isMerchantContactEmailSending,
  merchantContactEmailIdempotencyKey,
  parseMerchantContactEmailDeliveryRecord,
  resolveMerchantOutreachRecipientEmail,
  upsertMerchantContactEmailDeliveryNotes,
} from "@/lib/justice/merchantContactEmailDelivery";
import type { JusticeIntake } from "@/lib/justice/types";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";
import {
  isValidMerchantOutreachEmailAddress,
  resolveMerchantOutreachEmailEnv,
} from "@/lib/email/merchantOutreachEmailEnv";

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

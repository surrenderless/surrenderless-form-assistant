import { describe, expect, it, vi } from "vitest";
import { buildJusticeIntakeFromParts, defaultBuildJusticeIntakeParts } from "@/lib/justice/buildJusticeIntake";
import { buildDefaultPaymentDisputeDraft } from "@/lib/justice/buildPaymentDisputeBankLetter";
import { buildBbbFilingTaskNotes } from "@/lib/justice/bbbFilingTask";
import { buildDemandLetterFilingTaskNotes } from "@/lib/justice/demandLetterFilingTask";
import { buildMerchantContactFilingTaskNotes } from "@/lib/justice/merchantContactFilingTask";
import { buildPaymentDisputeFilingTaskNotes } from "@/lib/justice/paymentDisputeFilingTask";
import { buildPaymentDisputeOperatorFilingWorkspace } from "@/lib/justice/paymentDisputeOperatorFilingWorkspace";
import {
  classifyOpenOperatorTask,
  resolveOperatorFulfillmentPanelKind,
} from "@/lib/justice/operatorFulfillmentQueue";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";

const CASE_ID = "550e8400-e29b-41d4-a716-446655440000";
const USER_ID = "user-owner-1";
const TASK_ID = "550e8400-e29b-41d4-a716-446655440088";

vi.mock("@/lib/justice/completePaymentDisputeOperatorFiling", () => ({
  completePaymentDisputeOperatorFiling: vi.fn(),
}));

vi.mock("@/lib/justice/paymentDisputeEmailDelivery", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/justice/paymentDisputeEmailDelivery")>();
  return {
    ...actual,
    attemptAutomatedPaymentDisputeEmailDelivery: vi.fn(),
  };
});

import { completePaymentDisputeOperatorFiling } from "@/lib/justice/completePaymentDisputeOperatorFiling";
import { attemptAutomatedPaymentDisputeEmailDelivery } from "@/lib/justice/paymentDisputeEmailDelivery";

function baseIntake(overrides: Record<string, unknown> = {}) {
  return buildJusticeIntakeFromParts({
    ...defaultBuildJusticeIntakeParts(),
    problem_category: "charge_dispute",
    company_name: "Acme Retail",
    purchase_or_signup: "Wireless earbuds",
    story: "Paid for earbuds that never shipped.",
    money_amount: "$129.00",
    pay_or_order_date: "2026-05-01",
    consumer_us_state: "CA",
    user_display_name: "Alex River",
    reply_email: "alex@example.com",
    already_contacted: "yes",
    contact_method: "email",
    contact_date: "2026-05-05",
    merchant_response_type: "refused_help",
    card_issuer_contact_email: "disputes@bank.example",
    ...overrides,
  });
}

function openTask(notes: string): JusticeCaseTaskRow {
  return {
    id: TASK_ID,
    user_id: USER_ID,
    case_id: CASE_ID,
    title: "Operator filing",
    due_date: null,
    notes,
    completed_at: null,
    created_at: "2026-05-10T00:00:00.000Z",
    updated_at: "2026-05-10T00:00:00.000Z",
  };
}

describe("payment-dispute operator fulfillment queue attachment", () => {
  it("attaches payment_dispute_workspace only to payment-dispute queue items", () => {
    const intake = baseIntake();
    const draft = buildDefaultPaymentDisputeDraft(CASE_ID, intake);
    const paymentItem = classifyOpenOperatorTask(
      openTask(buildPaymentDisputeFilingTaskNotes(CASE_ID, intake, draft)),
      intake
    );
    expect(paymentItem?.step).toBe("payment_dispute");
    expect(paymentItem?.payment_dispute_workspace).toBeDefined();
    expect(paymentItem?.merchant_contact_workspace).toBeUndefined();
    expect(paymentItem?.demand_letter_workspace).toBeUndefined();
    expect(paymentItem?.payment_dispute_workspace?.is_submitted).toBe(false);
    expect(paymentItem?.payment_dispute_workspace?.delivery.recipient_email).toBe(
      "disputes@bank.example"
    );

    const merchantItem = classifyOpenOperatorTask(
      openTask(buildMerchantContactFilingTaskNotes(CASE_ID, intake)),
      intake
    );
    expect(merchantItem?.step).toBe("merchant_contact");
    expect(merchantItem?.payment_dispute_workspace).toBeUndefined();
    expect(merchantItem?.merchant_contact_workspace).toBeDefined();

    const bbbItem = classifyOpenOperatorTask(
      openTask(buildBbbFilingTaskNotes(CASE_ID, intake)),
      intake
    );
    expect(bbbItem?.step).toBe("bbb");
    expect(bbbItem?.payment_dispute_workspace).toBeUndefined();
  });
});

describe("resolveOperatorFulfillmentPanelKind payment-dispute branching", () => {
  it("branches payment dispute to payment_dispute_workspace and leaves other lanes on their panels", () => {
    const intake = baseIntake();
    const draft = buildDefaultPaymentDisputeDraft(CASE_ID, intake);
    const paymentItem = classifyOpenOperatorTask(
      openTask(buildPaymentDisputeFilingTaskNotes(CASE_ID, intake, draft)),
      intake
    )!;
    const merchantItem = classifyOpenOperatorTask(
      openTask(buildMerchantContactFilingTaskNotes(CASE_ID, intake)),
      intake
    )!;
    const dlItem = classifyOpenOperatorTask(
      openTask(buildDemandLetterFilingTaskNotes(CASE_ID, intake)),
      intake
    )!;

    expect(resolveOperatorFulfillmentPanelKind(paymentItem)).toBe("payment_dispute_workspace");
    expect(resolveOperatorFulfillmentPanelKind(merchantItem)).toBe("merchant_contact_workspace");
    expect(resolveOperatorFulfillmentPanelKind(dlItem)).toBe("demand_letter_workspace");
    expect(
      resolveOperatorFulfillmentPanelKind({
        step: "payment_dispute",
      })
    ).toBe("record_form");
  });
});

describe("payment-dispute workspace automated-delivery coexistence", () => {
  it("keeps is_submitted false when email is eligible and does not call complete or email delivery", () => {
    vi.mocked(completePaymentDisputeOperatorFiling).mockClear();
    vi.mocked(attemptAutomatedPaymentDisputeEmailDelivery).mockClear();
    const workspace = buildPaymentDisputeOperatorFilingWorkspace({
      intake: baseIntake({ card_issuer_contact_email: "disputes@bank.example" }),
      caseId: CASE_ID,
    });
    expect(workspace.delivery.automated_email_eligible).toBe(true);
    expect(workspace.is_submitted).toBe(false);
    expect(completePaymentDisputeOperatorFiling).not.toHaveBeenCalled();
    expect(attemptAutomatedPaymentDisputeEmailDelivery).not.toHaveBeenCalled();
  });

  it("keeps manual fallback available when email automation is ineligible", () => {
    const workspace = buildPaymentDisputeOperatorFilingWorkspace({
      intake: baseIntake({ card_issuer_contact_email: "" }),
      caseId: CASE_ID,
    });
    expect(workspace.delivery.automated_email_eligible).toBe(false);
    expect(workspace.letter_draft.length).toBeGreaterThan(50);
    expect(workspace.is_submitted).toBe(false);
    const intakeNoEmail = baseIntake({ card_issuer_contact_email: "" });
    const draft = buildDefaultPaymentDisputeDraft(CASE_ID, intakeNoEmail);
    const item = classifyOpenOperatorTask(
      openTask(buildPaymentDisputeFilingTaskNotes(CASE_ID, intakeNoEmail, draft)),
      intakeNoEmail
    );
    expect(resolveOperatorFulfillmentPanelKind(item!)).toBe("payment_dispute_workspace");
  });
});

describe("payment-dispute lane isolation", () => {
  it("does not attach payment-dispute workspace to other lanes", () => {
    const intake = baseIntake();
    const merchantItem = classifyOpenOperatorTask(
      openTask(buildMerchantContactFilingTaskNotes(CASE_ID, intake)),
      intake
    );
    expect(merchantItem?.step).toBe("merchant_contact");
    expect(merchantItem?.payment_dispute_workspace).toBeUndefined();
    expect(resolveOperatorFulfillmentPanelKind(merchantItem!)).toBe("merchant_contact_workspace");
  });
});

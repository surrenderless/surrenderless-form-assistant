import { describe, expect, it, vi } from "vitest";
import { buildJusticeIntakeFromParts, defaultBuildJusticeIntakeParts } from "@/lib/justice/buildJusticeIntake";
import { buildDefaultPaymentDisputeDraft } from "@/lib/justice/buildPaymentDisputeBankLetter";
import { buildBbbFilingTaskNotes } from "@/lib/justice/bbbFilingTask";
import { buildDemandLetterFilingTaskNotes } from "@/lib/justice/demandLetterFilingTask";
import { buildMerchantContactFilingTaskNotes } from "@/lib/justice/merchantContactFilingTask";
import { buildPaymentDisputeFilingTaskNotes } from "@/lib/justice/paymentDisputeFilingTask";
import { buildMerchantContactOperatorFilingWorkspace } from "@/lib/justice/merchantContactOperatorFilingWorkspace";
import {
  classifyOpenOperatorTask,
  resolveOperatorFulfillmentPanelKind,
} from "@/lib/justice/operatorFulfillmentQueue";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";

const CASE_ID = "550e8400-e29b-41d4-a716-446655440000";
const USER_ID = "user-owner-1";
const TASK_ID = "550e8400-e29b-41d4-a716-446655440088";

vi.mock("@/lib/justice/completeMerchantContactOperatorFiling", () => ({
  completeMerchantContactOperatorFiling: vi.fn(),
}));

vi.mock("@/lib/justice/merchantContactEmailDelivery", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/justice/merchantContactEmailDelivery")>();
  return {
    ...actual,
    attemptAutomatedMerchantContactEmailDelivery: vi.fn(),
  };
});

import { completeMerchantContactOperatorFiling } from "@/lib/justice/completeMerchantContactOperatorFiling";
import { attemptAutomatedMerchantContactEmailDelivery } from "@/lib/justice/merchantContactEmailDelivery";

function baseIntake(overrides: Record<string, unknown> = {}) {
  return buildJusticeIntakeFromParts({
    ...defaultBuildJusticeIntakeParts(),
    problem_category: "online_purchase",
    company_name: "Acme Retail",
    company_contact_email: "support@acme.example",
    purchase_or_signup: "Wireless earbuds",
    story: "Paid for earbuds that never shipped.",
    money_amount: "$129.00",
    pay_or_order_date: "2026-05-01",
    consumer_us_state: "CA",
    user_display_name: "Alex River",
    reply_email: "alex@example.com",
    already_contacted: "no",
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

describe("merchant-contact operator fulfillment queue attachment", () => {
  it("attaches merchant_contact_workspace only to merchant-contact queue items", () => {
    const intake = baseIntake();
    const merchantItem = classifyOpenOperatorTask(
      openTask(buildMerchantContactFilingTaskNotes(CASE_ID, intake)),
      intake
    );
    expect(merchantItem?.step).toBe("merchant_contact");
    expect(merchantItem?.merchant_contact_workspace).toBeDefined();
    expect(merchantItem?.demand_letter_workspace).toBeUndefined();
    expect(merchantItem?.bbb_workspace).toBeUndefined();
    expect(merchantItem?.merchant_contact_workspace?.is_submitted).toBe(false);
    expect(merchantItem?.merchant_contact_workspace?.delivery.recipient_email).toBe(
      "support@acme.example"
    );

    const dlItem = classifyOpenOperatorTask(
      openTask(buildDemandLetterFilingTaskNotes(CASE_ID, intake)),
      intake
    );
    expect(dlItem?.step).toBe("demand_letter");
    expect(dlItem?.merchant_contact_workspace).toBeUndefined();
    expect(dlItem?.demand_letter_workspace).toBeDefined();

    const bbbItem = classifyOpenOperatorTask(
      openTask(buildBbbFilingTaskNotes(CASE_ID, intake)),
      intake
    );
    expect(bbbItem?.step).toBe("bbb");
    expect(bbbItem?.merchant_contact_workspace).toBeUndefined();
  });
});

describe("resolveOperatorFulfillmentPanelKind merchant-contact branching", () => {
  it("branches merchant contact to merchant_contact_workspace and leaves payment dispute on payment_dispute_workspace", () => {
    const intake = baseIntake();
    const merchantItem = classifyOpenOperatorTask(
      openTask(buildMerchantContactFilingTaskNotes(CASE_ID, intake)),
      intake
    )!;
    const dlItem = classifyOpenOperatorTask(
      openTask(buildDemandLetterFilingTaskNotes(CASE_ID, intake)),
      intake
    )!;
    const paymentItem = classifyOpenOperatorTask(
      openTask(
        buildPaymentDisputeFilingTaskNotes(
          CASE_ID,
          intake,
          buildDefaultPaymentDisputeDraft(CASE_ID, intake)
        )
      ),
      intake
    )!;

    expect(resolveOperatorFulfillmentPanelKind(merchantItem)).toBe("merchant_contact_workspace");
    expect(resolveOperatorFulfillmentPanelKind(dlItem)).toBe("demand_letter_workspace");
    expect(resolveOperatorFulfillmentPanelKind(paymentItem)).toBe("payment_dispute_workspace");
    expect(
      resolveOperatorFulfillmentPanelKind({
        step: "merchant_contact",
      })
    ).toBe("record_form");
  });
});

describe("merchant-contact workspace automated-delivery coexistence", () => {
  it("keeps is_submitted false when email is eligible and does not call complete or email delivery", () => {
    vi.mocked(completeMerchantContactOperatorFiling).mockClear();
    vi.mocked(attemptAutomatedMerchantContactEmailDelivery).mockClear();
    const workspace = buildMerchantContactOperatorFilingWorkspace({
      intake: baseIntake({ company_contact_email: "support@acme.example" }),
    });
    expect(workspace.delivery.automated_email_eligible).toBe(true);
    expect(workspace.is_submitted).toBe(false);
    expect(completeMerchantContactOperatorFiling).not.toHaveBeenCalled();
    expect(attemptAutomatedMerchantContactEmailDelivery).not.toHaveBeenCalled();
  });

  it("keeps manual fallback available when email automation is ineligible", () => {
    const workspace = buildMerchantContactOperatorFilingWorkspace({
      intake: baseIntake({ company_contact_email: "" }),
    });
    expect(workspace.delivery.automated_email_eligible).toBe(false);
    expect(workspace.message_draft.length).toBeGreaterThan(50);
    expect(workspace.is_submitted).toBe(false);
    const intakeNoEmail = baseIntake({ company_contact_email: "" });
    const item = classifyOpenOperatorTask(
      openTask(buildMerchantContactFilingTaskNotes(CASE_ID, intakeNoEmail)),
      intakeNoEmail
    );
    expect(resolveOperatorFulfillmentPanelKind(item!)).toBe("merchant_contact_workspace");
  });
});

describe("merchant-contact lane isolation", () => {
  it("does not attach merchant workspace to other lanes", () => {
    const intake = baseIntake();
    const paymentItem = classifyOpenOperatorTask(
      openTask(
        buildPaymentDisputeFilingTaskNotes(
          CASE_ID,
          intake,
          buildDefaultPaymentDisputeDraft(CASE_ID, intake)
        )
      ),
      intake
    );
    expect(paymentItem?.step).toBe("payment_dispute");
    expect(paymentItem?.merchant_contact_workspace).toBeUndefined();
    expect(paymentItem?.payment_dispute_workspace).toBeDefined();
    expect(resolveOperatorFulfillmentPanelKind(paymentItem!)).toBe("payment_dispute_workspace");
  });
});

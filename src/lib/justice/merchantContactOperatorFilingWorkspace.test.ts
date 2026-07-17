import { describe, expect, it } from "vitest";
import { buildMerchantMessage } from "@/lib/justice/buildMerchantContactMessage";
import { buildJusticeIntakeFromParts, defaultBuildJusticeIntakeParts } from "@/lib/justice/buildJusticeIntake";
import { buildMerchantContactFilingTaskNotes } from "@/lib/justice/merchantContactFilingTask";
import {
  buildMerchantContactOperatorFilingWorkspace,
  buildMerchantContactPreparedAnswers,
} from "@/lib/justice/merchantContactOperatorFilingWorkspace";

const CASE_ID = "550e8400-e29b-41d4-a716-446655440000";

function baseIntake(overrides: Record<string, unknown> = {}) {
  return buildJusticeIntakeFromParts({
    ...defaultBuildJusticeIntakeParts(),
    problem_category: "online_purchase",
    company_name: "Acme Retail",
    company_website: "https://acme.example",
    company_contact_email: "support@acme.example",
    purchase_or_signup: "Wireless earbuds",
    story: "Paid for earbuds that never shipped.",
    money_amount: "$129.00",
    pay_or_order_date: "2026-05-01",
    order_confirmation_details: "Order #4411",
    consumer_us_state: "CA",
    user_display_name: "Alex River",
    reply_email: "alex@example.com",
    already_contacted: "no",
    ...overrides,
  });
}

describe("buildMerchantContactOperatorFilingWorkspace", () => {
  it("builds a full operator workspace payload with draft, recipient, answers, and evidence", () => {
    const intake = baseIntake();
    const notes = buildMerchantContactFilingTaskNotes(CASE_ID, intake);
    const workspace = buildMerchantContactOperatorFilingWorkspace({
      intake,
      taskNotes: notes,
      evidence: [
        {
          title: "Order receipt",
          evidence_type: "receipt",
          file_name: "receipt.pdf",
          evidence_date: "2026-05-01",
        },
      ],
    });

    expect(workspace.filing_destination).toBe("Merchant contact");
    expect(workspace.delivery.automated_email_eligible).toBe(true);
    expect(workspace.delivery.recipient_email).toBe("support@acme.example");
    expect(workspace.delivery.company_name).toBe("Acme Retail");
    expect(workspace.message_draft.length).toBeGreaterThan(100);
    expect(workspace.message_draft).toContain("Acme Retail");
    expect(workspace.message_draft).toContain("never shipped");
    expect(workspace.is_submitted).toBe(false);
    expect(workspace.confirmation_capture.requires_filed_at).toBe(true);
    expect(workspace.confirmation_capture.requires_confirmation_number).toBe(true);
    expect(workspace.confirmation_capture.requires_destination).toBe(true);
    expect(workspace.confirmation_capture.requires_contact_method).toBe(true);
    expect(workspace.confirmation_capture.requires_merchant_response_type).toBe(true);
    expect(workspace.confirmation_capture.requires_recipient).toBe(true);

    const answerIds = workspace.prepared_answers.map((a) => a.id);
    expect(answerIds).toContain("consumer_name");
    expect(answerIds).toContain("company_name");
    expect(answerIds).toContain("recipient_email");
    expect(answerIds).toContain("what_happened");
    expect(answerIds).toContain("desired_resolution");
    expect(workspace.prepared_answers.find((a) => a.id === "recipient_email")?.value).toBe(
      "support@acme.example"
    );

    expect(workspace.evidence).toEqual([
      {
        title: "Order receipt",
        evidence_type: "receipt",
        file_name: "receipt.pdf",
        evidence_date: "2026-05-01",
      },
    ]);
  });

  it("exposes prepared answers from intake for manual fulfillment", () => {
    const answers = buildMerchantContactPreparedAnswers(baseIntake());
    expect(answers.find((a) => a.id === "amount")?.value).toBe("$129.00");
    expect(answers.find((a) => a.id === "order_confirmation")?.value).toBe("Order #4411");
    expect(answers.every((a) => a.copyable)).toBe(true);
  });

  it("falls back to buildMerchantMessage when task notes lack a draft body", () => {
    const intake = baseIntake();
    const workspace = buildMerchantContactOperatorFilingWorkspace({
      intake,
      taskNotes: `merchant_contact_filing_queue:${CASE_ID}\ncase_id: ${CASE_ID}`,
      evidence: [],
    });
    expect(workspace.message_draft).toBe(buildMerchantMessage(intake));
  });

  it("never marks the workspace as submitted before completion API success", () => {
    const workspace = buildMerchantContactOperatorFilingWorkspace({
      intake: baseIntake(),
      evidence: [],
    });
    expect(workspace.is_submitted).toBe(false);
  });

  it("marks automated email ineligible when company contact email is missing", () => {
    const workspace = buildMerchantContactOperatorFilingWorkspace({
      intake: baseIntake({ company_contact_email: "" }),
      evidence: [],
    });
    expect(workspace.delivery.automated_email_eligible).toBe(false);
    expect(workspace.delivery.recipient_email).toBeNull();
    expect(workspace.delivery.operator_guidance).toMatch(/unavailable/i);
    expect(workspace.is_submitted).toBe(false);
  });
});

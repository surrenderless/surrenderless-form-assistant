import { describe, expect, it } from "vitest";
import { buildBankLetter, buildDefaultPaymentDisputeDraft } from "@/lib/justice/buildPaymentDisputeBankLetter";
import { buildJusticeIntakeFromParts, defaultBuildJusticeIntakeParts } from "@/lib/justice/buildJusticeIntake";
import { buildPaymentDisputeFilingTaskNotes } from "@/lib/justice/paymentDisputeFilingTask";
import {
  buildPaymentDisputeOperatorFilingWorkspace,
  buildPaymentDisputePreparedAnswers,
} from "@/lib/justice/paymentDisputeOperatorFilingWorkspace";

const CASE_ID = "550e8400-e29b-41d4-a716-446655440000";

function baseIntake(overrides: Record<string, unknown> = {}) {
  return buildJusticeIntakeFromParts({
    ...defaultBuildJusticeIntakeParts(),
    problem_category: "charge_dispute",
    company_name: "Acme Retail",
    company_website: "https://acme.example",
    purchase_or_signup: "Wireless earbuds",
    story: "Paid for earbuds that never shipped and merchant refused a refund.",
    money_amount: "$129.00",
    pay_or_order_date: "2026-05-01",
    order_confirmation_details: "Order #4411",
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

describe("buildPaymentDisputeOperatorFilingWorkspace", () => {
  it("builds a full operator workspace payload with letter, issuer/charge fields, answers, and evidence", () => {
    const intake = baseIntake();
    const draft = buildDefaultPaymentDisputeDraft(CASE_ID, intake);
    const notes = buildPaymentDisputeFilingTaskNotes(CASE_ID, intake, draft);
    const workspace = buildPaymentDisputeOperatorFilingWorkspace({
      intake,
      caseId: CASE_ID,
      taskNotes: notes,
      draft,
      evidence: [
        {
          id: "550e8400-e29b-41d4-a716-446655440099",
          title: "Order receipt",
          evidence_type: "receipt",
          file_name: "receipt.pdf",
          evidence_date: "2026-05-01",
        },
      ],
    });

    expect(workspace.filing_destination).toBe("Payment dispute (bank/card)");
    expect(workspace.delivery.automated_email_eligible).toBe(true);
    expect(workspace.delivery.recipient_email).toBe("disputes@bank.example");
    expect(workspace.delivery.merchant_name).toBe("Acme Retail");
    expect(workspace.charge_fields.charge_amount).toBe("$129.00");
    expect(workspace.charge_fields.charge_date).toBe("2026-05-01");
    expect(workspace.charge_fields.payment_method).toMatch(/card/i);
    expect(workspace.letter_draft.length).toBeGreaterThan(100);
    expect(workspace.letter_draft).toContain("DISPUTE REQUEST");
    expect(workspace.letter_draft).toContain("Acme Retail");
    expect(workspace.is_submitted).toBe(false);
    expect(workspace.confirmation_capture).toEqual({
      requires_filed_at: true,
      requires_confirmation_number: true,
      requires_destination: true,
    });

    const answerIds = workspace.prepared_answers.map((a) => a.id);
    expect(answerIds).toContain("consumer_name");
    expect(answerIds).toContain("merchant_name");
    expect(answerIds).toContain("issuer_email");
    expect(answerIds).toContain("charge_amount");
    expect(answerIds).toContain("dispute_reason");
    expect(workspace.prepared_answers.find((a) => a.id === "issuer_email")?.value).toBe(
      "disputes@bank.example"
    );

    expect(workspace.evidence).toEqual([
      {
        id: "550e8400-e29b-41d4-a716-446655440099",
        title: "Order receipt",
        evidence_type: "receipt",
        file_name: "receipt.pdf",
        evidence_date: "2026-05-01",
      },
    ]);
  });

  it("exposes prepared answers from intake and draft for manual fulfillment", () => {
    const intake = baseIntake();
    const draft = buildDefaultPaymentDisputeDraft(CASE_ID, intake);
    const answers = buildPaymentDisputePreparedAnswers(intake, draft);
    expect(answers.find((a) => a.id === "charge_amount")?.value).toBe("$129.00");
    expect(answers.find((a) => a.id === "order_confirmation")?.value).toBe("Order #4411");
    expect(answers.every((a) => a.copyable)).toBe(true);
  });

  it("falls back to buildBankLetter when task notes lack a draft body", () => {
    const intake = baseIntake();
    const draft = buildDefaultPaymentDisputeDraft(CASE_ID, intake);
    const workspace = buildPaymentDisputeOperatorFilingWorkspace({
      intake,
      caseId: CASE_ID,
      taskNotes: `payment_dispute_filing_queue:${CASE_ID}\ncase_id: ${CASE_ID}`,
      draft,
      evidence: [],
    });
    expect(workspace.letter_draft).toBe(buildBankLetter(draft, intake));
  });

  it("never marks the workspace as submitted before completion API success", () => {
    const workspace = buildPaymentDisputeOperatorFilingWorkspace({
      intake: baseIntake(),
      caseId: CASE_ID,
      evidence: [],
    });
    expect(workspace.is_submitted).toBe(false);
  });

  it("marks automated email ineligible when card issuer contact email is missing", () => {
    const workspace = buildPaymentDisputeOperatorFilingWorkspace({
      intake: baseIntake({ card_issuer_contact_email: "" }),
      caseId: CASE_ID,
      evidence: [],
    });
    expect(workspace.delivery.automated_email_eligible).toBe(false);
    expect(workspace.delivery.recipient_email).toBeNull();
    expect(workspace.delivery.operator_guidance).toMatch(/unavailable/i);
    expect(workspace.is_submitted).toBe(false);
  });
});

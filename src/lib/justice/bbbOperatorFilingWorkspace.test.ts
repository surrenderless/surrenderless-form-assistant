import { describe, expect, it } from "vitest";
import { REAL_BBB_COMPLAINT_SUBMISSION_URL } from "@/lib/justice/assistedSubmissionLane";
import { buildBbbComplaintDraft } from "@/lib/justice/buildBbbComplaintDraft";
import { buildJusticeIntakeFromParts, defaultBuildJusticeIntakeParts } from "@/lib/justice/buildJusticeIntake";
import { buildBbbFilingTaskNotes } from "@/lib/justice/bbbFilingTask";
import { BBB_OFFICIAL_COMPLAINT_PORTAL_URL } from "@/lib/justice/bbbOfficialPortal";
import {
  buildBbbOperatorFilingWorkspace,
  buildBbbPreparedAnswers,
} from "@/lib/justice/bbbOperatorFilingWorkspace";
import { isRealBbbComplaintAutofillEnabled } from "@/lib/justice/realBbbAutofillEnabled";

const CASE_ID = "550e8400-e29b-41d4-a716-446655440000";

function baseIntake(overrides: Record<string, unknown> = {}) {
  return buildJusticeIntakeFromParts({
    ...defaultBuildJusticeIntakeParts(),
    problem_category: "online_purchase",
    company_name: "Acme Retail",
    company_website: "https://acme.example",
    purchase_or_signup: "Wireless earbuds",
    story: "Paid for earbuds that never shipped.",
    money_amount: "$129.00",
    pay_or_order_date: "2026-05-01",
    order_confirmation_details: "Order #4411",
    consumer_us_state: "CA",
    user_display_name: "Alex River",
    reply_email: "alex@example.com",
    already_contacted: "yes",
    contact_method: "email",
    contact_date: "2026-05-05",
    merchant_response_type: "no_response",
    contact_proof_type: "paste",
    contact_proof_text: "No reply after two emails.",
    ...overrides,
  });
}

describe("buildBbbOperatorFilingWorkspace", () => {
  it("builds a full operator workspace payload with portal, draft, answers, and evidence", () => {
    const intake = baseIntake();
    const notes = buildBbbFilingTaskNotes(CASE_ID, intake);
    const workspace = buildBbbOperatorFilingWorkspace({
      intake,
      taskNotes: notes,
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

    expect(workspace.filing_destination).toBe("Better Business Bureau");
    expect(workspace.portal.portal_supported).toBe(true);
    expect(workspace.portal.portal_url).toBe(BBB_OFFICIAL_COMPLAINT_PORTAL_URL);
    expect(workspace.portal.portal_url).toBe(REAL_BBB_COMPLAINT_SUBMISSION_URL);
    expect(workspace.portal.portal_url).toBe("https://www.bbb.org/complain/");
    expect(workspace.complaint_draft.length).toBeGreaterThan(100);
    expect(workspace.complaint_draft).toContain("Acme Retail");
    expect(workspace.complaint_draft).toContain("never shipped");
    expect(workspace.is_submitted).toBe(false);
    expect(workspace.owned_autofill_enabled).toBe(isRealBbbComplaintAutofillEnabled());
    expect(workspace.confirmation_capture.requires_filed_at).toBe(true);
    expect(workspace.confirmation_capture.requires_confirmation_number).toBe(true);
    expect(workspace.confirmation_capture.requires_destination).toBe(true);

    const answerIds = workspace.prepared_answers.map((a) => a.id);
    expect(answerIds).toContain("consumer_name");
    expect(answerIds).toContain("company_name");
    expect(answerIds).toContain("what_happened");
    expect(answerIds).toContain("desired_resolution");
    expect(workspace.prepared_answers.find((a) => a.id === "company_name")?.value).toBe(
      "Acme Retail"
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

  it("exposes prepared answers from intake for portal filing", () => {
    const answers = buildBbbPreparedAnswers(baseIntake());
    expect(answers.find((a) => a.id === "amount")?.value).toBe("$129.00");
    expect(answers.find((a) => a.id === "order_confirmation")?.value).toBe("Order #4411");
    expect(answers.every((a) => a.copyable)).toBe(true);
  });

  it("falls back to buildBbbComplaintDraft when task notes lack a draft body", () => {
    const intake = baseIntake();
    const workspace = buildBbbOperatorFilingWorkspace({
      intake,
      taskNotes: `bbb_filing_queue:${CASE_ID}\ncase_id: ${CASE_ID}`,
      evidence: [],
    });
    expect(workspace.complaint_draft).toBe(buildBbbComplaintDraft(intake));
  });

  it("never marks the workspace as submitted before completion API success", () => {
    const workspace = buildBbbOperatorFilingWorkspace({
      intake: baseIntake(),
      evidence: [],
    });
    expect(workspace.is_submitted).toBe(false);
    expect(workspace.portal.portal_url).toBe("https://www.bbb.org/complain/");
  });

  it("keeps owned autofill coexistence guidance without claiming submission", () => {
    const workspace = buildBbbOperatorFilingWorkspace({ intake: baseIntake() });
    expect(workspace.is_submitted).toBe(false);
    expect(typeof workspace.owned_autofill_enabled).toBe("boolean");
    expect(workspace.owned_autofill_enabled).toBe(isRealBbbComplaintAutofillEnabled());
    expect(workspace.portal.operator_guidance).toMatch(/autofill/i);
    expect(workspace.portal.operator_guidance).toMatch(/fallback/i);
  });
});

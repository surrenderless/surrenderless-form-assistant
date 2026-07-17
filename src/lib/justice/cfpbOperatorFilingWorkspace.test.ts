import { describe, expect, it } from "vitest";
import { buildCfpbComplaintDraft } from "@/lib/justice/buildCfpbComplaintDraft";
import { buildJusticeIntakeFromParts, defaultBuildJusticeIntakeParts } from "@/lib/justice/buildJusticeIntake";
import { buildCfpbFilingTaskNotes } from "@/lib/justice/cfpbFilingTask";
import { CFPB_OFFICIAL_CONSUMER_COMPLAINT_PORTAL_URL } from "@/lib/justice/cfpbOfficialPortal";
import {
  buildCfpbOperatorFilingWorkspace,
  buildCfpbPreparedAnswers,
} from "@/lib/justice/cfpbOperatorFilingWorkspace";

const CASE_ID = "550e8400-e29b-41d4-a716-446655440000";

function baseIntake(overrides: Record<string, unknown> = {}) {
  return buildJusticeIntakeFromParts({
    ...defaultBuildJusticeIntakeParts(),
    problem_category: "charge_dispute",
    company_name: "North Bank",
    company_website: "https://northbank.example",
    purchase_or_signup: "Credit card account",
    story: "A recurring charge posted after I cancelled and the bank will not reverse it.",
    money_amount: "$49.00",
    pay_or_order_date: "2026-03-01",
    order_confirmation_details: "Acct ending 4412",
    consumer_us_state: "CA",
    user_display_name: "Alex River",
    reply_email: "alex@example.com",
    already_contacted: "yes",
    contact_method: "email",
    contact_date: "2026-03-05",
    merchant_response_type: "refused_help",
    contact_proof_type: "paste",
    contact_proof_text: "Bank said the charge stands.",
    ...overrides,
  });
}

describe("buildCfpbOperatorFilingWorkspace", () => {
  it("builds a full operator workspace payload with portal, draft, answers, and evidence", () => {
    const intake = baseIntake();
    const notes = buildCfpbFilingTaskNotes(CASE_ID, intake);
    const workspace = buildCfpbOperatorFilingWorkspace({
      intake,
      taskNotes: notes,
      evidence: [
        {
          id: "550e8400-e29b-41d4-a716-446655440099",
          title: "Bank statement",
          evidence_type: "statement",
          file_name: "statement-march.pdf",
          evidence_date: "2026-03-01",
        },
      ],
    });

    expect(workspace.filing_destination).toBe("CFPB");
    expect(workspace.portal.portal_supported).toBe(true);
    expect(workspace.portal.portal_url).toBe(CFPB_OFFICIAL_CONSUMER_COMPLAINT_PORTAL_URL);
    expect(workspace.complaint_draft.length).toBeGreaterThan(200);
    expect(workspace.complaint_draft).toContain("North Bank");
    expect(workspace.complaint_draft).toContain("recurring charge");
    expect(workspace.is_submitted).toBe(false);
    expect(workspace.confirmation_capture.requires_filed_at).toBe(true);
    expect(workspace.confirmation_capture.requires_confirmation_number).toBe(true);
    expect(workspace.confirmation_capture.requires_destination).toBe(true);

    const answerIds = workspace.prepared_answers.map((a) => a.id);
    expect(answerIds).toContain("consumer_name");
    expect(answerIds).toContain("company_name");
    expect(answerIds).toContain("what_happened");
    expect(answerIds).toContain("desired_resolution");
    expect(answerIds).toContain("contact_method");
    expect(workspace.prepared_answers.find((a) => a.id === "company_name")?.value).toBe(
      "North Bank"
    );

    expect(workspace.evidence).toEqual([
      {
        id: "550e8400-e29b-41d4-a716-446655440099",
        title: "Bank statement",
        evidence_type: "statement",
        file_name: "statement-march.pdf",
        evidence_date: "2026-03-01",
      },
    ]);
  });

  it("exposes prepared answers from intake for portal filing", () => {
    const answers = buildCfpbPreparedAnswers(baseIntake());
    expect(answers.find((a) => a.id === "amount")?.value).toBe("$49.00");
    expect(answers.find((a) => a.id === "order_confirmation")?.value).toBe("Acct ending 4412");
    expect(answers.every((a) => a.copyable)).toBe(true);
  });

  it("falls back to buildCfpbComplaintDraft when task notes lack a draft body", () => {
    const intake = baseIntake();
    const workspace = buildCfpbOperatorFilingWorkspace({
      intake,
      taskNotes: `cfpb_filing_queue:${CASE_ID}\ncase_id: ${CASE_ID}`,
      evidence: [],
    });
    expect(workspace.complaint_draft).toBe(buildCfpbComplaintDraft(intake));
  });

  it("never marks the workspace as submitted before completion API success", () => {
    const workspace = buildCfpbOperatorFilingWorkspace({
      intake: baseIntake(),
      evidence: [],
    });
    expect(workspace.is_submitted).toBe(false);
    expect(workspace.portal.portal_supported).toBe(true);
    expect(workspace.portal.portal_url).toBe(CFPB_OFFICIAL_CONSUMER_COMPLAINT_PORTAL_URL);
  });
});

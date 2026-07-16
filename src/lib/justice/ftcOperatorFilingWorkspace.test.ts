import { describe, expect, it } from "vitest";
import { buildFtcComplaintDraft } from "@/lib/justice/buildFtcComplaintDraft";
import { buildJusticeIntakeFromParts, defaultBuildJusticeIntakeParts } from "@/lib/justice/buildJusticeIntake";
import { buildFtcFilingTaskNotes } from "@/lib/justice/ftcFilingTask";
import { FTC_OFFICIAL_CONSUMER_COMPLAINT_PORTAL_URL } from "@/lib/justice/ftcOfficialPortal";
import {
  buildFtcOperatorFilingWorkspace,
  buildFtcPreparedAnswers,
} from "@/lib/justice/ftcOperatorFilingWorkspace";

const CASE_ID = "550e8400-e29b-41d4-a716-446655440000";

function baseIntake(overrides: Record<string, unknown> = {}) {
  return buildJusticeIntakeFromParts({
    ...defaultBuildJusticeIntakeParts(),
    problem_category: "online_purchase",
    company_name: "Scam Gadgets",
    company_website: "https://scamgadgets.example",
    purchase_or_signup: "Wireless earbuds",
    story: "I paid for earbuds that never shipped and the seller vanished after taking payment.",
    money_amount: "$129.00",
    pay_or_order_date: "2026-05-01",
    order_confirmation_details: "Order #SG-4401",
    consumer_us_state: "CA",
    user_display_name: "Alex River",
    reply_email: "alex@example.com",
    already_contacted: "yes",
    contact_method: "email",
    contact_date: "2026-05-05",
    merchant_response_type: "no_response",
    contact_proof_type: "paste",
    contact_proof_text: "No reply after three follow-ups.",
    ...overrides,
  });
}

describe("buildFtcOperatorFilingWorkspace", () => {
  it("builds a full operator workspace payload with portal, draft, answers, and evidence", () => {
    const intake = baseIntake();
    const notes = buildFtcFilingTaskNotes(CASE_ID, intake);
    const workspace = buildFtcOperatorFilingWorkspace({
      intake,
      taskNotes: notes,
      evidence: [
        {
          title: "Payment receipt",
          evidence_type: "receipt",
          file_name: "receipt-sg-4401.pdf",
          evidence_date: "2026-05-01",
        },
      ],
    });

    expect(workspace.filing_destination).toBe("FTC (consumer complaint)");
    expect(workspace.portal.portal_supported).toBe(true);
    expect(workspace.portal.portal_url).toBe(FTC_OFFICIAL_CONSUMER_COMPLAINT_PORTAL_URL);
    expect(workspace.complaint_draft.length).toBeGreaterThan(200);
    expect(workspace.complaint_draft).toContain("Scam Gadgets");
    expect(workspace.complaint_draft).toContain("never shipped");
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
      "Scam Gadgets"
    );

    expect(workspace.evidence).toEqual([
      {
        title: "Payment receipt",
        evidence_type: "receipt",
        file_name: "receipt-sg-4401.pdf",
        evidence_date: "2026-05-01",
      },
    ]);
  });

  it("exposes prepared answers from intake for portal filing", () => {
    const answers = buildFtcPreparedAnswers(baseIntake());
    expect(answers.find((a) => a.id === "amount")?.value).toBe("$129.00");
    expect(answers.find((a) => a.id === "order_confirmation")?.value).toBe("Order #SG-4401");
    expect(answers.every((a) => a.copyable)).toBe(true);
  });

  it("falls back to buildFtcComplaintDraft when task notes lack a draft body", () => {
    const intake = baseIntake();
    const workspace = buildFtcOperatorFilingWorkspace({
      intake,
      taskNotes: `ftc_filing_queue:${CASE_ID}\ncase_id: ${CASE_ID}`,
      evidence: [],
    });
    expect(workspace.complaint_draft).toBe(buildFtcComplaintDraft(intake));
  });

  it("never marks the workspace as submitted before completion API success", () => {
    const workspace = buildFtcOperatorFilingWorkspace({
      intake: baseIntake(),
      evidence: [],
    });
    expect(workspace.is_submitted).toBe(false);
    expect(workspace.portal.portal_supported).toBe(true);
    expect(workspace.portal.portal_url).toBe(FTC_OFFICIAL_CONSUMER_COMPLAINT_PORTAL_URL);
  });
});

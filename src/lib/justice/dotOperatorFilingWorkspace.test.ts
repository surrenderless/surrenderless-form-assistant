import { describe, expect, it } from "vitest";
import { buildDotAviationComplaintDraft } from "@/lib/justice/buildDotAviationComplaintDraft";
import { buildJusticeIntakeFromParts, defaultBuildJusticeIntakeParts } from "@/lib/justice/buildJusticeIntake";
import { buildDotFilingTaskNotes } from "@/lib/justice/dotFilingTask";
import { DOT_OFFICIAL_AVIATION_CONSUMER_COMPLAINT_PORTAL_URL } from "@/lib/justice/dotOfficialPortal";
import {
  buildDotOperatorFilingWorkspace,
  buildDotPreparedAnswers,
} from "@/lib/justice/dotOperatorFilingWorkspace";

const CASE_ID = "550e8400-e29b-41d4-a716-446655440000";

function baseIntake(overrides: Record<string, unknown> = {}) {
  return buildJusticeIntakeFromParts({
    ...defaultBuildJusticeIntakeParts(),
    problem_category: "service_failed",
    company_name: "SkyLink Air",
    company_website: "https://skylink.example",
    purchase_or_signup: "Flight SK-212 JFK to LAX",
    story: "My flight was cancelled and the airline refused a refund or rebooking within a reasonable time.",
    money_amount: "$640.00",
    pay_or_order_date: "2026-06-01",
    order_confirmation_details: "PNR ABC123",
    consumer_us_state: "CA",
    user_display_name: "Alex River",
    reply_email: "alex@example.com",
    already_contacted: "yes",
    contact_method: "email",
    contact_date: "2026-06-05",
    merchant_response_type: "refused_help",
    contact_proof_type: "paste",
    contact_proof_text: "Airline said no refund available.",
    ...overrides,
  });
}

describe("buildDotOperatorFilingWorkspace", () => {
  it("builds a full operator workspace payload with portal, draft, answers, and evidence", () => {
    const intake = baseIntake();
    const notes = buildDotFilingTaskNotes(CASE_ID, intake);
    const workspace = buildDotOperatorFilingWorkspace({
      intake,
      taskNotes: notes,
      evidence: [
        {
          title: "Boarding pass",
          evidence_type: "ticket",
          file_name: "boarding-pass.pdf",
          evidence_date: "2026-06-01",
        },
      ],
    });

    expect(workspace.filing_destination).toBe("USDOT / aviation consumer");
    expect(workspace.portal.portal_supported).toBe(true);
    expect(workspace.portal.portal_url).toBe(DOT_OFFICIAL_AVIATION_CONSUMER_COMPLAINT_PORTAL_URL);
    expect(workspace.portal.portal_url).toBe("https://www.transportation.gov/airconsumer");
    expect(workspace.complaint_draft.length).toBeGreaterThan(200);
    expect(workspace.complaint_draft).toContain("SkyLink Air");
    expect(workspace.complaint_draft).toContain("cancelled");
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
      "SkyLink Air"
    );

    expect(workspace.evidence).toEqual([
      {
        title: "Boarding pass",
        evidence_type: "ticket",
        file_name: "boarding-pass.pdf",
        evidence_date: "2026-06-01",
      },
    ]);
  });

  it("exposes prepared answers from intake for portal filing", () => {
    const answers = buildDotPreparedAnswers(baseIntake());
    expect(answers.find((a) => a.id === "amount")?.value).toBe("$640.00");
    expect(answers.find((a) => a.id === "order_confirmation")?.value).toBe("PNR ABC123");
    expect(answers.every((a) => a.copyable)).toBe(true);
  });

  it("falls back to buildDotAviationComplaintDraft when task notes lack a draft body", () => {
    const intake = baseIntake();
    const workspace = buildDotOperatorFilingWorkspace({
      intake,
      taskNotes: `dot_filing_queue:${CASE_ID}\ncase_id: ${CASE_ID}`,
      evidence: [],
    });
    expect(workspace.complaint_draft).toBe(buildDotAviationComplaintDraft(intake));
  });

  it("never marks the workspace as submitted before completion API success", () => {
    const workspace = buildDotOperatorFilingWorkspace({
      intake: baseIntake(),
      evidence: [],
    });
    expect(workspace.is_submitted).toBe(false);
    expect(workspace.portal.portal_supported).toBe(true);
    expect(workspace.portal.portal_url).toBe(DOT_OFFICIAL_AVIATION_CONSUMER_COMPLAINT_PORTAL_URL);
  });
});

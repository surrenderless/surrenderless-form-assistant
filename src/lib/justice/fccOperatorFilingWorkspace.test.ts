import { describe, expect, it } from "vitest";
import { buildFccComplaintDraft } from "@/lib/justice/buildFccComplaintDraft";
import { buildJusticeIntakeFromParts, defaultBuildJusticeIntakeParts } from "@/lib/justice/buildJusticeIntake";
import { buildFccFilingTaskNotes } from "@/lib/justice/fccFilingTask";
import { FCC_OFFICIAL_CONSUMER_COMPLAINT_PORTAL_URL } from "@/lib/justice/fccOfficialPortal";
import {
  buildFccOperatorFilingWorkspace,
  buildFccPreparedAnswers,
} from "@/lib/justice/fccOperatorFilingWorkspace";

const CASE_ID = "550e8400-e29b-41d4-a716-446655440000";

function baseIntake(overrides: Record<string, unknown> = {}) {
  return buildJusticeIntakeFromParts({
    ...defaultBuildJusticeIntakeParts(),
    problem_category: "service_failed",
    company_name: "Metro Wireless",
    company_website: "https://metrowireless.example",
    purchase_or_signup: "Mobile phone plan",
    story: "My service was disconnected without notice and the carrier refuses to restore it.",
    money_amount: "$85.00",
    pay_or_order_date: "2026-04-01",
    order_confirmation_details: "Acct ending 7781",
    consumer_us_state: "CA",
    user_display_name: "Alex River",
    reply_email: "alex@example.com",
    already_contacted: "yes",
    contact_method: "phone",
    contact_date: "2026-04-05",
    merchant_response_type: "refused_help",
    contact_proof_type: "paste",
    contact_proof_text: "Carrier said the account stays suspended.",
    ...overrides,
  });
}

describe("buildFccOperatorFilingWorkspace", () => {
  it("builds a full operator workspace payload with portal, draft, answers, and evidence", () => {
    const intake = baseIntake();
    const notes = buildFccFilingTaskNotes(CASE_ID, intake);
    const workspace = buildFccOperatorFilingWorkspace({
      intake,
      taskNotes: notes,
      evidence: [
        {
          id: "550e8400-e29b-41d4-a716-446655440099",
          title: "Bill PDF",
          evidence_type: "bill",
          file_name: "april-bill.pdf",
          evidence_date: "2026-04-01",
        },
      ],
    });

    expect(workspace.filing_destination).toBe("FCC");
    expect(workspace.portal.portal_supported).toBe(true);
    expect(workspace.portal.portal_url).toBe(FCC_OFFICIAL_CONSUMER_COMPLAINT_PORTAL_URL);
    expect(workspace.complaint_draft.length).toBeGreaterThan(200);
    expect(workspace.complaint_draft).toContain("Metro Wireless");
    expect(workspace.complaint_draft).toContain("disconnected without notice");
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
      "Metro Wireless"
    );

    expect(workspace.evidence).toEqual([
      {
        id: "550e8400-e29b-41d4-a716-446655440099",
        title: "Bill PDF",
        evidence_type: "bill",
        file_name: "april-bill.pdf",
        evidence_date: "2026-04-01",
      },
    ]);
  });

  it("exposes prepared answers from intake for portal filing", () => {
    const answers = buildFccPreparedAnswers(baseIntake());
    expect(answers.find((a) => a.id === "amount")?.value).toBe("$85.00");
    expect(answers.find((a) => a.id === "order_confirmation")?.value).toBe("Acct ending 7781");
    expect(answers.every((a) => a.copyable)).toBe(true);
  });

  it("falls back to buildFccComplaintDraft when task notes lack a draft body", () => {
    const intake = baseIntake();
    const workspace = buildFccOperatorFilingWorkspace({
      intake,
      taskNotes: `fcc_filing_queue:${CASE_ID}\ncase_id: ${CASE_ID}`,
      evidence: [],
    });
    expect(workspace.complaint_draft).toBe(buildFccComplaintDraft(intake));
  });

  it("never marks the workspace as submitted before completion API success", () => {
    const workspace = buildFccOperatorFilingWorkspace({
      intake: baseIntake(),
      evidence: [],
    });
    expect(workspace.is_submitted).toBe(false);
    expect(workspace.portal.portal_supported).toBe(true);
    expect(workspace.portal.portal_url).toBe(FCC_OFFICIAL_CONSUMER_COMPLAINT_PORTAL_URL);
  });
});

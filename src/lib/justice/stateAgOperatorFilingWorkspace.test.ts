import { describe, expect, it } from "vitest";
import { buildJusticeIntakeFromParts, defaultBuildJusticeIntakeParts } from "@/lib/justice/buildJusticeIntake";
import { buildStateAgComplaintDraft } from "@/lib/justice/buildStateAgComplaintDraft";
import { buildStateAgFilingTaskNotes } from "@/lib/justice/stateAgFilingTask";
import {
  buildStateAgOperatorFilingWorkspace,
  buildStateAgPreparedAnswers,
} from "@/lib/justice/stateAgOperatorFilingWorkspace";

const CASE_ID = "550e8400-e29b-41d4-a716-446655440000";

function baseIntake(overrides: Record<string, unknown> = {}) {
  return buildJusticeIntakeFromParts({
    ...defaultBuildJusticeIntakeParts(),
    problem_category: "online_purchase",
    company_name: "Laptop World",
    company_website: "https://laptop.example",
    purchase_or_signup: "Gaming laptop",
    story: "I purchased a laptop that never arrived and the seller stopped responding.",
    money_amount: "$1,299.00",
    pay_or_order_date: "2026-02-01",
    order_confirmation_details: "Order #LW-1001",
    consumer_us_state: "CA",
    user_display_name: "Alex River",
    reply_email: "alex@example.com",
    already_contacted: "yes",
    contact_method: "email",
    contact_date: "2026-02-10",
    merchant_response_type: "no_response",
    contact_proof_type: "paste",
    contact_proof_text: "No reply after two follow-ups.",
    ...overrides,
  });
}

describe("buildStateAgOperatorFilingWorkspace", () => {
  it("builds a full operator workspace payload with portal, draft, answers, and evidence", () => {
    const intake = baseIntake();
    const notes = buildStateAgFilingTaskNotes(CASE_ID, intake);
    const workspace = buildStateAgOperatorFilingWorkspace({
      intake,
      taskNotes: notes,
      evidence: [
        {
          id: "550e8400-e29b-41d4-a716-446655440099",
          title: "Order receipt",
          evidence_type: "receipt",
          file_name: "receipt-lw-1001.pdf",
          evidence_date: "2026-02-01",
        },
      ],
    });

    expect(workspace.filing_destination).toBe("State Attorney General (consumer)");
    expect(workspace.portal.portal_supported).toBe(true);
    expect(workspace.portal.portal_url).toContain("oag.ca.gov");
    expect(workspace.complaint_draft.length).toBeGreaterThan(200);
    expect(workspace.complaint_draft).toContain("Laptop World");
    expect(workspace.complaint_draft).toContain("never arrived");
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
      "Laptop World"
    );

    expect(workspace.evidence).toEqual([
      {
        id: "550e8400-e29b-41d4-a716-446655440099",
        title: "Order receipt",
        evidence_type: "receipt",
        file_name: "receipt-lw-1001.pdf",
        evidence_date: "2026-02-01",
      },
    ]);
  });

  it("exposes prepared answers from intake for portal filing", () => {
    const answers = buildStateAgPreparedAnswers(baseIntake());
    expect(answers.find((a) => a.id === "amount")?.value).toBe("$1,299.00");
    expect(answers.find((a) => a.id === "order_confirmation")?.value).toBe("Order #LW-1001");
    expect(answers.every((a) => a.copyable)).toBe(true);
  });

  it("falls back to buildStateAgComplaintDraft when task notes lack a draft body", () => {
    const intake = baseIntake();
    const workspace = buildStateAgOperatorFilingWorkspace({
      intake,
      taskNotes: `state_ag_filing_queue:${CASE_ID}\ncase_id: ${CASE_ID}`,
      evidence: [],
    });
    expect(workspace.complaint_draft).toBe(buildStateAgComplaintDraft(intake));
  });

  it("never marks the workspace as submitted before completion API success", () => {
    const workspace = buildStateAgOperatorFilingWorkspace({
      intake: baseIntake({ consumer_us_state: "AK" }),
      evidence: [],
    });
    expect(workspace.is_submitted).toBe(false);
    expect(workspace.portal.portal_supported).toBe(true);
    expect(workspace.portal.portal_url).toBe(
      "https://www.law.alaska.gov/department/civil/consumer/complaint-form.html"
    );
  });
});

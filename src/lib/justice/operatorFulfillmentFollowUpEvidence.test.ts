import { describe, expect, it } from "vitest";
import {
  classifyOpenOperatorTask,
  operatorFulfillmentStepLoadsCaseEvidence,
  withFollowUpResponseReviewEvidence,
} from "@/lib/justice/operatorFulfillmentQueue";
import { buildOperatorEvidenceViewFileControl } from "@/lib/justice/operatorWorkspaceEvidence";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";
import type { JusticeIntake } from "@/lib/justice/types";

const CASE_ID = "550e8400-e29b-41d4-a716-446655440000";
const EVIDENCE_ID = "550e8400-e29b-41d4-a716-446655440099";

const intake: JusticeIntake = {
  problem_category: "online_purchase",
  company_name: "Acme Retail",
  company_website: "",
  purchase_or_signup: "widget",
  story: "Test",
  money_involved: "$10",
  pay_or_order_date: "",
  order_confirmation_details: "",
  user_display_name: "Jordan",
  reply_email: "test@example.com",
  already_contacted: "no",
  consumer_us_state: "CA",
};

function followUpTask(overrides: Partial<JusticeCaseTaskRow> = {}): JusticeCaseTaskRow {
  return {
    id: "task-follow-up-1",
    user_id: "user_1",
    case_id: CASE_ID,
    title: "Follow-up response review",
    due_date: null,
    notes: `follow_up_response_review:${CASE_ID}\ncase_id: ${CASE_ID}\ndraft:\nReview merchant reply`,
    completed_at: null,
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("follow-up response review evidence in operator queue", () => {
  it("includes follow_up_response_review in case evidence load steps", () => {
    expect(operatorFulfillmentStepLoadsCaseEvidence("follow_up_response_review")).toBe(true);
    expect(operatorFulfillmentStepLoadsCaseEvidence("cfpb")).toBe(true);
    expect(operatorFulfillmentStepLoadsCaseEvidence("merchant_contact")).toBe(true);
  });

  it("classifies follow-up items with an empty evidence array ready for queue attach", () => {
    const item = classifyOpenOperatorTask(followUpTask(), intake);
    expect(item).not.toBeNull();
    expect(item?.step).toBe("follow_up_response_review");
    expect(item?.evidence).toEqual([]);
    expect(item?.cfpb_workspace).toBeUndefined();
    expect(item?.state_ag_workspace).toBeUndefined();
  });

  it("attaches OperatorWorkspaceEvidenceItem[] with ids for View file access", () => {
    const classified = classifyOpenOperatorTask(followUpTask(), intake);
    expect(classified).not.toBeNull();
    const withEvidence = withFollowUpResponseReviewEvidence(classified!, [
      {
        id: EVIDENCE_ID,
        title: "Merchant reply screenshot",
        evidence_type: "screenshot",
        file_name: "reply.png",
        evidence_date: "2026-07-10",
      },
    ]);

    expect(withEvidence.evidence).toEqual([
      {
        id: EVIDENCE_ID,
        title: "Merchant reply screenshot",
        evidence_type: "screenshot",
        file_name: "reply.png",
        evidence_date: "2026-07-10",
      },
    ]);

    const viewFile = buildOperatorEvidenceViewFileControl(withEvidence.evidence![0]);
    expect(viewFile).toEqual({
      href: `/api/operator/evidence/${EVIDENCE_ID}/file`,
      fileName: "reply.png",
      label: "View file",
    });
    expect(JSON.stringify(withEvidence)).not.toMatch(/file_path/);
  });

  it("does not attach top-level evidence onto other fulfillment lanes", () => {
    const cfpbNotes = `cfpb_filing_queue:${CASE_ID}\ncase_id: ${CASE_ID}\ndraft:\nBody`;
    const cfpbItem = classifyOpenOperatorTask(
      {
        ...followUpTask({
          id: "task-cfpb-1",
          title: "CFPB filing",
          notes: cfpbNotes,
        }),
      },
      intake
    );
    expect(cfpbItem?.step).toBe("cfpb");
    const unchanged = withFollowUpResponseReviewEvidence(cfpbItem!, [
      {
        id: EVIDENCE_ID,
        title: "Should not attach",
        evidence_type: "other",
        file_name: "x.pdf",
        evidence_date: null,
      },
    ]);
    expect(unchanged.evidence).toBeUndefined();
    expect(unchanged.cfpb_workspace).toBeDefined();
  });
});

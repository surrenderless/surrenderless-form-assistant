import { describe, expect, it } from "vitest";
import {
  classifyOpenOperatorTask,
  operatorFulfillmentStepLoadsCaseEvidence,
  resolveOperatorFulfillmentPanelKind,
  withFollowUpResponseReviewEvidence,
} from "@/lib/justice/operatorFulfillmentQueue";
import { buildOperatorEvidenceViewFileControl } from "@/lib/justice/operatorWorkspaceEvidence";
import {
  buildSupersededLaneResponseReviewTaskNotes,
  buildSupersededLaneResponseReviewTaskTitle,
} from "@/lib/justice/followUpResponseReviewTask";
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

const DEMAND_LETTER_HREF = "/justice/demand-letter";

function supersededLaneReviewTask(overrides: Partial<JusticeCaseTaskRow> = {}): JusticeCaseTaskRow {
  return {
    id: "task-superseded-review-1",
    user_id: "user_1",
    case_id: CASE_ID,
    title: buildSupersededLaneResponseReviewTaskTitle("Small claims / demand letter"),
    due_date: null,
    notes: buildSupersededLaneResponseReviewTaskNotes(
      CASE_ID,
      DEMAND_LETTER_HREF,
      "550e8400-e29b-41d4-a716-446655440077",
      "Small claims / demand letter"
    ),
    completed_at: null,
    created_at: "2026-07-05T00:00:00.000Z",
    updated_at: "2026-07-05T00:00:00.000Z",
    ...overrides,
  };
}

describe("superseded-lane response review in operator queue", () => {
  it("includes superseded_lane_review in case evidence load steps", () => {
    expect(operatorFulfillmentStepLoadsCaseEvidence("superseded_lane_review")).toBe(true);
  });

  it("classifies a superseded-lane review task, carrying its owner_href for the semantic completion API", () => {
    const item = classifyOpenOperatorTask(supersededLaneReviewTask(), intake);
    expect(item).not.toBeNull();
    expect(item?.step).toBe("superseded_lane_review");
    expect(item?.owner_href).toBe(DEMAND_LETTER_HREF);
    expect(item?.evidence).toEqual([]);
    expect(resolveOperatorFulfillmentPanelKind(item!)).toBe("superseded_lane_review");
  });

  it("fails closed (never surfaces) a malformed superseded-lane row with no owner_href", () => {
    const malformed = supersededLaneReviewTask({
      notes: `superseded_lane_review:${CASE_ID}\ncase_id: ${CASE_ID}`,
    });
    expect(classifyOpenOperatorTask(malformed, intake)).toBeNull();
  });

  it("attaches evidence onto a superseded-lane review item exactly like a follow-up response review", () => {
    const classified = classifyOpenOperatorTask(supersededLaneReviewTask(), intake);
    expect(classified).not.toBeNull();
    const withEvidence = withFollowUpResponseReviewEvidence(classified!, [
      {
        id: EVIDENCE_ID,
        title: "Demand letter reply",
        evidence_type: "screenshot",
        file_name: "reply.png",
        evidence_date: "2026-07-10",
      },
    ]);
    expect(withEvidence.evidence).toEqual([
      {
        id: EVIDENCE_ID,
        title: "Demand letter reply",
        evidence_type: "screenshot",
        file_name: "reply.png",
        evidence_date: "2026-07-10",
      },
    ]);
  });

  it("is surfaced by taskNotesMatchAnyOperatorFulfillmentMarker so the real queue listing includes it", async () => {
    const { taskNotesMatchAnyOperatorFulfillmentMarker } = await import(
      "@/lib/justice/operatorEvidenceFileAccess"
    );
    const task = supersededLaneReviewTask();
    expect(taskNotesMatchAnyOperatorFulfillmentMarker(task.notes, CASE_ID)).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { buildJusticeIntakeFromParts, defaultBuildJusticeIntakeParts } from "@/lib/justice/buildJusticeIntake";
import { buildCfpbFilingTaskNotes } from "@/lib/justice/cfpbFilingTask";
import { buildStateAgFilingTaskNotes } from "@/lib/justice/stateAgFilingTask";
import { buildFccFilingTaskNotes } from "@/lib/justice/fccFilingTask";
import {
  classifyOpenOperatorTask,
  resolveOperatorFulfillmentPanelKind,
} from "@/lib/justice/operatorFulfillmentQueue";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";

const CASE_ID = "550e8400-e29b-41d4-a716-446655440000";
const USER_ID = "user-owner-1";
const TASK_ID = "550e8400-e29b-41d4-a716-446655440088";

function baseIntake() {
  return buildJusticeIntakeFromParts({
    ...defaultBuildJusticeIntakeParts(),
    problem_category: "charge_dispute",
    company_name: "North Bank",
    purchase_or_signup: "Credit card account",
    story: "Unauthorized recurring charge after cancellation.",
    money_amount: "$49.00",
    pay_or_order_date: "2026-03-01",
    consumer_us_state: "CA",
    user_display_name: "Alex River",
    reply_email: "alex@example.com",
    already_contacted: "yes",
    contact_method: "email",
    contact_date: "2026-03-05",
    merchant_response_type: "refused_help",
  });
}

function openTask(notes: string): JusticeCaseTaskRow {
  return {
    id: TASK_ID,
    user_id: USER_ID,
    case_id: CASE_ID,
    title: "Operator filing",
    due_date: null,
    notes,
    completed_at: null,
    created_at: "2026-03-10T00:00:00.000Z",
    updated_at: "2026-03-10T00:00:00.000Z",
  };
}

describe("CFPB operator fulfillment queue attachment", () => {
  it("attaches cfpb_workspace only to CFPB queue items", () => {
    const intake = baseIntake();
    const cfpbItem = classifyOpenOperatorTask(
      openTask(buildCfpbFilingTaskNotes(CASE_ID, intake)),
      intake
    );
    expect(cfpbItem?.step).toBe("cfpb");
    expect(cfpbItem?.cfpb_workspace).toBeDefined();
    expect(cfpbItem?.state_ag_workspace).toBeUndefined();
    expect(cfpbItem?.cfpb_workspace?.is_submitted).toBe(false);
    expect(cfpbItem?.cfpb_workspace?.portal.portal_url).toContain("consumerfinance.gov");

    const stateAgItem = classifyOpenOperatorTask(
      openTask(buildStateAgFilingTaskNotes(CASE_ID, intake)),
      intake
    );
    expect(stateAgItem?.step).toBe("state_ag");
    expect(stateAgItem?.cfpb_workspace).toBeUndefined();
    expect(stateAgItem?.state_ag_workspace).toBeDefined();

    const fccItem = classifyOpenOperatorTask(
      openTask(buildFccFilingTaskNotes(CASE_ID, intake)),
      intake
    );
    expect(fccItem?.step).toBe("fcc");
    expect(fccItem?.cfpb_workspace).toBeUndefined();
    expect(fccItem?.state_ag_workspace).toBeUndefined();
  });
});

describe("resolveOperatorFulfillmentPanelKind", () => {
  it("branches CFPB and State AG to their workspace panels and leaves other lanes on record_form", () => {
    const intake = baseIntake();
    const cfpbItem = classifyOpenOperatorTask(
      openTask(buildCfpbFilingTaskNotes(CASE_ID, intake)),
      intake
    )!;
    const stateAgItem = classifyOpenOperatorTask(
      openTask(buildStateAgFilingTaskNotes(CASE_ID, intake)),
      intake
    )!;
    const fccItem = classifyOpenOperatorTask(
      openTask(buildFccFilingTaskNotes(CASE_ID, intake)),
      intake
    )!;

    expect(resolveOperatorFulfillmentPanelKind(cfpbItem)).toBe("cfpb_workspace");
    expect(resolveOperatorFulfillmentPanelKind(stateAgItem)).toBe("state_ag_workspace");
    expect(resolveOperatorFulfillmentPanelKind(fccItem)).toBe("record_form");
    expect(
      resolveOperatorFulfillmentPanelKind({
        step: "cfpb",
        // Missing workspace falls back to record form
      })
    ).toBe("record_form");
    expect(
      resolveOperatorFulfillmentPanelKind({
        step: "follow_up_response_review",
      })
    ).toBe("follow_up_response_review");
  });
});

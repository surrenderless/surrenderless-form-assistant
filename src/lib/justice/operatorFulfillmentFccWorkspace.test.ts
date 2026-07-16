import { describe, expect, it } from "vitest";
import { buildJusticeIntakeFromParts, defaultBuildJusticeIntakeParts } from "@/lib/justice/buildJusticeIntake";
import { buildCfpbFilingTaskNotes } from "@/lib/justice/cfpbFilingTask";
import { buildDotFilingTaskNotes } from "@/lib/justice/dotFilingTask";
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
    problem_category: "service_failed",
    company_name: "Metro Wireless",
    purchase_or_signup: "Mobile phone plan",
    story: "Service disconnected without notice.",
    money_amount: "$85.00",
    pay_or_order_date: "2026-04-01",
    consumer_us_state: "CA",
    user_display_name: "Alex River",
    reply_email: "alex@example.com",
    already_contacted: "yes",
    contact_method: "phone",
    contact_date: "2026-04-05",
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
    created_at: "2026-04-10T00:00:00.000Z",
    updated_at: "2026-04-10T00:00:00.000Z",
  };
}

describe("FCC operator fulfillment queue attachment", () => {
  it("attaches fcc_workspace only to FCC queue items", () => {
    const intake = baseIntake();
    const fccItem = classifyOpenOperatorTask(
      openTask(buildFccFilingTaskNotes(CASE_ID, intake)),
      intake
    );
    expect(fccItem?.step).toBe("fcc");
    expect(fccItem?.fcc_workspace).toBeDefined();
    expect(fccItem?.cfpb_workspace).toBeUndefined();
    expect(fccItem?.state_ag_workspace).toBeUndefined();
    expect(fccItem?.fcc_workspace?.is_submitted).toBe(false);
    expect(fccItem?.fcc_workspace?.portal.portal_url).toBe("https://consumercomplaints.fcc.gov/");

    const cfpbItem = classifyOpenOperatorTask(
      openTask(buildCfpbFilingTaskNotes(CASE_ID, intake)),
      intake
    );
    expect(cfpbItem?.step).toBe("cfpb");
    expect(cfpbItem?.fcc_workspace).toBeUndefined();
    expect(cfpbItem?.cfpb_workspace).toBeDefined();

    const dotItem = classifyOpenOperatorTask(
      openTask(buildDotFilingTaskNotes(CASE_ID, intake)),
      intake
    );
    expect(dotItem?.step).toBe("dot");
    expect(dotItem?.fcc_workspace).toBeUndefined();
    expect(dotItem?.cfpb_workspace).toBeUndefined();
  });
});

describe("resolveOperatorFulfillmentPanelKind FCC branching", () => {
  it("branches FCC to fcc_workspace and leaves non-workspace lanes on record_form", () => {
    const intake = baseIntake();
    const fccItem = classifyOpenOperatorTask(
      openTask(buildFccFilingTaskNotes(CASE_ID, intake)),
      intake
    )!;
    const cfpbItem = classifyOpenOperatorTask(
      openTask(buildCfpbFilingTaskNotes(CASE_ID, intake)),
      intake
    )!;
    const dotItem = classifyOpenOperatorTask(
      openTask(buildDotFilingTaskNotes(CASE_ID, intake)),
      intake
    )!;

    expect(resolveOperatorFulfillmentPanelKind(fccItem)).toBe("fcc_workspace");
    expect(resolveOperatorFulfillmentPanelKind(cfpbItem)).toBe("cfpb_workspace");
    expect(resolveOperatorFulfillmentPanelKind(dotItem)).toBe("dot_workspace");
    expect(
      resolveOperatorFulfillmentPanelKind({
        step: "fcc",
      })
    ).toBe("record_form");
  });
});

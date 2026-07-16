import { describe, expect, it } from "vitest";
import { buildJusticeIntakeFromParts, defaultBuildJusticeIntakeParts } from "@/lib/justice/buildJusticeIntake";
import { buildDotFilingTaskNotes } from "@/lib/justice/dotFilingTask";
import { buildFccFilingTaskNotes } from "@/lib/justice/fccFilingTask";
import { buildFtcFilingTaskNotes } from "@/lib/justice/ftcFilingTask";
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
    problem_category: "online_purchase",
    company_name: "Scam Gadgets",
    purchase_or_signup: "Wireless earbuds",
    story: "Paid for earbuds that never shipped.",
    money_amount: "$129.00",
    pay_or_order_date: "2026-05-01",
    consumer_us_state: "CA",
    user_display_name: "Alex River",
    reply_email: "alex@example.com",
    already_contacted: "yes",
    contact_method: "email",
    contact_date: "2026-05-05",
    merchant_response_type: "no_response",
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
    created_at: "2026-05-10T00:00:00.000Z",
    updated_at: "2026-05-10T00:00:00.000Z",
  };
}

describe("FTC operator fulfillment queue attachment", () => {
  it("attaches ftc_workspace only to FTC queue items", () => {
    const intake = baseIntake();
    const ftcItem = classifyOpenOperatorTask(
      openTask(buildFtcFilingTaskNotes(CASE_ID, intake)),
      intake
    );
    expect(ftcItem?.step).toBe("ftc");
    expect(ftcItem?.ftc_workspace).toBeDefined();
    expect(ftcItem?.fcc_workspace).toBeUndefined();
    expect(ftcItem?.cfpb_workspace).toBeUndefined();
    expect(ftcItem?.ftc_workspace?.is_submitted).toBe(false);
    expect(ftcItem?.ftc_workspace?.portal.portal_url).toBe("https://reportfraud.ftc.gov/");

    const fccItem = classifyOpenOperatorTask(
      openTask(buildFccFilingTaskNotes(CASE_ID, intake)),
      intake
    );
    expect(fccItem?.step).toBe("fcc");
    expect(fccItem?.ftc_workspace).toBeUndefined();
    expect(fccItem?.fcc_workspace).toBeDefined();

    const dotItem = classifyOpenOperatorTask(
      openTask(buildDotFilingTaskNotes(CASE_ID, intake)),
      intake
    );
    expect(dotItem?.step).toBe("dot");
    expect(dotItem?.ftc_workspace).toBeUndefined();
    expect(dotItem?.fcc_workspace).toBeUndefined();
  });
});

describe("resolveOperatorFulfillmentPanelKind FTC branching", () => {
  it("branches FTC to ftc_workspace and leaves non-workspace lanes on record_form", () => {
    const intake = baseIntake();
    const ftcItem = classifyOpenOperatorTask(
      openTask(buildFtcFilingTaskNotes(CASE_ID, intake)),
      intake
    )!;
    const fccItem = classifyOpenOperatorTask(
      openTask(buildFccFilingTaskNotes(CASE_ID, intake)),
      intake
    )!;
    const dotItem = classifyOpenOperatorTask(
      openTask(buildDotFilingTaskNotes(CASE_ID, intake)),
      intake
    )!;

    expect(resolveOperatorFulfillmentPanelKind(ftcItem)).toBe("ftc_workspace");
    expect(resolveOperatorFulfillmentPanelKind(fccItem)).toBe("fcc_workspace");
    expect(resolveOperatorFulfillmentPanelKind(dotItem)).toBe("record_form");
    expect(
      resolveOperatorFulfillmentPanelKind({
        step: "ftc",
      })
    ).toBe("record_form");
  });
});

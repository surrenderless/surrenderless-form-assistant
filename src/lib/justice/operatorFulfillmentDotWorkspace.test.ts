import { describe, expect, it } from "vitest";
import { buildJusticeIntakeFromParts, defaultBuildJusticeIntakeParts } from "@/lib/justice/buildJusticeIntake";
import { buildBbbFilingTaskNotes } from "@/lib/justice/bbbFilingTask";
import { buildDotFilingTaskNotes } from "@/lib/justice/dotFilingTask";
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
    problem_category: "service_failed",
    company_name: "SkyLink Air",
    purchase_or_signup: "Flight SK-212",
    story: "Flight cancelled with no refund.",
    money_amount: "$640.00",
    pay_or_order_date: "2026-06-01",
    consumer_us_state: "CA",
    user_display_name: "Alex River",
    reply_email: "alex@example.com",
    already_contacted: "yes",
    contact_method: "email",
    contact_date: "2026-06-05",
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
    created_at: "2026-06-10T00:00:00.000Z",
    updated_at: "2026-06-10T00:00:00.000Z",
  };
}

describe("DOT operator fulfillment queue attachment", () => {
  it("attaches dot_workspace only to DOT queue items", () => {
    const intake = baseIntake();
    const dotItem = classifyOpenOperatorTask(
      openTask(buildDotFilingTaskNotes(CASE_ID, intake)),
      intake
    );
    expect(dotItem?.step).toBe("dot");
    expect(dotItem?.dot_workspace).toBeDefined();
    expect(dotItem?.ftc_workspace).toBeUndefined();
    expect(dotItem?.fcc_workspace).toBeUndefined();
    expect(dotItem?.dot_workspace?.is_submitted).toBe(false);
    expect(dotItem?.dot_workspace?.portal.portal_url).toBe(
      "https://www.transportation.gov/airconsumer"
    );

    const ftcItem = classifyOpenOperatorTask(
      openTask(buildFtcFilingTaskNotes(CASE_ID, intake)),
      intake
    );
    expect(ftcItem?.step).toBe("ftc");
    expect(ftcItem?.dot_workspace).toBeUndefined();
    expect(ftcItem?.ftc_workspace).toBeDefined();

    const bbbItem = classifyOpenOperatorTask(
      openTask(buildBbbFilingTaskNotes(CASE_ID, intake)),
      intake
    );
    expect(bbbItem?.step).toBe("bbb");
    expect(bbbItem?.dot_workspace).toBeUndefined();
    expect(bbbItem?.ftc_workspace).toBeUndefined();
  });
});

describe("resolveOperatorFulfillmentPanelKind DOT branching", () => {
  it("branches DOT to dot_workspace and leaves non-workspace lanes on record_form", () => {
    const intake = baseIntake();
    const dotItem = classifyOpenOperatorTask(
      openTask(buildDotFilingTaskNotes(CASE_ID, intake)),
      intake
    )!;
    const ftcItem = classifyOpenOperatorTask(
      openTask(buildFtcFilingTaskNotes(CASE_ID, intake)),
      intake
    )!;
    const bbbItem = classifyOpenOperatorTask(
      openTask(buildBbbFilingTaskNotes(CASE_ID, intake)),
      intake
    )!;

    expect(resolveOperatorFulfillmentPanelKind(dotItem)).toBe("dot_workspace");
    expect(resolveOperatorFulfillmentPanelKind(ftcItem)).toBe("ftc_workspace");
    expect(resolveOperatorFulfillmentPanelKind(bbbItem)).toBe("record_form");
    expect(
      resolveOperatorFulfillmentPanelKind({
        step: "dot",
      })
    ).toBe("record_form");
  });
});

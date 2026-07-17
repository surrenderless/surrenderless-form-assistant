import { describe, expect, it, vi } from "vitest";
import { buildJusticeIntakeFromParts, defaultBuildJusticeIntakeParts } from "@/lib/justice/buildJusticeIntake";
import { buildBbbFilingTaskNotes } from "@/lib/justice/bbbFilingTask";
import { buildDemandLetterFilingTaskNotes } from "@/lib/justice/demandLetterFilingTask";
import { buildDotFilingTaskNotes } from "@/lib/justice/dotFilingTask";
import { buildDemandLetterOperatorFilingWorkspace } from "@/lib/justice/demandLetterOperatorFilingWorkspace";
import {
  classifyOpenOperatorTask,
  resolveOperatorFulfillmentPanelKind,
} from "@/lib/justice/operatorFulfillmentQueue";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";

const CASE_ID = "550e8400-e29b-41d4-a716-446655440000";
const USER_ID = "user-owner-1";
const TASK_ID = "550e8400-e29b-41d4-a716-446655440088";

vi.mock("@/lib/justice/completeDemandLetterOperatorFiling", () => ({
  completeDemandLetterOperatorFiling: vi.fn(),
}));

import { completeDemandLetterOperatorFiling } from "@/lib/justice/completeDemandLetterOperatorFiling";

function baseIntake(overrides: Record<string, unknown> = {}) {
  return buildJusticeIntakeFromParts({
    ...defaultBuildJusticeIntakeParts(),
    problem_category: "online_purchase",
    company_name: "Acme Retail",
    company_contact_email: "support@acme.example",
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
    ...overrides,
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

describe("demand-letter operator fulfillment queue attachment", () => {
  it("attaches demand_letter_workspace only to demand-letter queue items", () => {
    const intake = baseIntake();
    const dlItem = classifyOpenOperatorTask(
      openTask(buildDemandLetterFilingTaskNotes(CASE_ID, intake)),
      intake
    );
    expect(dlItem?.step).toBe("demand_letter");
    expect(dlItem?.demand_letter_workspace).toBeDefined();
    expect(dlItem?.dot_workspace).toBeUndefined();
    expect(dlItem?.ftc_workspace).toBeUndefined();
    expect(dlItem?.demand_letter_workspace?.is_submitted).toBe(false);
    expect(dlItem?.demand_letter_workspace?.delivery.recipient_email).toBe(
      "support@acme.example"
    );

    const dotItem = classifyOpenOperatorTask(
      openTask(buildDotFilingTaskNotes(CASE_ID, intake)),
      intake
    );
    expect(dotItem?.step).toBe("dot");
    expect(dotItem?.demand_letter_workspace).toBeUndefined();
    expect(dotItem?.dot_workspace).toBeDefined();

    const bbbItem = classifyOpenOperatorTask(
      openTask(buildBbbFilingTaskNotes(CASE_ID, intake)),
      intake
    );
    expect(bbbItem?.step).toBe("bbb");
    expect(bbbItem?.demand_letter_workspace).toBeUndefined();
  });
});

describe("resolveOperatorFulfillmentPanelKind demand-letter branching", () => {
  it("branches demand letter to demand_letter_workspace and leaves non-workspace lanes on record_form", () => {
    const intake = baseIntake();
    const dlItem = classifyOpenOperatorTask(
      openTask(buildDemandLetterFilingTaskNotes(CASE_ID, intake)),
      intake
    )!;
    const dotItem = classifyOpenOperatorTask(
      openTask(buildDotFilingTaskNotes(CASE_ID, intake)),
      intake
    )!;
    const bbbItem = classifyOpenOperatorTask(
      openTask(buildBbbFilingTaskNotes(CASE_ID, intake)),
      intake
    )!;

    expect(resolveOperatorFulfillmentPanelKind(dlItem)).toBe("demand_letter_workspace");
    expect(resolveOperatorFulfillmentPanelKind(dotItem)).toBe("dot_workspace");
    expect(resolveOperatorFulfillmentPanelKind(bbbItem)).toBe("bbb_workspace");
    expect(
      resolveOperatorFulfillmentPanelKind({
        step: "demand_letter",
      })
    ).toBe("record_form");
  });
});

describe("demand-letter workspace automated-delivery coexistence", () => {
  it("keeps is_submitted false when email is eligible and does not call the complete API", () => {
    vi.mocked(completeDemandLetterOperatorFiling).mockClear();
    const workspace = buildDemandLetterOperatorFilingWorkspace({
      intake: baseIntake({ company_contact_email: "support@acme.example" }),
    });
    expect(workspace.delivery.automated_email_eligible).toBe(true);
    expect(workspace.is_submitted).toBe(false);
    expect(completeDemandLetterOperatorFiling).not.toHaveBeenCalled();
  });

  it("keeps manual fallback available when email automation is ineligible", () => {
    const workspace = buildDemandLetterOperatorFilingWorkspace({
      intake: baseIntake({ company_contact_email: "" }),
    });
    expect(workspace.delivery.automated_email_eligible).toBe(false);
    expect(workspace.letter_draft.length).toBeGreaterThan(50);
    expect(workspace.is_submitted).toBe(false);
    const intakeNoEmail = baseIntake({ company_contact_email: "" });
    const item = classifyOpenOperatorTask(
      openTask(buildDemandLetterFilingTaskNotes(CASE_ID, intakeNoEmail)),
      intakeNoEmail
    );
    expect(resolveOperatorFulfillmentPanelKind(item!)).toBe("demand_letter_workspace");
  });
});

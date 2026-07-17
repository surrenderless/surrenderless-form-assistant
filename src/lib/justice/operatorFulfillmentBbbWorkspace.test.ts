import { describe, expect, it, vi } from "vitest";
import { buildJusticeIntakeFromParts, defaultBuildJusticeIntakeParts } from "@/lib/justice/buildJusticeIntake";
import { buildBbbFilingTaskNotes } from "@/lib/justice/bbbFilingTask";
import { buildDemandLetterFilingTaskNotes } from "@/lib/justice/demandLetterFilingTask";
import { buildMerchantContactFilingTaskNotes } from "@/lib/justice/merchantContactFilingTask";
import { buildBbbOperatorFilingWorkspace } from "@/lib/justice/bbbOperatorFilingWorkspace";
import {
  classifyOpenOperatorTask,
  resolveOperatorFulfillmentPanelKind,
} from "@/lib/justice/operatorFulfillmentQueue";
import { isRealBbbComplaintAutofillEnabled } from "@/lib/justice/realBbbAutofillEnabled";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";

const CASE_ID = "550e8400-e29b-41d4-a716-446655440000";
const USER_ID = "user-owner-1";
const TASK_ID = "550e8400-e29b-41d4-a716-446655440088";

vi.mock("@/lib/justice/completeBbbOperatorFiling", () => ({
  completeBbbOperatorFiling: vi.fn(),
}));

vi.mock("@/lib/justice/bbbOwnedFilingDelivery", () => ({
  attemptAutomatedBbbFiling: vi.fn(),
  attemptAutomatedBbbFilingAfterEnsure: vi.fn(),
}));

import { completeBbbOperatorFiling } from "@/lib/justice/completeBbbOperatorFiling";
import { attemptAutomatedBbbFiling } from "@/lib/justice/bbbOwnedFilingDelivery";

function baseIntake() {
  return buildJusticeIntakeFromParts({
    ...defaultBuildJusticeIntakeParts(),
    problem_category: "online_purchase",
    company_name: "Acme Retail",
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

describe("BBB operator fulfillment queue attachment", () => {
  it("attaches bbb_workspace only to BBB queue items", () => {
    const intake = baseIntake();
    const bbbItem = classifyOpenOperatorTask(
      openTask(buildBbbFilingTaskNotes(CASE_ID, intake)),
      intake
    );
    expect(bbbItem?.step).toBe("bbb");
    expect(bbbItem?.bbb_workspace).toBeDefined();
    expect(bbbItem?.demand_letter_workspace).toBeUndefined();
    expect(bbbItem?.dot_workspace).toBeUndefined();
    expect(bbbItem?.bbb_workspace?.is_submitted).toBe(false);
    expect(bbbItem?.bbb_workspace?.portal.portal_url).toBe("https://www.bbb.org/complain/");

    const dlItem = classifyOpenOperatorTask(
      openTask(buildDemandLetterFilingTaskNotes(CASE_ID, intake)),
      intake
    );
    expect(dlItem?.step).toBe("demand_letter");
    expect(dlItem?.bbb_workspace).toBeUndefined();
    expect(dlItem?.demand_letter_workspace).toBeDefined();
  });
});

describe("resolveOperatorFulfillmentPanelKind BBB branching", () => {
  it("branches BBB to bbb_workspace and leaves non-workspace lanes on record_form", () => {
    const intake = baseIntake();
    const bbbItem = classifyOpenOperatorTask(
      openTask(buildBbbFilingTaskNotes(CASE_ID, intake)),
      intake
    )!;
    const dlItem = classifyOpenOperatorTask(
      openTask(buildDemandLetterFilingTaskNotes(CASE_ID, intake)),
      intake
    )!;
    const merchantItem = classifyOpenOperatorTask(
      openTask(buildMerchantContactFilingTaskNotes(CASE_ID, intake)),
      intake
    )!;

    expect(resolveOperatorFulfillmentPanelKind(bbbItem)).toBe("bbb_workspace");
    expect(resolveOperatorFulfillmentPanelKind(dlItem)).toBe("demand_letter_workspace");
    expect(resolveOperatorFulfillmentPanelKind(merchantItem)).toBe("record_form");
    expect(
      resolveOperatorFulfillmentPanelKind({
        step: "bbb",
      })
    ).toBe("record_form");
  });
});

describe("BBB workspace owned-autofill coexistence and lane isolation", () => {
  it("does not call complete API or owned autofill delivery when building the fallback workspace", () => {
    vi.mocked(completeBbbOperatorFiling).mockClear();
    vi.mocked(attemptAutomatedBbbFiling).mockClear();
    const workspace = buildBbbOperatorFilingWorkspace({ intake: baseIntake() });
    expect(workspace.is_submitted).toBe(false);
    expect(workspace.owned_autofill_enabled).toBe(isRealBbbComplaintAutofillEnabled());
    expect(completeBbbOperatorFiling).not.toHaveBeenCalled();
    expect(attemptAutomatedBbbFiling).not.toHaveBeenCalled();
  });

  it("keeps merchant/payment-style lanes isolated on record_form", () => {
    const intake = baseIntake();
    const merchantItem = classifyOpenOperatorTask(
      openTask(buildMerchantContactFilingTaskNotes(CASE_ID, intake)),
      intake
    );
    expect(merchantItem?.step).toBe("merchant_contact");
    expect(merchantItem?.bbb_workspace).toBeUndefined();
    expect(resolveOperatorFulfillmentPanelKind(merchantItem!)).toBe("record_form");
  });
});

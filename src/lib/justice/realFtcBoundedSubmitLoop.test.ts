import { describe, expect, it } from "vitest";
import {
  buildFtcAssistantChoiceDecision,
  buildFtcEntryReportNowDecision,
  buildRealFtcIncompleteError,
  detectRealFtcTerminalConfirmation,
  extractFtcConfirmationReference,
  isFtcReportAssistantUrl,
  isFtcReportChoiceFlowUrl,
  isFtcReportEntryUrl,
  isFtcReportFormMainUrl,
  REAL_FTC_MAX_SUBMIT_STEPS,
} from "@/lib/justice/realFtcBoundedSubmitLoop";
import {
  REAL_BBB_MAX_SUBMIT_STEPS,
  hasReachedStepCap,
  type AssistedFormChoiceControl,
} from "@/lib/justice/realBbbBoundedSubmitLoop";
import type { AssistedFormPageData } from "@/lib/justice/realBbbBoundedSubmitLoop";

function pageData(partial: Partial<AssistedFormPageData>): AssistedFormPageData {
  return {
    fields: [],
    buttons: [],
    url: "https://reportfraud.ftc.gov/",
    pageText: "",
    ...partial,
  };
}

function choice(
  overrides: Partial<AssistedFormChoiceControl> = {}
): AssistedFormChoiceControl {
  return {
    source: "native",
    kind: "radio",
    name: "category",
    id: "cat-radio-2",
    optionValue: "Online shopping",
    accessibleName: "Online shopping",
    visible: false,
    enabled: true,
    checked: false,
    ...overrides,
  };
}

describe("REAL_FTC_MAX_SUBMIT_STEPS", () => {
  it("is independently 24 and does not share BBB's cap of 8", () => {
    expect(REAL_FTC_MAX_SUBMIT_STEPS).toBe(24);
    expect(REAL_BBB_MAX_SUBMIT_STEPS).toBe(8);
    expect(REAL_FTC_MAX_SUBMIT_STEPS).not.toBe(REAL_BBB_MAX_SUBMIT_STEPS);
    expect(hasReachedStepCap(8, REAL_FTC_MAX_SUBMIT_STEPS)).toBe(false);
    expect(hasReachedStepCap(24, REAL_FTC_MAX_SUBMIT_STEPS)).toBe(true);
    expect(hasReachedStepCap(8, REAL_BBB_MAX_SUBMIT_STEPS)).toBe(true);
  });
});

describe("isFtcReportEntryUrl", () => {
  it("accepts only the official HTTPS bare entry root", () => {
    expect(isFtcReportEntryUrl("https://reportfraud.ftc.gov/")).toBe(true);
    expect(isFtcReportEntryUrl("https://reportfraud.ftc.gov/#/")).toBe(true);
    expect(isFtcReportEntryUrl("https://reportfraud.ftc.gov/assistant")).toBe(false);
    expect(isFtcReportEntryUrl("https://reportfraud.ftc.gov/?source=test")).toBe(false);
    expect(isFtcReportEntryUrl("https://example.com/")).toBe(false);
    expect(isFtcReportEntryUrl("http://reportfraud.ftc.gov/")).toBe(false);
  });
});

describe("buildFtcEntryReportNowDecision", () => {
  it("returns the fixed Report Now decision used on the entry root", () => {
    expect(buildFtcEntryReportNowDecision()).toEqual({
      nextButton: { selectorType: "text", value: "Report Now" },
      waitForNavigation: true,
    });
  });
});

describe("buildFtcAssistantChoiceDecision", () => {
  const assistantUrl = "https://reportfraud.ftc.gov/assistant";

  it("matches a scraped category by normalized issue_type", () => {
    const decision = buildFtcAssistantChoiceDecision(
      pageData({
        url: assistantUrl,
        choiceControls: [
          choice({
            id: "cat-radio-11",
            optionValue: "Something else",
            accessibleName: "Something else",
          }),
        ],
      }),
      { issue_type: "something else" }
    );
    expect(decision).toEqual({
      fieldsToFill: [
        {
          selector: "cat-radio-11",
          value: "Something else",
          controlKind: "radio",
          choiceSelectorType: "id",
        },
      ],
      nextButton: { selectorType: "text", value: "Continue" },
      waitForNavigation: true,
    });
  });

  it("maps online_purchase / online purchase to Online shopping", () => {
    const decision = buildFtcAssistantChoiceDecision(
      pageData({
        url: assistantUrl,
        choiceControls: [choice()],
      }),
      { issue_type: "online purchase" }
    );
    expect(decision?.fieldsToFill?.[0]).toEqual({
      selector: "cat-radio-2",
      value: "Online shopping",
      controlKind: "radio",
      choiceSelectorType: "id",
    });
  });

  it("maps something_else alias to Something else", () => {
    const decision = buildFtcAssistantChoiceDecision(
      pageData({
        url: assistantUrl,
        choiceControls: [
          choice({
            id: "cat-radio-11",
            optionValue: "Something else",
            accessibleName: "Something else",
          }),
        ],
      }),
      { issue_type: "something_else" }
    );
    expect(decision?.fieldsToFill?.[0]?.selector).toBe("cat-radio-11");
  });

  it("returns null when no enabled radio matches", () => {
    expect(
      buildFtcAssistantChoiceDecision(
        pageData({
          url: assistantUrl,
          choiceControls: [choice()],
        }),
        { issue_type: "charge dispute" }
      )
    ).toBeNull();
  });

  it("returns null when multiple enabled radios match ambiguously", () => {
    expect(
      buildFtcAssistantChoiceDecision(
        pageData({
          url: assistantUrl,
          choiceControls: [
            choice({ id: "cat-radio-2a" }),
            choice({ id: "cat-radio-2b" }),
          ],
        }),
        { issue_type: "online purchase" }
      )
    ).toBeNull();
  });

  it("ignores disabled matching radios", () => {
    expect(
      buildFtcAssistantChoiceDecision(
        pageData({
          url: assistantUrl,
          choiceControls: [choice({ enabled: false })],
        }),
        { issue_type: "online purchase" }
      )
    ).toBeNull();
  });

  it("returns null for non-assistant URLs", () => {
    expect(
      buildFtcAssistantChoiceDecision(
        pageData({
          url: "https://reportfraud.ftc.gov/form/main",
          choiceControls: [choice()],
        }),
        { issue_type: "online purchase" }
      )
    ).toBeNull();
    expect(
      buildFtcAssistantChoiceDecision(
        pageData({
          url: "https://reportfraud.ftc.gov/",
          choiceControls: [choice()],
        }),
        { issue_type: "online purchase" }
      )
    ).toBeNull();
  });

  it("emits Continue-only when the matched parent is already checked and Continue is enabled", () => {
    const decision = buildFtcAssistantChoiceDecision(
      pageData({
        url: assistantUrl,
        buttons: [{ text: "Continue", id: "", name: "", type: "button" }],
        choiceControls: [choice({ checked: true })],
      }),
      { issue_type: "online purchase" }
    );
    expect(decision).toEqual({
      nextButton: { selectorType: "text", value: "Continue" },
      waitForNavigation: true,
    });
    expect(decision).not.toHaveProperty("fieldsToFill");
  });

  it("never re-emits an already checked parent when Continue is disabled", () => {
    const decision = buildFtcAssistantChoiceDecision(
      pageData({
        url: assistantUrl,
        buttons: [],
        choiceControls: [
          choice({ checked: true }),
          choice({
            id: "sub-radio-1",
            optionValue: "Did not receive what was ordered",
            accessibleName: "Did not receive what was ordered",
            checked: false,
          }),
        ],
      }),
      { issue_type: "online purchase" }
    );
    expect(decision?.fieldsToFill?.[0]?.selector).toBe("sub-radio-1");
    expect(decision?.fieldsToFill?.[0]?.selector).not.toBe("cat-radio-2");
  });

  it("selects the unique enabled unchecked next radio when Continue is disabled", () => {
    const decision = buildFtcAssistantChoiceDecision(
      pageData({
        url: assistantUrl,
        buttons: [{ text: "Back", id: "", name: "", type: "button" }],
        choiceControls: [
          choice({ checked: true }),
          choice({
            id: "sub-radio-1",
            optionValue: "Item never arrived",
            accessibleName: "Item never arrived",
            checked: false,
          }),
        ],
      }),
      { issue_type: "online purchase" }
    );
    expect(decision).toEqual({
      fieldsToFill: [
        {
          selector: "sub-radio-1",
          value: "Item never arrived",
          controlKind: "radio",
          choiceSelectorType: "id",
        },
      ],
      nextButton: { selectorType: "text", value: "Continue" },
      waitForNavigation: true,
    });
  });

  it("fails closed when Continue is disabled and there is no unchecked next radio", () => {
    expect(
      buildFtcAssistantChoiceDecision(
        pageData({
          url: assistantUrl,
          buttons: [],
          choiceControls: [choice({ checked: true })],
        }),
        { issue_type: "online purchase" }
      )
    ).toBeNull();
  });

  it("fails closed when Continue is disabled and next radios are ambiguous", () => {
    expect(
      buildFtcAssistantChoiceDecision(
        pageData({
          url: assistantUrl,
          buttons: [],
          choiceControls: [
            choice({ checked: true }),
            choice({
              id: "sub-a",
              optionValue: "Option A",
              accessibleName: "Option A",
              checked: false,
            }),
            choice({
              id: "sub-b",
              optionValue: "Option B",
              accessibleName: "Option B",
              checked: false,
            }),
          ],
        }),
        { issue_type: "online purchase" }
      )
    ).toBeNull();
  });

  it("ignores disabled unchecked next radios when selecting a unique next choice", () => {
    expect(
      buildFtcAssistantChoiceDecision(
        pageData({
          url: assistantUrl,
          buttons: [],
          choiceControls: [
            choice({ checked: true }),
            choice({
              id: "sub-disabled",
              optionValue: "Disabled option",
              accessibleName: "Disabled option",
              checked: false,
              enabled: false,
            }),
            choice({
              id: "sub-enabled",
              optionValue: "Enabled option",
              accessibleName: "Enabled option",
              checked: false,
            }),
          ],
        }),
        { issue_type: "online purchase" }
      )?.fieldsToFill?.[0]?.selector
    ).toBe("sub-enabled");
  });
});

describe("isFtcReportAssistantUrl", () => {
  it("accepts only the official HTTPS assistant path", () => {
    expect(isFtcReportAssistantUrl("https://reportfraud.ftc.gov/assistant")).toBe(true);
    expect(isFtcReportAssistantUrl("https://reportfraud.ftc.gov/assistant?page=2")).toBe(true);
    expect(isFtcReportAssistantUrl("https://reportfraud.ftc.gov/")).toBe(false);
    expect(isFtcReportAssistantUrl("https://example.com/assistant")).toBe(false);
    expect(isFtcReportAssistantUrl("http://reportfraud.ftc.gov/assistant")).toBe(false);
  });
});

describe("isFtcReportFormMainUrl / isFtcReportChoiceFlowUrl", () => {
  it("accepts only the official HTTPS form main path and choice-flow union", () => {
    expect(isFtcReportFormMainUrl("https://reportfraud.ftc.gov/form/main")).toBe(true);
    expect(isFtcReportFormMainUrl("https://reportfraud.ftc.gov/form/main?x=1")).toBe(true);
    expect(isFtcReportFormMainUrl("https://reportfraud.ftc.gov/assistant")).toBe(false);
    expect(isFtcReportFormMainUrl("https://example.com/form/main")).toBe(false);
    expect(isFtcReportChoiceFlowUrl("https://reportfraud.ftc.gov/form/main")).toBe(true);
    expect(isFtcReportChoiceFlowUrl("https://reportfraud.ftc.gov/assistant")).toBe(true);
    expect(isFtcReportChoiceFlowUrl("https://reportfraud.ftc.gov/")).toBe(false);
  });
});

describe("detectRealFtcTerminalConfirmation", () => {
  it("does not treat the ReportFraud entry page as terminal", () => {
    expect(
      detectRealFtcTerminalConfirmation(
        pageData({ url: "https://reportfraud.ftc.gov/", pageText: "Report fraud to the FTC" })
      )
    ).toBe(false);
  });

  it("does not treat an uncertain mid-wizard page as terminal", () => {
    expect(
      detectRealFtcTerminalConfirmation(
        pageData({
          url: "https://reportfraud.ftc.gov/#/?orgcode=X&pageNumber=3",
          pageText: "Tell us what happened. Continue to the next step.",
        })
      )
    ).toBe(false);
  });

  it("ignores confirmation-like text on non-FTC hosts", () => {
    expect(
      detectRealFtcTerminalConfirmation(
        pageData({
          url: "https://evil.example/thank-you",
          pageText: "Thank you for your report. Report number: 123456",
        })
      )
    ).toBe(false);
  });

  it("detects a terminal confirmation by strong body text", () => {
    expect(
      detectRealFtcTerminalConfirmation(
        pageData({
          url: "https://reportfraud.ftc.gov/#/thank-you",
          pageText: "Thank you for your report. Your report number is 987654.",
        })
      )
    ).toBe(true);
  });

  it("detects a terminal confirmation by confirmation-like URL path", () => {
    expect(
      detectRealFtcTerminalConfirmation(
        pageData({ url: "https://reportfraud.ftc.gov/confirmation", pageText: "" })
      )
    ).toBe(true);
  });
});

describe("extractFtcConfirmationReference", () => {
  it("extracts a report number when present", () => {
    expect(
      extractFtcConfirmationReference("Thank you. Report number: FTC-2026-4455")
    ).toBe("FTC-2026-4455");
  });

  it("extracts a reference number when present", () => {
    expect(extractFtcConfirmationReference("Your reference number is 55AA99B.")).toBe("55AA99B");
  });

  it("returns null when no identifier can be read", () => {
    expect(extractFtcConfirmationReference("Thank you for your report.")).toBeNull();
    expect(extractFtcConfirmationReference(null)).toBeNull();
  });
});

describe("buildRealFtcIncompleteError", () => {
  it("mentions the step cap for max_steps_reached", () => {
    expect(buildRealFtcIncompleteError("max_steps_reached", REAL_FTC_MAX_SUBMIT_STEPS)).toContain(
      String(REAL_FTC_MAX_SUBMIT_STEPS)
    );
  });

  it("returns retriable copy for decide_action_failed", () => {
    expect(buildRealFtcIncompleteError("decide_action_failed", 1)).toContain("retry");
  });
});

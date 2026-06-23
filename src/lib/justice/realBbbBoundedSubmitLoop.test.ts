import { describe, expect, it } from "vitest";
import {
  REAL_BBB_MAX_SUBMIT_STEPS,
  buildRealBbbIncompleteError,
  detectRealBbbTerminalConfirmation,
  hasReachedStepCap,
  isEmptyFormDecision,
  normalizeFormDecision,
  type AssistedFormPageData,
} from "@/lib/justice/realBbbBoundedSubmitLoop";

const basePage: AssistedFormPageData = {
  url: "https://www.bbb.org/complain/",
  fields: [],
  buttons: [],
  pageText: "File a complaint with BBB",
};

describe("realBbbBoundedSubmitLoop", () => {
  it("enforces the maximum step cap", () => {
    expect(hasReachedStepCap(0)).toBe(false);
    expect(hasReachedStepCap(REAL_BBB_MAX_SUBMIT_STEPS - 1)).toBe(false);
    expect(hasReachedStepCap(REAL_BBB_MAX_SUBMIT_STEPS)).toBe(true);
    expect(hasReachedStepCap(REAL_BBB_MAX_SUBMIT_STEPS + 1)).toBe(true);
  });

  it("does not treat the BBB complain entry URL as terminal", () => {
    expect(
      detectRealBbbTerminalConfirmation({
        ...basePage,
        url: "https://www.bbb.org/complain/",
        pageText: "File a complaint",
      })
    ).toBe(false);
  });

  it("detects terminal confirmation from URL and page text", () => {
    expect(
      detectRealBbbTerminalConfirmation({
        ...basePage,
        url: "https://www.bbb.org/complain/confirmation",
      })
    ).toBe(true);
    expect(
      detectRealBbbTerminalConfirmation({
        ...basePage,
        pageText: "Thank you for submitting your complaint. Confirmation number 12345",
      })
    ).toBe(true);
    expect(detectRealBbbTerminalConfirmation(basePage)).toBe(false);
  });

  it("rejects empty and invalid decisions", () => {
    expect(isEmptyFormDecision({ fieldsToFill: [], nextButton: undefined })).toBe(true);
    expect(
      isEmptyFormDecision({
        fieldsToFill: [{ selector: "business", value: "Acme" }],
      })
    ).toBe(false);
    expect(
      isEmptyFormDecision({
        nextButton: { selectorType: "text", value: "Continue" },
      })
    ).toBe(false);

    expect(normalizeFormDecision(null)).toBeNull();
    expect(normalizeFormDecision({ fieldsToFill: "bad" })).toBeNull();
    expect(
      normalizeFormDecision({
        nextButton: { selectorType: "bad", value: "Go" },
      })
    ).toBeNull();
    expect(
      normalizeFormDecision({
        fieldsToFill: [{ selector: "x", value: "y" }],
        nextButton: { selectorType: "text", value: "Next" },
        waitForNavigation: true,
      })
    ).toEqual({
      fieldsToFill: [{ selector: "x", value: "y" }],
      nextButton: { selectorType: "text", value: "Next" },
      waitForNavigation: true,
    });
  });

  it("builds clear incomplete error messages for retry", () => {
    expect(buildRealBbbIncompleteError("max_steps_reached", REAL_BBB_MAX_SUBMIT_STEPS)).toContain(
      String(REAL_BBB_MAX_SUBMIT_STEPS)
    );
    expect(buildRealBbbIncompleteError("empty_decision", 2)).toContain("no fields or next action");
    expect(buildRealBbbIncompleteError("invalid_decision", 1)).toContain("invalid next action");
    expect(buildRealBbbIncompleteError("decide_action_failed", 0)).toContain(
      "could not determine the next form action"
    );
  });
});

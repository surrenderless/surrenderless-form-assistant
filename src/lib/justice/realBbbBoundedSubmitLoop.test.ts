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
    expect(REAL_BBB_MAX_SUBMIT_STEPS).toBe(8);
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
    expect(
      detectRealBbbTerminalConfirmation({
        ...basePage,
        url: "https://www.bbb.org/complain/",
        pageText: "Thank you for submitting your complaint. Confirmation number 12345",
      })
    ).toBe(false);
  });

  it("rejects off-host URLs even when they contain success", () => {
    expect(
      detectRealBbbTerminalConfirmation({
        ...basePage,
        url: "https://example.com/success",
        pageText: "Operation complete",
      })
    ).toBe(false);
    expect(
      detectRealBbbTerminalConfirmation({
        ...basePage,
        url: "https://evil.test/complain/confirmation",
        pageText: "Thank you for submitting your complaint",
      })
    ).toBe(false);
  });

  it("rejects in-wizard BBB pages with incidental completion wording", () => {
    expect(
      detectRealBbbTerminalConfirmation({
        ...basePage,
        url: "https://www.bbb.org/complain/business-details",
        pageText: "Please complete the form below before continuing.",
      })
    ).toBe(false);
    expect(
      detectRealBbbTerminalConfirmation({
        ...basePage,
        url: "https://www.bbb.org/complain/review",
        pageText: "Review your information. Success depends on accurate details.",
      })
    ).toBe(false);
    expect(
      detectRealBbbTerminalConfirmation({
        ...basePage,
        url: "https://www.bbb.org/complain/success",
        pageText: "Step complete. Continue to the next section.",
      })
    ).toBe(false);
  });

  it("detects terminal confirmation from confirmation-like URL and submission text", () => {
    expect(
      detectRealBbbTerminalConfirmation({
        ...basePage,
        url: "https://www.bbb.org/complain/confirmation",
      })
    ).toBe(true);
    expect(
      detectRealBbbTerminalConfirmation({
        ...basePage,
        url: "https://www.bbb.org/complain/thank-you",
      })
    ).toBe(true);
    expect(
      detectRealBbbTerminalConfirmation({
        ...basePage,
        url: "https://www.bbb.org/complain/review",
        pageText: "Thank you for submitting your complaint. Confirmation number 12345",
      })
    ).toBe(true);
    expect(
      detectRealBbbTerminalConfirmation({
        ...basePage,
        url: "https://www.bbb.org/complain/review",
        pageText: "Your complaint has been received by BBB.",
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
    expect(
      normalizeFormDecision({
        fieldsToFill: [{
          selector: "Fraud category",
          value: "fraud",
          controlKind: "radio",
          choiceSelectorType: "accessibleName",
        }],
      })
    ).toEqual({
      fieldsToFill: [{
        selector: "Fraud category",
        value: "fraud",
        controlKind: "radio",
        choiceSelectorType: "accessibleName",
      }],
    });
    expect(
      normalizeFormDecision({
        fieldsToFill: [{ selector: "category", value: "fraud", controlKind: "card" }],
      })
    ).toBeNull();
    expect(
      normalizeFormDecision({
        fieldsToFill: [{
          selector: "category",
          value: "fraud",
          controlKind: "radio",
          choiceSelectorType: "text",
        }],
      })
    ).toBeNull();
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

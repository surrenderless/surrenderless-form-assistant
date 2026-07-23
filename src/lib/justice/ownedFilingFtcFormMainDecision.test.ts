import { describe, expect, it } from "vitest";
import {
  buildFtcFormMainInventoryAllowlist,
  formatFtcFormMainInventoryForPrompt,
  validateFtcFormMainDecision,
} from "@/lib/justice/ownedFilingFtcFormMainDecision";
import type { AssistedFormPageData, FormDecision } from "@/lib/justice/realBbbBoundedSubmitLoop";

const FORM_MAIN_URL = "https://reportfraud.ftc.gov/form/main";

function formMainPage(overrides: Partial<AssistedFormPageData> = {}): AssistedFormPageData {
  return {
    url: FORM_MAIN_URL,
    fields: [
      {
        tag: "textarea",
        type: "textarea",
        name: "",
        id: "",
        placeholder: "",
        label: "Please describe what happened.",
        formControlName: "comments",
      },
      {
        tag: "select",
        type: "select-one",
        name: "paymentType",
        id: "payment-type",
        placeholder: "",
        label: "Payment type",
      },
    ],
    choiceControls: [
      {
        source: "native",
        kind: "radio",
        name: "yesOrNoMoney",
        id: "yes-or-no-money-no",
        optionValue: "no",
        accessibleName: "No",
        visible: true,
        enabled: true,
        checked: false,
      },
    ],
    buttons: [{ text: "Continue", id: "", name: "", type: "button" }],
    pageText: "",
    ...overrides,
  };
}

function multiFieldDecision(): FormDecision {
  return {
    fieldsToFill: [
      { selector: "comments", value: "Merchant refused a refund." },
      { selector: "paymentType", value: "credit" },
      {
        selector: "yesOrNoMoney",
        value: "no",
        controlKind: "radio",
        choiceSelectorType: "name",
      },
    ],
    nextButton: { selectorType: "text", value: "Continue" },
    waitForNavigation: true,
  };
}

describe("ownedFilingFtcFormMainDecision", () => {
  describe("formatFtcFormMainInventoryForPrompt", () => {
    it("lists sanitized field and choice selectors without values or page text", () => {
      const prompt = formatFtcFormMainInventoryForPrompt(
        formMainPage({
          pageText: "SSN 123-45-6789 private@example.com",
          fields: [
            {
              tag: "textarea",
              type: "textarea",
              name: "",
              id: "",
              placeholder: "Tell us your story",
              label: "Story with PII",
              formControlName: "comments",
            },
          ],
        })
      );

      expect(prompt).toContain("Allowed field selectors (use exactly): comments");
      expect(prompt).toContain("name:yesOrNoMoney");
      expect(prompt).toContain("id:yes-or-no-money-no");
      expect(prompt).toContain("Continue actionable in scrape: yes");
      expect(prompt).not.toContain("private@example.com");
      expect(prompt).not.toContain("123-45-6789");
      expect(prompt).not.toContain("Tell us your story");
      expect(prompt).not.toContain("Merchant refused");
    });
  });

  describe("validateFtcFormMainDecision", () => {
    it("rejects invented unmatched form-main choices", () => {
      const result = validateFtcFormMainDecision(formMainPage(), {
        fieldsToFill: [
          {
            selector: "inventedControl",
            value: "made-up",
            controlKind: "radio",
            choiceSelectorType: "name",
          },
        ],
        nextButton: { selectorType: "text", value: "Continue" },
      });
      expect(result).toEqual({ ok: false, reason: "choice_unmatched" });
    });

    it("rejects unmatched text/select selectors", () => {
      expect(
        validateFtcFormMainDecision(formMainPage(), {
          fieldsToFill: [{ selector: "notInScrape", value: "x" }],
          nextButton: { selectorType: "text", value: "Continue" },
        })
      ).toEqual({ ok: false, reason: "field_selector_unmatched" });
    });

    it("accepts matched multi-field text/select/choice decisions", () => {
      expect(validateFtcFormMainDecision(formMainPage(), multiFieldDecision())).toEqual({
        ok: true,
      });
    });

    it("rejects zero fields when Continue is not actionable", () => {
      expect(
        validateFtcFormMainDecision(
          formMainPage({ buttons: [] }),
          {
            fieldsToFill: [],
            nextButton: { selectorType: "text", value: "Continue" },
          }
        )
      ).toEqual({ ok: false, reason: "fields_required" });
    });

    it("allows zero-field Continue-only when Continue is uniquely actionable", () => {
      expect(
        validateFtcFormMainDecision(formMainPage(), {
          fieldsToFill: [],
          nextButton: { selectorType: "text", value: "Continue" },
        })
      ).toEqual({ ok: true });
    });

    it("rejects ambiguous field selectors that match multiple scraped fields", () => {
      const page = formMainPage({
        fields: [
          {
            tag: "input",
            type: "text",
            name: "dup",
            id: "a",
            placeholder: "",
            label: "A",
          },
          {
            tag: "input",
            type: "text",
            name: "dup",
            id: "b",
            placeholder: "",
            label: "B",
          },
        ],
      });
      expect(
        validateFtcFormMainDecision(page, {
          fieldsToFill: [{ selector: "dup", value: "x" }],
          nextButton: { selectorType: "text", value: "Continue" },
        })
      ).toEqual({ ok: false, reason: "field_selector_ambiguous" });
    });

    it("build allowlist marks Continue actionable from unique scrape Continue", () => {
      expect(buildFtcFormMainInventoryAllowlist(formMainPage()).continueActionable).toBe(true);
      expect(
        buildFtcFormMainInventoryAllowlist(formMainPage({ buttons: [] })).continueActionable
      ).toBe(false);
    });
  });
});

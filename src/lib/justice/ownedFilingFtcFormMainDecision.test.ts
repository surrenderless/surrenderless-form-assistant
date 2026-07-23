import { describe, expect, it } from "vitest";
import {
  buildFtcFormMainInventoryAllowlist,
  buildFtcFormMainInventoryDecision,
  formatFtcFormMainInventoryForPrompt,
  validateFtcFormMainDecision,
} from "@/lib/justice/ownedFilingFtcFormMainDecision";
import type { AssistedFormPageData, FormDecision } from "@/lib/justice/realBbbBoundedSubmitLoop";

const FORM_MAIN_URL = "https://reportfraud.ftc.gov/form/main";

function yesNoMoneyControls() {
  return [
    {
      source: "native" as const,
      kind: "radio" as const,
      name: "yesOrNoMoney",
      id: "yes-or-no-money-yes",
      optionValue: "yes",
      accessibleName: "Yes",
      visible: true,
      enabled: true,
      checked: false,
    },
    {
      source: "native" as const,
      kind: "radio" as const,
      name: "yesOrNoMoney",
      id: "yes-or-no-money-no",
      optionValue: "no",
      accessibleName: "No",
      visible: true,
      enabled: true,
      checked: false,
    },
  ];
}

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
    choiceControls: yesNoMoneyControls(),
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

  describe("buildFtcFormMainInventoryDecision", () => {
    it("returns fill-only when fields map but Continue is not actionable", () => {
      const page = formMainPage({ buttons: [] });
      const decision = buildFtcFormMainInventoryDecision(page, {
        complaint_description: "Merchant refused a refund.",
        amount_involved: "$120",
        paymentType: "credit",
      });

      expect(decision).toEqual({
        fieldsToFill: [
          { selector: "comments", value: "Merchant refused a refund." },
          { selector: "paymentType", value: "credit" },
          {
            selector: "yesOrNoMoney",
            value: "yes",
            controlKind: "radio",
            choiceSelectorType: "name",
          },
        ],
      });
      expect(decision).not.toHaveProperty("nextButton");
      expect(decision).not.toHaveProperty("waitForNavigation");
      expect(validateFtcFormMainDecision(page, decision!)).toEqual({ ok: true });
    });

    it("returns fields plus Continue when Continue is uniquely actionable", () => {
      const decision = buildFtcFormMainInventoryDecision(formMainPage(), {
        complaint_description: "Merchant refused a refund.",
        amount_involved: "$120",
        paymentType: "credit",
      });

      expect(decision).toEqual({
        fieldsToFill: [
          { selector: "comments", value: "Merchant refused a refund." },
          { selector: "paymentType", value: "credit" },
          {
            selector: "yesOrNoMoney",
            value: "yes",
            controlKind: "radio",
            choiceSelectorType: "name",
          },
        ],
        nextButton: { selectorType: "text", value: "Continue" },
        waitForNavigation: true,
      });
      expect(validateFtcFormMainDecision(formMainPage(), decision!)).toEqual({ ok: true });
    });

    it("uses exact scraped optionValue no when amount is empty/zero-like", () => {
      const decision = buildFtcFormMainInventoryDecision(formMainPage(), {
        story: "No money lost.",
        amount_involved: "0",
      });
      expect(decision?.fieldsToFill).toEqual(
        expect.arrayContaining([
          { selector: "comments", value: "No money lost." },
          {
            selector: "yesOrNoMoney",
            value: "no",
            controlKind: "radio",
            choiceSelectorType: "name",
          },
        ])
      );
    });

    it("does not emit rcemail when only a hidden-style email field would map userData.email", () => {
      // After scrape visibility filtering, CSS-hidden rcemail is absent from pageData.fields.
      const decision = buildFtcFormMainInventoryDecision(
        formMainPage({
          fields: [],
          choiceControls: [],
          buttons: [{ text: "Continue", id: "", name: "", type: "button" }],
        }),
        { email: "pat@example.com", contact_email: "pat@example.com" }
      );

      expect(decision).toEqual({
        fieldsToFill: [],
        nextButton: { selectorType: "text", value: "Continue" },
        waitForNavigation: true,
      });
      expect(JSON.stringify(decision)).not.toContain("rcemail");
      expect(JSON.stringify(decision)).not.toContain("pat@example.com");
    });

    it("still builds visible narrative and yes/no inventory without selecting rcemail", () => {
      const decision = buildFtcFormMainInventoryDecision(
        formMainPage({
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
          ],
          buttons: [],
        }),
        {
          story: "Merchant refused a refund.",
          amount_involved: "$50",
          email: "pat@example.com",
        }
      );

      expect(decision?.fieldsToFill).toEqual([
        { selector: "comments", value: "Merchant refused a refund." },
        {
          selector: "yesOrNoMoney",
          value: "yes",
          controlKind: "radio",
          choiceSelectorType: "name",
        },
      ]);
      expect(decision).not.toHaveProperty("nextButton");
      expect(JSON.stringify(decision)).not.toContain("rcemail");
      expect(JSON.stringify(decision)).not.toContain("pat@example.com");
    });

    it("omits text/select when normalized currentValue already matches userData", () => {
      const decision = buildFtcFormMainInventoryDecision(
        formMainPage({
          fields: [
            {
              tag: "textarea",
              type: "textarea",
              name: "",
              id: "",
              placeholder: "",
              label: "Please describe what happened.",
              formControlName: "comments",
              currentValue: "  Merchant refused a refund.  ",
            },
            {
              tag: "select",
              type: "select-one",
              name: "paymentType",
              id: "payment-type",
              placeholder: "",
              label: "Payment type",
              currentValue: "credit",
            },
          ],
          choiceControls: yesNoMoneyControls().map((control, index) =>
            index === 0 ? { ...control, checked: true } : control
          ),
        }),
        {
          complaint_description: "Merchant refused a refund.",
          paymentType: "credit",
          amount_involved: "$120",
        }
      );

      expect(decision).toEqual({
        fieldsToFill: [],
        nextButton: { selectorType: "text", value: "Continue" },
        waitForNavigation: true,
      });
    });

    it("emits a differing currentValue field once as fill-only without Continue", () => {
      const decision = buildFtcFormMainInventoryDecision(
        formMainPage({
          buttons: [],
          fields: [
            {
              tag: "textarea",
              type: "textarea",
              name: "",
              id: "",
              placeholder: "",
              label: "Please describe what happened.",
              formControlName: "comments",
              currentValue: "stale narrative",
            },
          ],
          choiceControls: [],
        }),
        { story: "Merchant refused a refund." }
      );

      expect(decision).toEqual({
        fieldsToFill: [{ selector: "comments", value: "Merchant refused a refund." }],
      });
      expect(decision).not.toHaveProperty("nextButton");
    });

    it("returns empty decision when all inventory targets are satisfied and Continue is absent", () => {
      const decision = buildFtcFormMainInventoryDecision(
        formMainPage({
          buttons: [{ text: "Help", id: "", name: "", type: "button" }],
          fields: [
            {
              tag: "textarea",
              type: "textarea",
              name: "",
              id: "",
              placeholder: "",
              label: "Please describe what happened.",
              formControlName: "comments",
              currentValue: "Merchant refused a refund.",
            },
          ],
          choiceControls: yesNoMoneyControls().map((control, index) =>
            index === 1 ? { ...control, checked: true } : control
          ),
        }),
        {
          story: "Merchant refused a refund.",
          amount_involved: "0",
        }
      );

      expect(decision).toEqual({ fieldsToFill: [] });
      expect(decision).not.toHaveProperty("nextButton");
    });

    it("returns Continue-only when Continue is uniquely actionable and nothing is mappable", () => {
      expect(
        buildFtcFormMainInventoryDecision(
          formMainPage({ fields: [], choiceControls: [] }),
          {}
        )
      ).toEqual({
        fieldsToFill: [],
        nextButton: { selectorType: "text", value: "Continue" },
        waitForNavigation: true,
      });
    });

    it("returns null when Continue is not actionable and inventory cannot be mapped", () => {
      expect(
        buildFtcFormMainInventoryDecision(
          formMainPage({ fields: [], choiceControls: [], buttons: [] }),
          { story: "unused without fields" }
        )
      ).toBeNull();
    });

    it("returns null for incomplete yes/no groups instead of inventing an optionValue", () => {
      expect(
        buildFtcFormMainInventoryDecision(
          formMainPage({
            fields: [],
            buttons: [],
            choiceControls: [yesNoMoneyControls()[1]!],
          }),
          { amount_involved: "$50" }
        )
      ).toBeNull();
    });

    it("skips ambiguous duplicate field selectors instead of inventing a match", () => {
      const decision = buildFtcFormMainInventoryDecision(
        formMainPage({
          fields: [
            {
              tag: "input",
              type: "text",
              name: "dup",
              id: "",
              placeholder: "",
              label: "A",
            },
            {
              tag: "input",
              type: "text",
              name: "dup",
              id: "",
              placeholder: "",
              label: "B",
            },
          ],
          choiceControls: [],
          buttons: [],
        }),
        { dup: "value" }
      );
      expect(decision).toBeNull();
    });

    it("skips already-checked yes/no groups", () => {
      const controls = yesNoMoneyControls().map((control, index) =>
        index === 0 ? { ...control, checked: true } : control
      );
      const decision = buildFtcFormMainInventoryDecision(
        formMainPage({ choiceControls: controls, fields: [] }),
        { amount_involved: "$50" }
      );
      expect(decision?.fieldsToFill ?? []).toEqual([]);
      expect(decision?.nextButton).toEqual({ selectorType: "text", value: "Continue" });
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
        validateFtcFormMainDecision(formMainPage({ buttons: [] }), {
          fieldsToFill: [],
          nextButton: { selectorType: "text", value: "Continue" },
        })
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

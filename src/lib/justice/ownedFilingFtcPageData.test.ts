import { afterEach, describe, expect, it, vi } from "vitest";
import { collectOwnedFilingFtcPageDataInBrowser } from "@/lib/justice/ownedFilingFtcPageData";

const SECRET = "SENSITIVE_FIELD_VALUE";

type FakeElement = {
  tagName: string;
  textContent: string;
  id: string;
  disabled: boolean;
  hidden: boolean;
  value: string;
  type: string;
  labels: Array<{ innerText: string }>;
  styleState: { display: string; visibility: string };
  getAttribute(name: string): string | null;
  getBoundingClientRect(): { width: number; height: number };
};

function button(
  text: string,
  options: {
    disabled?: boolean;
    ariaDisabled?: string;
    hidden?: boolean;
    display?: string;
    visibility?: string;
    width?: number;
    height?: number;
  } = {}
): FakeElement {
  return {
    tagName: "BUTTON",
    textContent: text,
    id: "",
    disabled: options.disabled ?? false,
    hidden: options.hidden ?? false,
    value: "",
    type: "button",
    labels: [],
    styleState: {
      display: options.display ?? "block",
      visibility: options.visibility ?? "visible",
    },
    getAttribute(name: string) {
      if (name === "aria-disabled") return options.ariaDisabled ?? null;
      if (name === "type") return "button";
      return null;
    },
    getBoundingClientRect: () => ({
      width: options.width ?? 100,
      height: options.height ?? 30,
    }),
  };
}

function installDom(buttons: FakeElement[], choiceFields: FakeElement[] = []): void {
  const secretField: FakeElement = {
    tagName: "INPUT",
    textContent: "",
    id: "story",
    disabled: false,
    hidden: false,
    value: SECRET,
    type: "text",
    labels: [{ innerText: "What happened?" }],
    styleState: { display: "block", visibility: "visible" },
    getAttribute(name: string) {
      if (name === "name") return "story";
      if (name === "placeholder") return "Describe the issue";
      return null;
    },
    getBoundingClientRect: () => ({ width: 200, height: 30 }),
  };
  vi.stubGlobal("document", {
    querySelectorAll(selector: string) {
      if (selector === "button, input[type='submit']") return buttons;
      if (
        selector ===
        "input[type='radio'], input[type='checkbox'], [role='radio'], [role='checkbox']"
      ) {
        return choiceFields;
      }
      return [secretField, ...choiceFields.filter((field) => field.tagName === "INPUT")];
    },
    getElementById: () => null,
    body: { innerText: "FTC assistant" },
  });
  vi.stubGlobal("window", {
    location: { href: "https://reportfraud.ftc.gov/assistant" },
    getComputedStyle(element: FakeElement) {
      return element.styleState;
    },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("collectOwnedFilingFtcPageDataInBrowser", () => {
  it("omits disabled, aria-disabled, hidden, and zero-size CTA elements", () => {
    installDom([
      button("Disabled", { disabled: true }),
      button("ARIA disabled", { ariaDisabled: "true" }),
      button("Hidden attribute", { hidden: true }),
      button("Display none", { display: "none" }),
      button("Visibility hidden", { visibility: "hidden" }),
      button("Zero width", { width: 0 }),
      button("Zero height", { height: 0 }),
    ]);

    expect(collectOwnedFilingFtcPageDataInBrowser().buttons).toEqual([]);
  });

  it("retains enabled visible Continue and Next without collecting field values", () => {
    installDom([button("Continue"), button("Next")]);

    const result = collectOwnedFilingFtcPageDataInBrowser();

    expect(result.buttons.map((entry) => entry.text)).toEqual(["Continue", "Next"]);
    expect(result.fields).toEqual([
      {
        tag: "input",
        type: "text",
        name: "story",
        id: "story",
        placeholder: "Describe the issue",
        label: "What happened?",
      },
    ]);
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it("does not send a disabled Continue in the actionable button corpus", () => {
    installDom([button("Continue", { disabled: true }), button("Next")]);

    const result = collectOwnedFilingFtcPageDataInBrowser();

    expect(result.buttons).toHaveLength(1);
    expect(result.buttons[0]?.text).toBe("Next");
    expect(result.buttons.some((entry) => entry.text === "Continue")).toBe(false);
  });

  it("exposes only non-user radio option values needed for exact choice selection", () => {
    const radio: FakeElement = {
      tagName: "INPUT",
      textContent: "",
      id: "category-fraud",
      disabled: false,
      hidden: false,
      value: "fraud",
      type: "radio",
      labels: [{ innerText: "Fraud category" }],
      styleState: { display: "block", visibility: "visible" },
      getAttribute(name: string) {
        if (name === "name") return "category";
        if (name === "placeholder") return null;
        return null;
      },
      getBoundingClientRect: () => ({ width: 20, height: 20 }),
    };
    installDom([button("Continue")], [radio]);

    const result = collectOwnedFilingFtcPageDataInBrowser();

    expect(result.fields[1]).toEqual({
      tag: "input",
      type: "radio",
      name: "category",
      id: "category-fraud",
      placeholder: "",
      label: "Fraud category",
      optionValue: "fraud",
    });
    expect(result.fields[0]).not.toHaveProperty("optionValue");
    expect(result.choiceControls).toEqual([
      {
        source: "native",
        kind: "radio",
        name: "category",
        id: "category-fraud",
        optionValue: "fraud",
        accessibleName: "Fraud category",
        visible: true,
        enabled: true,
      },
    ]);
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it("collects exact sanitized ARIA radio metadata without broad page text", () => {
    const ariaRadio: FakeElement = {
      tagName: "DIV",
      textContent: "Ignored broad text",
      id: "category-imposter",
      disabled: false,
      hidden: false,
      value: "",
      type: "",
      labels: [],
      styleState: { display: "block", visibility: "visible" },
      getAttribute(name: string) {
        if (name === "role") return "radio";
        if (name === "aria-label") return "Imposter scams";
        if (name === "data-value") return "imposter";
        if (name === "aria-disabled") return "false";
        return null;
      },
      getBoundingClientRect: () => ({ width: 180, height: 40 }),
    };
    installDom([], [ariaRadio]);

    const result = collectOwnedFilingFtcPageDataInBrowser();

    expect(result.choiceControls).toEqual([
      {
        source: "aria",
        kind: "radio",
        name: "",
        id: "category-imposter",
        optionValue: "imposter",
        accessibleName: "Imposter scams",
        visible: true,
        enabled: true,
      },
    ]);
    expect(JSON.stringify(result.choiceControls)).not.toContain("Ignored broad text");
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });
});

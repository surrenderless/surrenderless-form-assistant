import { afterEach, describe, expect, it, vi } from "vitest";
import { collectOwnedFilingFtcPageDataInBrowser } from "@/lib/justice/ownedFilingFtcPageData";
import { formatOwnedFilingDryRunStepLog } from "@/lib/justice/ownedFilingDryRunState";

const SECRET = "SENSITIVE_FIELD_VALUE";

type FakeElement = {
  tagName: string;
  textContent: string;
  id: string;
  disabled: boolean;
  hidden: boolean;
  value: string;
  type: string;
  checked?: boolean;
  labels: Array<{ innerText: string }>;
  styleState: { display: string; visibility: string };
  valueAttribute?: string | null;
  getAttribute(name: string): string | null;
  hasAttribute(name: string): boolean;
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
    hasAttribute() {
      return false;
    },
    getBoundingClientRect: () => ({
      width: options.width ?? 100,
      height: options.height ?? 30,
    }),
  };
}

function installDom(
  buttons: FakeElement[],
  choiceFields: FakeElement[] = [],
  extraFields: FakeElement[] = []
): void {
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
    hasAttribute() {
      return false;
    },
    getBoundingClientRect: () => ({ width: 200, height: 30 }),
  };
  vi.stubGlobal("document", {
    querySelectorAll(selector: string) {
      if (selector === "button, input[type='submit'], a[role='button']") return buttons;
      if (
        selector ===
        "input[type='radio'], input[type='checkbox'], [role='radio'], [role='checkbox']"
      ) {
        return choiceFields;
      }
      return [secretField, ...extraFields, ...choiceFields.filter((field) => field.tagName === "INPUT")];
    },
    getElementById: (id: string) => {
      if (id === "commentsLabel") {
        return { textContent: "Please describe what happened." };
      }
      return null;
    },
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

  it("retains enabled visible Continue and Next and scrapes sanitized currentValue", () => {
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
        currentValue: SECRET,
      },
    ]);
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
      checked: false,
      labels: [{ innerText: "Fraud category" }],
      styleState: { display: "block", visibility: "visible" },
      getAttribute(name: string) {
        if (name === "name") return "category";
        if (name === "placeholder") return null;
        if (name === "value") return "fraud";
        return null;
      },
      hasAttribute(name: string) {
        return name === "value";
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
    expect(result.fields[0]).toMatchObject({
      tag: "input",
      type: "text",
      name: "story",
      currentValue: SECRET,
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
        checked: false,
      },
    ]);
  });

  it("uses accessibleName as optionValue for FTC category radios that omit value attributes", () => {
    const radio: FakeElement = {
      tagName: "INPUT",
      textContent: "",
      id: "cat-radio-2",
      disabled: false,
      hidden: true,
      value: "on",
      type: "radio",
      checked: true,
      labels: [{ innerText: "Online shopping" }],
      styleState: { display: "block", visibility: "hidden" },
      getAttribute(name: string) {
        if (name === "name") return "category";
        return null;
      },
      hasAttribute() {
        return false;
      },
      getBoundingClientRect: () => ({ width: 0, height: 0 }),
    };
    installDom([button("Continue", { disabled: true })], [radio]);

    const result = collectOwnedFilingFtcPageDataInBrowser();

    expect(result.choiceControls).toEqual([
      {
        source: "native",
        kind: "radio",
        name: "category",
        id: "cat-radio-2",
        optionValue: "Online shopping",
        accessibleName: "Online shopping",
        visible: false,
        enabled: true,
        checked: true,
      },
    ]);
    expect(result.choiceControls?.[0]?.optionValue).not.toBe("on");
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
        if (name === "aria-checked") return "false";
        return null;
      },
      hasAttribute() {
        return false;
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
        checked: false,
      },
    ]);
    expect(JSON.stringify(result.choiceControls)).not.toContain("Ignored broad text");
  });

  it("scrapes verified /form/main comments formControlName, aria-labelledby label, and currentValue", () => {
    const comments: FakeElement = {
      tagName: "TEXTAREA",
      textContent: "",
      id: "",
      disabled: false,
      hidden: false,
      value: SECRET,
      type: "textarea",
      labels: [],
      styleState: { display: "block", visibility: "visible" },
      getAttribute(name: string) {
        if (name === "formcontrolname") return "comments";
        if (name === "aria-labelledby") return "commentsLabel";
        if (name === "name" || name === "placeholder") return null;
        return null;
      },
      hasAttribute(name: string) {
        return name === "formcontrolname" || name === "aria-labelledby";
      },
      getBoundingClientRect: () => ({ width: 400, height: 120 }),
    };
    installDom([], [], [comments]);

    const result = collectOwnedFilingFtcPageDataInBrowser();
    const commentsField = result.fields.find((field) => field.formControlName === "comments");

    expect(commentsField).toEqual({
      tag: "textarea",
      type: "textarea",
      name: "",
      id: "",
      placeholder: "",
      label: "Please describe what happened.",
      formControlName: "comments",
      currentValue: SECRET,
    });
  });

  it("scrapes currentValue for visible text, textarea, and select only", () => {
    const text: FakeElement = {
      tagName: "INPUT",
      textContent: "",
      id: "merchant",
      disabled: false,
      hidden: false,
      value: "Acme Co",
      type: "text",
      labels: [{ innerText: "Merchant" }],
      styleState: { display: "block", visibility: "visible" },
      getAttribute(name: string) {
        if (name === "name") return "merchant";
        if (name === "placeholder") return null;
        return null;
      },
      hasAttribute() {
        return false;
      },
      getBoundingClientRect: () => ({ width: 200, height: 30 }),
    };
    const select: FakeElement = {
      tagName: "SELECT",
      textContent: "",
      id: "payment-type",
      disabled: false,
      hidden: false,
      value: "credit",
      type: "select-one",
      labels: [{ innerText: "Payment type" }],
      styleState: { display: "block", visibility: "visible" },
      getAttribute(name: string) {
        if (name === "name") return "paymentType";
        if (name === "placeholder") return null;
        return null;
      },
      hasAttribute() {
        return false;
      },
      getBoundingClientRect: () => ({ width: 200, height: 30 }),
    };
    const radio: FakeElement = {
      tagName: "INPUT",
      textContent: "",
      id: "yes-or-no-money-yes",
      disabled: false,
      hidden: false,
      value: "yes",
      type: "radio",
      checked: false,
      labels: [{ innerText: "Yes" }],
      styleState: { display: "block", visibility: "visible" },
      getAttribute(name: string) {
        if (name === "name") return "yesOrNoMoney";
        if (name === "value") return "yes";
        if (name === "placeholder") return null;
        return null;
      },
      hasAttribute(name: string) {
        return name === "value";
      },
      getBoundingClientRect: () => ({ width: 20, height: 20 }),
    };
    installDom([button("Continue")], [radio], [text, select]);

    const result = collectOwnedFilingFtcPageDataInBrowser();
    const byName = (name: string) => result.fields.find((field) => field.name === name);

    expect(byName("story")?.currentValue).toBe(SECRET);
    expect(byName("merchant")?.currentValue).toBe("Acme Co");
    expect(byName("paymentType")?.currentValue).toBe("credit");
    expect(byName("yesOrNoMoney")).not.toHaveProperty("currentValue");
    expect(byName("yesOrNoMoney")?.optionValue).toBe("yes");
  });

  it("never puts currentValue into persisted step_log formatting", () => {
    installDom([button("Continue")]);
    const pageData = collectOwnedFilingFtcPageDataInBrowser();
    expect(pageData.fields.some((field) => field.currentValue === SECRET)).toBe(true);

    const stepLog = formatOwnedFilingDryRunStepLog([
      { action: "decide", url: pageData.url, detail: "text:Continue" },
      { action: "apply", url: pageData.url, detail: "text:Continue" },
      {
        action: "exact_target_diagnostic",
        url: pageData.url,
        detail:
          "target=continue,count=1,visible=true,enabled=true,phase=nav_soft_timeout,labels=Continue",
      },
    ]);

    expect(stepLog).not.toContain(SECRET);
    expect(stepLog).not.toContain("currentValue");
    expect(JSON.stringify(stepLog)).not.toContain(SECRET);
  });

  it("omits CSS-hidden rcemail-style text fields while retaining visible controls", () => {
    const hiddenRcEmail: FakeElement = {
      tagName: "INPUT",
      textContent: "",
      id: "rcemail",
      disabled: false,
      hidden: false,
      value: "honeypot@example.com",
      type: "text",
      labels: [],
      styleState: { display: "none", visibility: "visible" },
      getAttribute(name: string) {
        if (name === "name") return "email";
        if (name === "formcontrolname") return "rcemail";
        if (name === "placeholder") return null;
        return null;
      },
      hasAttribute(name: string) {
        return name === "name" || name === "formcontrolname";
      },
      getBoundingClientRect: () => ({ width: 200, height: 30 }),
    };
    const comments: FakeElement = {
      tagName: "TEXTAREA",
      textContent: "",
      id: "",
      disabled: false,
      hidden: false,
      value: SECRET,
      type: "textarea",
      labels: [],
      styleState: { display: "block", visibility: "visible" },
      getAttribute(name: string) {
        if (name === "formcontrolname") return "comments";
        if (name === "aria-labelledby") return "commentsLabel";
        if (name === "name" || name === "placeholder") return null;
        return null;
      },
      hasAttribute(name: string) {
        return name === "formcontrolname" || name === "aria-labelledby";
      },
      getBoundingClientRect: () => ({ width: 400, height: 120 }),
    };
    installDom([], [], [hiddenRcEmail, comments]);

    const result = collectOwnedFilingFtcPageDataInBrowser();

    expect(result.fields.some((field) => field.formControlName === "rcemail")).toBe(false);
    expect(result.fields.some((field) => field.id === "rcemail")).toBe(false);
    expect(result.fields.some((field) => field.formControlName === "comments")).toBe(true);
    expect(result.fields.find((field) => field.formControlName === "comments")?.currentValue).toBe(
      SECRET
    );
    expect(JSON.stringify(result)).not.toContain("honeypot@example.com");
  });

  it("includes visible a[role=button] Continue and normalizes trailing NBSP text", () => {
    const continueLink: FakeElement = {
      tagName: "A",
      textContent: "Continue\u00a0",
      id: "",
      disabled: false,
      hidden: false,
      value: "",
      type: "",
      labels: [],
      styleState: { display: "block", visibility: "visible" },
      getAttribute(name: string) {
        if (name === "role") return "button";
        if (name === "aria-disabled") return null;
        if (name === "type" || name === "name") return null;
        return null;
      },
      hasAttribute() {
        return false;
      },
      getBoundingClientRect: () => ({ width: 183, height: 54 }),
    };
    const zeroSizeModalContinue = button("Continue", { width: 0, height: 0 });
    installDom([zeroSizeModalContinue, continueLink]);

    const result = collectOwnedFilingFtcPageDataInBrowser();

    expect(result.buttons).toEqual([
      {
        text: "Continue",
        id: "",
        name: "",
        type: "button",
      },
    ]);
  });
});

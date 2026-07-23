import { afterEach, describe, expect, it, vi } from "vitest";
import type { Locator, Page } from "playwright";
import {
  applyOwnedFilingFormDecision,
  OWNED_FILING_FTC_ACTION_TIMEOUT_MS,
} from "@/lib/justice/ownedFilingApplyDecision";
import type {
  AssistedFormChoiceControl,
  FormDecision,
} from "@/lib/justice/realBbbBoundedSubmitLoop";

type MockPage = Page & {
  exactButtonLocator: Locator;
  exactLinkLocator: Locator;
  choiceLocator: Locator;
  labelLocator: Locator;
  fillFieldLocator: Locator;
  fillMatchLocator: Locator;
};

type FillMatchOptions = {
  count?: number;
  tag?: string;
  type?: string;
  visible?: boolean;
  enabled?: boolean;
};

function mockPage(fillMatch: FillMatchOptions = {}): MockPage {
  const exactButtonLocator: Record<string, unknown> = {
    count: vi.fn(async () => 1),
    isVisible: vi.fn(async () => true),
    isEnabled: vi.fn(async () => true),
    click: vi.fn(async () => undefined),
  };
  exactButtonLocator.nth = vi.fn(() => exactButtonLocator);
  const exactLinkLocator: Record<string, unknown> = {
    count: vi.fn(async () => 0),
    isVisible: vi.fn(async () => true),
    isEnabled: vi.fn(async () => true),
    click: vi.fn(async () => undefined),
  };
  exactLinkLocator.nth = vi.fn(() => exactLinkLocator);
  const labelLocator = {
    count: vi.fn(async () => 1),
    isVisible: vi.fn(async () => true),
    isEnabled: vi.fn(async () => true),
    click: vi.fn(async () => undefined),
  } as unknown as Locator;
  const choiceLocator = {
    count: vi.fn(async () => 1),
    isVisible: vi.fn(async () => true),
    isEnabled: vi.fn(async () => true),
    isChecked: vi.fn(async () => true),
    check: vi.fn(async () => undefined),
    click: vi.fn(async () => undefined),
    getAttribute: vi.fn(async () => "false"),
    locator: vi.fn(() => labelLocator),
  } as unknown as Locator;
  const fillMatchLocator = {
    evaluate: vi.fn(async (fn: (el: { tagName: string; type: string }) => string) =>
      fn({
        tagName: fillMatch.tag ?? "TEXTAREA",
        type: fillMatch.type ?? "textarea",
      })
    ),
    isVisible: vi.fn(async () => fillMatch.visible ?? true),
    isEnabled: vi.fn(async () => fillMatch.enabled ?? true),
    fill: vi.fn(async () => undefined),
    selectOption: vi.fn(async () => [] as string[]),
  } as unknown as Locator;
  const fillFieldLocator = {
    count: vi.fn(async () => fillMatch.count ?? 1),
    nth: vi.fn(() => fillMatchLocator),
    fill: vi.fn(async () => undefined),
    selectOption: vi.fn(async () => [] as string[]),
  } as unknown as Locator;
  return {
    fill: vi.fn(async () => undefined),
    click: vi.fn(async () => undefined),
    waitForNavigation: vi.fn(async () => undefined),
    getByRole: vi.fn((role) => (role === "link" ? exactLinkLocator : exactButtonLocator)),
    locator: vi.fn((selector: string) => {
      if (
        /formcontrolname=|input\[name=|textarea\[name=|select\[name=|input#|textarea#|select#/.test(
          selector
        ) &&
        !/type=["']radio["']|type=["']checkbox["']|role=["']radio["']|role=["']checkbox["']/.test(
          selector
        )
      ) {
        return fillFieldLocator;
      }
      return choiceLocator;
    }),
    exactButtonLocator: exactButtonLocator as unknown as Locator,
    exactLinkLocator: exactLinkLocator as unknown as Locator,
    choiceLocator,
    labelLocator,
    fillFieldLocator,
    fillMatchLocator,
  } as unknown as MockPage;
}

function mockContinueCandidate(state: {
  visible: boolean;
  enabled: boolean;
}): Locator {
  return {
    isVisible: vi.fn(async () => state.visible),
    isEnabled: vi.fn(async () => state.enabled),
    click: vi.fn(async () => undefined),
  } as unknown as Locator;
}

function installContinueRoleMatches(
  page: MockPage,
  candidates: Locator[],
  softCandidates?: Locator[],
  nbspExactCandidates?: Locator[]
): void {
  const makeRoot = (list: Locator[]) =>
    ({
      count: vi.fn(async () => list.length),
      nth: vi.fn((index: number) => list[index]!),
      isVisible: vi.fn(async () => (list[0] ? list[0].isVisible() : false)),
      isEnabled: vi.fn(async () => (list[0] ? list[0].isEnabled() : false)),
      click: vi.fn(async () => undefined),
    }) as unknown as Locator;

  const nbspExactRoot = makeRoot(nbspExactCandidates ?? []);
  const exactRoot = makeRoot(candidates);
  const softRoot = makeRoot(softCandidates ?? []);

  vi.mocked(page.getByRole).mockImplementation((role, opts) => {
    if (role === "link") return page.exactLinkLocator;
    if (role === "button" && opts && "exact" in opts && opts.exact === true) {
      if (opts.name === "Continue\u00a0") return nbspExactRoot;
      return exactRoot;
    }
    if (role === "button") return softCandidates ? softRoot : exactRoot;
    return exactRoot;
  });
  page.exactButtonLocator = exactRoot;
}

function choiceControl(
  kind: "radio" | "checkbox" = "radio",
  source: "native" | "aria" = "native"
): AssistedFormChoiceControl {
  return {
    source,
    kind,
    name: "category",
    id: "category-fraud",
    optionValue: "fraud",
    accessibleName: "Fraud category",
    visible: true,
    enabled: true,
  };
}

/** Verified FTC /assistant category radio: no value attribute, optionValue === accessibleName. */
function ftcCategoryControl(
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
    ...overrides,
  };
}

describe("applyOwnedFilingFormDecision click gate", () => {
  it("dry-run stops before irreversible click and never clicks", async () => {
    const page = mockPage();
    const decision: FormDecision = {
      fieldsToFill: [{ selector: "email", value: "a@b.com" }],
      nextButton: { selectorType: "text", value: "Submit complaint" },
    };
    const result = await applyOwnedFilingFormDecision(page, decision, {
      mode: "dry_run",
      logPrefix: "test",
    });
    expect(result).toMatchObject({
      ok: false,
      blocked: true,
      risk: "irreversible",
      reason: "dry_run_stop",
    });
    expect(page.fill).toHaveBeenCalled();
    expect(page.click).not.toHaveBeenCalled();
  });

  it("unknown actions fail closed without clicking", async () => {
    const page = mockPage();
    const decision: FormDecision = {
      nextButton: { selectorType: "text", value: "Do the thing" },
    };
    const result = await applyOwnedFilingFormDecision(page, decision, {
      mode: "live",
      logPrefix: "test",
      env: { OWNED_FILING_SUBMIT_ARMED: "true" },
    });
    expect(result).toMatchObject({
      ok: false,
      blocked: true,
      risk: "unknown",
      reason: "unknown_fail_closed",
    });
    expect(page.click).not.toHaveBeenCalled();
  });

  it("unarmed live mode refuses irreversible click", async () => {
    const page = mockPage();
    const decision: FormDecision = {
      nextButton: { selectorType: "type", value: "submit" },
    };
    const result = await applyOwnedFilingFormDecision(page, decision, {
      mode: "live",
      logPrefix: "test",
      env: { OWNED_FILING_SUBMIT_ARMED: "false" },
    });
    expect(result).toMatchObject({
      ok: false,
      blocked: true,
      risk: "irreversible",
      reason: "unarmed_live",
    });
    expect(page.click).not.toHaveBeenCalled();
  });

  it("armed live mode may click irreversible submit", async () => {
    const page = mockPage();
    const decision: FormDecision = {
      nextButton: { selectorType: "text", value: "Submit" },
    };
    const result = await applyOwnedFilingFormDecision(page, decision, {
      mode: "live",
      logPrefix: "test",
      env: { OWNED_FILING_SUBMIT_ARMED: "true" },
    });
    expect(result).toMatchObject({ ok: true, clicked: true, risk: "irreversible" });
    expect(page.click).toHaveBeenCalledTimes(1);
  });

  it("dry-run and live may click safe navigation buttons", async () => {
    const page = mockPage();
    const decision: FormDecision = {
      nextButton: { selectorType: "text", value: "Continue" },
    };
    const dry = await applyOwnedFilingFormDecision(page, decision, {
      mode: "dry_run",
      logPrefix: "test",
    });
    expect(dry).toMatchObject({ ok: true, clicked: true, risk: "safe" });
    expect(page.click).toHaveBeenCalledTimes(1);

    const live = await applyOwnedFilingFormDecision(page, decision, {
      mode: "live",
      logPrefix: "test",
      env: { OWNED_FILING_SUBMIT_ARMED: "" },
    });
    expect(live).toMatchObject({ ok: true, clicked: true, risk: "safe" });
    expect(page.click).toHaveBeenCalledTimes(2);
  });
});

describe("FTC bounded actions", () => {
  const ftcOptions = {
    mode: "dry_run" as const,
    logPrefix: "real-ftc-submit",
    actionTimeoutMs: OWNED_FILING_FTC_ACTION_TIMEOUT_MS,
    propagateCriticalErrors: true,
    useExactTextButtonLocator: true,
    currentPageUrl: "https://reportfraud.ftc.gov/assistant",
    enableFtcChoiceControls: true,
    actionableButtonLabels: ["Continue"],
    choiceControls: [choiceControl()],
  };

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fails a stuck visible fill at 20 seconds without exposing its value", async () => {
    vi.useFakeTimers();
    const page = mockPage({ tag: "INPUT", type: "text", visible: true, enabled: true });
    vi.mocked(page.fillMatchLocator.fill).mockImplementation(
      (_value, options) =>
        new Promise<void>((_resolve, reject) => {
          setTimeout(() => {
            reject(Object.assign(new Error("Timeout exceeded"), { name: "TimeoutError" }));
          }, options?.timeout);
        })
    );

    const pending = applyOwnedFilingFormDecision(
      page,
      {
        fieldsToFill: [{ selector: "email", value: "private@example.com" }],
      },
      ftcOptions
    );
    const assertion = expect(pending).rejects.toThrow(
      "owned-filing action_timeout:fill after 20000ms"
    );
    await vi.advanceTimersByTimeAsync(OWNED_FILING_FTC_ACTION_TIMEOUT_MS);
    await assertion;
    expect(page.fillMatchLocator.fill).toHaveBeenCalledWith("private@example.com", {
      timeout: 20_000,
    });
    expect(page.fill).not.toHaveBeenCalled();
    await pending.catch((err: Error) => {
      expect(err.message).not.toContain("private@example.com");
    });
  });

  it("fills the verified unique visible /form/main comments textarea via formcontrolname", async () => {
    const page = mockPage({ tag: "TEXTAREA", type: "textarea", visible: true, enabled: true });

    const result = await applyOwnedFilingFormDecision(
      page,
      {
        fieldsToFill: [
          { selector: "comments", value: "SENSITIVE_CASE_STORY_VALUE" },
        ],
        nextButton: { selectorType: "text", value: "Continue" },
      },
      {
        ...ftcOptions,
        currentPageUrl: "https://reportfraud.ftc.gov/form/main",
      }
    );

    expect(result).toMatchObject({ ok: true, clicked: true, risk: "safe" });
    expect(page.locator).toHaveBeenCalledWith(
      expect.stringContaining('textarea[formcontrolname="comments"]')
    );
    expect(page.fillMatchLocator.fill).toHaveBeenCalledWith("SENSITIVE_CASE_STORY_VALUE", {
      timeout: 20_000,
    });
    expect(page.fill).not.toHaveBeenCalled();
  });

  it("selects a verified unique visible /form/main select via selectOption", async () => {
    const page = mockPage({ tag: "SELECT", type: "select-one", visible: true, enabled: true });

    const result = await applyOwnedFilingFormDecision(
      page,
      {
        fieldsToFill: [{ selector: "paymentType", value: "credit" }],
        nextButton: { selectorType: "text", value: "Continue" },
      },
      {
        ...ftcOptions,
        currentPageUrl: "https://reportfraud.ftc.gov/form/main",
      }
    );

    expect(result).toMatchObject({ ok: true, clicked: true });
    expect(page.fillMatchLocator.selectOption).toHaveBeenCalledWith("credit", {
      timeout: 20_000,
    });
    expect(page.fill).not.toHaveBeenCalled();
  });

  it("fails closed before waiting when /form/main fill matches are hidden duplicates", async () => {
    const page = mockPage({
      count: 2,
      tag: "INPUT",
      type: "text",
      visible: false,
      enabled: true,
    });

    const result = await applyOwnedFilingFormDecision(
      page,
      {
        fieldsToFill: [{ selector: "email", value: "private@example.com" }],
        nextButton: { selectorType: "text", value: "Continue" },
      },
      {
        ...ftcOptions,
        currentPageUrl: "https://reportfraud.ftc.gov/form/main",
      }
    );

    expect(result).toMatchObject({
      ok: false,
      blocked: true,
      reason: "unknown_fail_closed",
      diagnostic:
        "target=fill,selector=email,control=text,count=2,visible=false,enabled=true,phase=hidden,labels=Continue",
    });
    expect(result.diagnostic).not.toContain("private@example.com");
    expect(page.fillMatchLocator.fill).not.toHaveBeenCalled();
    expect(page.fill).not.toHaveBeenCalled();
    expect(page.exactButtonLocator.click).not.toHaveBeenCalled();
  });

  it("fails closed when fill targets a radio without controlKind", async () => {
    const page = mockPage({ tag: "INPUT", type: "radio", visible: true, enabled: true });

    const result = await applyOwnedFilingFormDecision(
      page,
      {
        fieldsToFill: [{ selector: "yesOrNoMoney", value: "no" }],
        nextButton: { selectorType: "text", value: "Continue" },
      },
      {
        ...ftcOptions,
        currentPageUrl: "https://reportfraud.ftc.gov/form/main",
      }
    );

    expect(result).toMatchObject({
      ok: false,
      blocked: true,
      diagnostic: expect.stringContaining("target=fill,selector=yesOrNoMoney,control=radio"),
    });
    expect(result.diagnostic).toContain("phase=unsupported");
    expect(page.fillMatchLocator.fill).not.toHaveBeenCalled();
    expect(page.exactButtonLocator.click).not.toHaveBeenCalled();
  });

  it("fails closed when multiple visible fill matches are ambiguous", async () => {
    const page = mockPage({
      count: 2,
      tag: "INPUT",
      type: "text",
      visible: true,
      enabled: true,
    });

    const result = await applyOwnedFilingFormDecision(
      page,
      {
        fieldsToFill: [{ selector: "name", value: "SENSITIVE_NAME" }],
        nextButton: { selectorType: "text", value: "Continue" },
      },
      {
        ...ftcOptions,
        currentPageUrl: "https://reportfraud.ftc.gov/form/main",
      }
    );

    expect(result).toMatchObject({
      ok: false,
      blocked: true,
      diagnostic: expect.stringContaining("phase=ambiguous"),
    });
    expect(result.diagnostic).not.toContain("SENSITIVE_NAME");
    expect(page.fillMatchLocator.fill).not.toHaveBeenCalled();
  });

  it.each(["radio", "checkbox"] as const)(
    "checks one exact visible enabled %s before Continue",
    async (controlKind) => {
      const page = mockPage();

      const result = await applyOwnedFilingFormDecision(
        page,
        {
          fieldsToFill: [{ selector: "category", value: "fraud", controlKind }],
          nextButton: { selectorType: "text", value: "Continue" },
        },
        { ...ftcOptions, choiceControls: [choiceControl(controlKind)] }
      );

      expect(result).toMatchObject({ ok: true, clicked: true, risk: "safe" });
      expect(page.locator).toHaveBeenCalledWith(
        `input[type="${controlKind}"][id="category-fraud"][value="fraud"]`
      );
      expect(page.choiceLocator.check).toHaveBeenCalledWith({ timeout: 20_000 });
      expect(vi.mocked(page.choiceLocator.check).mock.invocationCallOrder[0]).toBeLessThan(
        vi.mocked(page.exactButtonLocator.click).mock.invocationCallOrder[0]!
      );
    }
  );

  it("resolves a scraped ARIA radio exactly, selects it, then advances Continue", async () => {
    const page = mockPage();
    const ariaControl = {
      ...choiceControl("radio", "aria"),
      name: "",
      id: "category-fraud",
    };

    const result = await applyOwnedFilingFormDecision(
      page,
      {
        fieldsToFill: [
          {
            selector: "Fraud category",
            value: "fraud",
            controlKind: "radio",
          },
        ],
        nextButton: { selectorType: "text", value: "Continue" },
      },
      { ...ftcOptions, choiceControls: [ariaControl] }
    );

    expect(result).toMatchObject({ ok: true, clicked: true, risk: "safe" });
    expect(page.locator).toHaveBeenCalledWith('[role="radio"][id="category-fraud"]');
    expect(page.choiceLocator.click).toHaveBeenCalledWith({ timeout: 20_000 });
    expect(vi.mocked(page.choiceLocator.click).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(page.exactButtonLocator.click).mock.invocationCallOrder[0]!
    );
  });

  it.each([
    ["missing", 0, true, true],
    ["ambiguous", 2, true, true],
    ["hidden", 1, false, true],
    ["disabled", 1, true, false],
  ] as const)("fails closed for a %s required choice target", async (_name, count, visible, enabled) => {
    const page = mockPage();
    vi.mocked(page.choiceLocator.count).mockResolvedValue(count);
    vi.mocked(page.choiceLocator.isVisible).mockResolvedValue(visible);
    vi.mocked(page.choiceLocator.isEnabled).mockResolvedValue(enabled);

    const result = await applyOwnedFilingFormDecision(
      page,
      {
        fieldsToFill: [{ selector: "category", value: "fraud", controlKind: "choice" }],
        nextButton: { selectorType: "text", value: "Continue" },
      },
      ftcOptions
    );

    expect(result).toMatchObject({
      ok: false,
      blocked: true,
      risk: "unknown",
      reason: "unknown_fail_closed",
      diagnostic: expect.stringContaining(`target=choice,count=${count}`),
    });
    expect(page.choiceLocator.check).not.toHaveBeenCalled();
    expect(page.exactButtonLocator.click).not.toHaveBeenCalled();
    expect(page.waitForNavigation).not.toHaveBeenCalled();
  });

  it.each(["radio", "checkbox"] as const)(
    "activates the exact for/id visible label for a hidden but enabled native %s",
    async (controlKind) => {
      const page = mockPage();

      const result = await applyOwnedFilingFormDecision(
        page,
        {
          fieldsToFill: [{ selector: "category", value: "fraud", controlKind }],
          nextButton: { selectorType: "text", value: "Continue" },
        },
        {
          ...ftcOptions,
          choiceControls: [{ ...choiceControl(controlKind), visible: false }],
        }
      );

      expect(result).toMatchObject({ ok: true, clicked: true, risk: "safe" });
      expect(page.locator).toHaveBeenCalledWith('label[for="category-fraud"]');
      expect(page.choiceLocator.check).not.toHaveBeenCalled();
      expect(page.choiceLocator.click).toHaveBeenCalledWith({ timeout: 20_000 });
      expect(vi.mocked(page.choiceLocator.click).mock.invocationCallOrder[0]).toBeLessThan(
        vi.mocked(page.exactButtonLocator.click).mock.invocationCallOrder[0]!
      );
    }
  );

  it("activates the wrapping label when a hidden but enabled native radio has no id", async () => {
    const page = mockPage();

    const result = await applyOwnedFilingFormDecision(
      page,
      {
        fieldsToFill: [{ selector: "category", value: "fraud", controlKind: "radio" }],
        nextButton: { selectorType: "text", value: "Continue" },
      },
      {
        ...ftcOptions,
        choiceControls: [{ ...choiceControl(), id: "", visible: false }],
      }
    );

    expect(result).toMatchObject({ ok: true, clicked: true, risk: "safe" });
    expect(page.locator).toHaveBeenCalledWith(
      'input[type="radio"][name="category"][value="fraud"]'
    );
    expect(page.choiceLocator.locator).toHaveBeenCalledWith("xpath=ancestor::label[1]");
    expect(page.labelLocator.click).toHaveBeenCalledWith({ timeout: 20_000 });
    expect(vi.mocked(page.labelLocator.click).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(page.exactButtonLocator.click).mock.invocationCallOrder[0]!
    );
  });

  it("force-checks the exact hidden enabled native choice when no associated label exists", async () => {
    const page = mockPage();
    vi.mocked(page.choiceLocator.count)
      .mockResolvedValueOnce(0) // label[for]
      .mockResolvedValueOnce(1); // force-check input
    vi.mocked(page.labelLocator.count).mockResolvedValue(0); // wrapping label

    const result = await applyOwnedFilingFormDecision(
      page,
      {
        fieldsToFill: [{ selector: "category", value: "fraud", controlKind: "radio" }],
        nextButton: { selectorType: "text", value: "Continue" },
      },
      {
        ...ftcOptions,
        choiceControls: [{ ...choiceControl(), visible: false }],
      }
    );

    expect(result).toMatchObject({ ok: true, clicked: true, risk: "safe" });
    expect(page.locator).toHaveBeenCalledWith('label[for="category-fraud"]');
    expect(page.locator).toHaveBeenCalledWith(
      'input[type="radio"][id="category-fraud"][value="fraud"]'
    );
    expect(page.choiceLocator.check).toHaveBeenCalledWith({
      force: true,
      timeout: 20_000,
    });
    expect(page.choiceLocator.isChecked).toHaveBeenCalledTimes(1);
    expect(vi.mocked(page.choiceLocator.check).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(page.exactButtonLocator.click).mock.invocationCallOrder[0]!
    );
  });

  it("selects the verified FTC category radio via wrapping label when value attr is absent", async () => {
    const page = mockPage();
    vi.mocked(page.choiceLocator.count).mockResolvedValueOnce(0); // label[for]=0

    const result = await applyOwnedFilingFormDecision(
      page,
      {
        fieldsToFill: [
          {
            selector: "cat-radio-2",
            value: "Online shopping",
            controlKind: "radio",
            choiceSelectorType: "id",
          },
        ],
        nextButton: { selectorType: "text", value: "Continue" },
      },
      {
        ...ftcOptions,
        choiceControls: [ftcCategoryControl()],
      }
    );

    expect(result).toMatchObject({ ok: true, clicked: true, risk: "safe" });
    expect(page.locator).toHaveBeenCalledWith('label[for="cat-radio-2"]');
    expect(page.locator).toHaveBeenCalledWith('input[type="radio"][id="cat-radio-2"]');
    expect(page.locator).not.toHaveBeenCalledWith(
      'input[type="radio"][id="cat-radio-2"][value="Online shopping"]'
    );
    expect(page.locator).not.toHaveBeenCalledWith(
      'input[type="radio"][id="cat-radio-2"][value="on"]'
    );
    expect(page.choiceLocator.locator).toHaveBeenCalledWith("xpath=ancestor::label[1]");
    expect(page.labelLocator.click).toHaveBeenCalledWith({ timeout: 20_000 });
    expect(page.choiceLocator.check).not.toHaveBeenCalled();
    expect(vi.mocked(page.labelLocator.click).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(page.exactButtonLocator.click).mock.invocationCallOrder[0]!
    );
  });

  it("clicks exact Continue\\u00a0 and ignores other soft-name Continue matches", async () => {
    const page = mockPage();
    const nbspContinue = mockContinueCandidate({ visible: true, enabled: true });
    const softExtra = mockContinueCandidate({ visible: true, enabled: true });
    installContinueRoleMatches(page, [], [softExtra], [nbspContinue]);

    const result = await applyOwnedFilingFormDecision(
      page,
      { nextButton: { selectorType: "text", value: "Continue" } },
      {
        ...ftcOptions,
        currentPageUrl: "https://reportfraud.ftc.gov/form/main",
        actionableButtonLabels: ["Continue"],
      }
    );

    expect(result).toMatchObject({ ok: true, clicked: true, risk: "safe" });
    expect(page.getByRole).toHaveBeenCalledWith("button", {
      name: "Continue\u00a0",
      exact: true,
    });
    expect(page.getByRole).not.toHaveBeenCalledWith("button", { name: "Continue" });
    expect(nbspContinue.click).toHaveBeenCalledWith({ timeout: 20_000 });
    expect(softExtra.click).not.toHaveBeenCalled();
  });

  it("clicks exact ordinary Continue when the NBSP exact name is absent", async () => {
    const page = mockPage();
    const exactContinue = mockContinueCandidate({ visible: true, enabled: true });
    const softExtra = mockContinueCandidate({ visible: true, enabled: true });
    installContinueRoleMatches(page, [exactContinue], [softExtra], []);

    const result = await applyOwnedFilingFormDecision(
      page,
      { nextButton: { selectorType: "text", value: "Continue" } },
      {
        ...ftcOptions,
        currentPageUrl: "https://reportfraud.ftc.gov/form/main",
        actionableButtonLabels: ["Continue"],
      }
    );

    expect(result).toMatchObject({ ok: true, clicked: true, risk: "safe" });
    expect(page.getByRole).toHaveBeenCalledWith("button", {
      name: "Continue\u00a0",
      exact: true,
    });
    expect(page.getByRole).toHaveBeenCalledWith("button", { name: "Continue", exact: true });
    expect(page.getByRole).not.toHaveBeenCalledWith("button", { name: "Continue" });
    expect(exactContinue.click).toHaveBeenCalledWith({ timeout: 20_000 });
    expect(softExtra.click).not.toHaveBeenCalled();
  });

  it("fails closed when multiple exact visible-enabled Continue matches remain", async () => {
    const page = mockPage();
    const first = mockContinueCandidate({ visible: true, enabled: true });
    const second = mockContinueCandidate({ visible: true, enabled: true });
    installContinueRoleMatches(page, [first, second]);

    const result = await applyOwnedFilingFormDecision(
      page,
      { nextButton: { selectorType: "text", value: "Continue" } },
      {
        ...ftcOptions,
        currentPageUrl: "https://reportfraud.ftc.gov/form/main",
        actionableButtonLabels: ["Continue"],
      }
    );

    expect(result).toMatchObject({
      ok: false,
      blocked: true,
      reason: "unknown_fail_closed",
      diagnostic: expect.stringContaining("phase=precheck_ambiguous"),
    });
    expect(result.diagnostic).toContain("count=2");
    expect(first.click).not.toHaveBeenCalled();
    expect(second.click).not.toHaveBeenCalled();
  });

  it("uses soft Continue fallback only when both exact name variants are absent", async () => {
    const page = mockPage();
    const softContinue = mockContinueCandidate({ visible: true, enabled: true });
    installContinueRoleMatches(page, [], [softContinue], []);

    const result = await applyOwnedFilingFormDecision(
      page,
      { nextButton: { selectorType: "text", value: "Continue" } },
      ftcOptions
    );

    expect(result).toMatchObject({ ok: true, clicked: true, risk: "safe" });
    expect(page.getByRole).toHaveBeenCalledWith("button", {
      name: "Continue\u00a0",
      exact: true,
    });
    expect(page.getByRole).toHaveBeenCalledWith("button", { name: "Continue", exact: true });
    expect(page.getByRole).toHaveBeenCalledWith("button", { name: "Continue" });
    expect(softContinue.click).toHaveBeenCalledWith({ timeout: 20_000 });
  });

  it("advances Continue when exact accessible name misses trailing NBSP on FTC assistant", async () => {
    const page = mockPage();
    const softContinue = mockContinueCandidate({ visible: true, enabled: true });
    installContinueRoleMatches(page, [], [softContinue]);

    const result = await applyOwnedFilingFormDecision(
      page,
      { nextButton: { selectorType: "text", value: "Continue" } },
      ftcOptions
    );

    expect(result).toMatchObject({ ok: true, clicked: true, risk: "safe" });
    expect(page.getByRole).toHaveBeenCalledWith("button", {
      name: "Continue\u00a0",
      exact: true,
    });
    expect(page.getByRole).toHaveBeenCalledWith("button", { name: "Continue", exact: true });
    expect(page.getByRole).toHaveBeenCalledWith("button", { name: "Continue" });
    expect(softContinue.click).toHaveBeenCalledWith({ timeout: 20_000 });
  });

  it("selects verified /form/main yes/no radios and advances Continue via role=button soft match", async () => {
    const page = mockPage();
    const softContinue = mockContinueCandidate({ visible: true, enabled: true });
    installContinueRoleMatches(page, [], [softContinue]);

    const formMainControl: AssistedFormChoiceControl = {
      source: "native",
      kind: "radio",
      name: "yesOrNoMoney",
      id: "yes-or-no-money-no",
      optionValue: "no",
      accessibleName: "No",
      visible: true,
      enabled: true,
    };

    const result = await applyOwnedFilingFormDecision(
      page,
      {
        fieldsToFill: [
          {
            selector: "yesOrNoMoney",
            value: "no",
            controlKind: "radio",
            choiceSelectorType: "name",
          },
          { selector: "comments", value: "Merchant refused a refund after a defective product." },
        ],
        nextButton: { selectorType: "text", value: "Continue" },
      },
      {
        ...ftcOptions,
        currentPageUrl: "https://reportfraud.ftc.gov/form/main",
        choiceControls: [formMainControl],
      }
    );

    expect(result).toMatchObject({ ok: true, clicked: true, risk: "safe" });
    expect(page.locator).toHaveBeenCalled();
    expect(page.choiceLocator.check).toHaveBeenCalledWith({ timeout: 20_000 });
    expect(page.fillMatchLocator.fill).toHaveBeenCalledWith(
      "Merchant refused a refund after a defective product.",
      { timeout: 20_000 }
    );
    expect(page.fill).not.toHaveBeenCalled();
    expect(softContinue.click).toHaveBeenCalledWith({ timeout: 20_000 });
  });

  it("clicks the unique visible enabled Continue when a hidden or disabled duplicate exists", async () => {
    const page = mockPage();
    const hidden = mockContinueCandidate({ visible: false, enabled: true });
    const disabled = mockContinueCandidate({ visible: true, enabled: false });
    const active = mockContinueCandidate({ visible: true, enabled: true });
    installContinueRoleMatches(page, [hidden, disabled, active]);

    const result = await applyOwnedFilingFormDecision(
      page,
      { nextButton: { selectorType: "text", value: "Continue" } },
      {
        ...ftcOptions,
        currentPageUrl: "https://reportfraud.ftc.gov/form/main",
        actionableButtonLabels: ["Continue"],
      }
    );

    expect(result).toMatchObject({ ok: true, clicked: true, risk: "safe" });
    expect(active.click).toHaveBeenCalledWith({ timeout: 20_000 });
    expect(hidden.click).not.toHaveBeenCalled();
    expect(disabled.click).not.toHaveBeenCalled();
  });

  it("fails closed when no visible enabled Continue remains", async () => {    const page = mockPage();
    const hidden = mockContinueCandidate({ visible: false, enabled: true });
    const disabled = mockContinueCandidate({ visible: true, enabled: false });
    installContinueRoleMatches(page, [hidden, disabled]);

    const result = await applyOwnedFilingFormDecision(
      page,
      { nextButton: { selectorType: "text", value: "Continue" } },
      {
        ...ftcOptions,
        currentPageUrl: "https://reportfraud.ftc.gov/form/main",
        actionableButtonLabels: ["Continue"],
      }
    );

    // Unique visible-disabled (plus a hidden twin) still fails closed without a choice apply.
    expect(result).toMatchObject({
      ok: false,
      blocked: true,
      reason: "unknown_fail_closed",
      diagnostic: expect.stringContaining("phase=precheck_disabled"),
    });
    expect(hidden.click).not.toHaveBeenCalled();
    expect(disabled.click).not.toHaveBeenCalled();
  });

  it("clicks Continue after choice when scrape had zero Continues and one live active remains", async () => {
    const page = mockPage();
    const active = mockContinueCandidate({ visible: true, enabled: true });
    installContinueRoleMatches(page, [active]);

    const result = await applyOwnedFilingFormDecision(
      page,
      {
        fieldsToFill: [
          {
            selector: "sub-b",
            value: "Option B",
            controlKind: "radio",
            choiceSelectorType: "id",
          },
        ],
        nextButton: { selectorType: "text", value: "Continue" },
      },
      {
        ...ftcOptions,
        currentPageUrl: "https://reportfraud.ftc.gov/assistant",
        actionableButtonLabels: [],
        choiceControls: [
          {
            source: "native",
            kind: "radio",
            name: "subcategory",
            id: "sub-b",
            optionValue: "Option B",
            accessibleName: "Option B",
            visible: true,
            enabled: true,
          },
        ],
      }
    );

    expect(result).toMatchObject({ ok: true, clicked: true, risk: "safe" });
    expect(page.choiceLocator.check).toHaveBeenCalled();
    expect(active.click).toHaveBeenCalledWith({ timeout: 20_000 });
  });

  it("clicks Continue after a text mutation when scrape is empty and one live active remains", async () => {
    const page = mockPage({ tag: "TEXTAREA", type: "textarea", visible: true, enabled: true });
    const active = mockContinueCandidate({ visible: true, enabled: true });
    installContinueRoleMatches(page, [active]);

    const result = await applyOwnedFilingFormDecision(
      page,
      {
        fieldsToFill: [{ selector: "comments", value: "Merchant refused a refund." }],
        nextButton: { selectorType: "text", value: "Continue" },
      },
      {
        ...ftcOptions,
        currentPageUrl: "https://reportfraud.ftc.gov/form/main",
        actionableButtonLabels: [],
      }
    );

    expect(result).toMatchObject({ ok: true, clicked: true, risk: "safe" });
    expect(page.fillMatchLocator.fill).toHaveBeenCalledWith("Merchant refused a refund.", {
      timeout: 20_000,
    });
    expect(active.click).toHaveBeenCalledWith({ timeout: 20_000 });
  });

  it("clicks Continue after a select mutation when scrape is empty and one live active remains", async () => {
    const page = mockPage({ tag: "SELECT", type: "select-one", visible: true, enabled: true });
    const active = mockContinueCandidate({ visible: true, enabled: true });
    installContinueRoleMatches(page, [active]);

    const result = await applyOwnedFilingFormDecision(
      page,
      {
        fieldsToFill: [{ selector: "paymentType", value: "credit" }],
        nextButton: { selectorType: "text", value: "Continue" },
      },
      {
        ...ftcOptions,
        currentPageUrl: "https://reportfraud.ftc.gov/form/main",
        actionableButtonLabels: [],
      }
    );

    expect(result).toMatchObject({ ok: true, clicked: true, risk: "safe" });
    expect(page.fillMatchLocator.selectOption).toHaveBeenCalledWith("credit", {
      timeout: 20_000,
    });
    expect(active.click).toHaveBeenCalledWith({ timeout: 20_000 });
  });

  it("clicks only the active Continue after a text mutation when scrape is empty and duplicates are hidden/disabled", async () => {
    const page = mockPage({ tag: "TEXTAREA", type: "textarea", visible: true, enabled: true });
    const hidden = mockContinueCandidate({ visible: false, enabled: true });
    const disabled = mockContinueCandidate({ visible: true, enabled: false });
    const active = mockContinueCandidate({ visible: true, enabled: true });
    installContinueRoleMatches(page, [hidden, disabled, active]);

    const result = await applyOwnedFilingFormDecision(
      page,
      {
        fieldsToFill: [{ selector: "comments", value: "Case narrative." }],
        nextButton: { selectorType: "text", value: "Continue" },
      },
      {
        ...ftcOptions,
        currentPageUrl: "https://reportfraud.ftc.gov/form/main",
        actionableButtonLabels: [],
      }
    );

    expect(result).toMatchObject({ ok: true, clicked: true, risk: "safe" });
    expect(active.click).toHaveBeenCalledWith({ timeout: 20_000 });
    expect(hidden.click).not.toHaveBeenCalled();
    expect(disabled.click).not.toHaveBeenCalled();
  });

  it("clicks only the active Continue after choice when scrape is empty and duplicates are hidden/disabled", async () => {
    const page = mockPage();
    const hidden = mockContinueCandidate({ visible: false, enabled: true });
    const disabled = mockContinueCandidate({ visible: true, enabled: false });
    const active = mockContinueCandidate({ visible: true, enabled: true });
    installContinueRoleMatches(page, [hidden, disabled, active]);

    const result = await applyOwnedFilingFormDecision(
      page,
      {
        fieldsToFill: [
          {
            selector: "sub-a",
            value: "Option A",
            controlKind: "radio",
            choiceSelectorType: "id",
          },
        ],
        nextButton: { selectorType: "text", value: "Continue" },
      },
      {
        ...ftcOptions,
        currentPageUrl: "https://reportfraud.ftc.gov/assistant",
        actionableButtonLabels: [],
        choiceControls: [
          {
            source: "native",
            kind: "radio",
            name: "subcategory",
            id: "sub-a",
            optionValue: "Option A",
            accessibleName: "Option A",
            visible: true,
            enabled: true,
          },
        ],
      }
    );

    expect(result).toMatchObject({ ok: true, clicked: true, risk: "safe" });
    expect(active.click).toHaveBeenCalledWith({ timeout: 20_000 });
    expect(hidden.click).not.toHaveBeenCalled();
    expect(disabled.click).not.toHaveBeenCalled();
  });

  it("fails closed when scrape has zero Continues and no field mutation was applied", async () => {
    const page = mockPage();
    const active = mockContinueCandidate({ visible: true, enabled: true });
    installContinueRoleMatches(page, [active]);

    const result = await applyOwnedFilingFormDecision(
      page,
      { nextButton: { selectorType: "text", value: "Continue" } },
      {
        ...ftcOptions,
        currentPageUrl: "https://reportfraud.ftc.gov/assistant",
        actionableButtonLabels: [],
      }
    );

    expect(result).toMatchObject({
      ok: false,
      blocked: true,
      reason: "unknown_fail_closed",
      diagnostic: expect.stringContaining("phase=precheck_ambiguous"),
    });
    expect(active.click).not.toHaveBeenCalled();
  });

  it("fails closed when scrape is empty and two visible enabled Continues remain after mutation", async () => {
    const page = mockPage({ tag: "TEXTAREA", type: "textarea", visible: true, enabled: true });
    const first = mockContinueCandidate({ visible: true, enabled: true });
    const second = mockContinueCandidate({ visible: true, enabled: true });
    installContinueRoleMatches(page, [first, second]);

    const result = await applyOwnedFilingFormDecision(
      page,
      {
        fieldsToFill: [{ selector: "comments", value: "Case narrative." }],
        nextButton: { selectorType: "text", value: "Continue" },
      },
      {
        ...ftcOptions,
        currentPageUrl: "https://reportfraud.ftc.gov/form/main",
        actionableButtonLabels: [],
      }
    );

    expect(result).toMatchObject({
      ok: false,
      blocked: true,
      reason: "unknown_fail_closed",
      diagnostic: expect.stringContaining("phase=precheck_ambiguous"),
    });
    expect(first.click).not.toHaveBeenCalled();
    expect(second.click).not.toHaveBeenCalled();
  });

  it("fails closed when two Continues are scraped regardless of live matches", async () => {
    const page = mockPage();
    const active = mockContinueCandidate({ visible: true, enabled: true });
    installContinueRoleMatches(page, [active]);

    const result = await applyOwnedFilingFormDecision(
      page,
      { nextButton: { selectorType: "text", value: "Continue" } },
      {
        ...ftcOptions,
        currentPageUrl: "https://reportfraud.ftc.gov/assistant",
        actionableButtonLabels: ["Continue", "Continue"],
      }
    );

    expect(result).toMatchObject({
      ok: false,
      blocked: true,
      reason: "unknown_fail_closed",
      diagnostic: expect.stringContaining("phase=precheck_ambiguous"),
    });
    expect(active.click).not.toHaveBeenCalled();
  });

  it("still clicks when one Continue is scraped and one live active remains", async () => {
    const page = mockPage();
    const active = mockContinueCandidate({ visible: true, enabled: true });
    installContinueRoleMatches(page, [active]);

    const result = await applyOwnedFilingFormDecision(
      page,
      { nextButton: { selectorType: "text", value: "Continue" } },
      {
        ...ftcOptions,
        currentPageUrl: "https://reportfraud.ftc.gov/form/main",
        actionableButtonLabels: ["Continue"],
      }
    );

    expect(result).toMatchObject({ ok: true, clicked: true, risk: "safe" });
    expect(active.click).toHaveBeenCalledWith({ timeout: 20_000 });
  });

  it("defers unique visible-disabled Continue after a text mutation when scrape is empty", async () => {
    const page = mockPage({ tag: "TEXTAREA", type: "textarea", visible: true, enabled: true });
    const disabled = mockContinueCandidate({ visible: true, enabled: false });
    installContinueRoleMatches(page, [disabled]);

    const result = await applyOwnedFilingFormDecision(
      page,
      {
        fieldsToFill: [{ selector: "comments", value: "Case narrative." }],
        nextButton: { selectorType: "text", value: "Continue" },
      },
      {
        ...ftcOptions,
        currentPageUrl: "https://reportfraud.ftc.gov/form/main",
        actionableButtonLabels: [],
      }
    );

    expect(result).toMatchObject({
      ok: true,
      clicked: false,
      risk: "safe",
      diagnostic: expect.stringContaining("phase=precheck_disabled"),
    });
    expect(page.fillMatchLocator.fill).toHaveBeenCalled();
    expect(disabled.click).not.toHaveBeenCalled();
  });

  it("defers unique visible-disabled Continue after choice when scrape is empty", async () => {
    const page = mockPage();
    const disabled = mockContinueCandidate({ visible: true, enabled: false });
    installContinueRoleMatches(page, [disabled]);

    const result = await applyOwnedFilingFormDecision(
      page,
      {
        fieldsToFill: [
          {
            selector: "sub-b",
            value: "Option B",
            controlKind: "radio",
            choiceSelectorType: "id",
          },
        ],
        nextButton: { selectorType: "text", value: "Continue" },
      },
      {
        ...ftcOptions,
        currentPageUrl: "https://reportfraud.ftc.gov/assistant",
        actionableButtonLabels: [],
        choiceControls: [
          {
            source: "native",
            kind: "radio",
            name: "subcategory",
            id: "sub-b",
            optionValue: "Option B",
            accessibleName: "Option B",
            visible: true,
            enabled: true,
          },
        ],
      }
    );

    expect(result).toMatchObject({
      ok: true,
      clicked: false,
      risk: "safe",
      diagnostic: expect.stringContaining("phase=precheck_disabled"),
    });
    expect(page.choiceLocator.check).toHaveBeenCalled();
    expect(disabled.click).not.toHaveBeenCalled();
  });

  it("defers disabled Continue on /form/main after a successful choice apply", async () => {
    const page = mockPage();
    vi.mocked(page.exactButtonLocator.isEnabled).mockResolvedValue(false);

    const result = await applyOwnedFilingFormDecision(
      page,
      {
        fieldsToFill: [
          {
            selector: "yesOrNoMoney",
            value: "no",
            controlKind: "radio",
            choiceSelectorType: "name",
          },
        ],
        nextButton: { selectorType: "text", value: "Continue" },
      },
      {
        ...ftcOptions,
        currentPageUrl: "https://reportfraud.ftc.gov/form/main",
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
          },
        ],
      }
    );

    expect(result).toMatchObject({ ok: true, clicked: false, risk: "safe" });
    expect(page.choiceLocator.check).toHaveBeenCalled();
    expect(page.exactButtonLocator.click).not.toHaveBeenCalled();
  });

  it.each([
    ["ambiguous", 2, true, true],
    ["hidden", 1, false, true],
    ["disabled", 1, true, false],
  ] as const)(
    "fails closed when the hidden native choice label is %s",
    async (_name, count, visible, enabled) => {
      const page = mockPage();
      // for-label finds a candidate; no wrapping fallback needed
      vi.mocked(page.choiceLocator.count).mockResolvedValue(count);
      vi.mocked(page.choiceLocator.isVisible).mockResolvedValue(visible);
      vi.mocked(page.choiceLocator.isEnabled).mockResolvedValue(enabled);

      const result = await applyOwnedFilingFormDecision(
        page,
        {
          fieldsToFill: [{ selector: "category", value: "fraud", controlKind: "radio" }],
          nextButton: { selectorType: "text", value: "Continue" },
        },
        {
          ...ftcOptions,
          choiceControls: [{ ...choiceControl(), visible: false }],
        }
      );

      expect(result).toMatchObject({
        ok: false,
        blocked: true,
        risk: "unknown",
        reason: "unknown_fail_closed",
        diagnostic: expect.stringContaining(`target=choice-label,count=${count}`),
      });
      expect(page.choiceLocator.click).not.toHaveBeenCalled();
      expect(page.exactButtonLocator.click).not.toHaveBeenCalled();
      expect(page.waitForNavigation).not.toHaveBeenCalled();
    }
  );

  it("fails closed when force-check does not leave the exact native control checked", async () => {
    const page = mockPage();
    vi.mocked(page.choiceLocator.count)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(1);
    vi.mocked(page.labelLocator.count).mockResolvedValue(0);
    vi.mocked(page.choiceLocator.isChecked).mockResolvedValue(false);

    const result = await applyOwnedFilingFormDecision(
      page,
      {
        fieldsToFill: [{ selector: "category", value: "fraud", controlKind: "radio" }],
        nextButton: { selectorType: "text", value: "Continue" },
      },
      {
        ...ftcOptions,
        choiceControls: [{ ...choiceControl(), visible: false }],
      }
    );

    expect(result).toMatchObject({
      ok: false,
      blocked: true,
      reason: "unknown_fail_closed",
      diagnostic: expect.stringContaining("target=choice,count=1"),
    });
    expect(page.choiceLocator.check).toHaveBeenCalledWith({
      force: true,
      timeout: 20_000,
    });
    expect(page.exactButtonLocator.click).not.toHaveBeenCalled();
  });

  it("fails closed for a hidden but enabled ARIA choice control without label activation", async () => {
    const page = mockPage();

    const result = await applyOwnedFilingFormDecision(
      page,
      {
        fieldsToFill: [
          {
            selector: "category-fraud",
            value: "fraud",
            controlKind: "radio",
            choiceSelectorType: "id",
          },
        ],
        nextButton: { selectorType: "text", value: "Continue" },
      },
      {
        ...ftcOptions,
        choiceControls: [{ ...choiceControl("radio", "aria"), name: "", visible: false }],
      }
    );

    expect(result).toMatchObject({
      ok: false,
      blocked: true,
      reason: "unknown_fail_closed",
      diagnostic: expect.stringContaining("target=choice-label,count=0"),
    });
    expect(page.locator).not.toHaveBeenCalled();
    expect(page.exactButtonLocator.click).not.toHaveBeenCalled();
  });

  it("does not apply force-check to a non-choice target", async () => {
    const page = mockPage();

    const result = await applyOwnedFilingFormDecision(
      page,
      { nextButton: { selectorType: "text", value: "Do the thing" } },
      ftcOptions
    );

    expect(result).toMatchObject({
      ok: false,
      blocked: true,
      reason: "unknown_fail_closed",
    });
    expect(page.choiceLocator.check).not.toHaveBeenCalled();
    expect(page.choiceLocator.click).not.toHaveBeenCalled();
    expect(page.exactButtonLocator.click).not.toHaveBeenCalled();
  });

  it("bounds a stuck force-check and attributes it to check", async () => {
    vi.useFakeTimers();
    const page = mockPage();
    vi.mocked(page.choiceLocator.count)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(1);
    vi.mocked(page.labelLocator.count).mockResolvedValue(0);
    vi.mocked(page.choiceLocator.check).mockImplementation(
      (options) =>
        new Promise<void>((_resolve, reject) => {
          setTimeout(() => {
            reject(Object.assign(new Error("Timeout exceeded"), { name: "TimeoutError" }));
          }, options?.timeout);
        })
    );

    const pending = applyOwnedFilingFormDecision(
      page,
      {
        fieldsToFill: [{ selector: "category", value: "fraud", controlKind: "radio" }],
        nextButton: { selectorType: "text", value: "Continue" },
      },
      {
        ...ftcOptions,
        choiceControls: [{ ...choiceControl(), visible: false }],
      }
    );
    const assertion = expect(pending).rejects.toThrow(
      "owned-filing action_timeout:check after 20000ms"
    );
    await vi.advanceTimersByTimeAsync(OWNED_FILING_FTC_ACTION_TIMEOUT_MS);
    await assertion;
    expect(page.choiceLocator.check).toHaveBeenCalledWith({
      force: true,
      timeout: 20_000,
    });
    expect(page.exactButtonLocator.click).not.toHaveBeenCalled();
  });

  it("bounds a stuck hidden-label click and attributes it to check", async () => {
    vi.useFakeTimers();
    const page = mockPage();
    vi.mocked(page.choiceLocator.click).mockImplementation(
      (options) =>
        new Promise<void>((_resolve, reject) => {
          setTimeout(() => {
            reject(Object.assign(new Error("Timeout exceeded"), { name: "TimeoutError" }));
          }, options?.timeout);
        })
    );

    const pending = applyOwnedFilingFormDecision(
      page,
      {
        fieldsToFill: [{ selector: "category", value: "fraud", controlKind: "radio" }],
        nextButton: { selectorType: "text", value: "Continue" },
      },
      {
        ...ftcOptions,
        choiceControls: [{ ...choiceControl(), visible: false }],
      }
    );
    const assertion = expect(pending).rejects.toThrow(
      "owned-filing action_timeout:check after 20000ms"
    );
    await vi.advanceTimersByTimeAsync(OWNED_FILING_FTC_ACTION_TIMEOUT_MS);
    await assertion;
    expect(page.choiceLocator.click).toHaveBeenCalledWith({ timeout: 20_000 });
    expect(page.exactButtonLocator.click).not.toHaveBeenCalled();
  });

  it("keeps choice values out of hidden-label fail-closed diagnostics", async () => {
    const page = mockPage();
    vi.mocked(page.choiceLocator.count).mockResolvedValue(0);
    vi.mocked(page.labelLocator.count).mockResolvedValue(0);
    const secret = "SENSITIVE_CHOICE_VALUE";

    const result = await applyOwnedFilingFormDecision(
      page,
      {
        fieldsToFill: [{ selector: "category", value: secret, controlKind: "radio" }],
        nextButton: { selectorType: "text", value: "Continue" },
      },
      {
        ...ftcOptions,
        actionableButtonLabels: ["Continue"],
        choiceControls: [{ ...choiceControl(), optionValue: secret, visible: false }],
      }
    );

    const serialized = JSON.stringify(result);
    expect(serialized).toContain("target=choice,count=0");
    expect(serialized).not.toContain(secret);
  });

  it("fails closed before DOM lookup when scraped choice metadata is ambiguous", async () => {
    const page = mockPage();
    const duplicate = choiceControl();

    const result = await applyOwnedFilingFormDecision(
      page,
      {
        fieldsToFill: [{ selector: "category", value: "fraud", controlKind: "radio" }],
        nextButton: { selectorType: "text", value: "Continue" },
      },
      { ...ftcOptions, choiceControls: [duplicate, { ...duplicate }] }
    );

    expect(result).toMatchObject({
      ok: false,
      blocked: true,
      diagnostic: expect.stringContaining("target=choice,count=2"),
    });
    expect(page.locator).not.toHaveBeenCalled();
    expect(page.exactButtonLocator.click).not.toHaveBeenCalled();
  });

  it("does not enable choice controls outside official FTC choice-flow pages", async () => {
    const page = mockPage();

    const offHost = await applyOwnedFilingFormDecision(
      page,
      {
        fieldsToFill: [{ selector: "category", value: "fraud", controlKind: "radio" }],
        nextButton: { selectorType: "text", value: "Continue" },
      },
      { ...ftcOptions, currentPageUrl: "https://example.com/assistant" }
    );
    expect(offHost).toMatchObject({
      ok: false,
      blocked: true,
      reason: "unknown_fail_closed",
      diagnostic: expect.stringContaining("target=choice,count=0"),
    });

    const entryOnly = await applyOwnedFilingFormDecision(
      page,
      {
        fieldsToFill: [{ selector: "yesOrNoMoney", value: "no", controlKind: "radio" }],
        nextButton: { selectorType: "text", value: "Continue" },
      },
      { ...ftcOptions, currentPageUrl: "https://reportfraud.ftc.gov/" }
    );
    expect(entryOnly).toMatchObject({
      ok: false,
      blocked: true,
      reason: "unknown_fail_closed",
      diagnostic: expect.stringContaining("target=choice,count=0"),
    });

    expect(page.locator).not.toHaveBeenCalled();
    expect(page.exactButtonLocator.click).not.toHaveBeenCalled();
  });

  it("does not fill Angular formcontrolname selectors for BBB", async () => {
    const page = mockPage();

    await expect(
      applyOwnedFilingFormDecision(
        page,
        {
          fieldsToFill: [{ selector: "comments", value: "BBB story" }],
          nextButton: { selectorType: "text", value: "Continue" },
        },
        { mode: "dry_run", logPrefix: "real-bbb-submit" }
      )
    ).resolves.toMatchObject({ ok: true, clicked: true });

    expect(page.fill).toHaveBeenCalledWith(
      expect.not.stringContaining("formcontrolname"),
      "BBB story"
    );
    expect(page.click).toHaveBeenCalledWith('button:has-text("Continue")');
  });

  it("bounds a stuck FTC choice check and attributes it to check", async () => {
    vi.useFakeTimers();
    const page = mockPage();
    vi.mocked(page.choiceLocator.check).mockImplementation(
      (options) =>
        new Promise<void>((_resolve, reject) => {
          setTimeout(() => {
            reject(Object.assign(new Error("Timeout exceeded"), { name: "TimeoutError" }));
          }, options?.timeout);
        })
    );

    const pending = applyOwnedFilingFormDecision(
      page,
      {
        fieldsToFill: [{ selector: "category", value: "fraud", controlKind: "radio" }],
        nextButton: { selectorType: "text", value: "Continue" },
      },
      ftcOptions
    );
    const assertion = expect(pending).rejects.toThrow(
      "owned-filing action_timeout:check after 20000ms"
    );
    await vi.advanceTimersByTimeAsync(OWNED_FILING_FTC_ACTION_TIMEOUT_MS);
    await assertion;
    expect(page.choiceLocator.check).toHaveBeenCalledWith({ timeout: 20_000 });
    expect(page.exactButtonLocator.click).not.toHaveBeenCalled();
  });

  it("keeps choice values and case content out of fail-closed diagnostics", async () => {
    const page = mockPage();
    vi.mocked(page.choiceLocator.count).mockResolvedValue(0);
    const secret = "SENSITIVE_CHOICE_VALUE";
    const caseContent = "SENSITIVE_CASE_CONTENT";

    const result = await applyOwnedFilingFormDecision(
      page,
      {
        fieldsToFill: [{ selector: "category", value: secret, controlKind: "radio" }],
        nextButton: { selectorType: "text", value: "Continue" },
      },
      {
        ...ftcOptions,
        actionableButtonLabels: ["Continue", "Next"],
      }
    );

    const serialized = JSON.stringify(result);
    expect(serialized).toContain("labels=Continue/Next");
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain(caseContent);
  });

  it("fails a stuck click at 20 seconds", async () => {
    vi.useFakeTimers();
    const page = mockPage();
    vi.mocked(page.exactButtonLocator.click).mockImplementation(
      (options) =>
        new Promise<void>((_resolve, reject) => {
          setTimeout(() => {
            reject(Object.assign(new Error("Timeout exceeded"), { name: "TimeoutError" }));
          }, options?.timeout);
        })
    );

    const pending = applyOwnedFilingFormDecision(
      page,
      { nextButton: { selectorType: "text", value: "Continue" } },
      ftcOptions
    );
    const assertion = expect(pending).rejects.toThrow(
      "owned-filing action_timeout:click after 20000ms"
    );
    await vi.advanceTimersByTimeAsync(OWNED_FILING_FTC_ACTION_TIMEOUT_MS);
    await assertion;
    expect(page.getByRole).toHaveBeenCalledWith("button", {
      name: "Continue",
      exact: true,
    });
    expect(page.exactButtonLocator.click).toHaveBeenCalledWith({
      timeout: 20_000,
    });
    expect(page.click).not.toHaveBeenCalled();
  });

  it("does not map a soft navigation timeout to action_timeout and still counts the click", async () => {
    const page = mockPage();
    vi.mocked(page.exactButtonLocator.click).mockResolvedValue(undefined);
    vi.mocked(page.waitForNavigation).mockRejectedValue(
      Object.assign(new Error("Timeout 10000ms exceeded."), { name: "TimeoutError" })
    );

    const result = await applyOwnedFilingFormDecision(
      page,
      { nextButton: { selectorType: "text", value: "Continue" }, waitForNavigation: true },
      ftcOptions
    );

    expect(result).toMatchObject({
      ok: true,
      clicked: true,
      risk: "safe",
      diagnostic: expect.stringContaining("phase=nav_soft_timeout"),
    });
    expect(page.exactButtonLocator.click).toHaveBeenCalledWith({ timeout: 20_000 });
    expect(page.waitForNavigation).toHaveBeenCalled();
  });

  it("clicks the exact Report Now link on the official FTC entry root", async () => {
    const page = mockPage();
    vi.mocked(page.exactButtonLocator.count).mockResolvedValue(0);
    vi.mocked(page.exactLinkLocator.count).mockResolvedValue(1);

    const result = await applyOwnedFilingFormDecision(
      page,
      {
        nextButton: { selectorType: "text", value: "Report Now" },
        waitForNavigation: true,
      },
      { ...ftcOptions, currentPageUrl: "https://reportfraud.ftc.gov/" }
    );

    expect(result).toMatchObject({ ok: true, clicked: true, risk: "safe" });
    expect(page.getByRole).toHaveBeenCalledWith("link", {
      name: "Report Now",
      exact: true,
    });
    expect(page.exactLinkLocator.click).toHaveBeenCalledWith({ timeout: 20_000 });
    expect(page.waitForNavigation).toHaveBeenCalledTimes(1);
  });

  it("clicks the exact Report Now button on the official FTC entry root", async () => {
    const page = mockPage();

    const result = await applyOwnedFilingFormDecision(
      page,
      { nextButton: { selectorType: "text", value: "Report Now" } },
      { ...ftcOptions, currentPageUrl: "https://reportfraud.ftc.gov/" }
    );

    expect(result).toMatchObject({ ok: true, clicked: true, risk: "safe" });
    expect(page.exactButtonLocator.click).toHaveBeenCalledWith({ timeout: 20_000 });
    expect(page.exactLinkLocator.click).not.toHaveBeenCalled();
  });

  it.each([
    "https://reportfraud.ftc.gov/assistant",
    "https://example.com/",
  ])("does not allow Report Now at %s", async (currentPageUrl) => {
    const page = mockPage();
    vi.mocked(page.exactLinkLocator.count).mockResolvedValue(1);

    const result = await applyOwnedFilingFormDecision(
      page,
      { nextButton: { selectorType: "text", value: "Report Now" } },
      { ...ftcOptions, currentPageUrl }
    );

    expect(result).toMatchObject({
      ok: false,
      blocked: true,
      reason: "unknown_fail_closed",
    });
    expect(page.getByRole).not.toHaveBeenCalledWith("link", expect.anything());
    expect(page.exactButtonLocator.click).not.toHaveBeenCalled();
    expect(page.exactLinkLocator.click).not.toHaveBeenCalled();
  });

  it("fails closed for duplicate Report Now roles on the FTC entry root", async () => {
    const page = mockPage();
    vi.mocked(page.exactLinkLocator.count).mockResolvedValue(1);

    const result = await applyOwnedFilingFormDecision(
      page,
      { nextButton: { selectorType: "text", value: "Report Now" } },
      { ...ftcOptions, currentPageUrl: "https://reportfraud.ftc.gov/" }
    );

    expect(result).toMatchObject({
      ok: false,
      blocked: true,
      reason: "unknown_fail_closed",
    });
    expect(page.exactButtonLocator.click).not.toHaveBeenCalled();
    expect(page.exactLinkLocator.click).not.toHaveBeenCalled();
  });

  it("fails closed when Report Now has no exact accessible-name match", async () => {
    const page = mockPage();
    vi.mocked(page.exactButtonLocator.count).mockResolvedValue(0);

    const result = await applyOwnedFilingFormDecision(
      page,
      { nextButton: { selectorType: "text", value: "Report Now" } },
      { ...ftcOptions, currentPageUrl: "https://reportfraud.ftc.gov/" }
    );

    expect(result).toMatchObject({
      ok: false,
      blocked: true,
      reason: "unknown_fail_closed",
    });
    expect(page.getByRole).toHaveBeenCalledWith("button", {
      name: "Report Now",
      exact: true,
    });
    expect(page.getByRole).toHaveBeenCalledWith("link", {
      name: "Report Now",
      exact: true,
    });
  });

  it("does not start a navigation wait when the exact target is absent", async () => {
    const page = mockPage();
    vi.mocked(page.exactButtonLocator.count).mockResolvedValue(0);

    const result = await applyOwnedFilingFormDecision(
      page,
      {
        nextButton: { selectorType: "text", value: "Continue" },
        waitForNavigation: true,
      },
      ftcOptions
    );

    expect(result).toMatchObject({
      ok: false,
      blocked: true,
      reason: "unknown_fail_closed",
    });
    expect(page.waitForNavigation).not.toHaveBeenCalled();
  });

  it("fails closed when an exact accessible target cannot be clicked", async () => {
    const page = mockPage();
    vi.mocked(page.exactButtonLocator.click).mockRejectedValue(new Error("element is not visible"));

    const result = await applyOwnedFilingFormDecision(
      page,
      { nextButton: { selectorType: "text", value: "Continue" } },
      ftcOptions
    );

    expect(result).toMatchObject({
      ok: false,
      blocked: true,
      risk: "unknown",
      reason: "unknown_fail_closed",
      diagnostic: expect.stringContaining("phase=click_rejected"),
    });
    expect(page.exactButtonLocator.click).toHaveBeenCalledTimes(1);
  });

  it("allows a safe bounded click and still blocks Submit", async () => {
    const page = mockPage();
    await expect(
      applyOwnedFilingFormDecision(
        page,
        { nextButton: { selectorType: "text", value: "Continue" } },
        ftcOptions
      )
    ).resolves.toMatchObject({ ok: true, clicked: true, risk: "safe" });
    expect(page.getByRole).toHaveBeenCalledWith("button", {
      name: "Continue",
      exact: true,
    });
    expect(page.exactButtonLocator.click).toHaveBeenCalledWith({
      timeout: 20_000,
    });

    vi.mocked(page.exactButtonLocator.click).mockClear();
    await expect(
      applyOwnedFilingFormDecision(
        page,
        { nextButton: { selectorType: "text", value: "Submit complaint" } },
        ftcOptions
      )
    ).resolves.toMatchObject({
      ok: false,
      blocked: true,
      reason: "dry_run_stop",
    });
    expect(page.exactButtonLocator.click).not.toHaveBeenCalled();
  });

  it("fails closed without clicking when the exact accessible target is not unique", async () => {
    const page = mockPage();
    const first = mockContinueCandidate({ visible: true, enabled: true });
    const second = mockContinueCandidate({ visible: true, enabled: true });
    installContinueRoleMatches(page, [first, second]);

    const result = await applyOwnedFilingFormDecision(
      page,
      { nextButton: { selectorType: "text", value: "Continue" } },
      ftcOptions
    );

    expect(result).toMatchObject({
      ok: false,
      blocked: true,
      reason: "unknown_fail_closed",
      diagnostic: expect.stringContaining("phase=precheck_ambiguous"),
    });
    expect(first.click).not.toHaveBeenCalled();
    expect(second.click).not.toHaveBeenCalled();
  });

  it("does not click a disabled exact Continue target", async () => {
    const page = mockPage();
    vi.mocked(page.exactButtonLocator.isEnabled).mockResolvedValue(false);

    const result = await applyOwnedFilingFormDecision(
      page,
      { nextButton: { selectorType: "text", value: "Continue" } },
      ftcOptions
    );

    expect(result).toMatchObject({
      ok: false,
      blocked: true,
      reason: "unknown_fail_closed",
      diagnostic: expect.stringContaining("phase=precheck_disabled"),
    });
    expect(page.getByRole).toHaveBeenCalledWith("button", {
      name: "Continue",
      exact: true,
    });
    expect(page.exactButtonLocator.click).not.toHaveBeenCalled();
  });

  it("defers Continue when unique visible target stays disabled after an FTC choice", async () => {
    const page = mockPage();
    vi.mocked(page.choiceLocator.count).mockResolvedValueOnce(0); // label[for]=0
    vi.mocked(page.exactButtonLocator.isEnabled).mockResolvedValue(false);

    const result = await applyOwnedFilingFormDecision(
      page,
      {
        fieldsToFill: [
          {
            selector: "cat-radio-2",
            value: "Online shopping",
            controlKind: "radio",
            choiceSelectorType: "id",
          },
        ],
        nextButton: { selectorType: "text", value: "Continue" },
      },
      {
        ...ftcOptions,
        choiceControls: [ftcCategoryControl()],
      }
    );

    expect(result).toMatchObject({
      ok: true,
      clicked: false,
      risk: "safe",
      diagnostic: expect.stringMatching(
        /target=continue,count=1,visible=true,enabled=false,phase=precheck_disabled/
      ),
    });
    expect(page.labelLocator.click).toHaveBeenCalled();
    expect(page.exactButtonLocator.click).not.toHaveBeenCalled();
    expect(page.waitForNavigation).not.toHaveBeenCalled();
  });

  it("does not click a hidden exact Continue target and returns sanitized diagnostics", async () => {
    const page = mockPage();
    vi.mocked(page.exactButtonLocator.isVisible).mockResolvedValue(false);

    const result = await applyOwnedFilingFormDecision(
      page,
      { nextButton: { selectorType: "text", value: "Continue" } },
      { ...ftcOptions, actionableButtonLabels: ["Continue"] }
    );

    expect(result).toMatchObject({
      ok: false,
      blocked: true,
      reason: "unknown_fail_closed",
      diagnostic:
        "target=continue,count=1,visible=false,enabled=true,phase=precheck_hidden,labels=Continue",
    });
    expect(page.exactButtonLocator.click).not.toHaveBeenCalled();
    expect(page.waitForNavigation).not.toHaveBeenCalled();
  });

  it("attributes a soft Continue click failure to click_rejected", async () => {
    const page = mockPage();
    vi.mocked(page.exactButtonLocator.click).mockRejectedValue(new Error("element is not enabled"));

    const result = await applyOwnedFilingFormDecision(
      page,
      { nextButton: { selectorType: "text", value: "Continue" } },
      ftcOptions
    );

    expect(result).toMatchObject({
      ok: false,
      blocked: true,
      reason: "unknown_fail_closed",
      diagnostic: expect.stringContaining("phase=click_rejected"),
    });
  });

  it("keeps dry-run Submit blocked after a deferred Continue", async () => {
    const page = mockPage();
    vi.mocked(page.choiceLocator.count).mockResolvedValueOnce(0);
    vi.mocked(page.exactButtonLocator.isEnabled).mockResolvedValue(false);

    const deferred = await applyOwnedFilingFormDecision(
      page,
      {
        fieldsToFill: [
          {
            selector: "cat-radio-2",
            value: "Online shopping",
            controlKind: "radio",
            choiceSelectorType: "id",
          },
        ],
        nextButton: { selectorType: "text", value: "Continue" },
      },
      {
        ...ftcOptions,
        choiceControls: [ftcCategoryControl()],
      }
    );
    expect(deferred).toMatchObject({ ok: true, clicked: false });

    const submit = await applyOwnedFilingFormDecision(
      page,
      { nextButton: { selectorType: "text", value: "Submit" } },
      ftcOptions
    );
    expect(submit).toMatchObject({
      ok: false,
      blocked: true,
      risk: "irreversible",
      reason: "dry_run_stop",
    });
    expect(page.click).not.toHaveBeenCalled();
  });

  it("leaves BBB calls unbounded and preserves its soft action failure", async () => {
    const page = mockPage();
    vi.mocked(page.fill).mockRejectedValue(
      Object.assign(new Error("Timeout exceeded"), { name: "TimeoutError" })
    );

    await expect(
      applyOwnedFilingFormDecision(
        page,
        {
          fieldsToFill: [
            { selector: "email", value: "private@example.com", controlKind: "radio" },
          ],
          nextButton: { selectorType: "text", value: "Continue" },
        },
        { mode: "dry_run", logPrefix: "real-bbb-submit" }
      )
    ).resolves.toMatchObject({ ok: true, clicked: true });
    expect(page.fill).toHaveBeenCalledWith(expect.any(String), "private@example.com");
    expect(page.click).toHaveBeenCalledWith('button:has-text("Continue")');
    expect(page.locator).not.toHaveBeenCalled();
  });
});

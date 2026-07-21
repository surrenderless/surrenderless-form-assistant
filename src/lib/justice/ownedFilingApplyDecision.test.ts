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
};

function mockPage(): MockPage {
  const exactButtonLocator = {
    count: vi.fn(async () => 1),
    isVisible: vi.fn(async () => true),
    isEnabled: vi.fn(async () => true),
    click: vi.fn(async () => undefined),
  } as unknown as Locator;
  const exactLinkLocator = {
    count: vi.fn(async () => 0),
    isVisible: vi.fn(async () => true),
    isEnabled: vi.fn(async () => true),
    click: vi.fn(async () => undefined),
  } as unknown as Locator;
  const choiceLocator = {
    count: vi.fn(async () => 1),
    isVisible: vi.fn(async () => true),
    isEnabled: vi.fn(async () => true),
    check: vi.fn(async () => undefined),
    click: vi.fn(async () => undefined),
    getAttribute: vi.fn(async () => "false"),
  } as unknown as Locator;
  return {
    fill: vi.fn(async () => undefined),
    click: vi.fn(async () => undefined),
    waitForNavigation: vi.fn(async () => undefined),
    getByRole: vi.fn((role) => (role === "link" ? exactLinkLocator : exactButtonLocator)),
    locator: vi.fn(() => choiceLocator),
    exactButtonLocator,
    exactLinkLocator,
    choiceLocator,
  } as unknown as MockPage;
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

  it("fails a stuck fill at 20 seconds without exposing its value", async () => {
    vi.useFakeTimers();
    const page = mockPage();
    vi.mocked(page.fill).mockImplementation(
      (_selector, _value, options) =>
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
    expect(page.fill).toHaveBeenCalledWith(
      expect.any(String),
      "private@example.com",
      { timeout: 20_000 }
    );
    await pending.catch((err: Error) => {
      expect(err.message).not.toContain("private@example.com");
    });
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

  it("does not enable choice controls outside the official FTC assistant page", async () => {
    const page = mockPage();

    const result = await applyOwnedFilingFormDecision(
      page,
      {
        fieldsToFill: [{ selector: "category", value: "fraud", controlKind: "radio" }],
        nextButton: { selectorType: "text", value: "Continue" },
      },
      { ...ftcOptions, currentPageUrl: "https://example.com/assistant" }
    );

    expect(result).toMatchObject({
      ok: false,
      blocked: true,
      reason: "unknown_fail_closed",
    });
    expect(page.locator).not.toHaveBeenCalled();
    expect(page.exactButtonLocator.click).not.toHaveBeenCalled();
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

    expect(result).toMatchObject({ ok: true, clicked: true, risk: "safe" });
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
    vi.mocked(page.exactButtonLocator.count).mockResolvedValue(2);

    const result = await applyOwnedFilingFormDecision(
      page,
      { nextButton: { selectorType: "text", value: "Continue" } },
      ftcOptions
    );

    expect(result).toMatchObject({
      ok: false,
      blocked: true,
      reason: "unknown_fail_closed",
    });
    expect(page.exactButtonLocator.click).not.toHaveBeenCalled();
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
    });
    expect(page.getByRole).toHaveBeenCalledWith("button", {
      name: "Continue",
      exact: true,
    });
    expect(page.exactButtonLocator.click).not.toHaveBeenCalled();
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
      diagnostic: "target=continue,count=1,visible=false,enabled=true,labels=Continue",
    });
    expect(page.exactButtonLocator.click).not.toHaveBeenCalled();
    expect(page.waitForNavigation).not.toHaveBeenCalled();
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

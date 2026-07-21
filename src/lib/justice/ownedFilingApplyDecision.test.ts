import { afterEach, describe, expect, it, vi } from "vitest";
import type { Locator, Page } from "playwright";
import {
  applyOwnedFilingFormDecision,
  OWNED_FILING_FTC_ACTION_TIMEOUT_MS,
} from "@/lib/justice/ownedFilingApplyDecision";
import type { FormDecision } from "@/lib/justice/realBbbBoundedSubmitLoop";

type MockPage = Page & {
  exactButtonLocator: Locator;
  exactLinkLocator: Locator;
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
  return {
    fill: vi.fn(async () => undefined),
    click: vi.fn(async () => undefined),
    waitForNavigation: vi.fn(async () => undefined),
    getByRole: vi.fn((role) => (role === "link" ? exactLinkLocator : exactButtonLocator)),
    exactButtonLocator,
    exactLinkLocator,
  } as unknown as MockPage;
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

  it("leaves BBB calls unbounded and preserves its soft action failure", async () => {
    const page = mockPage();
    vi.mocked(page.fill).mockRejectedValue(
      Object.assign(new Error("Timeout exceeded"), { name: "TimeoutError" })
    );

    await expect(
      applyOwnedFilingFormDecision(
        page,
        {
          fieldsToFill: [{ selector: "email", value: "private@example.com" }],
          nextButton: { selectorType: "text", value: "Continue" },
        },
        { mode: "dry_run", logPrefix: "real-bbb-submit" }
      )
    ).resolves.toMatchObject({ ok: true, clicked: true });
    expect(page.fill).toHaveBeenCalledWith(expect.any(String), "private@example.com");
    expect(page.click).toHaveBeenCalledWith('button:has-text("Continue")');
  });
});

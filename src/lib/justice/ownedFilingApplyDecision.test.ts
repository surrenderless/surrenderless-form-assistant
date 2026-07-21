import { afterEach, describe, expect, it, vi } from "vitest";
import type { Page } from "playwright";
import {
  applyOwnedFilingFormDecision,
  OWNED_FILING_FTC_ACTION_TIMEOUT_MS,
} from "@/lib/justice/ownedFilingApplyDecision";
import type { FormDecision } from "@/lib/justice/realBbbBoundedSubmitLoop";

function mockPage(): Page {
  return {
    fill: vi.fn(async () => undefined),
    click: vi.fn(async () => undefined),
    waitForNavigation: vi.fn(async () => undefined),
  } as unknown as Page;
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
    vi.mocked(page.click).mockImplementation(
      (_selector, options) =>
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
    expect(page.click).toHaveBeenCalledWith('button:has-text("Continue")', {
      timeout: 20_000,
    });
  });

  it("does not map a soft navigation timeout to action_timeout and still counts the click", async () => {
    const page = mockPage();
    vi.mocked(page.click).mockResolvedValue(undefined);
    vi.mocked(page.waitForNavigation).mockRejectedValue(
      Object.assign(new Error("Timeout 10000ms exceeded."), { name: "TimeoutError" })
    );

    const result = await applyOwnedFilingFormDecision(
      page,
      { nextButton: { selectorType: "text", value: "Continue" }, waitForNavigation: true },
      ftcOptions
    );

    expect(result).toMatchObject({ ok: true, clicked: true, risk: "safe" });
    expect(page.click).toHaveBeenCalledWith('button:has-text("Continue")', { timeout: 20_000 });
    expect(page.waitForNavigation).toHaveBeenCalled();
  });

  it("does not count a click as clicked when page.click fails softly", async () => {
    const page = mockPage();
    vi.mocked(page.click).mockRejectedValue(new Error("element is not visible"));

    const result = await applyOwnedFilingFormDecision(
      page,
      { nextButton: { selectorType: "text", value: "Continue" } },
      ftcOptions
    );

    expect(result).toMatchObject({ ok: true, clicked: false, risk: "safe" });
    expect(page.click).toHaveBeenCalledTimes(1);
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
    expect(page.click).toHaveBeenCalledWith('button:has-text("Continue")', {
      timeout: 20_000,
    });

    vi.mocked(page.click).mockClear();
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

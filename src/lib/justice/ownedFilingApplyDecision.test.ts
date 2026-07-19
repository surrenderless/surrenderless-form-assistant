import { describe, expect, it, vi } from "vitest";
import type { Page } from "playwright";
import { applyOwnedFilingFormDecision } from "@/lib/justice/ownedFilingApplyDecision";
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

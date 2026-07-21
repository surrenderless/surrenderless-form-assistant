import type { Page } from "playwright";
import {
  buildButtonSelector,
  type FormDecision,
} from "@/lib/justice/realBbbBoundedSubmitLoop";
import { isFtcReportEntryUrl } from "@/lib/justice/realFtcBoundedSubmitLoop";
import { classifyOwnedFilingClick } from "@/lib/justice/classifyOwnedFilingClick";
import { isOwnedFilingSubmitArmed } from "@/lib/justice/ownedFilingSubmitArmed";

export type OwnedFilingSubmissionMode = "live" | "dry_run";
export const OWNED_FILING_FTC_ACTION_TIMEOUT_MS = 20_000;

export type OwnedFilingApplyDecisionResult =
  | { ok: true; clicked: boolean; risk: "safe" | "none" | "irreversible" }
  | {
      ok: false;
      blocked: true;
      risk: "irreversible" | "unknown";
      buttonLabel: string;
      reason: "dry_run_stop" | "unarmed_live" | "unknown_fail_closed";
    };

type ApplyDecisionOptions = {
  mode: OwnedFilingSubmissionMode;
  logPrefix: string;
  env?: Record<string, string | undefined>;
  /** FTC-only action bound. Omitted by BBB to preserve its existing behavior. */
  actionTimeoutMs?: number;
  /** FTC propagates action timeouts and closed-target errors; BBB keeps legacy soft failures. */
  propagateCriticalErrors?: boolean;
  /** FTC text buttons use an exact accessible-name locator and require exactly one match. */
  useExactTextButtonLocator?: boolean;
  /** Current FTC page URL, used only for the root-scoped Report Now link exception. */
  currentPageUrl?: string;
};

function isActionTimeoutError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return (
    (err instanceof Error && err.name === "TimeoutError") ||
    /timeout(?:error)?[\s\S]*exceeded/i.test(message)
  );
}

function isClosedTargetError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return (
    /target page, context or browser has been closed/i.test(message) ||
    /browser.*(?:disconnected|has been closed)/i.test(message) ||
    /context.*(?:closed|destroyed)/i.test(message)
  );
}

function propagateFtcActionError(
  err: unknown,
  options: ApplyDecisionOptions,
  operation: "fill" | "click"
): void {
  if (!options.propagateCriticalErrors) return;
  if (isActionTimeoutError(err)) {
    throw new Error(
      `owned-filing action_timeout:${operation} after ${options.actionTimeoutMs ?? "configured"}ms`
    );
  }
  if (isClosedTargetError(err)) throw err;
}

/** Returns the timed-out FTC action operation, or null for non-action-timeout errors. */
export function parseOwnedFilingActionTimeoutOperation(err: unknown): "fill" | "click" | null {
  const message = err instanceof Error ? err.message : String(err);
  const match = /action_timeout:(fill|click)/i.exec(message);
  return match ? (match[1].toLowerCase() as "fill" | "click") : null;
}

async function fillFields(
  page: Page,
  decision: FormDecision,
  options: ApplyDecisionOptions
): Promise<void> {
  const fieldsToFill = decision.fieldsToFill ?? [];
  for (const field of fieldsToFill) {
    if (!field.selector?.trim()) continue;
    try {
      const selector = `input[name="${field.selector}"], input#${field.selector}, textarea[name="${field.selector}"], textarea#${field.selector}, select[name="${field.selector}"], select#${field.selector}`;
      if (options.actionTimeoutMs === undefined) {
        await page.fill(selector, String(field.value ?? ""));
      } else {
        await page.fill(selector, String(field.value ?? ""), {
          timeout: options.actionTimeoutMs,
        });
      }
    } catch (err: unknown) {
      propagateFtcActionError(err, options, "fill");
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`${options.logPrefix}: could not fill "${field.selector}":`, message);
    }
  }
}

/**
 * Clicks the next button. Returns true only when `page.click` actually resolves.
 * Navigation waiting stays optional and soft: a navigation timeout is swallowed and never
 * remapped to an action_timeout. Only the click itself can raise an FTC action_timeout.
 */
async function clickNextButton(
  page: Page,
  decision: FormDecision,
  options: ApplyDecisionOptions
): Promise<boolean> {
  if (!decision.nextButton?.value?.trim()) return false;
  const buttonSelector = buildButtonSelector(decision.nextButton);
  const waitForNavigation = () =>
    page.waitForNavigation({ timeout: 10000 }).catch((err: unknown) => {
      if (options.propagateCriticalErrors && isClosedTargetError(err)) throw err;
      console.warn(`${options.logPrefix}: navigation timeout after button click`);
    });
  try {
    let click: () => Promise<boolean>;
    if (options.useExactTextButtonLocator && decision.nextButton.selectorType === "text") {
      const locatorOptions = { name: decision.nextButton.value, exact: true } as const;
      const buttonTarget = page.getByRole("button", locatorOptions);
      let target = buttonTarget;
      if (decision.nextButton.value === "Report Now") {
        if (!isFtcReportEntryUrl(options.currentPageUrl ?? "")) return false;
        const linkTarget = page.getByRole("link", locatorOptions);
        const [buttonCount, linkCount] = await Promise.all([
          buttonTarget.count(),
          linkTarget.count(),
        ]);
        if (buttonCount + linkCount !== 1) return false;
        target = buttonCount === 1 ? buttonTarget : linkTarget;
      } else if ((await buttonTarget.count()) !== 1) {
        return false;
      }
      if (!(await target.isVisible()) || !(await target.isEnabled())) return false;
      click = async () => {
        if (options.actionTimeoutMs === undefined) {
          await target.click();
        } else {
          await target.click({ timeout: options.actionTimeoutMs });
        }
        return true;
      };
    } else {
      click = async () => {
        if (options.actionTimeoutMs === undefined) {
          await page.click(buttonSelector);
        } else {
          await page.click(buttonSelector, { timeout: options.actionTimeoutMs });
        }
        return true;
      };
    }

    let clicked: boolean;
    if (decision.waitForNavigation) {
      [, clicked] = await Promise.all([waitForNavigation(), click()]);
    } else {
      clicked = await click();
    }
    return clicked;
  } catch (err: unknown) {
    propagateFtcActionError(err, options, "click");
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`${options.logPrefix}: could not click button:`, message);
    return false;
  }
}

/**
 * Fill fields, then gate the next click by risk + mode + arming.
 * Dry-run and unarmed live never click irreversible/unknown buttons.
 * Unknown always fails closed. Irreversible only when live + armed.
 */
export async function applyOwnedFilingFormDecision(
  page: Page,
  decision: FormDecision,
  options: ApplyDecisionOptions
): Promise<OwnedFilingApplyDecisionResult> {
  await fillFields(page, decision, options);

  const next = decision.nextButton;
  if (!next?.value?.trim()) {
    return { ok: true, clicked: false, risk: "none" };
  }

  const risk = classifyOwnedFilingClick(next);
  const buttonLabel = `${next.selectorType}:${next.value}`.slice(0, 200);

  if (risk === "safe") {
    const clicked = await clickNextButton(page, decision, options);
    if (!clicked && options.useExactTextButtonLocator) {
      return {
        ok: false,
        blocked: true,
        risk: "unknown",
        buttonLabel,
        reason: "unknown_fail_closed",
      };
    }
    return { ok: true, clicked, risk: "safe" };
  }

  if (risk === "unknown") {
    return {
      ok: false,
      blocked: true,
      risk: "unknown",
      buttonLabel,
      reason: "unknown_fail_closed",
    };
  }

  // irreversible
  if (options.mode === "dry_run") {
    return {
      ok: false,
      blocked: true,
      risk: "irreversible",
      buttonLabel,
      reason: "dry_run_stop",
    };
  }

  if (!isOwnedFilingSubmitArmed(options.env ?? process.env)) {
    return {
      ok: false,
      blocked: true,
      risk: "irreversible",
      buttonLabel,
      reason: "unarmed_live",
    };
  }

  const clicked = await clickNextButton(page, decision, options);
  if (!clicked && options.useExactTextButtonLocator) {
    return {
      ok: false,
      blocked: true,
      risk: "unknown",
      buttonLabel,
      reason: "unknown_fail_closed",
    };
  }
  return { ok: true, clicked, risk: "irreversible" };
}

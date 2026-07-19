import type { Page } from "playwright";
import {
  buildButtonSelector,
  type FormDecision,
} from "@/lib/justice/realBbbBoundedSubmitLoop";
import { classifyOwnedFilingClick } from "@/lib/justice/classifyOwnedFilingClick";
import { isOwnedFilingSubmitArmed } from "@/lib/justice/ownedFilingSubmitArmed";

export type OwnedFilingSubmissionMode = "live" | "dry_run";

export type OwnedFilingApplyDecisionResult =
  | { ok: true; clicked: boolean; risk: "safe" | "none" | "irreversible" }
  | {
      ok: false;
      blocked: true;
      risk: "irreversible" | "unknown";
      buttonLabel: string;
      reason: "dry_run_stop" | "unarmed_live" | "unknown_fail_closed";
    };

async function fillFields(page: Page, decision: FormDecision, logPrefix: string): Promise<void> {
  const fieldsToFill = decision.fieldsToFill ?? [];
  for (const field of fieldsToFill) {
    if (!field.selector?.trim()) continue;
    try {
      await page.fill(
        `input[name="${field.selector}"], input#${field.selector}, textarea[name="${field.selector}"], textarea#${field.selector}, select[name="${field.selector}"], select#${field.selector}`,
        String(field.value ?? "")
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`${logPrefix}: could not fill "${field.selector}":`, message);
    }
  }
}

async function clickNextButton(page: Page, decision: FormDecision, logPrefix: string): Promise<void> {
  if (!decision.nextButton?.value?.trim()) return;
  const buttonSelector = buildButtonSelector(decision.nextButton);
  try {
    if (decision.waitForNavigation) {
      await Promise.all([
        page.waitForNavigation({ timeout: 10000 }).catch(() => {
          console.warn(`${logPrefix}: navigation timeout after button click`);
        }),
        page.click(buttonSelector),
      ]);
    } else {
      await page.click(buttonSelector);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`${logPrefix}: could not click button:`, message);
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
  options: {
    mode: OwnedFilingSubmissionMode;
    logPrefix: string;
    env?: Record<string, string | undefined>;
  }
): Promise<OwnedFilingApplyDecisionResult> {
  await fillFields(page, decision, options.logPrefix);

  const next = decision.nextButton;
  if (!next?.value?.trim()) {
    return { ok: true, clicked: false, risk: "none" };
  }

  const risk = classifyOwnedFilingClick(next);
  const buttonLabel = `${next.selectorType}:${next.value}`.slice(0, 200);

  if (risk === "safe") {
    await clickNextButton(page, decision, options.logPrefix);
    return { ok: true, clicked: true, risk: "safe" };
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

  await clickNextButton(page, decision, options.logPrefix);
  return { ok: true, clicked: true, risk: "irreversible" };
}

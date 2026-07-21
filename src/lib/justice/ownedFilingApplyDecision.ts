import type { Page } from "playwright";
import {
  buildButtonSelector,
  type AssistedFormChoiceControl,
  type FormDecision,
} from "@/lib/justice/realBbbBoundedSubmitLoop";
import {
  isFtcReportAssistantUrl,
  isFtcReportEntryUrl,
} from "@/lib/justice/realFtcBoundedSubmitLoop";
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
      /** Sanitized target state only; never selectors, field values, user data, or page text. */
      diagnostic?: string;
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
  /** FTC-only support for exact radio/checkbox decisions. Omitted by BBB. */
  enableFtcChoiceControls?: boolean;
  /** Sanitized labels from the FTC actionable button corpus. */
  actionableButtonLabels?: string[];
  /** FTC-only sanitized structural inventory used to resolve exact choice decisions. */
  choiceControls?: AssistedFormChoiceControl[];
};

type FtcActionOperation = "fill" | "check" | "click";

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
  operation: FtcActionOperation
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
export function parseOwnedFilingActionTimeoutOperation(err: unknown): FtcActionOperation | null {
  const message = err instanceof Error ? err.message : String(err);
  const match = /action_timeout:(fill|check|click)/i.exec(message);
  return match ? (match[1].toLowerCase() as FtcActionOperation) : null;
}

function cssAttributeValue(value: string): string {
  return `"${value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r\n|\r|\n/g, "\\a ")}"`;
}

function sanitizedActionableLabels(options: ApplyDecisionOptions): string {
  const labels = (options.actionableButtonLabels ?? [])
    .map((label) => label.replace(/[|;,]/g, " ").trim().slice(0, 80))
    .filter(Boolean)
    .slice(0, 12);
  return labels.length > 0 ? labels.join("/") : "none";
}

function targetDiagnostic(
  target: "choice" | "continue",
  count: number,
  visible: boolean | null,
  enabled: boolean | null,
  options: ApplyDecisionOptions
): string {
  return [
    `target=${target}`,
    `count=${count}`,
    `visible=${visible === null ? "na" : String(visible)}`,
    `enabled=${enabled === null ? "na" : String(enabled)}`,
    `labels=${sanitizedActionableLabels(options)}`,
  ].join(",");
}

type FillFieldsResult = { ok: true } | { ok: false; diagnostic: string };

function matchingFtcChoiceControls(
  field: NonNullable<FormDecision["fieldsToFill"]>[number],
  options: ApplyDecisionOptions
): AssistedFormChoiceControl[] {
  return (options.choiceControls ?? []).filter((control) => {
    if (field.controlKind !== "choice" && control.kind !== field.controlKind) return false;
    if (control.optionValue !== field.value) return false;
    if (field.choiceSelectorType === "name") return control.name === field.selector;
    if (field.choiceSelectorType === "id") return control.id === field.selector;
    if (field.choiceSelectorType === "accessibleName") {
      return control.accessibleName === field.selector;
    }
    return (
      control.name === field.selector ||
      control.id === field.selector ||
      control.accessibleName === field.selector
    );
  });
}

async function fillFields(
  page: Page,
  decision: FormDecision,
  options: ApplyDecisionOptions
): Promise<FillFieldsResult> {
  const fieldsToFill = decision.fieldsToFill ?? [];
  for (const field of fieldsToFill) {
    if (options.enableFtcChoiceControls && field.controlKind) {
      if (
        !isFtcReportAssistantUrl(options.currentPageUrl ?? "") ||
        !field.selector?.trim() ||
        !["radio", "checkbox", "choice"].includes(field.controlKind) ||
        !field.value?.trim()
      ) {
        return {
          ok: false,
          diagnostic: targetDiagnostic("choice", 0, null, null, options),
        };
      }
      const metadataMatches = matchingFtcChoiceControls(field, options);
      const control = metadataMatches[0];
      if (!control || metadataMatches.length !== 1) {
        return {
          ok: false,
          diagnostic: targetDiagnostic("choice", metadataMatches.length, null, null, options),
        };
      }
      if (!control.visible || !control.enabled) {
        return {
          ok: false,
          diagnostic: targetDiagnostic(
            "choice",
            metadataMatches.length,
            control.visible,
            control.enabled,
            options
          ),
        };
      }
      const value = cssAttributeValue(control.optionValue);
      const target =
        control.source === "native"
          ? control.id
            ? page.locator(
                `input[type="${control.kind}"][id=${cssAttributeValue(control.id)}][value=${value}]`
              )
            : control.name
              ? page.locator(
                  `input[type="${control.kind}"][name=${cssAttributeValue(control.name)}][value=${value}]`
                )
              : page.getByRole(control.kind, {
                  name: control.accessibleName,
                  exact: true,
                })
          : control.id
            ? page.locator(
                `[role="${control.kind}"][id=${cssAttributeValue(control.id)}]`
              )
            : control.name
              ? page.locator(
                  `[role="${control.kind}"][name=${cssAttributeValue(control.name)}]`
                )
              : page.getByRole(control.kind, {
                  name: control.accessibleName,
                  exact: true,
                });
      try {
        const count = await target.count();
        if (count !== 1) {
          return {
            ok: false,
            diagnostic: targetDiagnostic("choice", count, null, null, options),
          };
        }
        const [visible, enabled] = await Promise.all([
          target.isVisible(),
          target.isEnabled(),
        ]);
        if (!visible || !enabled) {
          return {
            ok: false,
            diagnostic: targetDiagnostic("choice", count, visible, enabled, options),
          };
        }
        if (control.source === "native") {
          if (options.actionTimeoutMs === undefined) {
            await target.check();
          } else {
            await target.check({ timeout: options.actionTimeoutMs });
          }
        } else if ((await target.getAttribute("aria-checked")) !== "true") {
          if (options.actionTimeoutMs === undefined) {
            await target.click();
          } else {
            await target.click({ timeout: options.actionTimeoutMs });
          }
        }
      } catch (err: unknown) {
        propagateFtcActionError(err, options, "check");
        if (isClosedTargetError(err)) throw err;
        return {
          ok: false,
          diagnostic: targetDiagnostic("choice", 1, true, true, options),
        };
      }
      continue;
    }
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
  return { ok: true };
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
): Promise<{ clicked: boolean; diagnostic?: string }> {
  if (!decision.nextButton?.value?.trim()) return { clicked: false };
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
        if (!isFtcReportEntryUrl(options.currentPageUrl ?? "")) return { clicked: false };
        const linkTarget = page.getByRole("link", locatorOptions);
        const [buttonCount, linkCount] = await Promise.all([
          buttonTarget.count(),
          linkTarget.count(),
        ]);
        if (buttonCount + linkCount !== 1) return { clicked: false };
        target = buttonCount === 1 ? buttonTarget : linkTarget;
      } else {
        const count = await buttonTarget.count();
        if (count !== 1) {
          return {
            clicked: false,
            ...(decision.nextButton.value === "Continue"
              ? { diagnostic: targetDiagnostic("continue", count, null, null, options) }
              : {}),
          };
        }
      }
      const [visible, enabled] = await Promise.all([
        target.isVisible(),
        target.isEnabled(),
      ]);
      if (!visible || !enabled) {
        return {
          clicked: false,
          ...(decision.nextButton.value === "Continue"
            ? { diagnostic: targetDiagnostic("continue", 1, visible, enabled, options) }
            : {}),
        };
      }
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
    return { clicked };
  } catch (err: unknown) {
    propagateFtcActionError(err, options, "click");
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`${options.logPrefix}: could not click button:`, message);
    return { clicked: false };
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
  const next = decision.nextButton;
  const fieldsResult = await fillFields(page, decision, options);
  if (!fieldsResult.ok) {
    return {
      ok: false,
      blocked: true,
      risk: "unknown",
      buttonLabel: next?.value?.trim()
        ? `${next.selectorType}:${next.value}`.slice(0, 200)
        : "choice:required",
      reason: "unknown_fail_closed",
      diagnostic: fieldsResult.diagnostic,
    };
  }

  if (!next?.value?.trim()) {
    return { ok: true, clicked: false, risk: "none" };
  }

  const risk = classifyOwnedFilingClick(next);
  const buttonLabel = `${next.selectorType}:${next.value}`.slice(0, 200);

  if (risk === "safe") {
    const clickResult = await clickNextButton(page, decision, options);
    if (!clickResult.clicked && options.useExactTextButtonLocator) {
      return {
        ok: false,
        blocked: true,
        risk: "unknown",
        buttonLabel,
        reason: "unknown_fail_closed",
        ...(clickResult.diagnostic ? { diagnostic: clickResult.diagnostic } : {}),
      };
    }
    return { ok: true, clicked: clickResult.clicked, risk: "safe" };
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

  const clickResult = await clickNextButton(page, decision, options);
  if (!clickResult.clicked && options.useExactTextButtonLocator) {
    return {
      ok: false,
      blocked: true,
      risk: "unknown",
      buttonLabel,
      reason: "unknown_fail_closed",
    };
  }
  return { ok: true, clicked: clickResult.clicked, risk: "irreversible" };
}

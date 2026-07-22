import type { Locator, Page } from "playwright";
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
  | { ok: true; clicked: boolean; risk: "safe" | "none" | "irreversible"; diagnostic?: string }
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
  target: "choice" | "choice-label" | "continue",
  count: number,
  visible: boolean | null,
  enabled: boolean | null,
  options: ApplyDecisionOptions,
  phase?:
    | "precheck_disabled"
    | "precheck_hidden"
    | "precheck_ambiguous"
    | "click_rejected"
    | "nav_soft_timeout"
): string {
  return [
    `target=${target}`,
    `count=${count}`,
    `visible=${visible === null ? "na" : String(visible)}`,
    `enabled=${enabled === null ? "na" : String(enabled)}`,
    ...(phase ? [`phase=${phase}`] : []),
    `labels=${sanitizedActionableLabels(options)}`,
  ].join(",");
}

type FillFieldsResult =
  | { ok: true; choiceApplied: boolean }
  | { ok: false; diagnostic: string };

type ClickNextButtonResult = {
  clicked: boolean;
  diagnostic?: string;
  /** FTC Continue uniquely resolved but disabled — safe to defer after a choice apply. */
  continueDisabled?: boolean;
};

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

/**
 * True when optionValue is the accessible label stand-in used because the native control has
 * no distinguishing value attribute (verified FTC category radios).
 */
function nativeChoiceUsesAccessibleOptionValue(control: AssistedFormChoiceControl): boolean {
  return (
    control.source === "native" &&
    !!control.accessibleName &&
    control.optionValue === control.accessibleName
  );
}

/** Builds the exact locator for a scraped native or ARIA choice control. */
function resolveFtcChoiceLocator(page: Page, control: AssistedFormChoiceControl): Locator {
  if (control.source === "native") {
    // FTC category radios omit value=""; CSS [value=on] matches nothing even though
    // input.value is the HTML default "on". Prefer stable id / accessible name.
    if (control.id) {
      if (nativeChoiceUsesAccessibleOptionValue(control)) {
        return page.locator(
          `input[type="${control.kind}"][id=${cssAttributeValue(control.id)}]`
        );
      }
      return page.locator(
        `input[type="${control.kind}"][id=${cssAttributeValue(control.id)}][value=${cssAttributeValue(control.optionValue)}]`
      );
    }
    if (nativeChoiceUsesAccessibleOptionValue(control) && control.accessibleName) {
      return page.getByRole(control.kind, {
        name: control.accessibleName,
        exact: true,
      });
    }
    if (control.name) {
      return page.locator(
        `input[type="${control.kind}"][name=${cssAttributeValue(control.name)}][value=${cssAttributeValue(control.optionValue)}]`
      );
    }
    return page.getByRole(control.kind, { name: control.accessibleName, exact: true });
  }
  if (control.id) {
    return page.locator(`[role="${control.kind}"][id=${cssAttributeValue(control.id)}]`);
  }
  if (control.name) {
    return page.locator(`[role="${control.kind}"][name=${cssAttributeValue(control.name)}]`);
  }
  return page.getByRole(control.kind, { name: control.accessibleName, exact: true });
}

/**
 * Resolves the structurally associated visible label for a hidden native radio/checkbox.
 * Uses exact `label[for=id]` when the input carries an id, otherwise the nearest wrapping
 * `<label>` ancestor (verified FTC `.form-check-label.rf-radio` structure). No broad text,
 * card, link, or arbitrary wrapper targeting.
 */
function nativeChoiceLabelLocator(page: Page, control: AssistedFormChoiceControl): Locator {
  if (control.id) {
    return page.locator(`label[for=${cssAttributeValue(control.id)}]`);
  }
  return resolveFtcChoiceLocator(page, control).locator("xpath=ancestor::label[1]");
}

function nativeChoiceWrappingLabelLocator(
  page: Page,
  control: AssistedFormChoiceControl
): Locator {
  return resolveFtcChoiceLocator(page, control).locator("xpath=ancestor::label[1]");
}

async function forceCheckHiddenNativeChoice(
  page: Page,
  control: AssistedFormChoiceControl,
  options: ApplyDecisionOptions
): Promise<FillFieldsResult> {
  const target = resolveFtcChoiceLocator(page, control);
  try {
    const count = await target.count();
    if (count !== 1) {
      return {
        ok: false,
        diagnostic: targetDiagnostic("choice", count, false, null, options),
      };
    }
    const enabled = await target.isEnabled();
    if (!enabled) {
      return {
        ok: false,
        diagnostic: targetDiagnostic("choice", count, false, enabled, options),
      };
    }
    await target.check({
      force: true,
      timeout: options.actionTimeoutMs ?? OWNED_FILING_FTC_ACTION_TIMEOUT_MS,
    });
    if (!(await target.isChecked())) {
      return {
        ok: false,
        diagnostic: targetDiagnostic("choice", count, false, enabled, options),
      };
    }
  } catch (err: unknown) {
    propagateFtcActionError(err, options, "check");
    if (isClosedTargetError(err)) throw err;
    return {
      ok: false,
      diagnostic: targetDiagnostic("choice", 1, false, true, options),
    };
  }
  return { ok: true, choiceApplied: true };
}

/**
 * FTC /assistant hides its native radios/checkboxes and exposes the real hit target as a
 * structurally associated visible label. When the matched control is hidden but enabled,
 * activate only that label. If and only if no associated label exists, force-check the exact
 * native control and verify its checked state. Other label or control failures stay closed.
 */
async function activateHiddenNativeChoiceLabel(
  page: Page,
  control: AssistedFormChoiceControl,
  options: ApplyDecisionOptions
): Promise<FillFieldsResult> {
  if (control.source !== "native") {
    return {
      ok: false,
      diagnostic: targetDiagnostic("choice-label", 0, null, null, options),
    };
  }
  const label = nativeChoiceLabelLocator(page, control);
  try {
    let count = await label.count();
    let target = label;
    // Verified FTC /assistant structure: category radios sit inside
    // label.form-check-label.rf-radio with no for= association.
    if (count === 0 && control.id) {
      const wrapping = nativeChoiceWrappingLabelLocator(page, control);
      const wrappingCount = await wrapping.count();
      if (wrappingCount === 0) {
        return forceCheckHiddenNativeChoice(page, control, options);
      }
      if (wrappingCount !== 1) {
        return {
          ok: false,
          diagnostic: targetDiagnostic("choice-label", wrappingCount, null, null, options),
        };
      }
      count = wrappingCount;
      target = wrapping;
    } else if (count === 0) {
      return forceCheckHiddenNativeChoice(page, control, options);
    }
    if (count !== 1) {
      return {
        ok: false,
        diagnostic: targetDiagnostic("choice-label", count, null, null, options),
      };
    }
    const [visible, enabled] = await Promise.all([target.isVisible(), target.isEnabled()]);
    if (!visible || !enabled) {
      return {
        ok: false,
        diagnostic: targetDiagnostic("choice-label", count, visible, enabled, options),
      };
    }
    if (options.actionTimeoutMs === undefined) {
      await target.click();
    } else {
      await target.click({ timeout: options.actionTimeoutMs });
    }
  } catch (err: unknown) {
    propagateFtcActionError(err, options, "check");
    if (isClosedTargetError(err)) throw err;
    return {
      ok: false,
      diagnostic: targetDiagnostic("choice-label", 1, true, true, options),
    };
  }
  return { ok: true, choiceApplied: true };
}

async function fillFields(
  page: Page,
  decision: FormDecision,
  options: ApplyDecisionOptions
): Promise<FillFieldsResult> {
  const fieldsToFill = decision.fieldsToFill ?? [];
  let choiceApplied = false;
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
      if (!control.enabled) {
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
      if (!control.visible) {
        const labelResult = await activateHiddenNativeChoiceLabel(page, control, options);
        if (!labelResult.ok) return labelResult;
        choiceApplied = true;
        continue;
      }
      const target = resolveFtcChoiceLocator(page, control);
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
      choiceApplied = true;
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
  return { ok: true, choiceApplied };
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
): Promise<ClickNextButtonResult> {
  if (!decision.nextButton?.value?.trim()) return { clicked: false };
  const buttonSelector = buildButtonSelector(decision.nextButton);
  let navigationSoftTimedOut = false;
  const waitForNavigation = () =>
    page.waitForNavigation({ timeout: 10000 }).catch((err: unknown) => {
      if (options.propagateCriticalErrors && isClosedTargetError(err)) throw err;
      navigationSoftTimedOut = true;
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
        let count = await buttonTarget.count();
        // Verified FTC /assistant Continue buttons use a trailing NBSP in their accessible
        // name ("Continue\u00a0"), so exact "Continue" matches zero. Non-exact name match
        // resolves the unique visible Continue on that page.
        if (
          count === 0 &&
          decision.nextButton.value === "Continue" &&
          isFtcReportAssistantUrl(options.currentPageUrl ?? "")
        ) {
          target = page.getByRole("button", { name: "Continue" });
          count = await target.count();
        }
        if (count !== 1) {
          return {
            clicked: false,
            ...(decision.nextButton.value === "Continue"
              ? {
                  diagnostic: targetDiagnostic(
                    "continue",
                    count,
                    null,
                    null,
                    options,
                    "precheck_ambiguous"
                  ),
                }
              : {}),
          };
        }
      }
      const [visible, enabled] = await Promise.all([
        target.isVisible(),
        target.isEnabled(),
      ]);
      if (!visible || !enabled) {
        const phase = !visible ? "precheck_hidden" : "precheck_disabled";
        return {
          clicked: false,
          ...(decision.nextButton.value === "Continue"
            ? {
                diagnostic: targetDiagnostic("continue", 1, visible, enabled, options, phase),
                ...(phase === "precheck_disabled" ? { continueDisabled: true } : {}),
              }
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
    if (
      clicked &&
      navigationSoftTimedOut &&
      decision.nextButton.value === "Continue" &&
      options.useExactTextButtonLocator
    ) {
      return {
        clicked: true,
        diagnostic: targetDiagnostic("continue", 1, true, true, options, "nav_soft_timeout"),
      };
    }
    return { clicked };
  } catch (err: unknown) {
    propagateFtcActionError(err, options, "click");
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`${options.logPrefix}: could not click button:`, message);
    return {
      clicked: false,
      ...(decision.nextButton.value === "Continue" && options.useExactTextButtonLocator
        ? {
            diagnostic: targetDiagnostic(
              "continue",
              1,
              true,
              true,
              options,
              "click_rejected"
            ),
          }
        : {}),
    };
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
      // Verified FTC /assistant: after a category choice, Continue stays uniquely visible but
      // disabled until a subcategory is selected. Preserve the choice and let the loop re-scrape.
      if (
        fieldsResult.choiceApplied &&
        clickResult.continueDisabled &&
        isFtcReportAssistantUrl(options.currentPageUrl ?? "")
      ) {
        return {
          ok: true,
          clicked: false,
          risk: "safe",
          ...(clickResult.diagnostic ? { diagnostic: clickResult.diagnostic } : {}),
        };
      }
      return {
        ok: false,
        blocked: true,
        risk: "unknown",
        buttonLabel,
        reason: "unknown_fail_closed",
        ...(clickResult.diagnostic ? { diagnostic: clickResult.diagnostic } : {}),
      };
    }
    return {
      ok: true,
      clicked: clickResult.clicked,
      risk: "safe",
      ...(clickResult.diagnostic ? { diagnostic: clickResult.diagnostic } : {}),
    };
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

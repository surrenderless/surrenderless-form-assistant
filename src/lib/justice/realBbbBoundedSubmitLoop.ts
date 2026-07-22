/** Maximum decide-action + fill/click cycles for real BBB assisted submission. */
export const REAL_BBB_MAX_SUBMIT_STEPS = 8;

export type RealBbbSubmitStopReason =
  | "terminal_confirmation"
  | "max_steps_reached"
  | "invalid_decision"
  | "empty_decision"
  | "decide_action_failed"
  /** Dry-run or unarmed live stopped before an irreversible click. */
  | "blocked_irreversible_click"
  /** Ambiguous next action — fail closed, never click. */
  | "blocked_unknown_click"
  /** Live mode refused because OWNED_FILING_SUBMIT_ARMED is off. */
  | "submit_unarmed";

export type FormFieldDecision = {
  selector: string;
  value: string;
  /** FTC-only choice interaction; omitted for legacy text/select fields and all existing BBB use. */
  controlKind?: "radio" | "checkbox" | "choice";
  /** FTC-only exact structural key used to resolve a scraped choice control. */
  choiceSelectorType?: "name" | "id" | "accessibleName";
};

export type FormButtonDecision = {
  selectorType: "text" | "id" | "name" | "type";
  value: string;
};

export type FormDecision = {
  fieldsToFill?: FormFieldDecision[];
  nextButton?: FormButtonDecision;
  waitForNavigation?: boolean;
};

export type AssistedFormChoiceControl = {
  source: "native" | "aria";
  kind: "radio" | "checkbox";
  name: string;
  id: string;
  optionValue: string;
  accessibleName: string;
  visible: boolean;
  enabled: boolean;
  /** Sanitized selected state for FTC deterministic wizard progression. */
  checked?: boolean;
};

export type AssistedFormPageData = {
  fields: Array<{
    tag: string;
    type: string;
    name: string;
    id: string;
    placeholder: string;
    label: string;
    /** Angular formControlName when name/id are absent (FTC /form/main). */
    formControlName?: string;
    /** Non-user option value exposed only for radio/checkbox choice controls. */
    optionValue?: string;
  }>;
  /** FTC-only sanitized structural inventory for deterministic required-choice selection. */
  choiceControls?: AssistedFormChoiceControl[];
  buttons: Array<{
    text: string;
    id: string;
    name: string;
    type: string;
  }>;
  url: string;
  pageText?: string;
};

const BBB_TERMINAL_HOST = "www.bbb.org";

/** Confirmation-like URL path segments; excludes generic words such as success/complete. */
const TERMINAL_URL_PATH_PATTERNS = [/confirmation/i, /thank[-_ ]?you/i, /submitted/i];

/** Strong BBB complaint submission confirmation phrases in page body text. */
const TERMINAL_TEXT_PATTERNS = [
  /complaint.*submitted/i,
  /thank you for submitting/i,
  /confirmation number/i,
  /successfully submitted/i,
  /your complaint has been/i,
];

function isBbbOrgHost(url: string): boolean {
  try {
    return new URL(url).hostname === BBB_TERMINAL_HOST;
  } catch {
    return false;
  }
}

function isBbbComplainEntryUrl(url: string): boolean {
  try {
    const normalized = new URL(url).pathname.replace(/\/$/, "") || "/";
    return normalized === "/complain";
  } catch {
    return false;
  }
}

function hasConfirmationLikeBbbUrlPath(url: string): boolean {
  if (!isBbbOrgHost(url) || isBbbComplainEntryUrl(url)) {
    return false;
  }
  return TERMINAL_URL_PATH_PATTERNS.some((pattern) => pattern.test(url));
}

function hasBbbSubmissionConfirmationText(pageText: string): boolean {
  const text = pageText.slice(0, 12000);
  return TERMINAL_TEXT_PATTERNS.some((pattern) => pattern.test(text));
}

/** Exported for Playwright mock real-BBB terminal page assertions. */
export function hasBbbSubmissionConfirmationBodyText(pageText: string): boolean {
  return hasBbbSubmissionConfirmationText(pageText);
}

export function hasReachedStepCap(stepsExecuted: number, maxSteps = REAL_BBB_MAX_SUBMIT_STEPS): boolean {
  return stepsExecuted >= maxSteps;
}

export function normalizeFormDecision(raw: unknown): FormDecision | null {
  if (!raw || typeof raw !== "object") return null;
  const decision = raw as FormDecision;
  if (decision.fieldsToFill != null && !Array.isArray(decision.fieldsToFill)) return null;
  if (decision.nextButton != null) {
    const btn = decision.nextButton;
    if (
      typeof btn !== "object" ||
      !btn ||
      typeof btn.value !== "string" ||
      !btn.value.trim() ||
      !["text", "id", "name", "type"].includes(btn.selectorType)
    ) {
      return null;
    }
  }
  if (Array.isArray(decision.fieldsToFill)) {
    for (const field of decision.fieldsToFill) {
      if (
        !field ||
        typeof field !== "object" ||
        typeof field.selector !== "string" ||
        typeof field.value !== "string"
      ) {
        return null;
      }
      if (
        field.controlKind !== undefined &&
        !["radio", "checkbox", "choice"].includes(field.controlKind)
      ) {
        return null;
      }
      if (
        field.choiceSelectorType !== undefined &&
        !["name", "id", "accessibleName"].includes(field.choiceSelectorType)
      ) {
        return null;
      }
      if (field.choiceSelectorType !== undefined && field.controlKind === undefined) {
        return null;
      }
    }
  }
  return decision;
}

export function isEmptyFormDecision(decision: FormDecision): boolean {
  const fields = decision.fieldsToFill ?? [];
  const hasFields = fields.some((f) => f.selector?.trim());
  const hasButton =
    Boolean(decision.nextButton?.value?.trim()) && Boolean(decision.nextButton?.selectorType);
  return !hasFields && !hasButton;
}

/** True when the page shows a BBB complaint submission confirmation state. */
export function detectRealBbbTerminalConfirmation(pageData: AssistedFormPageData): boolean {
  const url = pageData.url ?? "";
  if (!isBbbOrgHost(url) || isBbbComplainEntryUrl(url)) {
    return false;
  }
  if (hasConfirmationLikeBbbUrlPath(url)) {
    return true;
  }
  return hasBbbSubmissionConfirmationText(pageData.pageText ?? "");
}

export function buildRealBbbIncompleteError(
  stopReason: Exclude<RealBbbSubmitStopReason, "terminal_confirmation">,
  stepsExecuted: number
): string {
  switch (stopReason) {
    case "max_steps_reached":
      return `BBB complaint autofill did not reach a confirmation page within ${REAL_BBB_MAX_SUBMIT_STEPS} steps (${stepsExecuted} executed). You can retry.`;
    case "empty_decision":
      return "BBB complaint autofill stopped: the assistant returned no fields or next action to take. You can retry.";
    case "invalid_decision":
      return "BBB complaint autofill stopped: the assistant returned an invalid next action. You can retry.";
    case "decide_action_failed":
      return "BBB complaint autofill stopped: could not determine the next form action. You can retry.";
    case "blocked_irreversible_click":
      return "BBB complaint autofill stopped before a potentially irreversible submit click (dry-run or unarmed).";
    case "blocked_unknown_click":
      return "BBB complaint autofill stopped: next button was ambiguous — fail closed, no click.";
    case "submit_unarmed":
      return "BBB complaint autofill refused: OWNED_FILING_SUBMIT_ARMED is not enabled.";
    default:
      return "BBB complaint autofill did not complete. You can retry.";
  }
}

export function buildButtonSelector(nextButton: FormButtonDecision): string {
  const { selectorType, value } = nextButton;
  if (selectorType === "text") return `button:has-text("${value}")`;
  if (selectorType === "id") return `#${value}`;
  if (selectorType === "name") return `[name="${value}"]`;
  return `button[type="${value}"], input[type="${value}"]`;
}

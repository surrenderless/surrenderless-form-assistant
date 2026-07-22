import type {
  AssistedFormChoiceControl,
  AssistedFormPageData,
  FormDecision,
  RealBbbSubmitStopReason,
} from "@/lib/justice/realBbbBoundedSubmitLoop";

/** Maximum decide-action + fill/check/click cycles for real FTC assisted submission. */
export const REAL_FTC_MAX_SUBMIT_STEPS = 24;

/**
 * FTC bounded-submit stop reasons reuse the shared decide-action loop reasons, plus an
 * FTC-only `action_timeout` for a bounded fill/check/click that exceeded its time limit. BBB does not
 * bound actions and never emits this reason.
 */
export type RealFtcSubmitStopReason = RealBbbSubmitStopReason | "action_timeout";

/** Official FTC ReportFraud consumer-complaint host. */
const FTC_TERMINAL_HOST = "reportfraud.ftc.gov";

/** Confirmation-like URL path segments; excludes generic words such as success/complete. */
const TERMINAL_URL_PATH_PATTERNS = [/confirmation/i, /thank[-_ ]?you/i, /submitted/i, /report-?number/i];

/** Strong FTC ReportFraud submission confirmation phrases in page body text. */
const TERMINAL_TEXT_PATTERNS = [
  /thank you for (?:your report|reporting|submitting)/i,
  /your report has been (?:submitted|received)/i,
  /report\s*(?:number|id)/i,
  /reference\s*(?:number|id)/i,
  /report was submitted/i,
];

/** Report/reference identifiers extracted from an FTC confirmation page. */
const REFERENCE_PATTERNS = [
  /report\s*(?:number|no\.?|#|id)?\s*(?:is|:|#|=)?\s*([A-Z0-9][A-Z0-9-]{4,})/i,
  /reference\s*(?:number|no\.?|#|id)?\s*(?:is|:|#|=)?\s*([A-Z0-9][A-Z0-9-]{4,})/i,
  /confirmation\s*(?:number|no\.?|#|id)?\s*(?:is|:|#|=)?\s*([A-Z0-9][A-Z0-9-]{4,})/i,
];

function isFtcReportHost(url: string): boolean {
  try {
    return new URL(url).hostname === FTC_TERMINAL_HOST;
  } catch {
    return false;
  }
}

function isOfficialFtcHttpsUrl(url: URL): boolean {
  return (
    url.protocol === "https:" &&
    url.hostname === FTC_TERMINAL_HOST &&
    !url.port
  );
}

/**
 * True only for the official HTTPS ReportFraud bare entry root. Deeper wizard/confirmation
 * states carry a path, query, or meaningful hash.
 */
export function isFtcReportEntryUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (!isOfficialFtcHttpsUrl(u)) return false;
    const path = u.pathname.replace(/\/$/, "") || "/";
    if (path !== "/") return false;
    const hashAndSearch = `${u.search}${u.hash}`;
    return !hashAndSearch || hashAndSearch === "#" || hashAndSearch === "#/";
  } catch {
    return false;
  }
}

/** True only for the official HTTPS ReportFraud assistant path (query/hash wizard state allowed). */
export function isFtcReportAssistantUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return isOfficialFtcHttpsUrl(u) && u.pathname.replace(/\/$/, "") === "/assistant";
  } catch {
    return false;
  }
}

/** True only for the official HTTPS ReportFraud main form path. */
export function isFtcReportFormMainUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return isOfficialFtcHttpsUrl(u) && u.pathname.replace(/\/$/, "") === "/form/main";
  } catch {
    return false;
  }
}

/**
 * Official FTC pages where exact choice-control selection is enabled (assistant wizard and
 * the main report form).
 */
export function isFtcReportChoiceFlowUrl(url: string): boolean {
  return isFtcReportAssistantUrl(url) || isFtcReportFormMainUrl(url);
}

/**
 * Deterministic first action on the official ReportFraud entry root only.
 * Bypasses decide-action; apply still enforces the entry-URL Report Now gate.
 */
export function buildFtcEntryReportNowDecision(): FormDecision {
  return {
    nextButton: { selectorType: "text", value: "Report Now" },
    waitForNavigation: true,
  };
}

/**
 * Verified FTC /assistant label aliases from intake `issue_type` (underscores already
 * normalized to spaces by intakeToRealFtcUserData) to scraped accessible names.
 */
const FTC_ASSISTANT_ISSUE_TYPE_ALIASES: Record<string, string> = {
  "online purchase": "Online shopping",
  "something else": "Something else",
};

function normalizeFtcAssistantChoiceLabel(value: string): string {
  return value.replace(/_/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
}

function ftcAssistantIssueMatchLabels(issueType: string): string[] {
  const normalized = normalizeFtcAssistantChoiceLabel(issueType);
  if (!normalized) return [];
  const labels = new Set<string>([normalized]);
  const alias = FTC_ASSISTANT_ISSUE_TYPE_ALIASES[normalized];
  if (alias) {
    labels.add(normalizeFtcAssistantChoiceLabel(alias));
  }
  return [...labels];
}

function choiceMatchesFtcAssistantIssue(
  control: AssistedFormChoiceControl,
  matchLabels: string[]
): boolean {
  const names = [
    normalizeFtcAssistantChoiceLabel(control.accessibleName),
    normalizeFtcAssistantChoiceLabel(control.optionValue),
  ].filter(Boolean);
  return names.some((name) => matchLabels.includes(name));
}

function ftcAssistantContinueOnlyDecision(): FormDecision {
  return {
    nextButton: { selectorType: "text", value: "Continue" },
    waitForNavigation: true,
  };
}

function ftcAssistantRadioChoiceDecision(control: AssistedFormChoiceControl): FormDecision {
  return {
    fieldsToFill: [
      {
        selector: control.id,
        value: control.optionValue,
        controlKind: "radio",
        choiceSelectorType: "id",
      },
    ],
    nextButton: { selectorType: "text", value: "Continue" },
    waitForNavigation: true,
  };
}

/** True when scraped actionable buttons include an enabled visible Continue CTA. */
function ftcAssistantContinueIsEnabled(pageData: AssistedFormPageData): boolean {
  return (pageData.buttons ?? []).some(
    (button) => normalizeFtcAssistantChoiceLabel(button.text) === "continue"
  );
}

function ftcAssistantIssueMatchedParent(
  pageData: AssistedFormPageData,
  userData: Record<string, unknown>
): AssistedFormChoiceControl | null {
  if (!isFtcReportAssistantUrl(pageData.url ?? "")) return null;

  const issueType =
    typeof userData.issue_type === "string" ? userData.issue_type.trim() : "";
  const matchLabels = ftcAssistantIssueMatchLabels(issueType);
  if (matchLabels.length === 0) return null;

  const issueMatches = (pageData.choiceControls ?? []).filter(
    (control) =>
      control.kind === "radio" &&
      control.enabled &&
      Boolean(control.id?.trim()) &&
      choiceMatchesFtcAssistantIssue(control, matchLabels)
  );
  return issueMatches.length === 1 ? issueMatches[0]! : null;
}

function ftcAssistantUncheckedNextRadios(
  pageData: AssistedFormPageData,
  parent: AssistedFormChoiceControl
): AssistedFormChoiceControl[] {
  return (pageData.choiceControls ?? []).filter(
    (control) =>
      control.kind === "radio" &&
      control.enabled &&
      Boolean(control.id?.trim()) &&
      !control.checked &&
      control.id !== parent.id
  );
}

/**
 * Case-appropriate /assistant category/subcategory decision from scraped choiceControls
 * and userData.issue_type. Never re-selects an already-checked parent. Returns null when the
 * page is not assistant or progression is zero/ambiguous — caller must fail closed (or use
 * the structured ambiguous-subcategory fallback when candidates are available).
 */
export function buildFtcAssistantChoiceDecision(
  pageData: AssistedFormPageData,
  userData: Record<string, unknown>
): FormDecision | null {
  const parent = ftcAssistantIssueMatchedParent(pageData, userData);
  if (!parent) return null;

  if (!parent.checked) {
    return ftcAssistantRadioChoiceDecision(parent);
  }

  // Parent already selected — never re-emit it.
  if (ftcAssistantContinueIsEnabled(pageData)) {
    return ftcAssistantContinueOnlyDecision();
  }

  const nextCandidates = ftcAssistantUncheckedNextRadios(pageData, parent);
  if (nextCandidates.length !== 1) return null;
  return ftcAssistantRadioChoiceDecision(nextCandidates[0]!);
}

/**
 * Scraped next-radio candidates when the unique issue_type parent is checked, Continue is
 * not actionable, and multiple enabled unchecked radios remain. Null outside that branch.
 */
export function ftcAssistantAmbiguousSubcategoryCandidates(
  pageData: AssistedFormPageData,
  userData: Record<string, unknown>
): AssistedFormChoiceControl[] | null {
  const parent = ftcAssistantIssueMatchedParent(pageData, userData);
  if (!parent?.checked) return null;
  if (ftcAssistantContinueIsEnabled(pageData)) return null;

  const nextCandidates = ftcAssistantUncheckedNextRadios(pageData, parent);
  return nextCandidates.length > 1 ? nextCandidates : null;
}

/**
 * Strict post-validation for a structured /assistant subcategory decide-action result.
 * Accepts only one radio id/value pair that exactly matches a scraped next candidate and a
 * Continue nextButton. Returns a canonical decision or null (fail closed).
 */
export function validateFtcAssistantStructuredSubcategoryDecision(
  decision: FormDecision,
  candidates: AssistedFormChoiceControl[]
): FormDecision | null {
  const fields = decision.fieldsToFill ?? [];
  if (fields.length !== 1) return null;

  const field = fields[0]!;
  if (field.controlKind !== "radio") return null;
  if (field.choiceSelectorType !== "id") return null;
  if (typeof field.selector !== "string" || !field.selector.trim()) return null;
  if (typeof field.value !== "string") return null;

  const next = decision.nextButton;
  if (!next?.value?.trim() || !next.selectorType) return null;
  if (normalizeFtcAssistantChoiceLabel(next.value) !== "continue") return null;

  const match = candidates.find((control) => control.id === field.selector);
  if (!match || field.value !== match.optionValue) return null;

  return {
    fieldsToFill: [
      {
        selector: match.id,
        value: match.optionValue,
        controlKind: "radio",
        choiceSelectorType: "id",
      },
    ],
    nextButton: { selectorType: next.selectorType, value: next.value },
    waitForNavigation: true,
  };
}

function hasConfirmationLikeFtcUrlPath(url: string): boolean {
  if (!isFtcReportHost(url) || isFtcReportEntryUrl(url)) {
    return false;
  }
  return TERMINAL_URL_PATH_PATTERNS.some((pattern) => pattern.test(url));
}

function hasFtcSubmissionConfirmationText(pageText: string): boolean {
  const text = pageText.slice(0, 12000);
  return TERMINAL_TEXT_PATTERNS.some((pattern) => pattern.test(text));
}

/** Exported for FTC terminal-page assertions. */
export function hasFtcSubmissionConfirmationBodyText(pageText: string): boolean {
  return hasFtcSubmissionConfirmationText(pageText);
}

/** True when the page shows an FTC ReportFraud submission confirmation state. */
export function detectRealFtcTerminalConfirmation(pageData: AssistedFormPageData): boolean {
  const url = pageData.url ?? "";
  if (!isFtcReportHost(url) || isFtcReportEntryUrl(url)) {
    return false;
  }
  if (hasConfirmationLikeFtcUrlPath(url)) {
    return true;
  }
  return hasFtcSubmissionConfirmationText(pageData.pageText ?? "");
}

/**
 * Extracts the real FTC report/reference number from a confirmation page, if present.
 * Returns null when no identifier can be read (caller falls back to a generic confirmation).
 */
export function extractFtcConfirmationReference(pageText: string | null | undefined): string | null {
  const text = (pageText ?? "").slice(0, 12000);
  for (const pattern of REFERENCE_PATTERNS) {
    const match = pattern.exec(text);
    const value = match?.[1]?.trim();
    if (value) {
      return value.slice(0, 120);
    }
  }
  return null;
}

export function buildRealFtcIncompleteError(
  stopReason: Exclude<RealFtcSubmitStopReason, "terminal_confirmation">,
  stepsExecuted: number
): string {
  switch (stopReason) {
    case "max_steps_reached":
      return `FTC complaint autofill did not reach a confirmation page within ${REAL_FTC_MAX_SUBMIT_STEPS} steps (${stepsExecuted} executed). You can retry.`;
    case "empty_decision":
      return "FTC complaint autofill stopped: the assistant returned no fields or next action to take. You can retry.";
    case "invalid_decision":
      return "FTC complaint autofill stopped: the assistant returned an invalid next action. You can retry.";
    case "decide_action_failed":
      return "FTC complaint autofill stopped: could not determine the next form action. You can retry.";
    case "blocked_irreversible_click":
      return "FTC complaint autofill stopped before a potentially irreversible submit click (dry-run or unarmed).";
    case "blocked_unknown_click":
      return "FTC complaint autofill stopped: next button was ambiguous — fail closed, no click.";
    case "submit_unarmed":
      return "FTC complaint autofill refused: OWNED_FILING_SUBMIT_ARMED is not enabled.";
    case "action_timeout":
      return `FTC complaint autofill stopped: a form action exceeded its time limit after ${stepsExecuted} step(s). You can retry.`;
    default:
      return "FTC complaint autofill did not complete. You can retry.";
  }
}

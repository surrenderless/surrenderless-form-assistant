import type {
  AssistedFormBbbSearchResult,
  AssistedFormPageData,
  FormDecision,
  FormFieldDecision,
} from "@/lib/justice/realBbbBoundedSubmitLoop";

/**
 * Allowlisted BBB business-search fail-closed reasons. Durable notes carry these enums plus
 * counts only — never scraped business names, model output, or user values.
 */
export type OwnedFilingBbbSearchDecisionFailure =
  | "search_business_name_missing"
  | "search_result_ambiguous"
  | "search_result_unmatched"
  | "search_result_unaddressable"
  | "search_no_results_identity_incomplete"
  | "search_no_results_form_ambiguous";

export const OWNED_FILING_BBB_SEARCH_DECISION_FAILURES: ReadonlySet<string> = new Set([
  "search_business_name_missing",
  "search_result_ambiguous",
  "search_result_unmatched",
  "search_result_unaddressable",
  "search_no_results_identity_incomplete",
  "search_no_results_form_ambiguous",
]);

/** Reversible CTA that enters the complaint wizard from the no-results business form. */
export const OWNED_FILING_BBB_NO_RESULTS_PROCEED_LABEL = "File a Complaint";

/** Official BBB business-search step, where a business must be selected before the wizard. */
export function isOwnedFilingBbbBusinessSearchUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  let pathname: string;
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "www.bbb.org") return false;
    pathname = parsed.pathname;
  } catch {
    return false;
  }
  const normalized = pathname.replace(/\/$/, "").toLowerCase();
  return normalized === "/file-a-complaint/search" || normalized === "/complain/search";
}

/**
 * Case/whitespace normalization only. Deliberately not fuzzy: a near-miss must never resolve to
 * a different real business.
 */
export function normalizeBbbBusinessName(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\.$/, "")
    .toLowerCase();
}

function userDataString(userData: Record<string, unknown>, key: string): string {
  const raw = userData[key];
  return typeof raw === "string" ? raw.trim() : "";
}

function firstUserDataString(userData: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = userDataString(userData, key);
    if (value) return value;
  }
  return "";
}

/** Business identity required by the BBB no-results Business Information form. */
const NO_RESULTS_IDENTITY_REQUIREMENTS: Array<{
  userDataKeys: string[];
  labelPattern: RegExp;
}> = [
  { userDataKeys: ["business_name"], labelPattern: /^business\s*name$/i },
  { userDataKeys: ["business_address"], labelPattern: /^address$/i },
  { userDataKeys: ["business_city"], labelPattern: /^city$/i },
  { userDataKeys: ["business_state"], labelPattern: /^state(\s*\/\s*province)?$/i },
  { userDataKeys: ["business_country"], labelPattern: /^country$/i },
  { userDataKeys: ["business_postal_code"], labelPattern: /^postal\s*code$/i },
];

function resultLabel(result: AssistedFormBbbSearchResult): string {
  return result.headingText.trim() || result.text.trim();
}

function visibleActionableResults(
  pageData: AssistedFormPageData
): AssistedFormBbbSearchResult[] {
  return (pageData.bbbSearchResults ?? []).filter(
    (result) => result.visible && result.enabled && resultLabel(result).length > 0
  );
}

/**
 * Resolves a schema-valid nextButton for one result. `text` addressing only works for real
 * buttons (`buildButtonSelector` emits `button:has-text(...)`), so an id/name-less result link
 * is reported unaddressable rather than clicked through a guessed selector.
 */
function addressResult(
  target: AssistedFormBbbSearchResult,
  allResults: AssistedFormBbbSearchResult[]
): FormDecision["nextButton"] | null {
  const uniqueBy = (pick: (result: AssistedFormBbbSearchResult) => string): boolean => {
    const key = pick(target).trim();
    if (!key) return false;
    return allResults.filter((result) => pick(result).trim() === key).length === 1;
  };

  if (uniqueBy((result) => result.id)) {
    return { selectorType: "id", value: target.id.trim() };
  }
  if (uniqueBy((result) => result.name)) {
    return { selectorType: "name", value: target.name.trim() };
  }
  if (target.kind === "button" && uniqueBy((result) => resultLabel(result))) {
    return { selectorType: "text", value: resultLabel(target) };
  }
  return null;
}

function countFieldsMatchingLabel(pageData: AssistedFormPageData, pattern: RegExp): number {
  return (pageData.fields ?? []).filter(
    (field) => pattern.test((field.label ?? "").trim()) || pattern.test((field.placeholder ?? "").trim())
  ).length;
}

function fieldSelectorForLabel(
  pageData: AssistedFormPageData,
  pattern: RegExp
): string | null {
  const matches = (pageData.fields ?? []).filter(
    (field) => pattern.test((field.label ?? "").trim()) || pattern.test((field.placeholder ?? "").trim())
  );
  if (matches.length !== 1) return null;
  const field = matches[0];
  const key = (field.name || field.id || "").trim();
  return key ? key : null;
}

function noResultsProceedCount(pageData: AssistedFormPageData): number {
  const target = normalizeBbbBusinessName(OWNED_FILING_BBB_NO_RESULTS_PROCEED_LABEL);
  return (pageData.buttons ?? []).filter(
    (button) => normalizeBbbBusinessName(button.text) === target
  ).length;
}

export type OwnedFilingBbbSearchDecisionResult =
  | { ok: true; decision: FormDecision }
  | {
      ok: false;
      failure: OwnedFilingBbbSearchDecisionFailure;
      /** Sanitized durable detail: enum + counts only. */
      detail: string;
    };

function fail(
  failure: OwnedFilingBbbSearchDecisionFailure,
  resultCount: number,
  matchCount: number
): OwnedFilingBbbSearchDecisionResult {
  return {
    ok: false,
    failure,
    detail: `${failure} results=${resultCount} matches=${matchCount}`,
  };
}

/**
 * Deterministic BBB business-search step, used instead of the generic decide-action model so a
 * zero/ambiguous result page can never produce an invented next action.
 *
 * - exactly one exact-name result → select only that one
 * - several exact-name results, or results that are none of ours → fail closed, never click
 * - no results → the Business Information form only when every required identity value is known
 *   and uniquely addressable; otherwise fail closed
 */
export function buildOwnedFilingBbbSearchDecision(
  pageData: AssistedFormPageData,
  userData: Record<string, unknown>
): OwnedFilingBbbSearchDecisionResult {
  const results = visibleActionableResults(pageData);
  const businessName = firstUserDataString(userData, ["business_name", "company_name"]);
  if (!businessName) {
    return fail("search_business_name_missing", results.length, 0);
  }

  const wanted = normalizeBbbBusinessName(businessName);
  const matches = results.filter((result) => normalizeBbbBusinessName(resultLabel(result)) === wanted);

  if (matches.length === 1) {
    const nextButton = addressResult(matches[0], results);
    if (!nextButton) {
      return fail("search_result_unaddressable", results.length, matches.length);
    }
    return { ok: true, decision: { fieldsToFill: [], nextButton, waitForNavigation: true } };
  }
  if (matches.length > 1) {
    return fail("search_result_ambiguous", results.length, matches.length);
  }
  if (results.length > 0) {
    // Results exist but none is the intended business — never substitute another real business.
    return fail("search_result_unmatched", results.length, 0);
  }

  const fieldsToFill: FormFieldDecision[] = [];
  for (const requirement of NO_RESULTS_IDENTITY_REQUIREMENTS) {
    const value = firstUserDataString(userData, requirement.userDataKeys);
    if (!value) {
      return fail("search_no_results_identity_incomplete", 0, 0);
    }
    if (countFieldsMatchingLabel(pageData, requirement.labelPattern) !== 1) {
      return fail("search_no_results_identity_incomplete", 0, 0);
    }
    const selector = fieldSelectorForLabel(pageData, requirement.labelPattern);
    if (!selector) {
      return fail("search_no_results_identity_incomplete", 0, 0);
    }
    fieldsToFill.push({ selector, value });
  }

  if (noResultsProceedCount(pageData) !== 1) {
    return fail("search_no_results_form_ambiguous", 0, 0);
  }

  return {
    ok: true,
    decision: {
      fieldsToFill,
      nextButton: { selectorType: "text", value: OWNED_FILING_BBB_NO_RESULTS_PROCEED_LABEL },
      waitForNavigation: true,
    },
  };
}

/** Returns the sanitized search-failure detail when it is one of the allowlisted enums. */
export function parseOwnedFilingBbbSearchFailureDetail(
  detail: string | null | undefined
): string | null {
  const trimmed = detail?.trim();
  if (!trimmed) return null;
  const [enumToken] = trimmed.split(/\s+/, 1);
  return OWNED_FILING_BBB_SEARCH_DECISION_FAILURES.has(enumToken) ? trimmed : null;
}

import type {
  AssistedFormBbbActionControl,
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

/** Allowlisted userData keys that may appear in missing=/unaddressable= telemetry (never values). */
export const OWNED_FILING_BBB_NO_RESULTS_IDENTITY_KEYS = [
  "business_name",
  "business_address",
  "business_city",
  "business_state",
  "business_country",
  "business_postal_code",
] as const;

export type OwnedFilingBbbNoResultsIdentityKey =
  (typeof OWNED_FILING_BBB_NO_RESULTS_IDENTITY_KEYS)[number];

const NO_RESULTS_IDENTITY_KEY_SET: ReadonlySet<string> = new Set(
  OWNED_FILING_BBB_NO_RESULTS_IDENTITY_KEYS
);

/** Reversible CTA that enters the complaint wizard from the no-results business form. */
export const OWNED_FILING_BBB_NO_RESULTS_PROCEED_LABEL = "File a Complaint";

/** Reversible CTA that reveals the no-results business form when it is not rendered yet. */
export const OWNED_FILING_BBB_NO_RESULTS_FORM_LABEL = "Business Information Form";

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

/**
 * Strips the decoration BBB puts around control labels ("Business name *", "URL (optional)")
 * so label patterns stay exact-semantic instead of fuzzy.
 */
export function normalizeOwnedFilingBbbControlLabel(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s*\((required|optional)\)$/i, "")
    .replace(/[*:]+$/, "")
    .trim();
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

type ScrapedField = AssistedFormPageData["fields"][number];

type IdentityFieldSpec = {
  /** Canonical allowlisted key used in missing=/unaddressable= telemetry. */
  identityKey: OwnedFilingBbbNoResultsIdentityKey | "business_website" | "business_email";
  userDataKeys: string[];
  labelPattern: RegExp;
  required: boolean;
};

/**
 * Business identity required by the BBB no-results Business Information form. Only the business
 * name accepts label synonyms: BBB renders it through Angular with no associated <label>, while
 * the postal controls already resolve exactly.
 */
const NO_RESULTS_REQUIRED_IDENTITY: IdentityFieldSpec[] = [
  {
    identityKey: "business_name",
    userDataKeys: ["business_name", "company_name"],
    labelPattern:
      /^((business|company|organization)(\s*\/\s*(business|company|organization))?\s*name|name\s+of\s+(the\s+)?(business|company))$/i,
    required: true,
  },
  {
    identityKey: "business_address",
    userDataKeys: ["business_address"],
    labelPattern: /^address$/i,
    required: true,
  },
  {
    identityKey: "business_city",
    userDataKeys: ["business_city"],
    labelPattern: /^city$/i,
    required: true,
  },
  {
    identityKey: "business_state",
    userDataKeys: ["business_state"],
    labelPattern: /^state(\s*\/\s*province)?$/i,
    required: true,
  },
  {
    identityKey: "business_country",
    userDataKeys: ["business_country"],
    labelPattern: /^country$/i,
    required: true,
  },
  {
    identityKey: "business_postal_code",
    userDataKeys: ["business_postal_code"],
    labelPattern: /^postal\s*code$/i,
    required: true,
  },
];

/** Optional BBB Business Information fields filled only when approved values exist. */
const NO_RESULTS_OPTIONAL_IDENTITY: IdentityFieldSpec[] = [
  {
    identityKey: "business_website",
    userDataKeys: ["business_website"],
    labelPattern: /^url$/i,
    required: false,
  },
  {
    identityKey: "business_email",
    userDataKeys: ["business_email", "company_contact_email"],
    labelPattern: /^business\s*email$/i,
    required: false,
  },
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

/** Live-state filter. An absent flag means the scrape did not report it and stays usable. */
function isUsableField(field: ScrapedField): boolean {
  return field.visible !== false && field.enabled !== false;
}

/**
 * BBB's own search filters (the find_* params carried in the search URL) are never business
 * identity controls, and "find_text" is labelled with business-name wording. Dropping them keeps
 * the search box from competing with the Business Information form.
 */
const SEARCH_FILTER_KEYS: ReadonlySet<string> = new Set([
  "find_text",
  "find_country",
  "find_loc",
  "find_latlng",
  "find_type",
  "page",
  "touched",
]);

function isSearchFilterField(field: ScrapedField): boolean {
  return fieldSelectorKeys(field).some((key) => SEARCH_FILTER_KEYS.has(key.toLowerCase()));
}

/**
 * Controls the no-results Business Information form owns, when the scrape could scope them.
 * Scoping keeps the search filters (which carry business-name wording too) out of the pool;
 * hidden duplicates of the form are dropped either way.
 */
function businessFormFields(pageData: AssistedFormPageData): {
  pool: ScrapedField[];
  usable: ScrapedField[];
} {
  const usable = (pageData.fields ?? []).filter(
    (field) => isUsableField(field) && !isSearchFilterField(field)
  );
  const scoped = usable.filter((field) => field.inBusinessInfoForm === true);
  return { pool: scoped.length > 0 ? scoped : usable, usable };
}

function fieldLabelMatches(field: ScrapedField, pattern: RegExp): boolean {
  return [field.label, field.ariaLabel, field.placeholder].some((candidate) => {
    const normalized = normalizeOwnedFilingBbbControlLabel(candidate);
    return normalized.length > 0 && pattern.test(normalized);
  });
}

/** Angular BBB controls are often nameless; formControlName is the stable third key. */
function fieldSelectorKeys(field: ScrapedField): string[] {
  return [field.name, field.id, field.formControlName]
    .map((value) => (value ?? "").trim())
    .filter(Boolean);
}

/**
 * One selector key for the single control matching `pattern`. The key must also be unique across
 * the whole usable scrape, because the fill selector matches name, id and formControlName alike.
 *
 * `absent` (nothing matched, or the one match exposes no key) can still be recovered by revealing
 * the form and re-scraping; `ambiguous` (several candidates) must fail closed.
 */
type IdentitySelectorResolution =
  | { status: "ok"; key: string }
  | { status: "absent" }
  | { status: "ambiguous" };

function resolveIdentitySelector(
  fields: { pool: ScrapedField[]; usable: ScrapedField[] },
  pattern: RegExp
): IdentitySelectorResolution {
  const matches = fields.pool.filter((field) => fieldLabelMatches(field, pattern));
  if (matches.length === 0) return { status: "absent" };
  if (matches.length > 1) return { status: "ambiguous" };
  const [key] = fieldSelectorKeys(matches[0]);
  if (!key) return { status: "absent" };
  const collisions = fields.usable.filter((field) =>
    fieldSelectorKeys(field).includes(key)
  ).length;
  return collisions === 1 ? { status: "ok", key } : { status: "ambiguous" };
}

/**
 * Visible+enabled no-results continuation controls. Falls back to the plain button corpus for
 * scrapes taken before the search-step control inventory existed (mock loop, older fixtures).
 */
function continuationControls(pageData: AssistedFormPageData): AssistedFormBbbActionControl[] {
  const scraped = pageData.bbbNoResultsControls;
  if (scraped) {
    return scraped.filter((control) => control.visible && control.enabled);
  }
  return (pageData.buttons ?? [])
    .filter((button) => button.visible !== false && button.enabled !== false)
    .map((button) => ({
      kind: "button" as const,
      text: button.text ?? "",
      id: button.id ?? "",
      name: button.name ?? "",
      visible: true,
      enabled: true,
    }));
}

/** Text addressing needs exactly one real <button> carrying that exact label. */
function uniqueTextButton(
  controls: AssistedFormBbbActionControl[],
  label: string
): FormDecision["nextButton"] | null {
  const wanted = normalizeBbbBusinessName(label);
  const matches = controls.filter((control) => normalizeBbbBusinessName(control.text) === wanted);
  if (matches.length !== 1 || matches[0].kind !== "button") return null;
  return { selectorType: "text", value: label };
}

/** Which deterministic search-step action was produced, for reveal accounting and step logs. */
export type OwnedFilingBbbSearchStep =
  | "select_result"
  | "reveal_business_form"
  | "submit_business_form";

export type OwnedFilingBbbSearchDecisionResult =
  | { ok: true; step: OwnedFilingBbbSearchStep; decision: FormDecision }
  | {
      ok: false;
      failure: OwnedFilingBbbSearchDecisionFailure;
      /** Sanitized durable detail: enum + counts (+ allowlisted missing/unaddressable keys). */
      detail: string;
    };

export type OwnedFilingBbbSearchDecisionOptions = {
  /** Reveal clicks already spent on this step. One is allowed, then the step fails closed. */
  revealAttempts?: number;
};

function fail(
  failure: OwnedFilingBbbSearchDecisionFailure,
  resultCount: number,
  matchCount: number,
  missingKeys: string[] = [],
  unaddressableKeys: string[] = []
): OwnedFilingBbbSearchDecisionResult {
  const allowlisted = (keys: string[]): string[] =>
    keys.map((key) => key.trim()).filter((key) => NO_RESULTS_IDENTITY_KEY_SET.has(key));
  const missing = allowlisted(missingKeys);
  const unaddressable = allowlisted(unaddressableKeys);
  const suffix = [
    missing.length > 0 ? ` missing=${missing.join(",")}` : "",
    unaddressable.length > 0 ? ` unaddressable=${unaddressable.join(",")}` : "",
  ].join("");
  return {
    ok: false,
    failure,
    detail: `${failure} results=${resultCount} matches=${matchCount}${suffix}`,
  };
}

/**
 * `missing_value` means approved case data has no value; `absent`/`ambiguous` mean the control is
 * not uniquely resolvable in the scrape. The three need different recoveries, so they stay
 * distinct here even though telemetry reports both scrape outcomes as unaddressable.
 */
function tryAppendIdentityFill(
  fieldsToFill: FormFieldDecision[],
  fields: { pool: ScrapedField[]; usable: ScrapedField[] },
  userData: Record<string, unknown>,
  spec: IdentityFieldSpec
): "ok" | "missing_value" | "absent" | "ambiguous" {
  const value = firstUserDataString(userData, spec.userDataKeys);
  if (!value) return "missing_value";
  const resolved = resolveIdentitySelector(fields, spec.labelPattern);
  if (resolved.status !== "ok") return resolved.status;
  fieldsToFill.push({ selector: resolved.key, value });
  return "ok";
}

/**
 * Deterministic BBB business-search step, used instead of the generic decide-action model so a
 * zero/ambiguous result page can never produce an invented next action.
 *
 * - exactly one exact-name result → select only that one
 * - several exact-name results, or results that are none of ours → fail closed, never click
 * - no results → the Business Information form when every required identity value is known and
 *   uniquely addressable; when the form is not addressable yet, one reversible reveal click on
 *   the unique continuation CTA; otherwise fail closed with allowlisted key telemetry
 */
export function buildOwnedFilingBbbSearchDecision(
  pageData: AssistedFormPageData,
  userData: Record<string, unknown>,
  options: OwnedFilingBbbSearchDecisionOptions = {}
): OwnedFilingBbbSearchDecisionResult {
  const results = visibleActionableResults(pageData);
  const businessName = firstUserDataString(userData, ["business_name", "company_name"]);
  if (!businessName) {
    return fail("search_business_name_missing", results.length, 0, ["business_name"]);
  }

  const wanted = normalizeBbbBusinessName(businessName);
  const matches = results.filter((result) => normalizeBbbBusinessName(resultLabel(result)) === wanted);

  if (matches.length === 1) {
    const nextButton = addressResult(matches[0], results);
    if (!nextButton) {
      return fail("search_result_unaddressable", results.length, matches.length);
    }
    return {
      ok: true,
      step: "select_result",
      decision: { fieldsToFill: [], nextButton, waitForNavigation: true },
    };
  }
  if (matches.length > 1) {
    return fail("search_result_ambiguous", results.length, matches.length);
  }
  if (results.length > 0) {
    // Results exist but none is the intended business — never substitute another real business.
    return fail("search_result_unmatched", results.length, 0);
  }

  const fields = businessFormFields(pageData);
  const fieldsToFill: FormFieldDecision[] = [];
  const missingValueKeys: string[] = [];
  const absentKeys: string[] = [];
  const ambiguousKeys: string[] = [];
  for (const requirement of NO_RESULTS_REQUIRED_IDENTITY) {
    const outcome = tryAppendIdentityFill(fieldsToFill, fields, userData, requirement);
    if (outcome === "missing_value") missingValueKeys.push(requirement.identityKey);
    if (outcome === "absent") absentKeys.push(requirement.identityKey);
    if (outcome === "ambiguous") ambiguousKeys.push(requirement.identityKey);
  }

  // Approved case data must carry every required value first: no click can recover a value we
  // are not allowed to invent.
  if (missingValueKeys.length > 0) {
    return fail("search_no_results_identity_incomplete", 0, 0, missingValueKeys, [
      ...absentKeys,
      ...ambiguousKeys,
    ]);
  }

  // Several candidates for one required control: filling could hit the wrong field, so stop.
  if (ambiguousKeys.length > 0) {
    return fail("search_no_results_identity_incomplete", 0, 0, [], [
      ...absentKeys,
      ...ambiguousKeys,
    ]);
  }

  const controls = continuationControls(pageData);

  if (absentKeys.length > 0) {
    // The form is not rendered (or not keyed) yet. One reversible click may reveal it; if the
    // fresh scrape still cannot address the controls, stop instead of clicking again.
    if ((options.revealAttempts ?? 0) > 0) {
      return fail("search_no_results_identity_incomplete", 0, 0, [], absentKeys);
    }
    const reveal =
      uniqueTextButton(controls, OWNED_FILING_BBB_NO_RESULTS_FORM_LABEL) ??
      uniqueTextButton(controls, OWNED_FILING_BBB_NO_RESULTS_PROCEED_LABEL);
    if (!reveal) {
      return fail("search_no_results_form_ambiguous", 0, 0, [], absentKeys);
    }
    return {
      ok: true,
      step: "reveal_business_form",
      decision: { fieldsToFill: [], nextButton: reveal, waitForNavigation: true },
    };
  }

  for (const optional of NO_RESULTS_OPTIONAL_IDENTITY) {
    // Optional: fill when approved value exists and the control is uniquely addressable; never
    // fail closed solely because an optional field is absent or missing from the scrape.
    tryAppendIdentityFill(fieldsToFill, fields, userData, optional);
  }

  const proceed = uniqueTextButton(controls, OWNED_FILING_BBB_NO_RESULTS_PROCEED_LABEL);
  if (!proceed) {
    return fail("search_no_results_form_ambiguous", 0, 0);
  }

  return {
    ok: true,
    step: "submit_business_form",
    decision: { fieldsToFill, nextButton: proceed, waitForNavigation: true },
  };
}

/** Returns the sanitized search-failure detail when it is one of the allowlisted enums. */
export function parseOwnedFilingBbbSearchFailureDetail(
  detail: string | null | undefined
): string | null {
  const trimmed = detail?.trim();
  if (!trimmed) return null;
  const [enumToken] = trimmed.split(/\s+/, 1);
  if (!OWNED_FILING_BBB_SEARCH_DECISION_FAILURES.has(enumToken)) return null;
  // Reject free-form payloads that sneak past the enum prefix.
  if (/[|;{}]/.test(trimmed)) return null;
  return trimmed;
}

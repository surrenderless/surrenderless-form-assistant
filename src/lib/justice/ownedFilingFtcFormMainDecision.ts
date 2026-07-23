import type {
  AssistedFormChoiceControl,
  AssistedFormPageData,
  FormDecision,
  FormFieldDecision,
} from "@/lib/justice/realBbbBoundedSubmitLoop";

/** Allowlisted form/main decision preflight failures — never free-form or payload text. */
export type FtcFormMainDecisionValidationFailure =
  | "field_selector_unmatched"
  | "field_selector_ambiguous"
  | "choice_unmatched"
  | "choice_ambiguous"
  | "fields_required";

export const FTC_FORM_MAIN_DECISION_VALIDATION_FAILURES: ReadonlySet<string> = new Set([
  "field_selector_unmatched",
  "field_selector_ambiguous",
  "choice_unmatched",
  "choice_ambiguous",
  "fields_required",
]);

export type FtcFormMainInventoryAllowlist = {
  fieldSelectors: string[];
  /** Sanitized "choiceSelectorType:key" entries for prompt only. */
  choiceKeys: string[];
  continueActionable: boolean;
};

function sanitizeInventoryToken(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
}

function normalizeContinueLabel(value: string): string {
  return value.replace(/\u00a0/g, " ").trim().toLowerCase();
}

/** True when scraped actionable buttons include exactly one Continue CTA. */
export function ftcFormMainContinueIsActionable(pageData: AssistedFormPageData): boolean {
  const continues = (pageData.buttons ?? []).filter(
    (button) => normalizeContinueLabel(button.text) === "continue"
  );
  return continues.length === 1;
}

function collectFieldSelectorKeys(pageData: AssistedFormPageData): string[] {
  const keys = new Set<string>();
  for (const field of pageData.fields ?? []) {
    for (const raw of [field.name, field.id, field.formControlName]) {
      const key = sanitizeInventoryToken(raw);
      if (key) keys.add(key);
    }
  }
  return [...keys].sort();
}

function countFieldsMatchingSelector(
  selector: string,
  pageData: AssistedFormPageData
): number {
  const key = sanitizeInventoryToken(selector);
  if (!key) return 0;
  return (pageData.fields ?? []).filter((field) => {
    return (
      sanitizeInventoryToken(field.name) === key ||
      sanitizeInventoryToken(field.id) === key ||
      sanitizeInventoryToken(field.formControlName) === key
    );
  }).length;
}

function matchingChoiceControls(
  field: FormFieldDecision,
  choiceControls: AssistedFormChoiceControl[]
): AssistedFormChoiceControl[] {
  return choiceControls.filter((control) => {
    if (!control.enabled) return false;
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
 * Sanitized scrape inventory for FTC /form/main decide prompts and preflight.
 * Structural keys only — never labels, page text, or user values.
 */
export function buildFtcFormMainInventoryAllowlist(
  pageData: AssistedFormPageData
): FtcFormMainInventoryAllowlist {
  const fieldSelectors = collectFieldSelectorKeys(pageData).slice(0, 40);

  const choiceKeySet = new Set<string>();
  for (const control of pageData.choiceControls ?? []) {
    if (!control.enabled) continue;
    for (const [type, raw] of [
      ["id", control.id],
      ["name", control.name],
      ["accessibleName", control.accessibleName],
    ] as const) {
      const key = sanitizeInventoryToken(raw);
      if (!key) continue;
      choiceKeySet.add(`${type}:${key}`);
    }
  }
  const choiceKeys = [...choiceKeySet].sort().slice(0, 60);

  return {
    fieldSelectors,
    choiceKeys,
    continueActionable: ftcFormMainContinueIsActionable(pageData),
  };
}

/** Compact allowlist block for the form/main decide-action prompt (no values/PII). */
export function formatFtcFormMainInventoryForPrompt(
  pageData: AssistedFormPageData
): string {
  const inventory = buildFtcFormMainInventoryAllowlist(pageData);
  const fields =
    inventory.fieldSelectors.length > 0
      ? inventory.fieldSelectors.join(", ")
      : "none";
  const choices =
    inventory.choiceKeys.length > 0 ? inventory.choiceKeys.join(", ") : "none";
  return [
    `Allowed field selectors (use exactly): ${fields}`,
    `Allowed choice keys (choiceSelectorType:key): ${choices}`,
    `Continue actionable in scrape: ${inventory.continueActionable ? "yes" : "no"}`,
    inventory.continueActionable
      ? "Continue-only (empty fieldsToFill) is allowed only because Continue is uniquely actionable."
      : "Continue is not actionable — include at least one inventory-backed fieldsToFill entry.",
  ].join("\n");
}

function countFieldSelectorMatches(
  selector: string,
  pageData: AssistedFormPageData
): number {
  return countFieldsMatchingSelector(selector, pageData);
}

function userDataString(
  userData: Record<string, unknown>,
  key: string
): string | null {
  const raw = userData[key];
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  return value ? value : null;
}

function narrativeValueFromUserData(userData: Record<string, unknown>): string | null {
  return (
    userDataString(userData, "complaint_description") ||
    userDataString(userData, "what_happened") ||
    userDataString(userData, "story")
  );
}

function isSkippedInputType(type: string): boolean {
  const normalized = type.trim().toLowerCase();
  return (
    normalized === "radio" ||
    normalized === "checkbox" ||
    normalized === "hidden" ||
    normalized === "submit" ||
    normalized === "button" ||
    normalized === "file" ||
    normalized === "image" ||
    normalized === "reset"
  );
}

function uniqueSelectorForField(
  field: AssistedFormPageData["fields"][number],
  pageData: AssistedFormPageData
): string | null {
  for (const raw of [field.formControlName, field.name, field.id]) {
    const key = sanitizeInventoryToken(raw);
    if (!key) continue;
    if (countFieldsMatchingSelector(key, pageData) === 1) return key;
  }
  return null;
}

function isNarrativeField(
  field: AssistedFormPageData["fields"][number],
  selector: string
): boolean {
  const tag = field.tag.trim().toLowerCase();
  if (tag === "textarea") return true;
  const haystack = [selector, field.label, field.placeholder, field.name, field.formControlName]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return /comment|story|description|what\s*happened|narrative/.test(haystack);
}

function resolveTextOrSelectValue(
  field: AssistedFormPageData["fields"][number],
  selector: string,
  userData: Record<string, unknown>
): string | null {
  const exact =
    userDataString(userData, selector) ||
    userDataString(userData, field.name) ||
    userDataString(userData, field.id) ||
    (field.formControlName ? userDataString(userData, field.formControlName) : null);
  if (exact) return exact;
  if (isNarrativeField(field, selector)) return narrativeValueFromUserData(userData);
  return null;
}

function normalizeYesNoToken(value: string): "yes" | "no" | null {
  const normalized = value.replace(/\u00a0/g, " ").trim().toLowerCase();
  if (normalized === "yes" || normalized === "y") return "yes";
  if (normalized === "no" || normalized === "n") return "no";
  return null;
}

function controlYesNoSide(control: AssistedFormChoiceControl): "yes" | "no" | null {
  return (
    normalizeYesNoToken(control.optionValue) || normalizeYesNoToken(control.accessibleName)
  );
}

/** Non-empty, non-zero amounts → yes; empty/zero-like → no. */
function resolveYesNoFromUserData(userData: Record<string, unknown>): "yes" | "no" {
  const amount =
    userDataString(userData, "amount_involved") ||
    userDataString(userData, "money_involved") ||
    "";
  const stripped = amount.replace(/[$,\s]/g, "").toLowerCase();
  if (!stripped || /^(0+|0+\.0+|none|n\/a|na|no|zero)$/.test(stripped)) {
    return "no";
  }
  return "yes";
}

function binaryYesNoPair(
  group: AssistedFormChoiceControl[]
): { yes: AssistedFormChoiceControl; no: AssistedFormChoiceControl } | null {
  const yesMatches = group.filter((control) => controlYesNoSide(control) === "yes");
  const noMatches = group.filter((control) => controlYesNoSide(control) === "no");
  if (yesMatches.length !== 1 || noMatches.length !== 1) return null;
  const yes = yesMatches[0]!;
  const no = noMatches[0]!;
  if (yes === no) return null;
  return { yes, no };
}

function preferredChoiceSelector(
  control: AssistedFormChoiceControl,
  group: AssistedFormChoiceControl[]
): { choiceSelectorType: "name" | "id"; selector: string } | null {
  const name = sanitizeInventoryToken(control.name);
  if (name && group.every((entry) => entry.name === control.name)) {
    return { choiceSelectorType: "name", selector: name };
  }
  const id = sanitizeInventoryToken(control.id);
  if (id) {
    const idMatches = group.filter((entry) => entry.id === control.id);
    if (idMatches.length === 1) {
      return { choiceSelectorType: "id", selector: id };
    }
  }
  return null;
}

/**
 * Deterministic /form/main FormDecision from scrape inventory + case userData only.
 * Returns null when mapping is insufficient or ambiguous — caller falls back to model decide.
 * Never invents selectors or optionValues.
 */
export function buildFtcFormMainInventoryDecision(
  pageData: AssistedFormPageData,
  userData: Record<string, unknown>
): FormDecision | null {
  const fieldsToFill: FormFieldDecision[] = [];
  const usedSelectors = new Set<string>();

  for (const field of pageData.fields ?? []) {
    if (isSkippedInputType(field.type) || field.tag.trim().toLowerCase() === "button") {
      continue;
    }
    const selector = uniqueSelectorForField(field, pageData);
    if (!selector || usedSelectors.has(selector)) continue;
    const value = resolveTextOrSelectValue(field, selector, userData);
    if (!value) continue;
    usedSelectors.add(selector);
    fieldsToFill.push({ selector, value });
  }

  const enabledChoices = (pageData.choiceControls ?? []).filter((control) => control.enabled);
  const groups = new Map<string, AssistedFormChoiceControl[]>();
  for (const control of enabledChoices) {
    const name = sanitizeInventoryToken(control.name);
    if (!name) continue;
    const list = groups.get(name) ?? [];
    list.push(control);
    groups.set(name, list);
  }

  for (const [, group] of groups) {
    if (group.some((control) => control.checked)) continue;
    const pair = binaryYesNoPair(group);
    if (!pair) continue;
    const want = resolveYesNoFromUserData(userData);
    const chosen = want === "yes" ? pair.yes : pair.no;
    const targeting = preferredChoiceSelector(chosen, group);
    if (!targeting) continue;
    const optionMatches = group.filter(
      (control) =>
        control.optionValue === chosen.optionValue &&
        (targeting.choiceSelectorType === "name"
          ? control.name === targeting.selector
          : control.id === targeting.selector)
    );
    if (optionMatches.length !== 1) continue;

    fieldsToFill.push({
      selector: targeting.selector,
      value: chosen.optionValue,
      controlKind: chosen.kind,
      choiceSelectorType: targeting.choiceSelectorType,
    });
  }

  const continueActionable = ftcFormMainContinueIsActionable(pageData);
  if (fieldsToFill.length === 0) {
    if (!continueActionable) return null;
    return {
      fieldsToFill: [],
      nextButton: { selectorType: "text", value: "Continue" },
      waitForNavigation: true,
    };
  }

  // Fields without an actionable Continue: fill-only so apply does not fail-closed on a
  // missing live Continue (production: target=continue,count=0,phase=precheck_ambiguous).
  if (!continueActionable) {
    return { fieldsToFill };
  }

  return {
    fieldsToFill,
    nextButton: { selectorType: "text", value: "Continue" },
    waitForNavigation: true,
  };
}

/**
 * Fail-closed preflight for FTC /form/main decisions against the evaluate scrape.
 * Rejects the entire decision when any field is unmatched/ambiguous, or when
 * Continue is not actionable and no inventory-backed field mutation is proposed.
 */
export function validateFtcFormMainDecision(
  pageData: AssistedFormPageData,
  decision: FormDecision
): { ok: true } | { ok: false; reason: FtcFormMainDecisionValidationFailure } {
  const fields = decision.fieldsToFill ?? [];
  const continueActionable = ftcFormMainContinueIsActionable(pageData);
  const choiceControls = pageData.choiceControls ?? [];

  let inventoryBackedFieldCount = 0;

  for (const field of fields) {
    if (!field.selector?.trim()) {
      return { ok: false, reason: "field_selector_unmatched" };
    }

    if (field.controlKind) {
      const matches = matchingChoiceControls(field, choiceControls);
      if (matches.length === 0) {
        return { ok: false, reason: "choice_unmatched" };
      }
      if (matches.length > 1) {
        return { ok: false, reason: "choice_ambiguous" };
      }
      inventoryBackedFieldCount += 1;
      continue;
    }

    const matchCount = countFieldSelectorMatches(field.selector, pageData);
    if (matchCount === 0) {
      return { ok: false, reason: "field_selector_unmatched" };
    }
    if (matchCount > 1) {
      return { ok: false, reason: "field_selector_ambiguous" };
    }
    inventoryBackedFieldCount += 1;
  }

  if (!continueActionable && inventoryBackedFieldCount === 0) {
    return { ok: false, reason: "fields_required" };
  }

  return { ok: true };
}

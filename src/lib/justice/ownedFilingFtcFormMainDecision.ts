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

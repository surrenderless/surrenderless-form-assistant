import type {
  AssistedFormBbbActionControl,
  FormButtonDecision,
} from "@/lib/justice/realBbbBoundedSubmitLoop";
import { isOwnedFilingBbbBusinessSearchUrl } from "@/lib/justice/ownedFilingBbbSearchDecision";

/**
 * Click risk for owned BBB/FTC bounded-submit automation.
 * - safe: navigation / continue / back — allowed in dry-run and live
 * - irreversible: final submit / file / send — dry-run must stop; live only when armed
 * - unknown: ambiguous — always fail closed (never click)
 */
export type OwnedFilingClickRisk = "safe" | "irreversible" | "unknown";

const IRREVERSIBLE_PATTERNS: RegExp[] = [
  /\bsubmit\b/i,
  /\bfile\b/i,
  /\bsend\b/i,
  /\bconfirm\b/i,
  /\bfinalize\b/i,
  /\bfinish\b/i,
  /\bcomplete\b/i,
  /\bpost\b/i,
  /\btransmit\b/i,
  /\bfile\s+(a\s+)?complaint\b/i,
  /\bsubmit\s+(a\s+)?complaint\b/i,
  /\bsubmit\s+(your\s+)?report\b/i,
  /\bi\s+agree\b/i,
  /\belectronically\s+sign\b/i,
];

const SAFE_PATTERNS: RegExp[] = [
  /^\s*continue\s*$/i,
  /^\s*continue[_-]?btn\s*$/i,
  /^\s*next\s*$/i,
  /^\s*next[_-]?btn\s*$/i,
  /** FTC ReportFraud landing CTA — starts the wizard; finalization is Submit later. */
  /^\s*report\s+now\s*$/i,
  /** BBB file-a-complaint landing CTA — starts the wizard; finalization is Submit/File later. */
  /^\s*start\s+complaint\s*$/i,
  /** BBB goal-picker complaint option — reveals Start Complaint; reversible setup only. */
  /^\s*i\s+want\s+help\s+resolving\s+a\s+problem\s+with\s+a\s+business\.?\s*$/i,
  /^\s*back\s*$/i,
  /^\s*back[_-]?btn\s*$/i,
  /^\s*previous\s*$/i,
  /^\s*prev\s*$/i,
  /^\s*save\s*(draft)?\s*$/i,
  /^\s*edit\s*$/i,
  /^\s*review\s*$/i,
  /^\s*add\b/i,
  /^\s*upload\b/i,
  /^\s*browse\b/i,
  /^\s*search\b/i,
  /^\s*find\b/i,
  /^\s*select\b/i,
  /^\s*choose\b/i,
  /^\s*look\s*up\b/i,
  /^\s*cancel\s*$/i,
  /^\s*close\s*$/i,
];

function buttonCorpus(button: FormButtonDecision): string {
  return [button.selectorType, button.value].filter(Boolean).join(" ").trim();
}

export type OwnedFilingClickContext = {
  /** Current page URL. Only used for URL-scoped wizard-entry exceptions. */
  pageUrl?: string;
  /**
   * Sanitized deduped BBB no-results continuation inventory. Lets an id/name-addressed
   * continuation be verified against the scraped DOM instead of trusting the caller.
   */
  bbbContinuationControls?: AssistedFormBbbActionControl[];
};

/**
 * BBB business-search step only: the no-results Business Information form's "File a Complaint"
 * button enters the wizard with the typed business, exactly like Start Complaint, and
 * "Business Information Form" only reveals that form. The true final submit lives on a later
 * wizard URL, so the global /\bfile\b/ gate stays intact.
 */
const BBB_BUSINESS_SEARCH_WIZARD_ENTRY_LABELS: RegExp[] = [
  /^\s*file\s+a\s+complaint\s*$/i,
  /^\s*business\s+information\s+form\s*$/i,
];

function isBbbWizardEntryLabel(value: string): boolean {
  const normalized = value.replace(/\u00a0/g, " ");
  return BBB_BUSINESS_SEARCH_WIZARD_ENTRY_LABELS.some((pattern) => pattern.test(normalized));
}

function isBbbBusinessSearchWizardEntry(
  button: FormButtonDecision,
  context: OwnedFilingClickContext | undefined
): boolean {
  if (!isOwnedFilingBbbBusinessSearchUrl(context?.pageUrl)) return false;
  if (button.selectorType === "text") return isBbbWizardEntryLabel(button.value);
  // The continuation is often an anchor, addressable only by id/name. The key must resolve to
  // exactly one scraped continuation host whose own label is a wizard-entry label, so this stays
  // DOM-verified rather than caller-asserted.
  if (button.selectorType !== "id" && button.selectorType !== "name") return false;
  const key = button.value.trim();
  if (!key) return false;
  const matches = (context?.bbbContinuationControls ?? []).filter((control) => {
    const controlKey = (button.selectorType === "id" ? control.id : control.name)?.trim();
    return controlKey === key;
  });
  if (matches.length !== 1) return false;
  const target = matches[0];
  return target.visible && target.enabled && isBbbWizardEntryLabel(target.text ?? "");
}

/**
 * Classify a decide-action nextButton before any click.
 * Missing/blank buttons are unknown (fail closed).
 * type=submit is irreversible. Ambiguous labels that match neither list are unknown.
 */
export function classifyOwnedFilingClick(
  button: FormButtonDecision | null | undefined,
  context?: OwnedFilingClickContext
): OwnedFilingClickRisk {
  if (!button || typeof button !== "object") return "unknown";
  const value = button.value?.trim() ?? "";
  if (!value) return "unknown";

  if (button.selectorType === "type" && /^submit$/i.test(value)) {
    return "irreversible";
  }

  if (isBbbBusinessSearchWizardEntry(button, context)) return "safe";

  const corpus = buttonCorpus(button);

  // Prefer irreversible over safe when both could match (e.g. "confirm and continue").
  if (IRREVERSIBLE_PATTERNS.some((re) => re.test(corpus))) {
    return "irreversible";
  }
  if (SAFE_PATTERNS.some((re) => re.test(value)) || SAFE_PATTERNS.some((re) => re.test(corpus))) {
    return "safe";
  }

  return "unknown";
}

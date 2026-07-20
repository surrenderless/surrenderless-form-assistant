import type { FormButtonDecision } from "@/lib/justice/realBbbBoundedSubmitLoop";

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

/**
 * Classify a decide-action nextButton before any click.
 * Missing/blank buttons are unknown (fail closed).
 * type=submit is irreversible. Ambiguous labels that match neither list are unknown.
 */
export function classifyOwnedFilingClick(
  button: FormButtonDecision | null | undefined
): OwnedFilingClickRisk {
  if (!button || typeof button !== "object") return "unknown";
  const value = button.value?.trim() ?? "";
  if (!value) return "unknown";

  if (button.selectorType === "type" && /^submit$/i.test(value)) {
    return "irreversible";
  }

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

const MAX_NOTES = 8000;
const MAX_STEP_LOG_ENTRIES = 24;
const MAX_STEP_LOG_CHARS = 1500;

/** Marker opening the owned-filing dry-run result block inside task notes. */
export const OWNED_FILING_DRY_RUN_BLOCK_MARKER = "---owned_filing_dry_run---";

export type OwnedFilingDryRunStatus =
  | "dry_run_completed"
  | "dry_run_blocked_at_submit"
  | "dry_run_failed";

export type OwnedFilingDryRunRecord = {
  status: OwnedFilingDryRunStatus;
  destination: "bbb" | "ftc";
  case_id: string;
  task_id: string;
  ran_at: string;
  steps_executed: number;
  stop_reason?: string;
  button_risk?: string;
  button_label?: string;
  page_url?: string;
  detail?: string;
  /** Bounded redacted step log: action|button_label|url entries (no form field values). */
  step_log?: string;
};

export type OwnedFilingDryRunStepSource = {
  action: string;
  url?: string;
  /** Button corpus only (e.g. text:Continue) — never field values. */
  detail?: string;
};

/**
 * Formats a bounded, non-sensitive step log for dry-run notes.
 * Stores action type, optional button label, and page URL only.
 */
export function formatOwnedFilingDryRunStepLog(
  entries: OwnedFilingDryRunStepSource[]
): string {
  const parts: string[] = [];
  for (const entry of entries.slice(0, MAX_STEP_LOG_ENTRIES)) {
    const action = (entry.action ?? "").replace(/[|;]/g, " ").trim().slice(0, 48);
    if (!action) continue;
    const button = (entry.detail ?? "").replace(/[|;]/g, " ").trim().slice(0, 80);
    const url = (entry.url ?? "").replace(/[|;]/g, " ").trim().slice(0, 160);
    parts.push(`${action}|${button}|${url}`);
  }
  return parts.join(";").slice(0, MAX_STEP_LOG_CHARS);
}

export function ownedFilingDryRunIdempotencyKey(
  caseId: string,
  destination: "bbb" | "ftc"
): string {
  return `owned-filing-dry-run:${destination}:${caseId.trim()}`;
}

export function parseOwnedFilingDryRunRecord(
  notes: string | null | undefined
): OwnedFilingDryRunRecord | null {
  const trimmed = notes?.trim() ?? "";
  const idx = trimmed.indexOf(OWNED_FILING_DRY_RUN_BLOCK_MARKER);
  if (idx < 0) return null;
  const block = trimmed.slice(idx + OWNED_FILING_DRY_RUN_BLOCK_MARKER.length).trim();
  const map = new Map<string, string>();
  for (const rawLine of block.split("\n")) {
    const line = rawLine.trim();
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    map.set(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
  }
  const status = map.get("status");
  if (
    status !== "dry_run_completed" &&
    status !== "dry_run_blocked_at_submit" &&
    status !== "dry_run_failed"
  ) {
    return null;
  }
  const destination = map.get("destination");
  if (destination !== "bbb" && destination !== "ftc") return null;
  const case_id = map.get("case_id")?.trim() ?? "";
  const task_id = map.get("task_id")?.trim() ?? "";
  const ran_at = map.get("ran_at")?.trim() ?? "";
  const stepsRaw = map.get("steps_executed")?.trim() ?? "0";
  const steps_executed = Number.parseInt(stepsRaw, 10);
  if (!case_id || !task_id || !ran_at || !Number.isFinite(steps_executed)) return null;
  return {
    status,
    destination,
    case_id,
    task_id,
    ran_at,
    steps_executed,
    ...(map.get("stop_reason") ? { stop_reason: map.get("stop_reason") } : {}),
    ...(map.get("button_risk") ? { button_risk: map.get("button_risk") } : {}),
    ...(map.get("button_label") ? { button_label: map.get("button_label") } : {}),
    ...(map.get("page_url") ? { page_url: map.get("page_url") } : {}),
    ...(map.get("detail") ? { detail: map.get("detail") } : {}),
    ...(map.get("step_log") ? { step_log: map.get("step_log") } : {}),
  };
}

/**
 * Upserts the dry-run result block. Replaces any prior dry-run block (duplicate-safe).
 * Does not touch the owned-filing delivery block or complete the task.
 */
export function upsertOwnedFilingDryRunNotes(
  notes: string | null | undefined,
  record: OwnedFilingDryRunRecord
): string {
  const base = (notes ?? "").trim();
  const without =
    base.indexOf(OWNED_FILING_DRY_RUN_BLOCK_MARKER) >= 0
      ? base.slice(0, base.indexOf(OWNED_FILING_DRY_RUN_BLOCK_MARKER)).trimEnd()
      : base;
  const lines = [
    OWNED_FILING_DRY_RUN_BLOCK_MARKER,
    `status: ${record.status}`,
    `destination: ${record.destination}`,
    `case_id: ${record.case_id}`,
    `task_id: ${record.task_id}`,
    `ran_at: ${record.ran_at}`,
    `steps_executed: ${record.steps_executed}`,
    `idempotency: ${ownedFilingDryRunIdempotencyKey(record.case_id, record.destination)}`,
  ];
  if (record.stop_reason) lines.push(`stop_reason: ${record.stop_reason}`);
  if (record.button_risk) lines.push(`button_risk: ${record.button_risk}`);
  if (record.button_label) lines.push(`button_label: ${record.button_label.slice(0, 200)}`);
  if (record.page_url) lines.push(`page_url: ${record.page_url.slice(0, 500)}`);
  if (record.detail) lines.push(`detail: ${record.detail.slice(0, 500)}`);
  if (record.step_log) lines.push(`step_log: ${record.step_log.slice(0, MAX_STEP_LOG_CHARS)}`);
  const next = [without, lines.join("\n")].filter(Boolean).join("\n\n");
  return next.length <= MAX_NOTES ? next : next.slice(0, MAX_NOTES);
}

/**
 * True when an identical successful dry-run result is already recorded (same destination +
 * terminal status). Used for duplicate-safe short-circuit of repeated dry-runs.
 */
export function hasMatchingOwnedFilingDryRunResult(
  notes: string | null | undefined,
  destination: "bbb" | "ftc",
  status: OwnedFilingDryRunStatus
): boolean {
  const existing = parseOwnedFilingDryRunRecord(notes);
  if (!existing) return false;
  return existing.destination === destination && existing.status === status;
}

/**
 * Whether a prior dry-run should short-circuit a retry.
 * - dry_run_blocked_at_submit: terminal only for a verified irreversible Submit boundary
 * - Legacy mis-mapped blocked_unknown_click / button_risk=unknown records are retryable
 * - dry_run_completed: terminal unless stop_reason is max_steps_reached (legacy/incomplete)
 * - dry_run_failed / max_steps: never blocks retry
 */
export function shouldSkipOwnedFilingDryRunAsDuplicate(
  notes: string | null | undefined,
  destination: "bbb" | "ftc"
): OwnedFilingDryRunStatus | null {
  const existing = parseOwnedFilingDryRunRecord(notes);
  if (!existing || existing.destination !== destination) return null;
  if (existing.status === "dry_run_blocked_at_submit") {
    // Prior tip incorrectly mapped mid-form unknown clicks to blocked_at_submit.
    if (
      existing.stop_reason === "blocked_unknown_click" ||
      existing.button_risk === "unknown"
    ) {
      return null;
    }
    return "dry_run_blocked_at_submit";
  }
  if (existing.status === "dry_run_completed") {
    if (existing.stop_reason === "max_steps_reached") return null;
    return "dry_run_completed";
  }
  return null;
}

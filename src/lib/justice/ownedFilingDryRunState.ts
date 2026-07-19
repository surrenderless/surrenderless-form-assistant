const MAX_NOTES = 8000;

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
};

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

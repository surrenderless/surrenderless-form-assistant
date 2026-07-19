import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";

const MAX_NOTES = 8000;
/** Marker line that opens the owned-FTC delivery block inside task notes. */
export const FTC_OWNED_FILING_DELIVERY_BLOCK_MARKER = "---ftc_owned_autofill_delivery---";
const DELIVERY_BLOCK_MARKER = FTC_OWNED_FILING_DELIVERY_BLOCK_MARKER;

/** Persisted owned-FTC automation states (queued → submitting → filed | failed). */
export type FtcOwnedFilingDeliveryState = "queued" | "submitting" | "failed" | "filed";

export type FtcOwnedFilingDeliveryRecord = {
  delivery_state: FtcOwnedFilingDeliveryState;
  provider: string;
  confirmation?: string;
  started_at?: string;
  completed_at?: string;
  failure_detail?: string;
  stop_reason?: string;
};

export function ftcOwnedFilingIdempotencyKey(caseId: string): string {
  return `ftc-owned-autofill:${caseId.trim()}`;
}

export function ftcOwnedFilingTimelineId(
  caseId: string,
  state: FtcOwnedFilingDeliveryState
): string {
  return `ftc_autofill_${state}:${caseId.trim()}`;
}

export function parseFtcOwnedFilingDeliveryRecord(
  notes: string | null | undefined
): FtcOwnedFilingDeliveryRecord | null {
  const trimmed = notes?.trim() ?? "";
  const idx = trimmed.indexOf(DELIVERY_BLOCK_MARKER);
  if (idx < 0) return null;
  const block = trimmed.slice(idx + DELIVERY_BLOCK_MARKER.length).trim();
  const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
  const map = new Map<string, string>();
  for (const line of lines) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    map.set(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
  }
  const state = map.get("delivery_state");
  if (
    state !== "queued" &&
    state !== "submitting" &&
    state !== "failed" &&
    state !== "filed"
  ) {
    return null;
  }
  const provider = map.get("provider")?.trim() ?? "";
  if (!provider) return null;
  return {
    delivery_state: state,
    provider,
    ...(map.get("confirmation") ? { confirmation: map.get("confirmation") } : {}),
    ...(map.get("started_at") ? { started_at: map.get("started_at") } : {}),
    ...(map.get("completed_at") ? { completed_at: map.get("completed_at") } : {}),
    ...(map.get("failure_detail") ? { failure_detail: map.get("failure_detail") } : {}),
    ...(map.get("stop_reason") ? { stop_reason: map.get("stop_reason") } : {}),
  };
}

export function upsertFtcOwnedFilingDeliveryNotes(
  notes: string | null | undefined,
  record: FtcOwnedFilingDeliveryRecord
): string {
  const base = (notes ?? "").trim();
  const without =
    base.indexOf(DELIVERY_BLOCK_MARKER) >= 0
      ? base.slice(0, base.indexOf(DELIVERY_BLOCK_MARKER)).trimEnd()
      : base;
  const lines = [
    DELIVERY_BLOCK_MARKER,
    `delivery_state: ${record.delivery_state}`,
    `provider: ${record.provider}`,
  ];
  if (record.confirmation) lines.push(`confirmation: ${record.confirmation}`);
  if (record.started_at) lines.push(`started_at: ${record.started_at}`);
  if (record.completed_at) lines.push(`completed_at: ${record.completed_at}`);
  if (record.failure_detail) lines.push(`failure_detail: ${record.failure_detail}`);
  if (record.stop_reason) lines.push(`stop_reason: ${record.stop_reason}`);
  const next = [without, lines.join("\n")].filter(Boolean).join("\n\n");
  return next.length <= MAX_NOTES ? next : next.slice(0, MAX_NOTES);
}

/** Task-notes helpers for chat status (queued / submitting / failed while task remains open). */
export function isFtcOwnedFilingSubmitting(task: JusticeCaseTaskRow | undefined): boolean {
  if (!task || task.completed_at?.trim()) return false;
  return parseFtcOwnedFilingDeliveryRecord(task.notes)?.delivery_state === "submitting";
}

export function isFtcOwnedFilingFailed(task: JusticeCaseTaskRow | undefined): boolean {
  if (!task || task.completed_at?.trim()) return false;
  return parseFtcOwnedFilingDeliveryRecord(task.notes)?.delivery_state === "failed";
}

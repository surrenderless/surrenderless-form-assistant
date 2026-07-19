const MAX_NOTES = 8000;

/** Note-marker field recording that an operator alert was durably delivered for a fallback event. */
export const OPERATOR_ALERT_SENT_FIELD = "operator_alert_sent";

/**
 * Exactly-once key for a single fallback event: task id + delivery idempotency key + stop_reason.
 * A new distinct stop_reason (e.g. a later stale reclaim) is a new alertable event; a replay of the
 * same event resolves to the same key and is suppressed.
 */
export function operatorFallbackAlertKey(
  taskId: string,
  idempotencyKey: string,
  stopReason: string | null | undefined
): string {
  const reason = (stopReason ?? "").trim() || "failed";
  return `${taskId.trim()}|${idempotencyKey.trim()}|${reason}`;
}

/** All alert keys already recorded on a task's notes. */
export function parseOperatorAlertSentKeys(notes: string | null | undefined): Set<string> {
  const out = new Set<string>();
  for (const rawLine of (notes ?? "").split("\n")) {
    const line = rawLine.trim();
    if (line.startsWith(`${OPERATOR_ALERT_SENT_FIELD}:`)) {
      const value = line.slice(OPERATOR_ALERT_SENT_FIELD.length + 1).trim();
      if (value) out.add(value);
    }
  }
  return out;
}

export function hasOperatorAlertBeenSent(
  notes: string | null | undefined,
  key: string
): boolean {
  return parseOperatorAlertSentKeys(notes).has(key.trim());
}

/**
 * Appends the durable exactly-once alert marker. Idempotent: re-appending an existing key is a
 * no-op. The marker is appended (never prepended) so it does not disturb the leading queue marker
 * or the trailing owned-filing delivery block that other parsers rely on.
 */
export function appendOperatorAlertSentMarker(
  notes: string | null | undefined,
  key: string,
  sentAtIso: string
): string {
  const base = notes ?? "";
  const trimmedKey = key.trim();
  if (parseOperatorAlertSentKeys(base).has(trimmedKey)) return base;
  const next = [
    base.replace(/\s+$/, ""),
    `${OPERATOR_ALERT_SENT_FIELD}: ${trimmedKey}`,
    `${OPERATOR_ALERT_SENT_FIELD}_at: ${sentAtIso}`,
  ]
    .filter(Boolean)
    .join("\n");
  return next.length <= MAX_NOTES ? next : next.slice(0, MAX_NOTES);
}

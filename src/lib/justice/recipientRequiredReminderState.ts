const MAX_NOTES = 8000;

/**
 * Note-marker field recording that the one-time recipient-required consumer reminder was durably
 * sent for a merchant-contact/demand-letter filing task. Appended to the SAME task row that
 * `operatorFallbackAlertState`'s marker is also appended to over the task's lifetime — a distinct
 * field name keeps the two exactly-once mechanisms from ever being confused with one another.
 */
export const RECIPIENT_REQUIRED_REMINDER_SENT_FIELD = "recipient_required_reminder_sent";

/** Exactly-once key for a single task's reminder — a task can only ever earn one reminder. */
export function recipientRequiredReminderKey(taskId: string): string {
  return taskId.trim();
}

/** All reminder keys already recorded on a task's notes. */
export function parseRecipientRequiredReminderSentKeys(notes: string | null | undefined): Set<string> {
  const out = new Set<string>();
  for (const rawLine of (notes ?? "").split("\n")) {
    const line = rawLine.trim();
    if (line.startsWith(`${RECIPIENT_REQUIRED_REMINDER_SENT_FIELD}:`)) {
      const value = line.slice(RECIPIENT_REQUIRED_REMINDER_SENT_FIELD.length + 1).trim();
      if (value) out.add(value);
    }
  }
  return out;
}

export function hasRecipientRequiredReminderBeenSent(
  notes: string | null | undefined,
  taskId: string
): boolean {
  return parseRecipientRequiredReminderSentKeys(notes).has(recipientRequiredReminderKey(taskId));
}

/**
 * Appends the durable exactly-once reminder marker. Idempotent: re-appending an existing key is a
 * no-op. The marker is appended (never prepended) so it does not disturb the leading queue marker
 * or any other marker (e.g. operator alert) another reconciler appends to this same task.
 */
export function appendRecipientRequiredReminderSentMarker(
  notes: string | null | undefined,
  taskId: string,
  sentAtIso: string
): string {
  const base = notes ?? "";
  const key = recipientRequiredReminderKey(taskId);
  if (parseRecipientRequiredReminderSentKeys(base).has(key)) return base;
  const next = [
    base.replace(/\s+$/, ""),
    `${RECIPIENT_REQUIRED_REMINDER_SENT_FIELD}: ${key}`,
    `${RECIPIENT_REQUIRED_REMINDER_SENT_FIELD}_at: ${sentAtIso}`,
  ]
    .filter(Boolean)
    .join("\n");
  return next.length <= MAX_NOTES ? next : next.slice(0, MAX_NOTES);
}

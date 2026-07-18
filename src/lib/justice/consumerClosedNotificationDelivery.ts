import type { SupabaseClient } from "@supabase/supabase-js";
import {
  consumerClosedNotificationTaskNotesMarker,
  taskNotesMatchConsumerClosedNotificationMarker,
} from "@/lib/justice/reconcileClosedCaseConsumerNotifications";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";
import { appendCaseTimelineEntry } from "@/server/justiceTimelineAppend";

const TASK_SELECT =
  "id, user_id, case_id, title, due_date, notes, completed_at, created_at, updated_at" as const;
const MAX_NOTES = 8000;

const DELIVERY_STATE_FIELD = "delivery_state";
const DELIVERY_UPDATED_FIELD = "delivery_updated_at";
const FALLBACK_FIELD = "manual_fallback_required";
const PROVIDER_MESSAGE_ID_FIELD = "provider_message_id";
const IDEMPOTENCY_KEY_FIELD = "idempotency_key";

export type ConsumerClosedNotificationDeliveryState =
  | "accepted"
  | "delivered"
  | "bounced"
  | "complained";

export type ResendDeliveryEventType = "email.delivered" | "email.bounced" | "email.complained";

const EVENT_TO_STATE: Record<ResendDeliveryEventType, ConsumerClosedNotificationDeliveryState> = {
  "email.delivered": "delivered",
  "email.bounced": "bounced",
  "email.complained": "complained",
};

/** Monotonic precedence: negative (fallback) states win over delivered/accepted and never downgrade. */
const STATE_RANK: Record<ConsumerClosedNotificationDeliveryState, number> = {
  accepted: 0,
  delivered: 1,
  bounced: 2,
  complained: 2,
};

function isFallbackState(
  state: ConsumerClosedNotificationDeliveryState
): state is "bounced" | "complained" {
  return state === "bounced" || state === "complained";
}

function clampLen(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max);
}

function parseMarkerField(notes: string | null | undefined, key: string): string | null {
  const trimmed = notes ?? "";
  for (const rawLine of trimmed.split("\n")) {
    const line = rawLine.trim();
    if (line.startsWith(`${key}:`)) {
      return line.slice(key.length + 1).trim();
    }
  }
  return null;
}

/** Replaces the `key: ...` line in note text, or appends it. Never touches the marker line. */
function upsertMarkerField(notes: string, key: string, value: string): string {
  const lines = notes.split("\n");
  let replaced = false;
  const next = lines.map((rawLine) => {
    if (!replaced && rawLine.trim().startsWith(`${key}:`)) {
      replaced = true;
      return `${key}: ${value}`;
    }
    return rawLine;
  });
  if (!replaced) next.push(`${key}: ${value}`);
  return next.join("\n");
}

export function parseConsumerClosedNotificationDeliveryState(
  notes: string | null | undefined
): ConsumerClosedNotificationDeliveryState {
  const value = parseMarkerField(notes, DELIVERY_STATE_FIELD);
  if (value === "delivered" || value === "bounced" || value === "complained") return value;
  return "accepted";
}

export function consumerClosedNotificationDeliveryTimelineId(
  messageId: string,
  state: ConsumerClosedNotificationDeliveryState
): string {
  return `consumer_closed_delivery:${messageId.trim()}:${state}`;
}

export type RecordConsumerClosedNotificationDeliveryResult =
  | { status: "confirmed"; caseId: string; state: "delivered" }
  | { status: "fallback"; caseId: string; state: "bounced" | "complained" }
  | { status: "ignored_unknown" }
  | {
      status: "ignored_duplicate";
      caseId: string;
      state: ConsumerClosedNotificationDeliveryState;
    }
  | { status: "error"; reason: string };

async function findClosureMarkerTask(
  supabase: SupabaseClient,
  params: { messageId?: string; idempotencyKey?: string }
): Promise<JusticeCaseTaskRow | null | "error"> {
  const messageId = params.messageId?.trim() ?? "";
  const idempotencyKey = params.idempotencyKey?.trim() ?? "";
  const needle = messageId || idempotencyKey;
  if (!needle) return null;
  const field = messageId ? PROVIDER_MESSAGE_ID_FIELD : IDEMPOTENCY_KEY_FIELD;

  const { data, error } = await supabase
    .from("justice_case_tasks")
    .select(TASK_SELECT)
    // Coarse filter; `_` is a LIKE wildcard so this only over-matches — exact line check below.
    .like("notes", `%${needle}%`)
    .limit(25);

  if (error) {
    console.warn("consumer closed delivery: find marker", error.message);
    return "error";
  }

  const rows = (data ?? []) as JusticeCaseTaskRow[];
  const match = rows.find((row) => {
    const caseId = row.case_id?.trim() ?? "";
    if (!caseId || !taskNotesMatchConsumerClosedNotificationMarker(row.notes, caseId)) return false;
    return parseMarkerField(row.notes, field) === needle;
  });
  return match ?? null;
}

/**
 * Durably records a Resend delivery-status event onto the closure-notification marker.
 * Idempotent: replays and stale/out-of-order events are no-ops (state never downgrades).
 * Bounced/complained flip the marker into an operator manual-fallback state and, because
 * the notified marker is preserved, the reconcile cron never re-emails the bad address.
 */
export async function recordConsumerClosedNotificationDeliveryEvent(
  supabase: SupabaseClient,
  params: { messageId?: string; idempotencyKey?: string; eventType: ResendDeliveryEventType }
): Promise<RecordConsumerClosedNotificationDeliveryResult> {
  const task = await findClosureMarkerTask(supabase, params);
  if (task === "error") return { status: "error", reason: "marker_lookup_failed" };
  if (!task) return { status: "ignored_unknown" };

  const caseId = task.case_id.trim();
  const userId = task.user_id.trim();
  const currentState = parseConsumerClosedNotificationDeliveryState(task.notes);
  const targetState = EVENT_TO_STATE[params.eventType];

  if (STATE_RANK[targetState] <= STATE_RANK[currentState]) {
    return { status: "ignored_duplicate", caseId, state: currentState };
  }

  const nowIso = new Date().toISOString();
  let notes = task.notes ?? consumerClosedNotificationTaskNotesMarker(caseId);
  notes = upsertMarkerField(notes, DELIVERY_STATE_FIELD, targetState);
  notes = upsertMarkerField(notes, DELIVERY_UPDATED_FIELD, nowIso);
  if (isFallbackState(targetState)) {
    notes = upsertMarkerField(notes, FALLBACK_FIELD, "true");
  }

  const { error: updateErr } = await supabase
    .from("justice_case_tasks")
    .update({ notes: clampLen(notes, MAX_NOTES) })
    .eq("id", task.id)
    .eq("user_id", userId);

  if (updateErr) {
    console.warn("consumer closed delivery: update marker", updateErr.message);
    return { status: "error", reason: "marker_update_failed" };
  }

  const messageId = params.messageId?.trim() || params.idempotencyKey?.trim() || task.id;
  if (isFallbackState(targetState)) {
    await appendCaseTimelineEntry(supabase, userId, caseId, {
      id: consumerClosedNotificationDeliveryTimelineId(messageId, targetState),
      type: "outcome_recorded",
      label:
        targetState === "complained"
          ? "Closed-case notification marked as spam — manual follow-up required"
          : "Closed-case notification bounced — manual follow-up required",
      detail: "Automatic email suppressed; operator should reach the consumer another way.",
      ts: nowIso,
    });
    return { status: "fallback", caseId, state: targetState };
  }

  await appendCaseTimelineEntry(supabase, userId, caseId, {
    id: consumerClosedNotificationDeliveryTimelineId(messageId, targetState),
    type: "outcome_recorded",
    label: "Closed-case notification delivered",
    detail: "Consumer email delivery confirmed by the provider.",
    ts: nowIso,
  });
  return { status: "confirmed", caseId, state: "delivered" };
}

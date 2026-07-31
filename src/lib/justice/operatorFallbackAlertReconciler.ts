import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveMerchantOutreachEmailProvider } from "@/lib/email/resolveMerchantOutreachEmailProvider";
import { resolveOperatorAlertEmail } from "@/lib/email/operatorAlertEmailEnv";
import {
  BBB_OWNED_FILING_DELIVERY_BLOCK_MARKER,
  bbbOwnedFilingIdempotencyKey,
  parseBbbOwnedFilingDeliveryRecord,
} from "@/lib/justice/bbbOwnedFilingDeliveryState";
import { taskNotesMatchBbbFilingMarker } from "@/lib/justice/bbbFilingTask";
import {
  FTC_OWNED_FILING_DELIVERY_BLOCK_MARKER,
  ftcOwnedFilingIdempotencyKey,
  parseFtcOwnedFilingDeliveryRecord,
} from "@/lib/justice/ftcOwnedFilingDeliveryState";
import { taskNotesMatchFtcFilingMarker } from "@/lib/justice/ftcFilingTask";
import { taskNotesMatchCfpbFilingMarker } from "@/lib/justice/cfpbFilingTask";
import { taskNotesMatchDemandLetterFilingMarker } from "@/lib/justice/demandLetterFilingTask";
import { taskNotesMatchDotFilingMarker } from "@/lib/justice/dotFilingTask";
import { taskNotesMatchFccFilingMarker } from "@/lib/justice/fccFilingTask";
import { taskNotesMatchMerchantContactFilingMarker } from "@/lib/justice/merchantContactFilingTask";
import { taskNotesMatchPaymentDisputeFilingMarker } from "@/lib/justice/paymentDisputeFilingTask";
import { taskNotesMatchStateAgFilingMarker } from "@/lib/justice/stateAgFilingTask";
import {
  appendOperatorAlertSentMarker,
  hasOperatorAlertBeenSent,
  operatorFallbackAlertKey,
} from "@/lib/justice/operatorFallbackAlertState";
import {
  applyKeysetCursor,
  nextKeysetCursor,
  type KeysetCursor,
} from "@/lib/justice/reconcilerKeysetPagination";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";
import { appendCaseTimelineEntry } from "@/server/justiceTimelineAppend";

const TASK_SELECT =
  "id, user_id, case_id, title, due_date, notes, completed_at, created_at, updated_at" as const;
const MAX_NOTES = 8000;
const OPERATOR_WORKSPACE_PATH = "/operator/fulfillment";

function clampLen(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max);
}

type OwnedFilingKind = "bbb" | "ftc";

/** All 9 owned escalation destinations — the ordinary (non-automated-fallback) queue alert covers all of them. */
type AllDestinationKind =
  | OwnedFilingKind
  | "merchant_contact"
  | "state_ag"
  | "demand_letter"
  | "cfpb"
  | "payment_dispute"
  | "fcc"
  | "dot";

type OwnedDeliveryRecord = {
  delivery_state: "queued" | "submitting" | "failed" | "filed";
  provider: string;
  confirmation?: string;
  started_at?: string;
  completed_at?: string;
  failure_detail?: string;
  stop_reason?: string;
};

type AlertDestination = {
  kind: OwnedFilingKind;
  deliveryMarker: string;
  destinationLabel: string;
  parseRecord: (notes: string | null | undefined) => OwnedDeliveryRecord | null;
  idempotencyKey: (caseId: string) => string;
  taskMarkerMatches: (notes: string | null | undefined, caseId: string) => boolean;
};

const DESTINATIONS: AlertDestination[] = [
  {
    kind: "bbb",
    deliveryMarker: BBB_OWNED_FILING_DELIVERY_BLOCK_MARKER,
    destinationLabel: "Better Business Bureau",
    parseRecord: parseBbbOwnedFilingDeliveryRecord,
    idempotencyKey: bbbOwnedFilingIdempotencyKey,
    taskMarkerMatches: taskNotesMatchBbbFilingMarker,
  },
  {
    kind: "ftc",
    deliveryMarker: FTC_OWNED_FILING_DELIVERY_BLOCK_MARKER,
    destinationLabel: "FTC (consumer complaint)",
    parseRecord: parseFtcOwnedFilingDeliveryRecord,
    idempotencyKey: ftcOwnedFilingIdempotencyKey,
    taskMarkerMatches: taskNotesMatchFtcFilingMarker,
  },
];

type QueueAlertDestination = {
  kind: AllDestinationKind;
  destinationLabel: string;
  taskMarkerMatches: (notes: string | null | undefined, caseId: string) => boolean;
};

/**
 * All 9 owned escalation destinations, for the ordinary-queue alert. BBB/FTC markers match
 * regardless of whether an owned-filing delivery block is present — the caller excludes tasks
 * that have one, since those are either being (or were) handled by the automated pipeline and
 * are covered by DESTINATIONS above instead.
 */
const QUEUE_ALERT_DESTINATIONS: QueueAlertDestination[] = [
  {
    kind: "bbb",
    destinationLabel: "Better Business Bureau",
    taskMarkerMatches: taskNotesMatchBbbFilingMarker,
  },
  {
    kind: "ftc",
    destinationLabel: "FTC (consumer complaint)",
    taskMarkerMatches: taskNotesMatchFtcFilingMarker,
  },
  {
    kind: "merchant_contact",
    destinationLabel: "Merchant contact",
    taskMarkerMatches: taskNotesMatchMerchantContactFilingMarker,
  },
  {
    kind: "state_ag",
    destinationLabel: "State Attorney General (consumer)",
    taskMarkerMatches: taskNotesMatchStateAgFilingMarker,
  },
  {
    kind: "demand_letter",
    destinationLabel: "Small claims / demand letter",
    taskMarkerMatches: taskNotesMatchDemandLetterFilingMarker,
  },
  {
    kind: "cfpb",
    destinationLabel: "CFPB",
    taskMarkerMatches: taskNotesMatchCfpbFilingMarker,
  },
  {
    kind: "payment_dispute",
    destinationLabel: "Payment dispute (bank/card)",
    taskMarkerMatches: taskNotesMatchPaymentDisputeFilingMarker,
  },
  {
    kind: "fcc",
    destinationLabel: "FCC",
    taskMarkerMatches: taskNotesMatchFccFilingMarker,
  },
  {
    kind: "dot",
    destinationLabel: "USDOT / aviation consumer",
    taskMarkerMatches: taskNotesMatchDotFilingMarker,
  },
];

/** Stand-in "stop_reason"/failure-reason for the ordinary (non-automated-fallback) queue alert. */
const QUEUE_ALERT_REASON = "awaiting_operator_fulfillment";
const QUEUE_ALERT_FAILURE_TEXT =
  "No automated filing was attempted — this is an ordinary operator-fulfilled destination awaiting action.";
/** Distinguishes queue-alert idempotency keys from automated-fallback-alert keys on the same task. */
const QUEUE_ALERT_KEY_NAMESPACE = "operator-queue";

export function resolveOperatorWorkspaceUrl(caseId: string): string {
  const trimmedCase = caseId.trim();
  const query = trimmedCase ? `?case=${encodeURIComponent(trimmedCase)}` : "";
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (appUrl) return `${appUrl.replace(/\/$/, "")}${OPERATOR_WORKSPACE_PATH}${query}`;
  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) {
    const host = vercel.replace(/^https?:\/\//i, "").replace(/\/$/, "");
    if (host) return `https://${host}${OPERATOR_WORKSPACE_PATH}${query}`;
  }
  return `${OPERATOR_WORKSPACE_PATH}${query}`;
}

function formatAgeMs(ageMs: number): string {
  if (!Number.isFinite(ageMs) || ageMs < 0) return "unknown";
  const minutes = Math.floor(ageMs / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  if (hours < 24) return `${hours}h ${remMinutes}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

export function buildOperatorFallbackAlertSubject(
  cfg: Pick<AlertDestination, "destinationLabel">,
  caseId: string
): string {
  return `[Surrenderless] Manual filing needed — ${cfg.destinationLabel} (case ${caseId})`;
}

export function buildOperatorFallbackAlertBody(params: {
  destinationLabel: string;
  caseId: string;
  taskTitle: string;
  failureReason: string;
  ageLabel: string;
  workspaceUrl: string;
}): string {
  return [
    "An automated owned filing fell back to manual operator fulfillment and needs attention.",
    "",
    `Destination: ${params.destinationLabel}`,
    `Case ID: ${params.caseId}`,
    `Task: ${params.taskTitle}`,
    `Failure reason: ${params.failureReason}`,
    `Task age: ${params.ageLabel}`,
    "",
    "Open the operator workspace to complete this filing:",
    params.workspaceUrl,
    "",
    "— Surrenderless automated alerting",
  ].join("\n");
}

export type OperatorFallbackAlertResultKind = "sent" | "skipped" | "failed";

export type OperatorFallbackAlertResult = {
  case_id: string;
  user_id: string | null;
  kind: AllDestinationKind;
  task_id: string;
  result: OperatorFallbackAlertResultKind;
  stop_reason?: string;
  reason?: string;
};

export type ReconcileOperatorFallbackAlertsSummary = {
  scanned: number;
  attempted: number;
  sent: number;
  skipped: number;
  failed: number;
  results: OperatorFallbackAlertResult[];
};

function emptySummary(): ReconcileOperatorFallbackAlertsSummary {
  return { scanned: 0, attempted: 0, sent: 0, skipped: 0, failed: 0, results: [] };
}

export type ReconcileOperatorFallbackAlertsOptions = {
  limit?: number;
  nowMs?: number;
};

/**
 * Durable proactive operator alerting, in two phases sharing the same recipient resolution,
 * email provider, exactly-once marker mechanism, and case timeline audit trail:
 *
 * 1. Owned BBB/FTC filings that fell back to manual fulfillment (worker/provider failure,
 *    uncertain submission, execute-time config failure, or a stale queued/submitting reclaim —
 *    all converge to `delivery_state: "failed"`).
 * 2. Ordinary open operator-fulfillment work across all 9 escalation destinations that never had
 *    an automated filing attempted at all — i.e. every case in the default product mode (owned
 *    BBB/FTC autofill off, or any of the other 7 destinations, which have no automated path).
 *    Without this phase, a case can sit in "awaiting Surrenderless operator fulfillment"
 *    indefinitely with nothing ever alerting anyone, since phase 1 only fires for tasks that
 *    carry an owned-filing delivery block.
 *
 * Both phases email a configurable OPERATOR_ALERT_EMAIL through the existing Resend
 * infrastructure exactly once per alertable event (per task, per phase — a task can only ever
 * match one phase, since phase 2 explicitly excludes any task carrying an owned-filing delivery
 * block). Fails safe: when the provider or recipient is unconfigured nothing is marked delivered;
 * provider/database failures leave the event retryable on the next run. Never alerts for
 * successfully filed or completed tasks. Off all consumer request paths (cron only).
 */
export async function reconcileOperatorFallbackAlerts(
  supabase: SupabaseClient,
  options: ReconcileOperatorFallbackAlertsOptions = {}
): Promise<ReconcileOperatorFallbackAlertsSummary> {
  const summary = emptySummary();
  const limit = options.limit ?? 100;
  const nowMs = options.nowMs ?? Date.now();

  const recipient = resolveOperatorAlertEmail();
  if (!recipient) {
    // Fail safe: no recipient configured — send nothing, mark nothing, retry next run.
    console.warn("operator fallback alert: OPERATOR_ALERT_EMAIL unavailable");
    return summary;
  }

  const providerResolved = resolveMerchantOutreachEmailProvider();
  if (!providerResolved.ok) {
    console.warn("operator fallback alert: email provider unavailable", providerResolved.reason);
    return summary;
  }

  for (const cfg of DESTINATIONS) {
    let destCursor: KeysetCursor = null;

    for (;;) {
      const { data, error } = await applyKeysetCursor(
        supabase
          .from("justice_case_tasks")
          .select(TASK_SELECT)
          .is("completed_at", null)
          .like("notes", `%${cfg.deliveryMarker}%`),
        destCursor
      ).limit(limit);

      if (error) {
        console.warn(`operator fallback alert (${cfg.kind}): list tasks`, error.message);
        break;
      }

      const tasks = (data ?? []) as JusticeCaseTaskRow[];
      for (const task of tasks) {
        summary.scanned += 1;
        const caseId = task.case_id?.trim() ?? "";
        const userId = task.user_id?.trim() ?? "";
        const record = cfg.parseRecord(task.notes);

        // Only alert for genuine manual-fallback events: an open (never completed) task whose
        // owned-filing delivery is failed. Filed/queued/submitting and completed tasks are excluded.
        if (!caseId || !userId || !record || record.delivery_state !== "failed") continue;
        if (!cfg.taskMarkerMatches(task.notes, caseId)) continue;

        const stopReason = record.stop_reason ?? "";
        const key = operatorFallbackAlertKey(task.id, cfg.idempotencyKey(caseId), stopReason);

        if (hasOperatorAlertBeenSent(task.notes, key)) {
          summary.results.push({
            case_id: caseId,
            user_id: userId,
            kind: cfg.kind,
            task_id: task.id,
            result: "skipped",
            stop_reason: stopReason || undefined,
            reason: "already_alerted",
          });
          summary.skipped += 1;
          continue;
        }

        summary.attempted += 1;

        const createdAtMs = task.created_at ? Date.parse(task.created_at) : NaN;
        const ageLabel = Number.isFinite(createdAtMs)
          ? formatAgeMs(nowMs - createdAtMs)
          : "unknown";
        const failureReason = [
          stopReason || "failed",
          record.failure_detail ? `— ${record.failure_detail}` : "",
        ]
          .filter(Boolean)
          .join(" ");

        try {
          const sendResult = await providerResolved.provider.send({
            from: providerResolved.from,
            to: recipient,
            subject: buildOperatorFallbackAlertSubject(cfg, caseId),
            text: buildOperatorFallbackAlertBody({
              destinationLabel: cfg.destinationLabel,
              caseId,
              taskTitle: task.title?.trim() || `${cfg.destinationLabel} filing`,
              failureReason,
              ageLabel,
              workspaceUrl: resolveOperatorWorkspaceUrl(caseId),
            }),
            // Per task + stop_reason: retries never duplicate the email even before the marker lands.
            idempotencyKey: `operator-fallback-alert:${task.id}:${stopReason || "failed"}`,
          });

          if (!sendResult.ok) {
            summary.results.push({
              case_id: caseId,
              user_id: userId,
              kind: cfg.kind,
              task_id: task.id,
              result: "failed",
              stop_reason: stopReason || undefined,
              reason: sendResult.error,
            });
            summary.failed += 1;
            continue;
          }

          // Persist the durable exactly-once marker ONLY after an accepted send.
          const sentAt = new Date(nowMs).toISOString();
          const nextNotes = appendOperatorAlertSentMarker(task.notes, key, sentAt);
          const { error: updateErr } = await supabase
            .from("justice_case_tasks")
            .update({ notes: clampLen(nextNotes, MAX_NOTES) })
            .eq("id", task.id)
            .eq("user_id", userId);

          if (updateErr) {
            // Provider idempotency key prevents a duplicate email on the retry next run.
            console.warn(`operator fallback alert (${cfg.kind}): mark sent`, updateErr.message);
            summary.results.push({
              case_id: caseId,
              user_id: userId,
              kind: cfg.kind,
              task_id: task.id,
              result: "failed",
              stop_reason: stopReason || undefined,
              reason: "marker_write_failed",
            });
            summary.failed += 1;
            continue;
          }

          await appendCaseTimelineEntry(supabase, userId, caseId, {
            id: `operator_fallback_alert:${task.id}:${stopReason || "failed"}`,
            type: "outcome_recorded",
            label: `Operator alerted — manual ${cfg.destinationLabel} filing needed`,
            detail: failureReason,
            ts: sentAt,
          });

          summary.results.push({
            case_id: caseId,
            user_id: userId,
            kind: cfg.kind,
            task_id: task.id,
            result: "sent",
            stop_reason: stopReason || undefined,
          });
          summary.sent += 1;
        } catch (err) {
          console.warn(`operator fallback alert (${cfg.kind}): process task`, task.id, err);
          summary.results.push({
            case_id: caseId,
            user_id: userId,
            kind: cfg.kind,
            task_id: task.id,
            result: "failed",
            stop_reason: stopReason || undefined,
            reason: "exception",
          });
          summary.failed += 1;
        }
      }

      if (tasks.length < limit) break;
      destCursor = nextKeysetCursor(tasks);
    }
  }

  // Phase 2: ordinary open operator-fulfillment work, no automated delivery ever attempted.
  // Paginated in stable (created_at, id) order so every open task in the system is eventually
  // reached as volume grows — a single capped query would let old, already-processed tasks
  // permanently occupy the page and starve newer alertable tasks from ever being scanned.
  const pageSize = limit;
  let pageOffset = 0;
  for (;;) {
    const { data: page, error: pageErr } = await supabase
      .from("justice_case_tasks")
      .select(TASK_SELECT)
      .is("completed_at", null)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(pageOffset, pageOffset + pageSize - 1);

    if (pageErr) {
      console.warn("operator fallback alert (queue): list open tasks", pageErr.message);
      break;
    }

    const rows = (page ?? []) as JusticeCaseTaskRow[];

    for (const task of rows) {
      const caseId = task.case_id?.trim() ?? "";
      const userId = task.user_id?.trim() ?? "";
      if (!caseId || !userId) continue;

      // Any task carrying an owned-filing delivery block (queued/submitting/filed/failed) is
      // either actively automated or already covered by phase 1 above — never double-alert it.
      const hasOwnedDeliveryBlock =
        (task.notes ?? "").includes(BBB_OWNED_FILING_DELIVERY_BLOCK_MARKER) ||
        (task.notes ?? "").includes(FTC_OWNED_FILING_DELIVERY_BLOCK_MARKER);
      if (hasOwnedDeliveryBlock) continue;

      const cfg = QUEUE_ALERT_DESTINATIONS.find((d) => d.taskMarkerMatches(task.notes, caseId));
      if (!cfg) continue;

      summary.scanned += 1;

      const key = operatorFallbackAlertKey(task.id, QUEUE_ALERT_KEY_NAMESPACE, cfg.kind);
      if (hasOperatorAlertBeenSent(task.notes, key)) {
        summary.results.push({
          case_id: caseId,
          user_id: userId,
          kind: cfg.kind,
          task_id: task.id,
          result: "skipped",
          stop_reason: QUEUE_ALERT_REASON,
          reason: "already_alerted",
        });
        summary.skipped += 1;
        continue;
      }

      summary.attempted += 1;

      const createdAtMs = task.created_at ? Date.parse(task.created_at) : NaN;
      const ageLabel = Number.isFinite(createdAtMs) ? formatAgeMs(nowMs - createdAtMs) : "unknown";

      try {
        const sendResult = await providerResolved.provider.send({
          from: providerResolved.from,
          to: recipient,
          subject: buildOperatorFallbackAlertSubject(cfg, caseId),
          text: buildOperatorFallbackAlertBody({
            destinationLabel: cfg.destinationLabel,
            caseId,
            taskTitle: task.title?.trim() || `${cfg.destinationLabel} filing`,
            failureReason: QUEUE_ALERT_FAILURE_TEXT,
            ageLabel,
            workspaceUrl: resolveOperatorWorkspaceUrl(caseId),
          }),
          // Per task + destination: retries never duplicate the email even before the marker lands.
          idempotencyKey: `${QUEUE_ALERT_KEY_NAMESPACE}-alert:${task.id}:${cfg.kind}`,
        });

        if (!sendResult.ok) {
          summary.results.push({
            case_id: caseId,
            user_id: userId,
            kind: cfg.kind,
            task_id: task.id,
            result: "failed",
            stop_reason: QUEUE_ALERT_REASON,
            reason: sendResult.error,
          });
          summary.failed += 1;
          continue;
        }

        // Persist the durable exactly-once marker ONLY after an accepted send.
        const sentAt = new Date(nowMs).toISOString();
        const nextNotes = appendOperatorAlertSentMarker(task.notes, key, sentAt);
        const { error: updateErr } = await supabase
          .from("justice_case_tasks")
          .update({ notes: clampLen(nextNotes, MAX_NOTES) })
          .eq("id", task.id)
          .eq("user_id", userId);

        if (updateErr) {
          // Provider idempotency key prevents a duplicate email on the retry next run.
          console.warn("operator fallback alert (queue): mark sent", updateErr.message);
          summary.results.push({
            case_id: caseId,
            user_id: userId,
            kind: cfg.kind,
            task_id: task.id,
            result: "failed",
            stop_reason: QUEUE_ALERT_REASON,
            reason: "marker_write_failed",
          });
          summary.failed += 1;
          continue;
        }

        await appendCaseTimelineEntry(supabase, userId, caseId, {
          id: `operator_queue_alert:${task.id}:${cfg.kind}`,
          type: "outcome_recorded",
          label: `Operator alerted — ${cfg.destinationLabel} filing awaiting fulfillment`,
          detail: QUEUE_ALERT_FAILURE_TEXT,
          ts: sentAt,
        });

        summary.results.push({
          case_id: caseId,
          user_id: userId,
          kind: cfg.kind,
          task_id: task.id,
          result: "sent",
          stop_reason: QUEUE_ALERT_REASON,
        });
        summary.sent += 1;
      } catch (err) {
        console.warn("operator fallback alert (queue): process task", task.id, err);
        summary.results.push({
          case_id: caseId,
          user_id: userId,
          kind: cfg.kind,
          task_id: task.id,
          result: "failed",
          stop_reason: QUEUE_ALERT_REASON,
          reason: "exception",
        });
        summary.failed += 1;
      }
    }

    if (rows.length < pageSize) break;
    pageOffset += pageSize;
  }

  return summary;
}

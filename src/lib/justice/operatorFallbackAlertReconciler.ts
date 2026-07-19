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
import {
  appendOperatorAlertSentMarker,
  hasOperatorAlertBeenSent,
  operatorFallbackAlertKey,
} from "@/lib/justice/operatorFallbackAlertState";
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
  cfg: AlertDestination,
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
  kind: OwnedFilingKind;
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
 * Durable proactive operator alerting for owned BBB/FTC filings that fell back to manual
 * fulfillment (worker/provider failure, uncertain submission, execute-time config failure, or a
 * stale queued/submitting reclaim — all converge to `delivery_state: "failed"`). Emails a
 * configurable OPERATOR_ALERT_EMAIL through the existing Resend infrastructure exactly once per
 * fallback event. Fails safe: when the provider or recipient is unconfigured nothing is marked
 * delivered; provider/database failures leave the event retryable on the next run. Never alerts
 * for successfully filed or completed tasks. Off all consumer request paths (cron only).
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
    const { data, error } = await supabase
      .from("justice_case_tasks")
      .select(TASK_SELECT)
      .is("completed_at", null)
      .like("notes", `%${cfg.deliveryMarker}%`)
      .limit(limit);

    if (error) {
      console.warn(`operator fallback alert (${cfg.kind}): list tasks`, error.message);
      continue;
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
  }

  return summary;
}

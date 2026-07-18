import type { SupabaseClient } from "@supabase/supabase-js";
import {
  findBbbFilingWithConfirmation,
  taskNotesMatchBbbFilingMarker,
} from "@/lib/justice/bbbFilingTask";
import { completeBbbOperatorFiling } from "@/lib/justice/completeBbbOperatorFiling";
import {
  BBB_OWNED_FILING_DELIVERY_BLOCK_MARKER,
  bbbOwnedFilingTimelineId,
  parseBbbOwnedFilingDeliveryRecord,
  upsertBbbOwnedFilingDeliveryNotes,
} from "@/lib/justice/bbbOwnedFilingDeliveryState";
import {
  findFtcFilingWithConfirmation,
  taskNotesMatchFtcFilingMarker,
} from "@/lib/justice/ftcFilingTask";
import { completeFtcOperatorFiling } from "@/lib/justice/completeFtcOperatorFiling";
import {
  FTC_OWNED_FILING_DELIVERY_BLOCK_MARKER,
  ftcOwnedFilingTimelineId,
  parseFtcOwnedFilingDeliveryRecord,
  upsertFtcOwnedFilingDeliveryNotes,
} from "@/lib/justice/ftcOwnedFilingDeliveryState";
import type { JusticeCaseFilingRow } from "@/lib/justice/filings";
import {
  canonicalFilingDestinationForApprovedActionHref,
  MANUAL_ACTION_TRACKING_REAL_BBB_PREP_HREF,
  MANUAL_ACTION_TRACKING_REAL_FTC_PREP_HREF,
} from "@/lib/justice/handlingTrackingProgress";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";
import { appendCaseTimelineEntry } from "@/server/justiceTimelineAppend";

const TASK_SELECT =
  "id, user_id, case_id, title, due_date, notes, completed_at, created_at, updated_at" as const;

const FILING_SELECT =
  "id, user_id, case_id, destination, filed_at, confirmation_number, filing_url, notes, created_at, updated_at" as const;

/** Env override for the stale-submitting reclaim window (milliseconds). */
export const OWNED_FILING_STALE_SUBMITTING_TIMEOUT_ENV = "OWNED_FILING_STALE_SUBMITTING_TIMEOUT_MS";

/**
 * Default reclaim window. Comfortably longer than the 300s synchronous owned-submit cap
 * (`BBB_OWNED_AUTOFILL_ROUTE_MAX_DURATION_SECONDS`) so an in-flight submission is never reclaimed.
 */
export const OWNED_FILING_STALE_SUBMITTING_DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;

/** Resolves the reclaim timeout from env, falling back to the production-safe default. */
export function resolveStaleSubmittingTimeoutMs(
  env: Record<string, string | undefined> = process.env
): number {
  const raw = env[OWNED_FILING_STALE_SUBMITTING_TIMEOUT_ENV]?.trim();
  if (raw) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return OWNED_FILING_STALE_SUBMITTING_DEFAULT_TIMEOUT_MS;
}

type OwnedDeliveryRecord = {
  delivery_state: "queued" | "submitting" | "failed" | "filed";
  provider: string;
  confirmation?: string;
  started_at?: string;
  completed_at?: string;
  failure_detail?: string;
  stop_reason?: string;
};

type OperatorFilingResult = { ok: true } | { ok: false; error: string; status: number };

type StaleReconcilerDestination = {
  kind: "bbb" | "ftc";
  deliveryMarker: string;
  approvedActionHref: string;
  destinationFallback: string;
  failedLabel: string;
  filedLabel: string;
  parseRecord: (notes: string | null | undefined) => OwnedDeliveryRecord | null;
  upsertNotes: (notes: string | null | undefined, record: OwnedDeliveryRecord) => string;
  timelineId: (caseId: string, state: "submitting" | "failed" | "filed") => string;
  taskMarkerMatches: (notes: string | null | undefined, caseId: string) => boolean;
  findFilingWithConfirmation: (
    filings: JusticeCaseFilingRow[]
  ) => JusticeCaseFilingRow | undefined;
  completeOperatorFiling: (
    supabase: SupabaseClient,
    userId: string,
    input: {
      caseId: string;
      taskId: string;
      destination: string;
      filedAt: string;
      confirmationNumber: string;
      notes?: string | null;
    }
  ) => Promise<OperatorFilingResult>;
};

const BBB_DESTINATION: StaleReconcilerDestination = {
  kind: "bbb",
  deliveryMarker: BBB_OWNED_FILING_DELIVERY_BLOCK_MARKER,
  approvedActionHref: MANUAL_ACTION_TRACKING_REAL_BBB_PREP_HREF,
  destinationFallback: "Better Business Bureau",
  failedLabel: "BBB filing failed",
  filedLabel: "BBB filing filed",
  parseRecord: parseBbbOwnedFilingDeliveryRecord,
  upsertNotes: upsertBbbOwnedFilingDeliveryNotes,
  timelineId: bbbOwnedFilingTimelineId,
  taskMarkerMatches: taskNotesMatchBbbFilingMarker,
  findFilingWithConfirmation: findBbbFilingWithConfirmation,
  completeOperatorFiling: completeBbbOperatorFiling,
};

const FTC_DESTINATION: StaleReconcilerDestination = {
  kind: "ftc",
  deliveryMarker: FTC_OWNED_FILING_DELIVERY_BLOCK_MARKER,
  approvedActionHref: MANUAL_ACTION_TRACKING_REAL_FTC_PREP_HREF,
  destinationFallback: "FTC (consumer complaint)",
  failedLabel: "FTC filing failed",
  filedLabel: "FTC filing filed",
  parseRecord: parseFtcOwnedFilingDeliveryRecord,
  upsertNotes: upsertFtcOwnedFilingDeliveryNotes,
  timelineId: ftcOwnedFilingTimelineId,
  taskMarkerMatches: taskNotesMatchFtcFilingMarker,
  findFilingWithConfirmation: findFtcFilingWithConfirmation,
  completeOperatorFiling: completeFtcOperatorFiling,
};

export type StaleSubmittingReconcileOutcome =
  | "finalized_filed"
  | "sent_to_operator"
  | "ignored_not_stale"
  | "skipped"
  | "error";

export type StaleSubmittingReconcileResult = {
  case_id: string;
  user_id: string;
  kind: "bbb" | "ftc";
  outcome: StaleSubmittingReconcileOutcome;
  detail?: string;
};

export type ReconcileStaleSubmittingOwnedFilingsSummary = {
  scanned: number;
  stale: number;
  finalized_filed: number;
  sent_to_operator: number;
  ignored: number;
  skipped: number;
  errors: number;
  results: StaleSubmittingReconcileResult[];
};

export type ReconcileStaleSubmittingOwnedFilingsOptions = {
  limit?: number;
  nowMs?: number;
  timeoutMs?: number;
};

type Counters = {
  scanned: number;
  stale: number;
  finalized_filed: number;
  sent_to_operator: number;
  ignored: number;
  skipped: number;
  errors: number;
};

function isStaleSubmitting(
  record: OwnedDeliveryRecord,
  nowMs: number,
  timeoutMs: number
): boolean {
  if (record.delivery_state !== "submitting") return false;
  const started = record.started_at ? Date.parse(record.started_at) : NaN;
  // Unknown/unparseable start time means we cannot bound its age — reclaim it.
  if (!Number.isFinite(started)) return true;
  return nowMs - started >= timeoutMs;
}

async function patchTaskNotes(
  supabase: SupabaseClient,
  userId: string,
  taskId: string,
  notes: string
): Promise<JusticeCaseTaskRow | null> {
  const { data, error } = await supabase
    .from("justice_case_tasks")
    .update({ notes })
    .eq("id", taskId)
    .eq("user_id", userId)
    .select(TASK_SELECT)
    .maybeSingle();
  if (error || !data) {
    console.warn(
      "reconcile stale submitting: patch task notes",
      error?.message ?? "not found"
    );
    return null;
  }
  return data as JusticeCaseTaskRow;
}

async function processDestination(
  supabase: SupabaseClient,
  cfg: StaleReconcilerDestination,
  nowMs: number,
  timeoutMs: number,
  limit: number,
  results: StaleSubmittingReconcileResult[],
  counters: Counters
): Promise<void> {
  const { data: taskRows, error } = await supabase
    .from("justice_case_tasks")
    .select(TASK_SELECT)
    .is("completed_at", null)
    .like("notes", `%${cfg.deliveryMarker}%`)
    .limit(limit);

  if (error) {
    console.warn(`reconcile stale submitting (${cfg.kind}): list tasks`, error.message);
    return;
  }

  const tasks = (taskRows ?? []) as JusticeCaseTaskRow[];

  for (const task of tasks) {
    counters.scanned += 1;
    const caseId = task.case_id?.trim() ?? "";
    const userId = task.user_id?.trim() ?? "";
    const record = cfg.parseRecord(task.notes);

    if (!caseId || !userId || !record || !cfg.taskMarkerMatches(task.notes, caseId)) {
      results.push({
        case_id: caseId,
        user_id: userId,
        kind: cfg.kind,
        outcome: "skipped",
        detail: "invalid task or delivery record",
      });
      counters.skipped += 1;
      continue;
    }

    if (record.delivery_state !== "submitting") {
      results.push({
        case_id: caseId,
        user_id: userId,
        kind: cfg.kind,
        outcome: "skipped",
        detail: `delivery_state ${record.delivery_state}`,
      });
      counters.skipped += 1;
      continue;
    }

    if (!isStaleSubmitting(record, nowMs, timeoutMs)) {
      results.push({
        case_id: caseId,
        user_id: userId,
        kind: cfg.kind,
        outcome: "ignored_not_stale",
      });
      counters.ignored += 1;
      continue;
    }

    counters.stale += 1;

    const { data: filingRows, error: filingsErr } = await supabase
      .from("justice_case_filings")
      .select(FILING_SELECT)
      .eq("case_id", caseId)
      .eq("user_id", userId);

    if (filingsErr) {
      // Cannot determine whether the submission actually landed — leave it submitting for a later run.
      console.warn(
        `reconcile stale submitting (${cfg.kind}): list filings`,
        filingsErr.message
      );
      results.push({
        case_id: caseId,
        user_id: userId,
        kind: cfg.kind,
        outcome: "error",
        detail: "could not list filings",
      });
      counters.errors += 1;
      continue;
    }

    const filings = (filingRows ?? []) as JusticeCaseFilingRow[];
    const confirmed = cfg.findFilingWithConfirmation(filings);

    if (confirmed) {
      const confirmationNumber = confirmed.confirmation_number?.trim() || "";
      const destination =
        canonicalFilingDestinationForApprovedActionHref(cfg.approvedActionHref) ??
        confirmed.destination?.trim() ??
        cfg.destinationFallback;
      const filedAt =
        confirmed.filed_at?.trim() || new Date(nowMs).toISOString().slice(0, 10);

      const complete = await cfg.completeOperatorFiling(supabase, userId, {
        caseId,
        taskId: task.id,
        destination,
        filedAt,
        confirmationNumber,
        notes: [
          `provider: ${record.provider}`,
          "delivery_state: filed",
          `confirmation: ${confirmationNumber}`,
          "reclaimed_by: stale_submitting_reconciler",
          `completed_at: ${new Date(nowMs).toISOString()}`,
        ].join("\n"),
      });

      if (!complete.ok) {
        // Leave submitting so a later run can retry rather than lose the confirmed filing.
        results.push({
          case_id: caseId,
          user_id: userId,
          kind: cfg.kind,
          outcome: "error",
          detail: complete.error,
        });
        counters.errors += 1;
        continue;
      }

      const filedRecord: OwnedDeliveryRecord = {
        delivery_state: "filed",
        provider: record.provider,
        confirmation: confirmationNumber || record.confirmation,
        ...(record.started_at ? { started_at: record.started_at } : {}),
        completed_at: new Date(nowMs).toISOString(),
      };
      await patchTaskNotes(supabase, userId, task.id, cfg.upsertNotes(task.notes, filedRecord));
      await appendCaseTimelineEntry(supabase, userId, caseId, {
        id: cfg.timelineId(caseId, "filed"),
        type: "filing_recorded",
        label: cfg.filedLabel,
        detail: `reclaimed stale submitting → filed\nconfirmation: ${confirmationNumber}`,
        ts: new Date(nowMs).toISOString(),
      });

      results.push({
        case_id: caseId,
        user_id: userId,
        kind: cfg.kind,
        outcome: "finalized_filed",
        detail: confirmationNumber || undefined,
      });
      counters.finalized_filed += 1;
      continue;
    }

    const failedAt = new Date(nowMs).toISOString();
    const failedRecord: OwnedDeliveryRecord = {
      delivery_state: "failed",
      provider: record.provider,
      ...(record.started_at ? { started_at: record.started_at } : {}),
      completed_at: failedAt,
      failure_detail:
        "Automated submission did not confirm within the stale-submitting window; reclaimed by reconciler — operator/manual fallback".slice(
          0,
          500
        ),
      stop_reason: "stale_submitting_reclaimed",
    };

    const patched = await patchTaskNotes(
      supabase,
      userId,
      task.id,
      cfg.upsertNotes(task.notes, failedRecord)
    );
    if (!patched) {
      results.push({
        case_id: caseId,
        user_id: userId,
        kind: cfg.kind,
        outcome: "error",
        detail: "could not patch task notes",
      });
      counters.errors += 1;
      continue;
    }

    await appendCaseTimelineEntry(supabase, userId, caseId, {
      id: cfg.timelineId(caseId, "failed"),
      type: "filing_recorded",
      label: cfg.failedLabel,
      detail: failedRecord.failure_detail,
      ts: failedAt,
    });

    results.push({
      case_id: caseId,
      user_id: userId,
      kind: cfg.kind,
      outcome: "sent_to_operator",
    });
    counters.sent_to_operator += 1;
  }
}

/**
 * Reclaims owned BBB/FTC filing tasks stuck in `delivery_state: "submitting"` past a safe timeout
 * (a submission process that died mid-flight). Never blindly re-submits: if a confirmed filing
 * already exists the delivery is finalized as filed and the task completed idempotently; otherwise
 * the delivery is transitioned to failed, a submit-failed timeline event is appended, and the task
 * is left open so it surfaces to the operator queue and chat switches to the operator-fallback state.
 */
export async function reconcileStaleSubmittingOwnedFilings(
  supabase: SupabaseClient,
  options: ReconcileStaleSubmittingOwnedFilingsOptions = {}
): Promise<ReconcileStaleSubmittingOwnedFilingsSummary> {
  const limit = options.limit ?? 100;
  const nowMs = options.nowMs ?? Date.now();
  const timeoutMs = options.timeoutMs ?? resolveStaleSubmittingTimeoutMs();

  const results: StaleSubmittingReconcileResult[] = [];
  const counters: Counters = {
    scanned: 0,
    stale: 0,
    finalized_filed: 0,
    sent_to_operator: 0,
    ignored: 0,
    skipped: 0,
    errors: 0,
  };

  for (const cfg of [BBB_DESTINATION, FTC_DESTINATION]) {
    await processDestination(supabase, cfg, nowMs, timeoutMs, limit, results, counters);
  }

  return { ...counters, results };
}

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
  FCC_OWNED_FILING_DELIVERY_BLOCK_MARKER,
  fccOwnedFilingIdempotencyKey,
  parseFccOwnedFilingDeliveryRecord,
} from "@/lib/justice/fccOwnedFilingDeliveryState";
import { taskNotesMatchCfpbFilingMarker } from "@/lib/justice/cfpbFilingTask";
import { taskNotesMatchDemandLetterFilingMarker } from "@/lib/justice/demandLetterFilingTask";
import { taskNotesMatchDotFilingMarker } from "@/lib/justice/dotFilingTask";
import { taskNotesMatchFccFilingMarker } from "@/lib/justice/fccFilingTask";
import { taskNotesMatchMerchantContactFilingMarker } from "@/lib/justice/merchantContactFilingTask";
import { taskNotesMatchPaymentDisputeFilingMarker } from "@/lib/justice/paymentDisputeFilingTask";
import { taskNotesMatchStateAgFilingMarker } from "@/lib/justice/stateAgFilingTask";
import { taskNotesMatchFollowUpResponseReviewMarker } from "@/lib/justice/followUpResponseReviewTask";
import { taskNotesMatchOrphanedPaidCaseApprovalMarker } from "@/lib/justice/orphanedPaidCaseApprovalTask";
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

type OwnedFilingKind = "bbb" | "ftc" | "fcc";

/**
 * All 11 destinations the ordinary (non-automated-fallback) queue alert covers: the 9 owned
 * escalation filing/contact destinations; follow_up_response_review — the operator's own
 * resolved/no_resolution/further_escalation decision task, not a filing at all, but just as
 * capable of silently stalling a case forever if nothing ever re-alerts on it; and
 * orphaned_paid_case_approval — a paid case whose approval could not be automatically finalized
 * (see reconcileOrphanedPaidCaseApprovals.ts) and needs a human to pick the right action, reusing
 * this same alerting mechanism rather than a separate one-shot notice.
 */
type AllDestinationKind =
  | OwnedFilingKind
  | "merchant_contact"
  | "state_ag"
  | "demand_letter"
  | "cfpb"
  | "payment_dispute"
  | "fcc"
  | "dot"
  | "follow_up_response_review"
  | "orphaned_paid_case_approval";

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
  {
    kind: "fcc",
    deliveryMarker: FCC_OWNED_FILING_DELIVERY_BLOCK_MARKER,
    destinationLabel: "FCC",
    parseRecord: parseFccOwnedFilingDeliveryRecord,
    idempotencyKey: fccOwnedFilingIdempotencyKey,
    taskMarkerMatches: taskNotesMatchFccFilingMarker,
  },
];

type QueueAlertDestination = {
  kind: AllDestinationKind;
  destinationLabel: string;
  taskMarkerMatches: (notes: string | null | undefined, caseId: string) => boolean;
  /**
   * Overrides "filing" in the alert subject ("Manual filing needed — ..."). Only follow_up_response_review
   * sets this — it isn't a filing, so calling it one would misdescribe what the operator needs to do.
   */
  subjectActionNoun?: string;
  /** Overrides QUEUE_ALERT_FAILURE_TEXT's "no automated filing was attempted" framing. */
  reasonText?: string;
  /** Overrides "${destinationLabel} filing awaiting fulfillment" in the case timeline entry label. */
  timelineAwaitingLabel?: string;
};

/**
 * All 11 destinations the ordinary-queue alert covers (see AllDestinationKind). BBB/FTC markers
 * match regardless of whether an owned-filing delivery block is present — the caller excludes
 * tasks that have one, since those are either being (or were) handled by the automated pipeline
 * and are covered by DESTINATIONS above instead.
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
  {
    kind: "follow_up_response_review",
    destinationLabel: "Follow-up response review",
    taskMarkerMatches: taskNotesMatchFollowUpResponseReviewMarker,
    subjectActionNoun: "review",
    reasonText:
      "No automated resolution decision is possible — this case is awaiting an operator's response-review outcome (resolved, no resolution, or further escalation).",
    timelineAwaitingLabel: "Follow-up response review awaiting an operator decision",
  },
  {
    kind: "orphaned_paid_case_approval",
    destinationLabel: "Paid case approval review",
    taskMarkerMatches: taskNotesMatchOrphanedPaidCaseApprovalMarker,
    subjectActionNoun: "approval review",
    reasonText:
      "This case was paid but Surrenderless could not automatically determine and finalize which action to approve — an operator must review the case and approve the correct action manually.",
    timelineAwaitingLabel: "Paid case awaiting manual approval review",
  },
];

/** Stand-in "stop_reason"/failure-reason for the ordinary (non-automated-fallback) queue alert. */
const QUEUE_ALERT_REASON = "awaiting_operator_fulfillment";
const QUEUE_ALERT_FAILURE_TEXT =
  "No automated filing was attempted — this is an ordinary operator-fulfilled destination awaiting action.";
/** Distinguishes queue-alert idempotency keys from automated-fallback-alert keys on the same task. */
const QUEUE_ALERT_KEY_NAMESPACE = "operator-queue";

/** Escalation tiers for the ordinary (non-automated-fallback) queue alert, keyed by task age. */
type QueueAlertTierKey = "immediate" | "24h" | "72h";

type QueueAlertTier = {
  key: QueueAlertTierKey;
  thresholdMs: number;
  /**
   * Idempotency-key namespace slot passed to operatorFallbackAlertKey. "immediate" reuses the
   * original pre-escalation namespace unchanged so alerts already marked sent in production stay
   * deduped exactly as before; the escalation tiers use distinct namespaces so each tier gets its
   * own durable exactly-once key on the same task.
   */
  keyNamespace: string;
  subjectPrefix: string;
  reasonSuffix: string;
};

const QUEUE_ALERT_TIERS: readonly QueueAlertTier[] = [
  { key: "immediate", thresholdMs: 0, keyNamespace: QUEUE_ALERT_KEY_NAMESPACE, subjectPrefix: "", reasonSuffix: "" },
  {
    key: "24h",
    thresholdMs: 24 * 60 * 60 * 1000,
    keyNamespace: `${QUEUE_ALERT_KEY_NAMESPACE}-24h`,
    subjectPrefix: "ESCALATION (24h): ",
    reasonSuffix: " This task has been awaiting operator fulfillment for over 24 hours.",
  },
  {
    key: "72h",
    thresholdMs: 72 * 60 * 60 * 1000,
    keyNamespace: `${QUEUE_ALERT_KEY_NAMESPACE}-72h`,
    subjectPrefix: "ESCALATION (72h): ",
    reasonSuffix: " This task has been awaiting operator fulfillment for over 72 hours — urgent.",
  },
];

/**
 * Picks the single escalation tier due for a task right now, or null when nothing new is due.
 *
 * Compares the highest tier already marked sent against the highest tier whose age threshold has
 * been crossed. Only ever returns the single highest due-and-unsent tier — so a task first
 * scanned when already older than 72h fires just the 72h alert, never a burst of immediate + 24h
 * + 72h together — and once a higher tier has been sent, an earlier/lower tier is never returned
 * again for that task, even if it was never individually marked sent.
 */
function resolveDueQueueAlertTier(
  notes: string | null | undefined,
  taskId: string,
  destinationKind: AllDestinationKind,
  ageMs: number
): { tier: QueueAlertTierKey; key: string; subjectPrefix: string; reasonSuffix: string } | null {
  let highestSentIndex = -1;
  for (let i = 0; i < QUEUE_ALERT_TIERS.length; i++) {
    const candidateKey = operatorFallbackAlertKey(taskId, QUEUE_ALERT_TIERS[i].keyNamespace, destinationKind);
    if (hasOperatorAlertBeenSent(notes, candidateKey)) highestSentIndex = i;
  }
  let dueIndex = 0;
  for (let i = 0; i < QUEUE_ALERT_TIERS.length; i++) {
    if (ageMs >= QUEUE_ALERT_TIERS[i].thresholdMs) dueIndex = i;
  }
  if (dueIndex <= highestSentIndex) return null;
  const tier = QUEUE_ALERT_TIERS[dueIndex];
  return {
    tier: tier.key,
    key: operatorFallbackAlertKey(taskId, tier.keyNamespace, destinationKind),
    subjectPrefix: tier.subjectPrefix,
    reasonSuffix: tier.reasonSuffix,
  };
}

/**
 * Interval between recurring overdue reminders once the fixed 72h tier has already fired — same
 * width as the 72h boundary itself, so the cadence continues cleanly with no gap: 144h, 216h,
 * 288h, ... with no upper bound, for as long as the task stays open and its case isn't archived.
 */
const QUEUE_ALERT_RECURRING_INTERVAL_MS = 72 * 60 * 60 * 1000;
const QUEUE_ALERT_RECURRING_NAMESPACE = `${QUEUE_ALERT_KEY_NAMESPACE}-recurring`;

/** Short id embedded in provider idempotency keys and timeline entry ids for a recurring reminder. */
function queueRecurringReminderOccasionId(reminderNumber: number): string {
  return `recurring-${reminderNumber}`;
}

/**
 * Once the fixed 72h tier has been sent, computes which (if any) recurring overdue reminder is
 * due right now — numbered 1, 2, 3, ... at 144h, 216h, 288h, ... forever. `reminderNumber` is a
 * pure function of `ageMs` alone (not of wall-clock send time), so repeated or concurrent
 * reconciler runs observing the same task at the same age always compute the identical reminder
 * number and therefore the identical durable key. That determinism is what makes duplicate
 * delivery preventable at all — but the actual prevention, exactly like the fixed tiers, is not an
 * application-level lock: two runs that both read this task before either has written its marker
 * will both call the provider's send() with that identical key, and rely entirely on the email
 * provider's own idempotency-key contract to collapse those into one delivered message (exercised,
 * not merely assumed, by the forced-concurrency coverage in operatorFallbackAlertReconciler.test.ts
 * and the Resend-forwarding coverage in resendEmailProvider.test.ts). The durable notes marker
 * only prevents a *later, non-overlapping* run from re-alerting an already-recorded event.
 *
 * Mirrors resolveDueQueueAlertTier's "only the single highest due-and-unsent" rule: a task that
 * hasn't been scanned in a while (e.g. the reconciler was paused) jumps straight to whichever
 * reminder number is due right now rather than bursting every backlogged one. A reminder whose
 * send previously failed (so no marker was written) remains eligible and is retried exactly like
 * the fixed tiers — a failed attempt never counts as "sent" for this or any later window.
 */
function resolveDueQueueRecurringReminder(
  notes: string | null | undefined,
  taskId: string,
  destinationKind: AllDestinationKind,
  ageMs: number
): { reminderNumber: number; key: string } | null {
  const dueReminderNumber = Math.floor(ageMs / QUEUE_ALERT_RECURRING_INTERVAL_MS) - 1;
  if (dueReminderNumber < 1) return null;
  const key = operatorFallbackAlertKey(
    taskId,
    `${QUEUE_ALERT_RECURRING_NAMESPACE}-${dueReminderNumber}`,
    destinationKind
  );
  if (hasOperatorAlertBeenSent(notes, key)) return null;
  return { reminderNumber: dueReminderNumber, key };
}

type ResolvedQueueAlert = {
  /** "immediate" | "24h" | "72h" | "recurring-<N>" — embedded in idempotency/timeline ids. */
  occasionId: string;
  key: string;
  subjectPrefix: string;
  reasonSuffix: string;
};

function queueAlertOccasionHumanLabel(occasionId: string): string {
  if (occasionId.startsWith("recurring-")) {
    return `overdue reminder #${occasionId.slice("recurring-".length)}`;
  }
  return `${occasionId} escalation`;
}

/**
 * Single entry point for "what, if anything, should fire for this task right now": tries the
 * fixed immediate/24h/72h tiers first (unchanged), then falls back to the open-ended recurring
 * reminder once 72h has already fired. There is deliberately no cutoff on the recurring branch —
 * the caller is responsible for excluding tasks that are no longer genuinely open (completed,
 * cancelled, or their case archived/resolved) before ever reaching this function.
 */
function resolveDueQueueAlertOrReminder(
  notes: string | null | undefined,
  taskId: string,
  destinationKind: AllDestinationKind,
  ageMs: number
): ResolvedQueueAlert | null {
  const fixedDue = resolveDueQueueAlertTier(notes, taskId, destinationKind, ageMs);
  if (fixedDue) {
    return {
      occasionId: fixedDue.tier,
      key: fixedDue.key,
      subjectPrefix: fixedDue.subjectPrefix,
      reasonSuffix: fixedDue.reasonSuffix,
    };
  }
  const recurring = resolveDueQueueRecurringReminder(notes, taskId, destinationKind, ageMs);
  if (!recurring) return null;
  return {
    occasionId: queueRecurringReminderOccasionId(recurring.reminderNumber),
    key: recurring.key,
    subjectPrefix: `ESCALATION (overdue reminder #${recurring.reminderNumber}): `,
    reasonSuffix: ` This task has been awaiting operator fulfillment for over 72 hours and remains open — overdue reminder #${recurring.reminderNumber}.`,
  };
}

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
  caseId: string,
  actionNoun: string = "filing"
): string {
  return `[Surrenderless] Manual ${actionNoun} needed — ${cfg.destinationLabel} (case ${caseId})`;
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
 * Durable proactive operator alerting, in two phases sharing the same recipient resolution, email
 * provider, durable sent-marker mechanism, and case timeline audit trail:
 *
 * 1. Owned BBB/FTC/FCC filings that fell back to manual fulfillment (worker/provider failure,
 *    uncertain submission, execute-time config failure, or a stale queued/submitting reclaim —
 *    all converge to `delivery_state: "failed"`). FCC has no live execution path yet (dry-run
 *    only), so this phase currently never actually fires for FCC in production — it exists so
 *    the wiring is ready once a real harness lands.
 * 2. Ordinary open operator-fulfillment work across all 11 QUEUE_ALERT_DESTINATIONS: the 9
 *    escalation filing/contact destinations that never had an automated filing attempted at all
 *    (every case in the default product mode — owned BBB/FTC/FCC autofill off, or any of the
 *    other 6 destinations, which have no automated path) — plus follow_up_response_review, the
 *    operator's own resolved/no_resolution/further_escalation decision task, and
 *    orphaned_paid_case_approval, a paid case whose approval could not be auto-finalized. Neither
 *    is a filing, but both stall a case just as permanently if nothing ever re-alerts on them.
 *    Escalates immediate -> 24h -> 72h, then keeps re-alerting every further 72h indefinitely
 *    (numbered "overdue reminder #1", #2, ...) for as long as the task remains genuinely open —
 *    there is no cutoff after which a stalled task goes silent. Stops the moment the task is
 *    completed/cancelled (both close it via `completed_at`, checked at the query level) or its
 *    case is explicitly archived (checked per page against `justice_cases.archived_at`). Archiving
 *    is a separate, later, explicit operator action (operatorOwnedCaseArchive.ts) — not itself the
 *    resolution signal, and a case can sit "resolved" (client_state.approved_next_action.outcome_note
 *    carries OPERATOR_RESOLVED_OUTCOME_MARKER, set only by completeFollowUpResponseReview.ts) for a
 *    real, possibly long-lived stretch before an operator confirms the archive. That gap does not
 *    reach this alerter, though: a resolved outcome_note (or the follow_up_needed write that leads
 *    to one) can only ever be persisted once none of the 9 alert-eligible destinations still has an
 *    open task — enforced, for every write path, by rejectPrematureResolutionClientStatePatch's use
 *    of hasPendingHumanFulfillmentEscalation (escalationLadderResolution.ts), wired unconditionally
 *    into the sole client_state-writing route (src/app/api/justice/cases/[id]/route.ts). So a
 *    resolved-but-unarchived case can never retain an open task this alerter would still be firing
 *    on — verified per-destination, not assumed.
 *
 * Both phases email a configurable OPERATOR_ALERT_EMAIL through the existing Resend
 * infrastructure, intending one delivered email per alertable event (per task, per phase, per
 * occasion — a task can only ever match one phase, since phase 2 explicitly excludes any task
 * carrying an owned-filing delivery block). Fails safe: when the provider or recipient is
 * unconfigured nothing is marked delivered; provider/database failures leave the event retryable
 * on the next run — a failed send never marks its window sent, so it is retried (not skipped) the
 * next time this runs. Never alerts for successfully filed, completed, or (phase 2) archived-case
 * tasks. Off all consumer request paths (cron only).
 *
 * IMPORTANT: within a single reconciler run, each window is attempted at most once per task
 * (the durable notes marker prevents this run from re-attempting a window it already recorded
 * sent, and a later run from re-attempting one recorded by an earlier run). Across two runs that
 * genuinely overlap in time, though, there is no application-level lock — both can independently
 * observe "not yet sent" and both will call the provider's send() with the identical deterministic
 * idempotency key for that window. Collapsing that into a single delivered email is Resend's own
 * idempotency-key contract, not something this code enforces itself — see the forced-concurrency
 * tests in operatorFallbackAlertReconciler.test.ts and the forwarding proof in
 * resendEmailProvider.test.ts.
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
            // Deterministic per task + stop_reason, so a retry (or a genuinely concurrent run)
            // reuses this identical key — Resend's idempotency-key contract, not anything this
            // code enforces itself, is what collapses repeats into one delivered email.
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
            // The marker write failed, but the idempotency key above is unchanged on retry — a
            // duplicate delivered email on the next run is prevented by Resend's own idempotency
            // contract, not by anything this application does after the fact.
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

    // Batch-fetch archived_at for every case referenced on this page (one query per page, not
    // per task) so a resolved/archived case's leftover open task never gets a queue alert or
    // recurring reminder — the case is done, and further pestering serves no one. A case_id with
    // no matching row is treated as not-archived (fail toward the existing alerting behavior for
    // that genuinely-unexpected situation, rather than silently suppressing alerts for it).
    const pageCaseIds = Array.from(
      new Set(rows.map((t) => t.case_id?.trim()).filter((id): id is string => Boolean(id)))
    );
    let archivedCaseIds: ReadonlySet<string> = new Set();
    if (pageCaseIds.length > 0) {
      const { data: caseRows, error: caseErr } = await supabase
        .from("justice_cases")
        .select("id, archived_at")
        .in("id", pageCaseIds);
      if (caseErr) {
        console.warn("operator fallback alert (queue): list cases for archive check", caseErr.message);
        break;
      }
      archivedCaseIds = new Set(
        ((caseRows ?? []) as { id: string; archived_at: string | null }[])
          .filter((c) => c.archived_at?.trim())
          .map((c) => c.id)
      );
    }

    for (const task of rows) {
      const caseId = task.case_id?.trim() ?? "";
      const userId = task.user_id?.trim() ?? "";
      if (!caseId || !userId) continue;

      if (archivedCaseIds.has(caseId)) {
        // Only count/report this as a skip if the task would otherwise have been alertable at
        // all (matches one of the 11 QUEUE_ALERT_DESTINATIONS) — an archived case's unrelated open task (e.g.
        // a plain personal reminder) was never going to be scanned or alerted either way.
        const cfgForArchived = QUEUE_ALERT_DESTINATIONS.find((d) => d.taskMarkerMatches(task.notes, caseId));
        if (cfgForArchived) {
          summary.scanned += 1;
          summary.results.push({
            case_id: caseId,
            user_id: userId,
            kind: cfgForArchived.kind,
            task_id: task.id,
            result: "skipped",
            stop_reason: QUEUE_ALERT_REASON,
            reason: "case_archived",
          });
          summary.skipped += 1;
        }
        continue;
      }

      // Any task carrying an owned-filing delivery block (queued/submitting/filed/failed) is
      // either actively automated or already covered by phase 1 above — never double-alert it.
      const hasOwnedDeliveryBlock =
        (task.notes ?? "").includes(BBB_OWNED_FILING_DELIVERY_BLOCK_MARKER) ||
        (task.notes ?? "").includes(FTC_OWNED_FILING_DELIVERY_BLOCK_MARKER) ||
        (task.notes ?? "").includes(FCC_OWNED_FILING_DELIVERY_BLOCK_MARKER);
      if (hasOwnedDeliveryBlock) continue;

      const cfg = QUEUE_ALERT_DESTINATIONS.find((d) => d.taskMarkerMatches(task.notes, caseId));
      if (!cfg) continue;

      summary.scanned += 1;

      const createdAtMs = task.created_at ? Date.parse(task.created_at) : NaN;
      const ageMs = Number.isFinite(createdAtMs) ? Math.max(0, nowMs - createdAtMs) : 0;
      const ageLabel = Number.isFinite(createdAtMs) ? formatAgeMs(ageMs) : "unknown";

      const due = resolveDueQueueAlertOrReminder(task.notes, task.id, cfg.kind, ageMs);
      if (!due) {
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
      const { occasionId, key, subjectPrefix, reasonSuffix } = due;

      summary.attempted += 1;

      // Immediate keeps its original provider idempotency key unchanged (no production behavior
      // change); escalation tiers and recurring reminders each get their own distinct suffixed
      // key so a resend at a later occasion is never deduped against an earlier one's email.
      const providerIdempotencyKey =
        occasionId === "immediate"
          ? `${QUEUE_ALERT_KEY_NAMESPACE}-alert:${task.id}:${cfg.kind}`
          : `${QUEUE_ALERT_KEY_NAMESPACE}-alert:${task.id}:${cfg.kind}:${occasionId}`;

      try {
        const sendResult = await providerResolved.provider.send({
          from: providerResolved.from,
          to: recipient,
          subject: `${subjectPrefix}${buildOperatorFallbackAlertSubject(cfg, caseId, cfg.subjectActionNoun)}`,
          text: buildOperatorFallbackAlertBody({
            destinationLabel: cfg.destinationLabel,
            caseId,
            taskTitle: task.title?.trim() || `${cfg.destinationLabel} ${cfg.subjectActionNoun ?? "filing"}`,
            failureReason: `${cfg.reasonText ?? QUEUE_ALERT_FAILURE_TEXT}${reasonSuffix}`,
            ageLabel,
            workspaceUrl: resolveOperatorWorkspaceUrl(caseId),
          }),
          // Deterministic per task + destination + occasion, so a retry (or a genuinely
          // concurrent run) reuses this identical key and an earlier occasion never collides with
          // a later one. Collapsing repeats of the same key into one delivered email is Resend's
          // idempotency-key contract, not an application-level lock this code implements itself.
          idempotencyKey: providerIdempotencyKey,
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
          // The marker write failed, but the idempotency key above is unchanged on retry — a
          // duplicate delivered email on the next run is prevented by Resend's own idempotency
          // contract, not by anything this application does after the fact.
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

        const timelineIdSuffix = occasionId === "immediate" ? "" : `:${occasionId}`;
        const timelineLabelSuffix =
          occasionId === "immediate" ? "" : ` (${queueAlertOccasionHumanLabel(occasionId)})`;
        await appendCaseTimelineEntry(supabase, userId, caseId, {
          id: `operator_queue_alert:${task.id}:${cfg.kind}${timelineIdSuffix}`,
          type: "outcome_recorded",
          label: `Operator alerted — ${cfg.timelineAwaitingLabel ?? `${cfg.destinationLabel} filing awaiting fulfillment`}${timelineLabelSuffix}`,
          detail: `${cfg.reasonText ?? QUEUE_ALERT_FAILURE_TEXT}${reasonSuffix}`,
          ts: sentAt,
        });

        summary.results.push({
          case_id: caseId,
          user_id: userId,
          kind: cfg.kind,
          task_id: task.id,
          result: "sent",
          stop_reason: occasionId === "immediate" ? QUEUE_ALERT_REASON : `${QUEUE_ALERT_REASON}_${occasionId}`,
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

import type { SupabaseClient } from "@supabase/supabase-js";
import type { EmailProvider } from "@/lib/email/emailProvider";
import { isValidMerchantOutreachEmailAddress } from "@/lib/email/merchantOutreachEmailEnv";
import { resolveMerchantOutreachEmailProvider } from "@/lib/email/resolveMerchantOutreachEmailProvider";
import { isJusticeIntakePayload } from "@/lib/justice/caseApiValidation";
import { followUpTaskOwnerHref } from "@/lib/justice/followUpCaseTask";
import {
  taskNotesMatchFollowUpResponseReviewMarker,
  taskNotesMatchSupersededLaneReviewMarker,
} from "@/lib/justice/followUpResponseReviewTask";
import { canonicalFilingDestinationForApprovedActionHref } from "@/lib/justice/handlingTrackingProgress";
import {
  applyKeysetCursor,
  nextKeysetCursor,
  type KeysetCursor,
} from "@/lib/justice/reconcilerKeysetPagination";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";
import type { JusticeIntake } from "@/lib/justice/types";
import { appendCaseTimelineEntry } from "@/server/justiceTimelineAppend";

const TASK_SELECT =
  "id, user_id, case_id, title, due_date, notes, completed_at, created_at, updated_at" as const;
const MAX_NOTES = 8000;
const CHAT_PATH = "/justice/chat-ai";

export type ConsumerReviewTaskSourceType = "follow_up_response_review" | "superseded_lane_review";

/**
 * Durable exactly-once marker: one completed marker task per notified SOURCE task id — never
 * per case, since a case can have more than one simultaneously-open review task (one per
 * superseded lane, plus the case-scoped current-lane review) that each need their own
 * independent notification and their own independent idempotency.
 */
export function consumerReviewNotifiedTaskNotesMarker(sourceTaskId: string): string {
  return `consumer_review_notified:${sourceTaskId.trim()}`;
}

export function taskNotesMatchConsumerReviewNotifiedMarker(
  notes: string | null | undefined,
  sourceTaskId: string
): boolean {
  const marker = consumerReviewNotifiedTaskNotesMarker(sourceTaskId);
  const trimmed = notes?.trim() ?? "";
  return trimmed === marker || trimmed.startsWith(`${marker}\n`);
}

/** Provider idempotency key so retries never create a duplicate consumer email. */
export function consumerReviewNotificationEmailIdempotencyKey(sourceTaskId: string): string {
  return `consumer-review-email:${sourceTaskId.trim()}`;
}

function clampLen(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max);
}

/**
 * Deep-links back to the exact source case + review task so a consumer landing on a fresh tab
 * (no sessionStorage) or with a different case already active can still be routed to precisely
 * this review — see resolveReviewTaskDeepLinkAction, which never substitutes "most recent".
 */
function resolveChatUrl(deepLink: { caseId: string; taskId: string }): string {
  const base = (() => {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
    if (appUrl) return `${appUrl.replace(/\/$/, "")}${CHAT_PATH}`;
    const vercel = process.env.VERCEL_URL?.trim();
    if (vercel) {
      const host = vercel.replace(/^https?:\/\//i, "").replace(/\/$/, "");
      if (host) return `https://${host}${CHAT_PATH}`;
    }
    return CHAT_PATH;
  })();
  const params = new URLSearchParams({ case: deepLink.caseId, task: deepLink.taskId });
  return `${base}?${params.toString()}`;
}

export function buildConsumerReviewNeededEmailSubject(
  intake: JusticeIntake,
  laneLabel?: string
): string {
  const company = intake.company_name.trim() || "your case";
  return laneLabel
    ? `Action needed: confirm ${laneLabel}'s status — ${company}`
    : `Action needed: your decision on ${company}`;
}

/**
 * Deliberately never claims a response arrived — this notification exists specifically for the
 * case where no decision has been recorded yet, so it asks the consumer to confirm status rather
 * than reporting one.
 */
export function buildConsumerReviewNeededEmailBody(
  intake: JusticeIntake,
  deepLink: { caseId: string; taskId: string },
  laneLabel?: string
): string {
  const company = intake.company_name.trim() || "your case";
  const name = intake.user_display_name?.trim();
  const statusLine = laneLabel
    ? `We don't yet know whether ${laneLabel} on your case ever received a response — we need you to confirm its status.`
    : "We don't yet know the status of your case's next step — we need you to confirm what happened so far.";
  return [
    `Hi${name ? ` ${name}` : ""},`,
    "",
    statusLine,
    `Company or matter: ${company}`,
    "",
    "No response has been confirmed yet — this is a request for your input, not a status update.",
    "Please review and record what happened in chat:",
    resolveChatUrl(deepLink),
    "",
    "— Surrenderless",
  ].join("\n");
}

export type ConsumerReviewNotificationResultKind = "sent" | "skipped" | "failed";

export type ConsumerReviewNotificationResult = {
  case_id: string;
  user_id: string | null;
  task_id: string;
  source_type: ConsumerReviewTaskSourceType;
  kind: ConsumerReviewNotificationResultKind;
  recipient?: string;
  reason?: string;
};

export type ReconcileConsumerReviewTaskNotificationsSummary = {
  attempted: number;
  sent: number;
  skipped: number;
  failed: number;
  results: ConsumerReviewNotificationResult[];
};

function emptySummary(): ReconcileConsumerReviewTaskNotificationsSummary {
  return { attempted: 0, sent: 0, skipped: 0, failed: 0, results: [] };
}

function resolveConsumerRecipientEmail(intake: JusticeIntake): string | null {
  const candidate = intake.reply_email?.trim() ?? "";
  if (!candidate || !isValidMerchantOutreachEmailAddress(candidate)) return null;
  return candidate.toLowerCase();
}

async function taskHasConsumerReviewNotifiedMarker(
  supabase: SupabaseClient,
  userId: string,
  caseId: string,
  sourceTaskId: string
): Promise<boolean | null> {
  const marker = consumerReviewNotifiedTaskNotesMarker(sourceTaskId);
  const { data, error } = await supabase
    .from("justice_case_tasks")
    .select(TASK_SELECT)
    .eq("user_id", userId)
    .eq("case_id", caseId)
    .like("notes", `${marker}%`)
    .limit(1);

  if (error) {
    console.warn("consumer review notification: select marker", error.message);
    return null;
  }
  const row = (data?.[0] as JusticeCaseTaskRow | undefined) ?? undefined;
  if (!row) return false;
  return taskNotesMatchConsumerReviewNotifiedMarker(row.notes, sourceTaskId);
}

/** Writes the durable exactly-once marker only after an accepted send. */
async function writeConsumerReviewNotifiedMarker(
  supabase: SupabaseClient,
  userId: string,
  caseId: string,
  sourceTaskId: string,
  detail: { recipient: string; messageId: string; sourceType: ConsumerReviewTaskSourceType }
): Promise<boolean> {
  const marker = consumerReviewNotifiedTaskNotesMarker(sourceTaskId);
  const notes = clampLen(
    [
      marker,
      `case_id: ${caseId}`,
      `source_task_id: ${sourceTaskId}`,
      `source_task_type: ${detail.sourceType}`,
      `recipient: ${detail.recipient}`,
      `provider_message_id: ${detail.messageId}`,
      `idempotency_key: ${consumerReviewNotificationEmailIdempotencyKey(sourceTaskId)}`,
      `notified_at: ${new Date().toISOString()}`,
    ].join("\n"),
    MAX_NOTES
  );

  const { data, error } = await supabase
    .from("justice_case_tasks")
    .insert({
      user_id: userId,
      case_id: caseId,
      title: "Consumer review-needed notification sent",
      notes,
      completed_at: new Date().toISOString(),
    })
    .select(TASK_SELECT)
    .single();

  if (error || !data) {
    console.warn("consumer review notification: write marker", error?.message ?? "no row");
    return false;
  }
  return true;
}

/**
 * Writes the same durable exactly-once marker when reply_email can never be resolved to a valid
 * address, so this source task stops being silently re-fetched and re-failed on every future
 * run. Mirrors reconcileClosedCaseConsumerNotifications' unresolvable-recipient handling, keyed
 * by the exact source task id instead of the case id.
 */
async function writeConsumerReviewNotificationUnresolvableMarker(
  supabase: SupabaseClient,
  userId: string,
  caseId: string,
  sourceTaskId: string,
  sourceType: ConsumerReviewTaskSourceType
): Promise<boolean> {
  const marker = consumerReviewNotifiedTaskNotesMarker(sourceTaskId);
  const flaggedAt = new Date().toISOString();
  const notes = clampLen(
    [
      marker,
      `case_id: ${caseId}`,
      `source_task_id: ${sourceTaskId}`,
      `source_task_type: ${sourceType}`,
      `delivery_state: unresolvable`,
      `manual_fallback_required: true`,
      `reason: recipient_unresolved`,
      `flagged_at: ${flaggedAt}`,
    ].join("\n"),
    MAX_NOTES
  );

  const { data, error } = await supabase
    .from("justice_case_tasks")
    .insert({
      user_id: userId,
      case_id: caseId,
      title: "Consumer review-needed notification could not be sent",
      notes,
      completed_at: flaggedAt,
    })
    .select(TASK_SELECT)
    .single();

  if (error || !data) {
    console.warn(
      "consumer review notification: write unresolvable marker",
      error?.message ?? "no row"
    );
    return false;
  }

  await appendCaseTimelineEntry(supabase, userId, caseId, {
    id: `consumer_review_notification_unresolvable:${sourceTaskId}`,
    type: "outcome_recorded",
    label: "Review-needed notification undeliverable — manual follow-up required",
    detail: "No valid reply email on file; operator should reach the consumer another way.",
    ts: flaggedAt,
  });

  return true;
}

type CaseIntakeRow = { id: string; user_id: string; intake: unknown };

const SOURCE_TYPES: ReadonlyArray<{
  type: ConsumerReviewTaskSourceType;
  markerPrefix: string;
  matches: (notes: string | null | undefined, caseId: string) => boolean;
}> = [
  {
    type: "follow_up_response_review",
    markerPrefix: "follow_up_response_review:",
    matches: taskNotesMatchFollowUpResponseReviewMarker,
  },
  {
    type: "superseded_lane_review",
    markerPrefix: "superseded_lane_review:",
    matches: taskNotesMatchSupersededLaneReviewMarker,
  },
];

async function scanSourceType(
  supabase: SupabaseClient,
  provider: EmailProvider,
  from: string,
  source: (typeof SOURCE_TYPES)[number],
  pageSize: number,
  summary: ReconcileConsumerReviewTaskNotificationsSummary
): Promise<void> {
  let cursor: KeysetCursor = null;

  for (;;) {
    let fetchedRows: JusticeCaseTaskRow[];
    try {
      const { data, error } = await applyKeysetCursor(
        supabase
          .from("justice_case_tasks")
          .select(TASK_SELECT)
          .is("completed_at", null)
          .like("notes", `${source.markerPrefix}%`),
        cursor
      ).limit(pageSize);
      if (error) {
        console.warn(`consumer review notification: list ${source.type} tasks`, error.message);
        return;
      }
      fetchedRows = (data ?? []) as JusticeCaseTaskRow[];
    } catch (error) {
      console.warn(`consumer review notification: list ${source.type} tasks`, error);
      return;
    }

    for (const task of fetchedRows) {
      const caseId = task.case_id?.trim() ?? "";
      const userId = task.user_id?.trim() ?? "";
      const taskId = task.id;

      // Defensive re-check: a completed or genuinely non-matching row must never be attempted,
      // even though the query itself already filters for open + prefix-matching rows.
      if (task.completed_at?.trim() || !caseId || !userId || !source.matches(task.notes, caseId)) {
        summary.results.push({
          case_id: caseId,
          user_id: userId || null,
          task_id: taskId,
          source_type: source.type,
          kind: "skipped",
          reason: task.completed_at?.trim() ? "completed" : "malformed",
        });
        summary.skipped += 1;
        continue;
      }

      summary.attempted += 1;

      try {
        const alreadyNotified = await taskHasConsumerReviewNotifiedMarker(
          supabase,
          userId,
          caseId,
          taskId
        );
        if (alreadyNotified === null) {
          summary.results.push({
            case_id: caseId,
            user_id: userId,
            task_id: taskId,
            source_type: source.type,
            kind: "failed",
            reason: "marker_lookup_failed",
          });
          summary.failed += 1;
          continue;
        }
        if (alreadyNotified) {
          summary.results.push({
            case_id: caseId,
            user_id: userId,
            task_id: taskId,
            source_type: source.type,
            kind: "skipped",
            reason: "already_notified",
          });
          summary.skipped += 1;
          continue;
        }

        const { data: caseRow, error: caseErr } = await supabase
          .from("justice_cases")
          .select("id, user_id, intake")
          .eq("id", caseId)
          .eq("user_id", userId)
          .maybeSingle();

        if (caseErr || !caseRow || !isJusticeIntakePayload((caseRow as CaseIntakeRow).intake)) {
          summary.results.push({
            case_id: caseId,
            user_id: userId,
            task_id: taskId,
            source_type: source.type,
            kind: "failed",
            reason: "invalid_intake",
          });
          summary.failed += 1;
          continue;
        }
        const intake = (caseRow as CaseIntakeRow).intake as JusticeIntake;
        const recipient = resolveConsumerRecipientEmail(intake);
        if (!recipient) {
          // Flag once for manual follow-up so this task is not silently re-fetched and
          // re-failed forever — see writeConsumerReviewNotificationUnresolvableMarker.
          await writeConsumerReviewNotificationUnresolvableMarker(
            supabase,
            userId,
            caseId,
            taskId,
            source.type
          );
          summary.results.push({
            case_id: caseId,
            user_id: userId,
            task_id: taskId,
            source_type: source.type,
            kind: "failed",
            reason: "recipient_unresolved",
          });
          summary.failed += 1;
          continue;
        }

        const laneLabel =
          source.type === "superseded_lane_review"
            ? (canonicalFilingDestinationForApprovedActionHref(
                followUpTaskOwnerHref(task.notes) ?? ""
              ) ?? undefined)
            : undefined;

        const sendResult = await provider.send({
          from,
          to: recipient,
          subject: buildConsumerReviewNeededEmailSubject(intake, laneLabel),
          text: buildConsumerReviewNeededEmailBody(intake, { caseId, taskId }, laneLabel),
          idempotencyKey: consumerReviewNotificationEmailIdempotencyKey(taskId),
        });

        if (!sendResult.ok) {
          summary.results.push({
            case_id: caseId,
            user_id: userId,
            task_id: taskId,
            source_type: source.type,
            kind: "failed",
            recipient,
            reason: sendResult.error,
          });
          summary.failed += 1;
          continue;
        }

        // Mark notified ONLY after an accepted send. If this write races/fails, the provider
        // idempotency key still prevents a duplicate email on the next run.
        const marked = await writeConsumerReviewNotifiedMarker(supabase, userId, caseId, taskId, {
          recipient,
          messageId: sendResult.messageId,
          sourceType: source.type,
        });
        if (!marked) {
          summary.results.push({
            case_id: caseId,
            user_id: userId,
            task_id: taskId,
            source_type: source.type,
            kind: "failed",
            recipient,
            reason: "marker_write_failed",
          });
          summary.failed += 1;
          continue;
        }

        summary.results.push({
          case_id: caseId,
          user_id: userId,
          task_id: taskId,
          source_type: source.type,
          kind: "sent",
          recipient,
        });
        summary.sent += 1;
      } catch (error) {
        console.warn("consumer review notification: process task", taskId, error);
        summary.results.push({
          case_id: caseId,
          user_id: userId,
          task_id: taskId,
          source_type: source.type,
          kind: "failed",
          reason: "exception",
        });
        summary.failed += 1;
      }
    }

    if (fetchedRows.length < pageSize) break;
    cursor = nextKeysetCursor(fetchedRows);
  }
}

/**
 * Durable consumer notification for OPEN follow_up_response_review and superseded_lane_review
 * tasks — the two task types that require an explicit consumer decision but have no other
 * channel telling the consumer one is needed. Emails intake.reply_email once per exact source
 * task id (never per case, since more than one review can be open on the same case at once),
 * directing them back to chat. Never claims a response arrived — asks for status/decision.
 * Idempotent via a per-task marker task and the provider idempotency key; each task is
 * processed independently so one failure never stops the batch.
 */
export async function reconcileConsumerReviewTaskNotifications(
  supabase: SupabaseClient,
  options: { limit?: number } = {}
): Promise<ReconcileConsumerReviewTaskNotificationsSummary> {
  const summary = emptySummary();
  const pageSize = options.limit ?? 100;

  const providerResolved = resolveMerchantOutreachEmailProvider();
  if (!providerResolved.ok) {
    // Global config gap: send nothing, write no markers, retry next run.
    console.warn("consumer review notification: email provider unavailable", providerResolved.reason);
    return summary;
  }

  for (const source of SOURCE_TYPES) {
    await scanSourceType(
      supabase,
      providerResolved.provider,
      providerResolved.from,
      source,
      pageSize,
      summary
    );
  }

  return summary;
}

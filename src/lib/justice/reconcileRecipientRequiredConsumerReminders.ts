import type { SupabaseClient } from "@supabase/supabase-js";
import { isValidMerchantOutreachEmailAddress } from "@/lib/email/merchantOutreachEmailEnv";
import { resolveMerchantOutreachEmailProvider } from "@/lib/email/resolveMerchantOutreachEmailProvider";
import { parseJusticeCaseClientState } from "@/lib/justice/approvedNextActionState";
import { isJusticeIntakePayload } from "@/lib/justice/caseApiValidation";
import {
  findOpenDemandLetterFilingTask,
  isApprovedDemandLetterFilingAction,
} from "@/lib/justice/demandLetterFilingTask";
import {
  findOpenMerchantContactFilingTask,
  isApprovedMerchantContactFilingAction,
} from "@/lib/justice/merchantContactFilingTask";
import {
  hasValidMerchantContactRecipient,
  isMerchantContactOperatorFallbackChosen,
} from "@/lib/justice/merchantContactRecipient";
import {
  appendRecipientRequiredReminderSentMarker,
  hasRecipientRequiredReminderBeenSent,
} from "@/lib/justice/recipientRequiredReminderState";
import {
  applyKeysetCursor,
  nextKeysetCursor,
  type KeysetCursor,
} from "@/lib/justice/reconcilerKeysetPagination";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";
import type { JusticeApprovedNextAction, JusticeIntake } from "@/lib/justice/types";

const CASE_SELECT = "id, user_id, intake, client_state, archived_at, updated_at" as const;
const TASK_SELECT =
  "id, user_id, case_id, title, due_date, notes, completed_at, created_at, updated_at" as const;
const MAX_NOTES = 8000;
const CHAT_PATH = "/justice/chat-ai";

/**
 * A consumer gets 24 hours to self-serve (add the company's email, or choose operator fallback)
 * before being emailed — long enough that a quick same-day fix never triggers a needless nudge.
 * The operator side of this same block is already covered by `reconcileOperatorFallbackAlerts`'s
 * own established queue-alert tiers (immediate/24h/72h — see `operatorFallbackAlertReconciler.ts`),
 * which fire independently for any open merchant-contact/demand-letter task regardless of cause,
 * so no separate operator-alert threshold or delivery path is introduced here.
 */
export const RECIPIENT_REQUIRED_CONSUMER_REMINDER_THRESHOLD_MS = 24 * 60 * 60 * 1000;

function clampLen(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max);
}

export type RecipientRequiredLane = "merchant_contact" | "demand_letter";

const LANE_LABEL: Record<RecipientRequiredLane, string> = {
  merchant_contact: "Merchant contact",
  demand_letter: "Small claims / demand letter",
};

/** The blocked lane for this case's live approved_next_action, or null when not applicable. */
export function resolveRecipientRequiredLane(
  next: JusticeApprovedNextAction | undefined
): RecipientRequiredLane | null {
  if (!next || next.status === "completed") return null;
  if (isApprovedMerchantContactFilingAction(next)) return "merchant_contact";
  if (isApprovedDemandLetterFilingAction(next)) return "demand_letter";
  return null;
}

function resolveConsumerRecipientEmail(intake: JusticeIntake): string | null {
  const candidate = intake.reply_email?.trim() ?? "";
  if (!candidate || !isValidMerchantOutreachEmailAddress(candidate)) return null;
  return candidate.toLowerCase();
}

function resolveChatUrl(caseId: string): string {
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
  const params = new URLSearchParams({ case: caseId });
  return `${base}?${params.toString()}`;
}

export function buildRecipientRequiredReminderEmailSubject(intake: JusticeIntake): string {
  const company = intake.company_name.trim() || "your case";
  return `Action needed: add ${company}'s contact email to continue`;
}

/**
 * Deliberately honest: never implies anything has been sent to the company, and always states
 * both ways to unblock it (supply the email, or hand it to operators) since either resolves it.
 */
export function buildRecipientRequiredReminderEmailBody(
  intake: JusticeIntake,
  lane: RecipientRequiredLane,
  caseId: string
): string {
  const company = intake.company_name.trim() || "the company";
  const name = intake.user_display_name?.trim();
  return [
    `Hi${name ? ` ${name}` : ""},`,
    "",
    `Your approved next step — ${LANE_LABEL[lane]} — is ready to go for your case against ${company}, but it still needs the company's contact email before Surrenderless can send it.`,
    "",
    "No message has been sent to the company yet.",
    "",
    "Add the company's contact email in chat, or choose to have Surrenderless operators handle outreach instead:",
    resolveChatUrl(caseId),
    "",
    "— Surrenderless",
  ].join("\n");
}

export type RecipientRequiredReminderResultKind = "sent" | "skipped" | "failed";

export type RecipientRequiredReminderResult = {
  case_id: string;
  user_id: string | null;
  task_id?: string;
  lane?: RecipientRequiredLane;
  kind: RecipientRequiredReminderResultKind;
  recipient?: string;
  reason?: string;
};

export type ReconcileRecipientRequiredConsumerRemindersSummary = {
  scanned: number;
  attempted: number;
  sent: number;
  skipped: number;
  failed: number;
  results: RecipientRequiredReminderResult[];
};

function emptySummary(): ReconcileRecipientRequiredConsumerRemindersSummary {
  return { scanned: 0, attempted: 0, sent: 0, skipped: 0, failed: 0, results: [] };
}

type CaseRow = {
  id: string;
  user_id: string;
  intake: unknown;
  client_state: unknown;
  archived_at: string | null;
  updated_at: string;
};

export type ReconcileRecipientRequiredConsumerRemindersOptions = {
  limit?: number;
  nowMs?: number;
};

/**
 * Durable one-time consumer reminder for approved merchant-contact/demand-letter actions still
 * missing a valid company recipient email 24+ hours after the queue task was created. Re-checks
 * every live condition at send time (recipient still missing, operator fallback not chosen, task
 * still open) so nothing is ever sent once the block has been resolved. Idempotent per approved
 * action *instance* — scoped to the open queue task's own id/notes, never the case, since a case
 * can accumulate a fresh task if the destination is re-queued after this one closes.
 *
 * Deliberately does not alert operators: `reconcileOperatorFallbackAlerts`'s own queue-alert tiers
 * already do that for any open merchant-contact/demand-letter task regardless of cause (see
 * `RECIPIENT_REQUIRED_CONSUMER_REMINDER_THRESHOLD_MS`'s doc comment) — duplicating that here would
 * risk a second, competing operator alert for the same event.
 */
export async function reconcileRecipientRequiredConsumerReminders(
  supabase: SupabaseClient,
  options: ReconcileRecipientRequiredConsumerRemindersOptions = {}
): Promise<ReconcileRecipientRequiredConsumerRemindersSummary> {
  const summary = emptySummary();
  const pageSize = options.limit ?? 100;
  const nowMs = options.nowMs ?? Date.now();

  const providerResolved = resolveMerchantOutreachEmailProvider();
  if (!providerResolved.ok) {
    // Global config gap: send nothing, write no markers, retry next run.
    console.warn("recipient required reminder: email provider unavailable", providerResolved.reason);
    return summary;
  }

  let cursor: KeysetCursor = null;

  for (;;) {
    const { data, error } = await applyKeysetCursor(
      supabase.from("justice_cases").select(CASE_SELECT).is("archived_at", null),
      cursor
    ).limit(pageSize);

    if (error) {
      console.warn("recipient required reminder: list cases", error.message);
      break;
    }

    const fetchedRows = (data ?? []) as CaseRow[];
    summary.scanned += fetchedRows.length;

    for (const row of fetchedRows) {
      const caseId = row.id?.trim() ?? "";
      const userId = row.user_id?.trim() ?? "";
      if (!caseId || !userId || row.archived_at?.trim()) continue;

      const parsedState = parseJusticeCaseClientState(row.client_state);
      const lane = resolveRecipientRequiredLane(parsedState.approved_next_action);
      if (!lane) continue;
      if (isMerchantContactOperatorFallbackChosen(row.client_state)) continue;

      if (!isJusticeIntakePayload(row.intake)) {
        summary.results.push({
          case_id: caseId,
          user_id: userId,
          lane,
          kind: "failed",
          reason: "invalid_intake",
        });
        summary.failed += 1;
        continue;
      }
      const intake = row.intake as JusticeIntake;

      // Live re-check: recipient supplied since this instance was blocked — nothing to do.
      if (hasValidMerchantContactRecipient(intake)) continue;

      const { data: taskRows, error: taskErr } = await supabase
        .from("justice_case_tasks")
        .select(TASK_SELECT)
        .eq("user_id", userId)
        .eq("case_id", caseId)
        .is("completed_at", null);

      if (taskErr) {
        summary.results.push({
          case_id: caseId,
          user_id: userId,
          lane,
          kind: "failed",
          reason: "list_tasks_failed",
        });
        summary.failed += 1;
        continue;
      }

      const openTasks = (taskRows ?? []) as JusticeCaseTaskRow[];
      const task =
        lane === "merchant_contact"
          ? findOpenMerchantContactFilingTask(openTasks, caseId)
          : findOpenDemandLetterFilingTask(openTasks, caseId);

      if (!task) {
        // No anchor task yet — the owned-filing-task reconciler creates it; retry next run.
        summary.results.push({
          case_id: caseId,
          user_id: userId,
          lane,
          kind: "skipped",
          reason: "no_open_task",
        });
        summary.skipped += 1;
        continue;
      }

      const createdAtMs = task.created_at ? Date.parse(task.created_at) : NaN;
      if (!Number.isFinite(createdAtMs)) {
        summary.results.push({
          case_id: caseId,
          user_id: userId,
          task_id: task.id,
          lane,
          kind: "skipped",
          reason: "invalid_task_created_at",
        });
        summary.skipped += 1;
        continue;
      }

      if (nowMs - createdAtMs < RECIPIENT_REQUIRED_CONSUMER_REMINDER_THRESHOLD_MS) {
        summary.results.push({
          case_id: caseId,
          user_id: userId,
          task_id: task.id,
          lane,
          kind: "skipped",
          reason: "not_yet_stale",
        });
        summary.skipped += 1;
        continue;
      }

      if (hasRecipientRequiredReminderBeenSent(task.notes, task.id)) {
        summary.results.push({
          case_id: caseId,
          user_id: userId,
          task_id: task.id,
          lane,
          kind: "skipped",
          reason: "already_reminded",
        });
        summary.skipped += 1;
        continue;
      }

      summary.attempted += 1;

      const recipient = resolveConsumerRecipientEmail(intake);
      if (!recipient) {
        summary.results.push({
          case_id: caseId,
          user_id: userId,
          task_id: task.id,
          lane,
          kind: "failed",
          reason: "consumer_recipient_unresolved",
        });
        summary.failed += 1;
        continue;
      }

      try {
        const sendResult = await providerResolved.provider.send({
          from: providerResolved.from,
          to: recipient,
          subject: buildRecipientRequiredReminderEmailSubject(intake),
          text: buildRecipientRequiredReminderEmailBody(intake, lane, caseId),
          idempotencyKey: `recipient-required-reminder:${task.id}`,
        });

        if (!sendResult.ok) {
          summary.results.push({
            case_id: caseId,
            user_id: userId,
            task_id: task.id,
            lane,
            kind: "failed",
            recipient,
            reason: sendResult.error,
          });
          summary.failed += 1;
          continue;
        }

        // Persist the durable exactly-once marker ONLY after an accepted send.
        const sentAt = new Date(nowMs).toISOString();
        const nextNotes = appendRecipientRequiredReminderSentMarker(task.notes, task.id, sentAt);
        const { error: updateErr } = await supabase
          .from("justice_case_tasks")
          .update({ notes: clampLen(nextNotes, MAX_NOTES) })
          .eq("id", task.id)
          .eq("user_id", userId);

        if (updateErr) {
          // Provider idempotency key prevents a duplicate email on the retry next run.
          console.warn("recipient required reminder: mark sent", updateErr.message);
          summary.results.push({
            case_id: caseId,
            user_id: userId,
            task_id: task.id,
            lane,
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
          task_id: task.id,
          lane,
          kind: "sent",
          recipient,
        });
        summary.sent += 1;
      } catch (err) {
        console.warn("recipient required reminder: process case", caseId, err);
        summary.results.push({
          case_id: caseId,
          user_id: userId,
          task_id: task.id,
          lane,
          kind: "failed",
          reason: "exception",
        });
        summary.failed += 1;
      }
    }

    if (fetchedRows.length < pageSize) break;
    cursor = nextKeysetCursor(fetchedRows);
  }

  return summary;
}

import type { SupabaseClient } from "@supabase/supabase-js";
import { isValidMerchantOutreachEmailAddress } from "@/lib/email/merchantOutreachEmailEnv";
import { resolveMerchantOutreachEmailProvider } from "@/lib/email/resolveMerchantOutreachEmailProvider";
import { parseApprovedNextActionFromClientState } from "@/lib/justice/approvedNextActionState";
import { isJusticeIntakePayload } from "@/lib/justice/caseApiValidation";
import {
  hasOperatorTerminalResponseReviewOutcome,
  operatorOwnedClosableOutcomeFromAction,
  type OperatorOwnedClosableOutcome,
} from "@/lib/justice/operatorOwnedCaseArchive";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";
import type { JusticeIntake } from "@/lib/justice/types";

const CASE_SELECT = "id, user_id, intake, client_state, archived_at" as const;
const TASK_SELECT =
  "id, user_id, case_id, title, due_date, notes, completed_at, created_at, updated_at" as const;
const MAX_NOTES = 8000;
const CHAT_PATH = "/justice/chat-ai";

/** Durable exactly-once marker: one completed task per notified closed case. */
export function consumerClosedNotificationTaskNotesMarker(caseId: string): string {
  return `consumer_closed_notified:${caseId.trim()}`;
}

export function taskNotesMatchConsumerClosedNotificationMarker(
  notes: string | null | undefined,
  caseId: string
): boolean {
  const marker = consumerClosedNotificationTaskNotesMarker(caseId);
  const trimmed = notes?.trim() ?? "";
  return trimmed === marker || trimmed.startsWith(`${marker}\n`);
}

/** Provider idempotency key so retries never create a duplicate consumer email. */
export function consumerClosedNotificationEmailIdempotencyKey(caseId: string): string {
  return `consumer-closed-email:${caseId.trim()}`;
}

function clampLen(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max);
}

function resolveChatUrl(): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (appUrl) return `${appUrl.replace(/\/$/, "")}${CHAT_PATH}`;
  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) {
    const host = vercel.replace(/^https?:\/\//i, "").replace(/\/$/, "");
    if (host) return `https://${host}${CHAT_PATH}`;
  }
  return CHAT_PATH;
}

export function buildConsumerCaseClosedEmailSubject(intake: JusticeIntake): string {
  const company = intake.company_name.trim() || "your case";
  return `Your Surrenderless case is closed — ${company}`;
}

export function buildConsumerCaseClosedEmailBody(
  intake: JusticeIntake,
  outcome: OperatorOwnedClosableOutcome
): string {
  const company = intake.company_name.trim() || "your case";
  const name = intake.user_display_name?.trim();
  const outcomeLine =
    outcome === "resolved"
      ? "Surrenderless has closed this case after confirming a resolution."
      : "Surrenderless has closed this case after completing the available steps.";
  return [
    `Hi${name ? ` ${name}` : ""},`,
    "",
    outcomeLine,
    `Company or matter: ${company}`,
    "",
    "You can review the outcome or start a new matter anytime in chat:",
    resolveChatUrl(),
    "",
    "— Surrenderless",
  ].join("\n");
}

export type ConsumerClosedNotificationResultKind = "sent" | "skipped" | "failed";

export type ConsumerClosedNotificationResult = {
  case_id: string;
  user_id: string | null;
  kind: ConsumerClosedNotificationResultKind;
  outcome?: OperatorOwnedClosableOutcome;
  recipient?: string;
  reason?: string;
};

export type ReconcileClosedCaseConsumerNotificationsSummary = {
  attempted: number;
  sent: number;
  skipped: number;
  failed: number;
  results: ConsumerClosedNotificationResult[];
};

function emptySummary(): ReconcileClosedCaseConsumerNotificationsSummary {
  return { attempted: 0, sent: 0, skipped: 0, failed: 0, results: [] };
}

function resolveConsumerRecipientEmail(intake: JusticeIntake): string | null {
  const candidate = intake.reply_email?.trim() ?? "";
  if (!candidate || !isValidMerchantOutreachEmailAddress(candidate)) return null;
  return candidate.toLowerCase();
}

async function caseHasConsumerClosedNotificationMarker(
  supabase: SupabaseClient,
  userId: string,
  caseId: string
): Promise<boolean | null> {
  const marker = consumerClosedNotificationTaskNotesMarker(caseId);
  const { data, error } = await supabase
    .from("justice_case_tasks")
    .select(TASK_SELECT)
    .eq("user_id", userId)
    .eq("case_id", caseId)
    .like("notes", `${marker}%`)
    .limit(1);

  if (error) {
    console.warn("consumer closed notification: select marker", error.message);
    return null;
  }
  const row = (data?.[0] as JusticeCaseTaskRow | undefined) ?? undefined;
  if (!row) return false;
  return taskNotesMatchConsumerClosedNotificationMarker(row.notes, caseId);
}

/** Writes the durable exactly-once marker only after an accepted send. */
async function writeConsumerClosedNotificationMarker(
  supabase: SupabaseClient,
  userId: string,
  caseId: string,
  detail: { recipient: string; messageId: string; outcome: OperatorOwnedClosableOutcome }
): Promise<boolean> {
  const marker = consumerClosedNotificationTaskNotesMarker(caseId);
  // Store the provider identifiers the delivery-status webhook needs to resolve this
  // case later (message id + idempotency key), plus the initial accepted state.
  const notes = clampLen(
    [
      marker,
      `case_id: ${caseId}`,
      `recipient: ${detail.recipient}`,
      `provider_message_id: ${detail.messageId}`,
      `idempotency_key: ${consumerClosedNotificationEmailIdempotencyKey(caseId)}`,
      `outcome: ${detail.outcome}`,
      `delivery_state: accepted`,
      `notified_at: ${new Date().toISOString()}`,
    ].join("\n"),
    MAX_NOTES
  );

  const { data, error } = await supabase
    .from("justice_case_tasks")
    .insert({
      user_id: userId,
      case_id: caseId,
      title: "Consumer closed-case notification sent",
      notes,
      completed_at: new Date().toISOString(),
    })
    .select(TASK_SELECT)
    .single();

  if (error || !data) {
    console.warn("consumer closed notification: write marker", error?.message ?? "no row");
    return false;
  }
  return true;
}

/**
 * Durable consumer notification for operator-owned terminal cases that have been
 * archived. Emails the case owner once (resolved or no_resolution), directing them
 * back to chat. Idempotent via a per-case marker task and the provider idempotency
 * key; each case is processed independently so one failure never stops the batch.
 */
export async function reconcileClosedCaseConsumerNotifications(
  supabase: SupabaseClient,
  options: { limit?: number } = {}
): Promise<ReconcileClosedCaseConsumerNotificationsSummary> {
  const summary = emptySummary();
  const limit = options.limit ?? 100;

  let rows: Array<{
    id: string;
    user_id: string;
    intake: unknown;
    client_state: unknown;
    archived_at: string | null;
  }>;
  try {
    const { data, error } = await supabase
      .from("justice_cases")
      .select(CASE_SELECT)
      .not("archived_at", "is", null)
      .order("updated_at", { ascending: false })
      .limit(limit);
    if (error) {
      console.warn("consumer closed notification: list cases", error.message);
      return summary;
    }
    rows = (data ?? []) as typeof rows;
  } catch (error) {
    console.warn("consumer closed notification: list cases", error);
    return summary;
  }

  const providerResolved = resolveMerchantOutreachEmailProvider();
  if (!providerResolved.ok) {
    // Global config gap: send nothing, write no markers, retry next run.
    console.warn("consumer closed notification: email provider unavailable", providerResolved.reason);
    return summary;
  }

  for (const row of rows) {
    const caseId = row.id?.trim() ?? "";
    const userId = row.user_id?.trim() ?? "";
    if (!row.archived_at?.trim()) continue;

    const action = parseApprovedNextActionFromClientState(row.client_state);
    if (!hasOperatorTerminalResponseReviewOutcome(action)) continue;
    const outcome = operatorOwnedClosableOutcomeFromAction(action);
    if (!outcome) continue;

    summary.attempted += 1;

    if (!caseId || !userId) {
      summary.results.push({ case_id: caseId, user_id: userId || null, kind: "failed", reason: "invalid_case" });
      summary.failed += 1;
      continue;
    }

    try {
      const alreadyNotified = await caseHasConsumerClosedNotificationMarker(supabase, userId, caseId);
      if (alreadyNotified === null) {
        summary.results.push({ case_id: caseId, user_id: userId, kind: "failed", reason: "marker_lookup_failed" });
        summary.failed += 1;
        continue;
      }
      if (alreadyNotified) {
        summary.results.push({ case_id: caseId, user_id: userId, kind: "skipped", outcome, reason: "already_notified" });
        summary.skipped += 1;
        continue;
      }

      if (!isJusticeIntakePayload(row.intake)) {
        summary.results.push({ case_id: caseId, user_id: userId, kind: "failed", reason: "invalid_intake" });
        summary.failed += 1;
        continue;
      }
      const intake = row.intake as JusticeIntake;
      const recipient = resolveConsumerRecipientEmail(intake);
      if (!recipient) {
        summary.results.push({ case_id: caseId, user_id: userId, kind: "failed", reason: "recipient_unresolved" });
        summary.failed += 1;
        continue;
      }

      const sendResult = await providerResolved.provider.send({
        from: providerResolved.from,
        to: recipient,
        subject: buildConsumerCaseClosedEmailSubject(intake),
        text: buildConsumerCaseClosedEmailBody(intake, outcome),
        idempotencyKey: consumerClosedNotificationEmailIdempotencyKey(caseId),
      });

      if (!sendResult.ok) {
        summary.results.push({
          case_id: caseId,
          user_id: userId,
          kind: "failed",
          recipient,
          reason: sendResult.error,
        });
        summary.failed += 1;
        continue;
      }

      // Mark notified ONLY after an accepted send. If this write races/fails, the
      // provider idempotency key still prevents a duplicate email on the next run.
      const marked = await writeConsumerClosedNotificationMarker(supabase, userId, caseId, {
        recipient,
        messageId: sendResult.messageId,
        outcome,
      });
      if (!marked) {
        summary.results.push({
          case_id: caseId,
          user_id: userId,
          kind: "failed",
          recipient,
          reason: "marker_write_failed",
        });
        summary.failed += 1;
        continue;
      }

      summary.results.push({ case_id: caseId, user_id: userId, kind: "sent", outcome, recipient });
      summary.sent += 1;
    } catch (error) {
      console.warn("consumer closed notification: process case", caseId, error);
      summary.results.push({ case_id: caseId, user_id: userId, kind: "failed", reason: "exception" });
      summary.failed += 1;
    }
  }

  return summary;
}

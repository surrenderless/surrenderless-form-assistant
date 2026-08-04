import type { SupabaseClient } from "@supabase/supabase-js";
import { isValidMerchantOutreachEmailAddress } from "@/lib/email/merchantOutreachEmailEnv";
import { resolveMerchantOutreachEmailProvider } from "@/lib/email/resolveMerchantOutreachEmailProvider";
import { parseJusticeCaseClientState } from "@/lib/justice/approvedNextActionState";
import { buildMerchantMessage } from "@/lib/justice/buildMerchantContactMessage";
import { completeMerchantContactOperatorFiling } from "@/lib/justice/completeMerchantContactOperatorFiling";
import {
  findLatestMerchantContactFilingCreatedAt,
  findOpenMerchantContactFilingTask,
  hasMerchantContactFilingWithConfirmation,
  merchantContactFilingsForManualTracking,
  parseMerchantContactFilingTaskDraft,
  reopenMerchantContactFilingTaskForBounce,
  taskNotesMatchMerchantContactFilingMarker,
} from "@/lib/justice/merchantContactFilingTask";
import { completeFollowUpCaseTaskIfOwnedByAction } from "@/lib/justice/followUpCaseTask";
import {
  canonicalFilingDestinationForApprovedActionHref,
  MANUAL_ACTION_TRACKING_REAL_MERCHANT_PREP_HREF,
} from "@/lib/justice/handlingTrackingProgress";
import type { JusticeCaseFilingRow } from "@/lib/justice/filings";
import {
  recordFilingEmailBounceEventAndEnsureActionability,
  type FilingEmailBounceActionResult,
  type FilingEmailBounceEventType,
} from "@/lib/justice/filingEmailBounceTracking";
import { shouldSuppressChatManualActionForSurrenderlessOwnedStep } from "@/lib/justice/surrenderlessOwnedStep";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";
import type { JusticeIntake, TimelineEntry } from "@/lib/justice/types";
import { appendCaseTimelineEntry } from "@/server/justiceTimelineAppend";

const FILING_SELECT =
  "id, user_id, case_id, destination, filed_at, confirmation_number, filing_url, notes, created_at, updated_at" as const;

const TASK_SELECT =
  "id, user_id, case_id, title, due_date, notes, completed_at, created_at, updated_at" as const;

const MAX_NOTES = 8000;
const DELIVERY_BLOCK_MARKER = "---merchant_outreach_delivery---";

export type MerchantContactEmailDeliveryState =
  | "sending"
  | "accepted"
  | "failed"
  | "bounced"
  | "complained";

export type MerchantContactEmailDeliveryRecord = {
  delivery_state: MerchantContactEmailDeliveryState;
  provider: string;
  recipient: string;
  sent_at?: string;
  provider_message_id?: string;
  failure_detail?: string;
};

export function merchantContactEmailIdempotencyKey(caseId: string): string {
  return `merchant-contact-email:${caseId.trim()}`;
}

export function merchantContactEmailTimelineId(
  caseId: string,
  state: MerchantContactEmailDeliveryState
): string {
  return `merchant_email_${state}:${caseId.trim()}`;
}

export function resolveMerchantOutreachRecipientEmail(
  intake: JusticeIntake
): string | null {
  const candidate = intake.company_contact_email?.trim() ?? "";
  if (!candidate || !isValidMerchantOutreachEmailAddress(candidate)) return null;
  return candidate.toLowerCase();
}

export function parseMerchantContactEmailDeliveryRecord(
  notes: string | null | undefined
): MerchantContactEmailDeliveryRecord | null {
  const trimmed = notes?.trim() ?? "";
  const idx = trimmed.indexOf(DELIVERY_BLOCK_MARKER);
  if (idx < 0) return null;
  const block = trimmed.slice(idx + DELIVERY_BLOCK_MARKER.length).trim();
  const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
  const map = new Map<string, string>();
  for (const line of lines) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    map.set(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
  }
  const state = map.get("delivery_state");
  if (
    state !== "sending" &&
    state !== "accepted" &&
    state !== "failed" &&
    state !== "bounced" &&
    state !== "complained"
  ) {
    return null;
  }
  const provider = map.get("provider")?.trim() ?? "";
  const recipient = map.get("recipient")?.trim() ?? "";
  if (!provider || !recipient) return null;
  return {
    delivery_state: state,
    provider,
    recipient,
    ...(map.get("sent_at") ? { sent_at: map.get("sent_at") } : {}),
    ...(map.get("provider_message_id")
      ? { provider_message_id: map.get("provider_message_id") }
      : {}),
    ...(map.get("failure_detail") ? { failure_detail: map.get("failure_detail") } : {}),
  };
}

export function upsertMerchantContactEmailDeliveryNotes(
  notes: string | null | undefined,
  record: MerchantContactEmailDeliveryRecord
): string {
  const base = (notes ?? "").trim();
  const without =
    base.indexOf(DELIVERY_BLOCK_MARKER) >= 0
      ? base.slice(0, base.indexOf(DELIVERY_BLOCK_MARKER)).trimEnd()
      : base;
  const lines = [
    DELIVERY_BLOCK_MARKER,
    `delivery_state: ${record.delivery_state}`,
    `provider: ${record.provider}`,
    `recipient: ${record.recipient}`,
  ];
  if (record.sent_at) lines.push(`sent_at: ${record.sent_at}`);
  if (record.provider_message_id) {
    lines.push(`provider_message_id: ${record.provider_message_id}`);
  }
  if (record.failure_detail) {
    lines.push(`failure_detail: ${record.failure_detail}`);
  }
  const next = [without, lines.join("\n")].filter(Boolean).join("\n\n");
  return next.length <= MAX_NOTES ? next : next.slice(0, MAX_NOTES);
}

export function buildMerchantOutreachEmailSubject(intake: JusticeIntake): string {
  const company = intake.company_name.trim() || "Support";
  return `Consumer dispute follow-up — ${company}`;
}

export type AttemptAutomatedMerchantContactEmailDeliveryResult =
  | {
      status: "accepted";
      messageId: string;
      recipient: string;
      idempotent: boolean;
      filing?: JusticeCaseFilingRow;
      task?: JusticeCaseTaskRow;
      timeline?: TimelineEntry[] | null;
    }
  | {
      status: "failed";
      recipient: string;
      error: string;
      timeline?: TimelineEntry[] | null;
    }
  | {
      status: "skipped";
      reason: string;
    };

async function patchMerchantTaskNotes(
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
    console.warn("merchant email delivery: patch task notes", error?.message ?? "failed");
    return null;
  }
  return data as JusticeCaseTaskRow;
}

/**
 * Sends merchant/company first-contact email when packet-approved and Surrenderless-owned.
 * Idempotent: retries reuse the same provider idempotency key and skip after acceptance.
 * Does not mark contact completed until the provider accepts the message.
 * Falls back (skipped/failed leave task open) for operator manual fulfillment.
 */
export async function attemptAutomatedMerchantContactEmailDelivery(
  supabase: SupabaseClient,
  userId: string,
  caseId: string
): Promise<AttemptAutomatedMerchantContactEmailDeliveryResult> {
  const trimmedCaseId = caseId.trim();
  if (!trimmedCaseId) {
    return { status: "skipped", reason: "case_id is required" };
  }

  const { data: caseRow, error: caseErr } = await supabase
    .from("justice_cases")
    .select("intake, client_state, timeline")
    .eq("id", trimmedCaseId)
    .eq("user_id", userId)
    .maybeSingle();

  if (caseErr || !caseRow) {
    return { status: "skipped", reason: "case not found" };
  }

  const intake = caseRow.intake as JusticeIntake | null;
  if (!intake || typeof intake !== "object") {
    return { status: "skipped", reason: "invalid intake" };
  }

  const parsed = parseJusticeCaseClientState(caseRow.client_state);
  if (!parsed.prepared_packet_approved) {
    return { status: "skipped", reason: "packet not approved" };
  }
  const approved = parsed.approved_next_action;
  if (!approved || approved.href?.trim() !== MANUAL_ACTION_TRACKING_REAL_MERCHANT_PREP_HREF) {
    return { status: "skipped", reason: "approved action is not merchant contact" };
  }
  if (approved.status === "completed") {
    return { status: "skipped", reason: "merchant contact already completed" };
  }

  const { data: taskRows, error: tasksErr } = await supabase
    .from("justice_case_tasks")
    .select(TASK_SELECT)
    .eq("case_id", trimmedCaseId)
    .eq("user_id", userId);

  if (tasksErr) {
    console.warn("merchant email delivery: list tasks", tasksErr.message);
    return { status: "skipped", reason: "could not list tasks" };
  }

  const { data: filingRows, error: filingsErr } = await supabase
    .from("justice_case_filings")
    .select(FILING_SELECT)
    .eq("case_id", trimmedCaseId)
    .eq("user_id", userId);

  if (filingsErr) {
    console.warn("merchant email delivery: list filings", filingsErr.message);
    return { status: "skipped", reason: "could not list filings" };
  }

  const tasks = (taskRows ?? []) as JusticeCaseTaskRow[];
  const filings = (filingRows ?? []) as JusticeCaseFilingRow[];

  if (
    !shouldSuppressChatManualActionForSurrenderlessOwnedStep({
      approvedAction: approved,
      caseId: trimmedCaseId,
      tasks,
      filings,
    })
  ) {
    return { status: "skipped", reason: "step is not Surrenderless-owned" };
  }

  if (hasMerchantContactFilingWithConfirmation(filings)) {
    const existing = merchantContactFilingsForManualTracking(filings).find((f) =>
      Boolean(f.confirmation_number?.trim())
    );
    return {
      status: "accepted",
      messageId: existing?.confirmation_number?.trim() || "existing",
      recipient:
        parseMerchantContactEmailDeliveryRecord(existing?.notes)?.recipient ||
        resolveMerchantOutreachRecipientEmail(intake) ||
        "unknown",
      idempotent: true,
      filing: existing,
    };
  }

  const openTask = findOpenMerchantContactFilingTask(tasks, trimmedCaseId);
  if (!openTask) {
    return { status: "skipped", reason: "no open merchant contact task" };
  }
  if (!taskNotesMatchMerchantContactFilingMarker(openTask.notes, trimmedCaseId)) {
    return { status: "skipped", reason: "task marker mismatch" };
  }

  const priorDelivery = parseMerchantContactEmailDeliveryRecord(openTask.notes);
  if (priorDelivery?.delivery_state === "accepted" && priorDelivery.provider_message_id) {
    return {
      status: "accepted",
      messageId: priorDelivery.provider_message_id,
      recipient: priorDelivery.recipient,
      idempotent: true,
      task: openTask,
    };
  }

  const recipient = resolveMerchantOutreachRecipientEmail(intake);
  if (!recipient) {
    return {
      status: "skipped",
      reason: "company_contact_email missing or invalid — operator/manual fallback",
    };
  }

  const providerResolved = resolveMerchantOutreachEmailProvider();
  if (!providerResolved.ok) {
    return {
      status: "skipped",
      reason: `${providerResolved.reason} — operator/manual fallback`,
    };
  }

  const rawDraft = parseMerchantContactFilingTaskDraft(openTask.notes);
  const draftWithoutDelivery =
    rawDraft.indexOf(DELIVERY_BLOCK_MARKER) >= 0
      ? rawDraft.slice(0, rawDraft.indexOf(DELIVERY_BLOCK_MARKER)).trim()
      : rawDraft.trim();
  const body = draftWithoutDelivery || buildMerchantMessage(intake);

  const sendingAt = new Date().toISOString();
  const sendingRecord: MerchantContactEmailDeliveryRecord = {
    delivery_state: "sending",
    provider: providerResolved.provider.name,
    recipient,
    sent_at: sendingAt,
  };
  const sendingNotes = upsertMerchantContactEmailDeliveryNotes(openTask.notes, sendingRecord);
  const sendingTask = await patchMerchantTaskNotes(supabase, userId, openTask.id, sendingNotes);
  await appendCaseTimelineEntry(supabase, userId, trimmedCaseId, {
    id: merchantContactEmailTimelineId(trimmedCaseId, "sending"),
    type: "filing_recorded",
    label: "Merchant outreach email sending",
    detail: `recipient: ${recipient}\nprovider: ${providerResolved.provider.name}`,
    ts: sendingAt,
  });

  const sendResult = await providerResolved.provider.send({
    from: providerResolved.from,
    to: recipient,
    subject: buildMerchantOutreachEmailSubject(intake),
    text: body,
    replyTo: intake.reply_email.trim() || undefined,
    idempotencyKey: merchantContactEmailIdempotencyKey(trimmedCaseId),
  });

  if (!sendResult.ok) {
    const failedAt = new Date().toISOString();
    const failedRecord: MerchantContactEmailDeliveryRecord = {
      delivery_state: "failed",
      provider: providerResolved.provider.name,
      recipient,
      sent_at: failedAt,
      failure_detail: sendResult.error.slice(0, 500),
    };
    await patchMerchantTaskNotes(
      supabase,
      userId,
      openTask.id,
      upsertMerchantContactEmailDeliveryNotes(sendingTask?.notes ?? sendingNotes, failedRecord)
    );
    const timeline = await appendCaseTimelineEntry(supabase, userId, trimmedCaseId, {
      id: merchantContactEmailTimelineId(trimmedCaseId, "failed"),
      type: "filing_recorded",
      label: "Merchant outreach email failed",
      detail: `recipient: ${recipient}\nerror: ${sendResult.error.slice(0, 500)}`,
      ts: failedAt,
    });
    return {
      status: "failed",
      recipient,
      error: sendResult.error,
      timeline,
    };
  }

  const destination =
    canonicalFilingDestinationForApprovedActionHref(MANUAL_ACTION_TRACKING_REAL_MERCHANT_PREP_HREF) ??
    "Merchant contact";
  const filedAt = new Date().toISOString().slice(0, 10);
  const completeResult = await completeMerchantContactOperatorFiling(supabase, userId, {
    caseId: trimmedCaseId,
    taskId: openTask.id,
    destination,
    filedAt,
    confirmationNumber: sendResult.messageId,
    contactMethod: "email",
    merchantResponseType: "no_response",
    recipient,
    notes: [
      `provider: ${providerResolved.provider.name}`,
      `provider_message_id: ${sendResult.messageId}`,
      `delivery_state: accepted`,
      `sent_at: ${new Date().toISOString()}`,
    ].join("\n"),
  });

  if (!completeResult.ok) {
    const failedAt = new Date().toISOString();
    const failedRecord: MerchantContactEmailDeliveryRecord = {
      delivery_state: "failed",
      provider: providerResolved.provider.name,
      recipient,
      sent_at: failedAt,
      provider_message_id: sendResult.messageId,
      failure_detail: `Provider accepted but completion failed: ${completeResult.error}`.slice(0, 500),
    };
    await patchMerchantTaskNotes(
      supabase,
      userId,
      openTask.id,
      upsertMerchantContactEmailDeliveryNotes(sendingTask?.notes ?? sendingNotes, failedRecord)
    );
    const timeline = await appendCaseTimelineEntry(supabase, userId, trimmedCaseId, {
      id: merchantContactEmailTimelineId(trimmedCaseId, "failed"),
      type: "filing_recorded",
      label: "Merchant outreach email failed",
      detail: failedRecord.failure_detail,
      ts: failedAt,
    });
    return {
      status: "failed",
      recipient,
      error: completeResult.error,
      timeline,
    };
  }

  const acceptedAt = new Date().toISOString();
  await appendCaseTimelineEntry(supabase, userId, trimmedCaseId, {
    id: merchantContactEmailTimelineId(trimmedCaseId, "accepted"),
    type: "filing_recorded",
    label: "Merchant outreach email accepted",
    detail: [
      `recipient: ${recipient}`,
      `provider: ${providerResolved.provider.name}`,
      `provider_message_id: ${sendResult.messageId}`,
      `sent_at: ${acceptedAt}`,
    ].join("\n"),
    ts: acceptedAt,
  });

  return {
    status: "accepted",
    messageId: sendResult.messageId,
    recipient,
    idempotent: completeResult.idempotent,
    filing: completeResult.filing,
    task: completeResult.task,
    timeline: completeResult.timeline,
  };
}

/** Task-notes helpers for chat status (queued / sending / failed while task remains open). */
export function isMerchantContactEmailSending(task: JusticeCaseTaskRow | undefined): boolean {
  if (!task || task.completed_at?.trim()) return false;
  return parseMerchantContactEmailDeliveryRecord(task.notes)?.delivery_state === "sending";
}

export function isMerchantContactEmailFailed(task: JusticeCaseTaskRow | undefined): boolean {
  if (!task || task.completed_at?.trim()) return false;
  return parseMerchantContactEmailDeliveryRecord(task.notes)?.delivery_state === "failed";
}

/**
 * True (with which kind) when the merchant-contact filing on file bounced or was marked as
 * spam — read from the filing that survives after the operator task completes, so this reflects
 * the outcome regardless of whether the task has since been reopened. Chat/status UI uses this
 * to stop showing outreach as successfully sent.
 */
export function merchantContactEmailBounceState(
  filing: Pick<JusticeCaseFilingRow, "notes"> | undefined
): "bounced" | "complained" | null {
  const state = parseMerchantContactEmailDeliveryRecord(filing?.notes)?.delivery_state;
  return state === "bounced" || state === "complained" ? state : null;
}

/**
 * Records a Resend bounce/complaint for a merchant outreach send and ensures both follow-on
 * actions are complete: reopening the operator task so the case reappears in
 * /operator/fulfillment, and stopping the false no-response follow-up countdown. Looks up the
 * completed filing first (the common case, since acceptance and filing completion happen back to
 * back), falling back to a still-open task if provider acceptance completed but the filing write
 * itself failed.
 *
 * Runs the actionability check on every call, including replays after the delivery state already
 * flipped — so an incomplete action from a prior attempt is retried rather than silently
 * swallowed as a duplicate. Returns "error" (triggering a webhook 5xx / provider retry) whenever
 * either action can't be confirmed complete. See recordFilingEmailBounceEventAndEnsureActionability
 * for the full contract.
 */
export async function recordMerchantContactEmailBounceEvent(
  supabase: SupabaseClient,
  params: { messageId: string; eventType: FilingEmailBounceEventType }
): Promise<FilingEmailBounceActionResult> {
  return recordFilingEmailBounceEventAndEnsureActionability(
    supabase,
    {
      label: "Merchant outreach",
      timelineIdPrefix: "merchant_email",
      parseRecord: parseMerchantContactEmailDeliveryRecord,
      upsertNotes: upsertMerchantContactEmailDeliveryNotes,
      reopenTask: reopenMerchantContactFilingTaskForBounce,
      stopFollowUp: (supabase, userId, caseId) =>
        completeFollowUpCaseTaskIfOwnedByAction(
          supabase,
          userId,
          caseId,
          MANUAL_ACTION_TRACKING_REAL_MERCHANT_PREP_HREF
        ),
      findLatestFilingCreatedAt: findLatestMerchantContactFilingCreatedAt,
    },
    params
  );
}

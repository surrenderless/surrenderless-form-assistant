import type { SupabaseClient } from "@supabase/supabase-js";
import { isValidMerchantOutreachEmailAddress } from "@/lib/email/merchantOutreachEmailEnv";
import { resolveMerchantOutreachEmailProvider } from "@/lib/email/resolveMerchantOutreachEmailProvider";
import { parseJusticeCaseClientState } from "@/lib/justice/approvedNextActionState";
import { buildDemandLetterDraft } from "@/lib/justice/buildDemandLetterDraft";
import { completeDemandLetterOperatorFiling } from "@/lib/justice/completeDemandLetterOperatorFiling";
import {
  findOpenDemandLetterFilingTask,
  hasDemandLetterFilingWithConfirmation,
  parseDemandLetterFilingTaskDraft,
  demandLetterFilingsForManualTracking,
  shouldQueueDemandLetterFilingTask,
  taskNotesMatchDemandLetterFilingMarker,
} from "@/lib/justice/demandLetterFilingTask";
import {
  canonicalFilingDestinationForApprovedActionHref,
  MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF,
} from "@/lib/justice/handlingTrackingProgress";
import type { JusticeCaseFilingRow } from "@/lib/justice/filings";
import { shouldSuppressChatManualActionForSurrenderlessOwnedStep } from "@/lib/justice/surrenderlessOwnedStep";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";
import type { JusticeIntake, TimelineEntry } from "@/lib/justice/types";
import { appendCaseTimelineEntry } from "@/server/justiceTimelineAppend";

const FILING_SELECT =
  "id, user_id, case_id, destination, filed_at, confirmation_number, filing_url, notes, created_at, updated_at" as const;

const TASK_SELECT =
  "id, user_id, case_id, title, due_date, notes, completed_at, created_at, updated_at" as const;

const MAX_NOTES = 8000;
const DELIVERY_BLOCK_MARKER = "---demand_letter_outreach_delivery---";

export type DemandLetterEmailDeliveryState = "sending" | "accepted" | "failed";

export type DemandLetterEmailDeliveryRecord = {
  delivery_state: DemandLetterEmailDeliveryState;
  provider: string;
  recipient: string;
  sent_at?: string;
  provider_message_id?: string;
  failure_detail?: string;
};

export function demandLetterEmailIdempotencyKey(caseId: string): string {
  return `demand-letter-email:${caseId.trim()}`;
}

export function demandLetterEmailTimelineId(
  caseId: string,
  state: DemandLetterEmailDeliveryState
): string {
  return `demand_letter_email_${state}:${caseId.trim()}`;
}

/** Same recipient field as merchant outreach — demand letter emails the company. */
export function resolveDemandLetterRecipientEmail(intake: JusticeIntake): string | null {
  const candidate = intake.company_contact_email?.trim() ?? "";
  if (!candidate || !isValidMerchantOutreachEmailAddress(candidate)) return null;
  return candidate.toLowerCase();
}

export function parseDemandLetterEmailDeliveryRecord(
  notes: string | null | undefined
): DemandLetterEmailDeliveryRecord | null {
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
  if (state !== "sending" && state !== "accepted" && state !== "failed") return null;
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

export function upsertDemandLetterEmailDeliveryNotes(
  notes: string | null | undefined,
  record: DemandLetterEmailDeliveryRecord
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

export function buildDemandLetterOutreachEmailSubject(intake: JusticeIntake): string {
  const company = intake.company_name.trim() || "Support";
  return `Demand letter — consumer dispute — ${company}`;
}

/**
 * Strip prep-only disclaimers from the task draft before sending.
 * Leaves the letter body intact for the company recipient.
 */
export function formatDemandLetterOutreachEmailBody(draft: string): string {
  const lines = draft.split("\n");
  const filtered = lines.filter((line) => {
    const t = line.trim();
    if (!t) return true;
    if (/^DRAFT DEMAND LETTER/i.test(t)) return false;
    if (/^This app does not send/i.test(t)) return false;
    if (/^\(This app does not send/i.test(t)) return false;
    if (/^FOR YOUR REVIEW AND EDITING ONLY$/i.test(t)) return false;
    return true;
  });
  return filtered.join("\n").replace(/^\n+/, "").trim();
}

export type AttemptAutomatedDemandLetterEmailDeliveryResult =
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

async function patchDemandLetterTaskNotes(
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
    console.warn("demand letter email delivery: patch task notes", error?.message ?? "failed");
    return null;
  }
  return data as JusticeCaseTaskRow;
}

/**
 * Sends the demand-letter draft to company_contact_email when packet-approved and Surrenderless-owned.
 * Idempotent: retries reuse the same provider idempotency key and skip after acceptance.
 * Does not mark the letter sent until the provider accepts the message.
 * Falls back (skipped/failed leave task open) for operator manual fulfillment.
 */
export async function attemptAutomatedDemandLetterEmailDelivery(
  supabase: SupabaseClient,
  userId: string,
  caseId: string
): Promise<AttemptAutomatedDemandLetterEmailDeliveryResult> {
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
  if (
    !approved ||
    approved.href?.trim() !== MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF
  ) {
    return { status: "skipped", reason: "approved action is not demand letter" };
  }
  if (approved.status === "completed") {
    return { status: "skipped", reason: "demand letter already completed" };
  }

  const { data: taskRows, error: tasksErr } = await supabase
    .from("justice_case_tasks")
    .select(TASK_SELECT)
    .eq("case_id", trimmedCaseId)
    .eq("user_id", userId);

  if (tasksErr) {
    console.warn("demand letter email delivery: list tasks", tasksErr.message);
    return { status: "skipped", reason: "could not list tasks" };
  }

  const { data: filingRows, error: filingsErr } = await supabase
    .from("justice_case_filings")
    .select(FILING_SELECT)
    .eq("case_id", trimmedCaseId)
    .eq("user_id", userId);

  if (filingsErr) {
    console.warn("demand letter email delivery: list filings", filingsErr.message);
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

  if (hasDemandLetterFilingWithConfirmation(filings)) {
    const existing = demandLetterFilingsForManualTracking(filings).find((f) =>
      Boolean(f.confirmation_number?.trim())
    );
    return {
      status: "accepted",
      messageId: existing?.confirmation_number?.trim() || "existing",
      recipient:
        parseDemandLetterEmailDeliveryRecord(existing?.notes)?.recipient ||
        resolveDemandLetterRecipientEmail(intake) ||
        "unknown",
      idempotent: true,
      filing: existing,
    };
  }

  const openTask = findOpenDemandLetterFilingTask(tasks, trimmedCaseId);
  if (!openTask) {
    return { status: "skipped", reason: "no open demand letter task" };
  }
  if (!taskNotesMatchDemandLetterFilingMarker(openTask.notes, trimmedCaseId)) {
    return { status: "skipped", reason: "task marker mismatch" };
  }

  const priorDelivery = parseDemandLetterEmailDeliveryRecord(openTask.notes);
  if (priorDelivery?.delivery_state === "accepted" && priorDelivery.provider_message_id) {
    return {
      status: "accepted",
      messageId: priorDelivery.provider_message_id,
      recipient: priorDelivery.recipient,
      idempotent: true,
      task: openTask,
    };
  }

  const recipient = resolveDemandLetterRecipientEmail(intake);
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

  const rawDraft = parseDemandLetterFilingTaskDraft(openTask.notes);
  const draftWithoutDelivery =
    rawDraft.indexOf(DELIVERY_BLOCK_MARKER) >= 0
      ? rawDraft.slice(0, rawDraft.indexOf(DELIVERY_BLOCK_MARKER)).trim()
      : rawDraft.trim();
  const body =
    formatDemandLetterOutreachEmailBody(draftWithoutDelivery) ||
    formatDemandLetterOutreachEmailBody(buildDemandLetterDraft(intake));

  const sendingAt = new Date().toISOString();
  const sendingRecord: DemandLetterEmailDeliveryRecord = {
    delivery_state: "sending",
    provider: providerResolved.provider.name,
    recipient,
    sent_at: sendingAt,
  };
  const sendingNotes = upsertDemandLetterEmailDeliveryNotes(openTask.notes, sendingRecord);
  const sendingTask = await patchDemandLetterTaskNotes(supabase, userId, openTask.id, sendingNotes);
  await appendCaseTimelineEntry(supabase, userId, trimmedCaseId, {
    id: demandLetterEmailTimelineId(trimmedCaseId, "sending"),
    type: "filing_recorded",
    label: "Demand letter email sending",
    detail: `recipient: ${recipient}\nprovider: ${providerResolved.provider.name}`,
    ts: sendingAt,
  });

  const sendResult = await providerResolved.provider.send({
    from: providerResolved.from,
    to: recipient,
    subject: buildDemandLetterOutreachEmailSubject(intake),
    text: body,
    replyTo: intake.reply_email.trim() || undefined,
    idempotencyKey: demandLetterEmailIdempotencyKey(trimmedCaseId),
  });

  if (!sendResult.ok) {
    const failedAt = new Date().toISOString();
    const failedRecord: DemandLetterEmailDeliveryRecord = {
      delivery_state: "failed",
      provider: providerResolved.provider.name,
      recipient,
      sent_at: failedAt,
      failure_detail: sendResult.error.slice(0, 500),
    };
    await patchDemandLetterTaskNotes(
      supabase,
      userId,
      openTask.id,
      upsertDemandLetterEmailDeliveryNotes(sendingTask?.notes ?? sendingNotes, failedRecord)
    );
    const timeline = await appendCaseTimelineEntry(supabase, userId, trimmedCaseId, {
      id: demandLetterEmailTimelineId(trimmedCaseId, "failed"),
      type: "filing_recorded",
      label: "Demand letter email failed",
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
    canonicalFilingDestinationForApprovedActionHref(
      MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF
    ) ?? "Small claims / demand letter";
  const filedAt = new Date().toISOString().slice(0, 10);
  const completeResult = await completeDemandLetterOperatorFiling(supabase, userId, {
    caseId: trimmedCaseId,
    taskId: openTask.id,
    destination,
    filedAt,
    confirmationNumber: sendResult.messageId,
    notes: [
      `provider: ${providerResolved.provider.name}`,
      `provider_message_id: ${sendResult.messageId}`,
      `delivery_state: accepted`,
      `recipient: ${recipient}`,
      `sent_at: ${new Date().toISOString()}`,
    ].join("\n"),
  });

  if (!completeResult.ok) {
    const failedAt = new Date().toISOString();
    const failedRecord: DemandLetterEmailDeliveryRecord = {
      delivery_state: "failed",
      provider: providerResolved.provider.name,
      recipient,
      sent_at: failedAt,
      provider_message_id: sendResult.messageId,
      failure_detail: `Provider accepted but completion failed: ${completeResult.error}`.slice(0, 500),
    };
    await patchDemandLetterTaskNotes(
      supabase,
      userId,
      openTask.id,
      upsertDemandLetterEmailDeliveryNotes(sendingTask?.notes ?? sendingNotes, failedRecord)
    );
    const timeline = await appendCaseTimelineEntry(supabase, userId, trimmedCaseId, {
      id: demandLetterEmailTimelineId(trimmedCaseId, "failed"),
      type: "filing_recorded",
      label: "Demand letter email failed",
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
    id: demandLetterEmailTimelineId(trimmedCaseId, "accepted"),
    type: "filing_recorded",
    label: "Demand letter email accepted",
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

export async function attemptAutomatedDemandLetterEmailDeliveryAfterEnsure(
  supabase: SupabaseClient,
  userId: string,
  caseId: string,
  currentTimeline: TimelineEntry[] | null = null
): Promise<{
  timeline: TimelineEntry[] | null;
  result: AttemptAutomatedDemandLetterEmailDeliveryResult;
}> {
  const result = await attemptAutomatedDemandLetterEmailDelivery(supabase, userId, caseId);
  if (
    (result.status === "accepted" || result.status === "failed") &&
    result.timeline
  ) {
    return { timeline: result.timeline, result };
  }
  return { timeline: currentTimeline, result };
}

/**
 * Safe to call after any ladder completion that may have queued the demand letter.
 * No-ops unless client_state currently queues the Surrenderless-owned demand-letter step.
 */
export async function maybeAttemptAutomatedDemandLetterEmailDeliveryForClientState(
  supabase: SupabaseClient,
  userId: string,
  caseId: string,
  clientState: unknown,
  currentTimeline: TimelineEntry[] | null = null
): Promise<{
  timeline: TimelineEntry[] | null;
  result: AttemptAutomatedDemandLetterEmailDeliveryResult | { status: "skipped"; reason: string };
}> {
  if (!shouldQueueDemandLetterFilingTask(clientState)) {
    return {
      timeline: currentTimeline,
      result: { status: "skipped", reason: "Demand letter not queued for this client_state" },
    };
  }
  return attemptAutomatedDemandLetterEmailDeliveryAfterEnsure(
    supabase,
    userId,
    caseId,
    currentTimeline
  );
}

/** Task-notes helpers for chat status (queued / sending / failed while task remains open). */
export function isDemandLetterEmailSending(task: JusticeCaseTaskRow | undefined): boolean {
  if (!task || task.completed_at?.trim()) return false;
  return parseDemandLetterEmailDeliveryRecord(task.notes)?.delivery_state === "sending";
}

export function isDemandLetterEmailFailed(task: JusticeCaseTaskRow | undefined): boolean {
  if (!task || task.completed_at?.trim()) return false;
  return parseDemandLetterEmailDeliveryRecord(task.notes)?.delivery_state === "failed";
}

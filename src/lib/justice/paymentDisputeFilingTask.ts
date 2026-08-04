import type { SupabaseClient } from "@supabase/supabase-js";
import { parseJusticeCaseClientState } from "@/lib/justice/approvedNextActionState";
import { buildDefaultFollowUpAtAfterRealBbbAutofill } from "@/lib/justice/autoOutcomeTrackingAfterRealBbbAutofill";
import {
  buildBankLetter,
  buildDefaultPaymentDisputeDraft,
  type PaymentDisputeDraft,
} from "@/lib/justice/buildPaymentDisputeBankLetter";
import {
  filingsForApprovedActionManualTracking,
  MANUAL_ACTION_TRACKING_REAL_PAYMENT_DISPUTE_PREP_HREF,
  type ManualActionTrackingFiling,
} from "@/lib/justice/handlingTrackingProgress";
import type { JusticeCaseFilingRow } from "@/lib/justice/filings";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";
import type { JusticeApprovedNextAction, JusticeIntake, TimelineEntry } from "@/lib/justice/types";
import { appendCaseTimelineEntry } from "@/server/justiceTimelineAppend";

const MAX_TITLE = 500;
const MAX_NOTES = 8000;
const PAYMENT_DISPUTE_FILING_TASK_TITLE_PREFIX = "Payment dispute: ";

const TASK_SELECT =
  "id, user_id, case_id, title, due_date, notes, completed_at, created_at, updated_at" as const;

const EVIDENCE_SELECT = "title, evidence_type, evidence_date" as const;

function clampLen(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max);
}

/** Stable idempotency marker stored at the start of task notes. */
export function paymentDisputeFilingTaskNotesMarker(caseId: string): string {
  return `payment_dispute_filing_queue:${caseId.trim()}`;
}

export function buildPaymentDisputeFilingTaskTitle(intake: JusticeIntake): string {
  const company = intake.company_name.trim() || "payment dispute";
  return clampLen(`${PAYMENT_DISPUTE_FILING_TASK_TITLE_PREFIX}${company}`, MAX_TITLE);
}

export function isPaymentDisputeDraftPayload(value: unknown): value is PaymentDisputeDraft {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const d = value as Record<string, unknown>;
  return (
    typeof d.case_id === "string" &&
    typeof d.payment_method === "string" &&
    typeof d.charge_date === "string" &&
    typeof d.charge_amount === "string" &&
    typeof d.merchant_name === "string" &&
    typeof d.dispute_reason === "string" &&
    (d.prior_company_contact === "yes" || d.prior_company_contact === "no") &&
    typeof d.proof_type === "string"
  );
}

export function resolvePaymentDisputeDraftForOperatorPacket(
  caseId: string,
  intake: JusticeIntake,
  draft: unknown
): PaymentDisputeDraft {
  if (isPaymentDisputeDraftPayload(draft)) {
    return { ...draft, case_id: caseId.trim() || draft.case_id };
  }
  return buildDefaultPaymentDisputeDraft(caseId, intake);
}

export type PaymentDisputeEvidenceSummaryLine = {
  title: string;
  evidence_type: string;
  evidence_date?: string | null;
};

export function buildPaymentDisputeEvidenceInventory(
  evidence: readonly PaymentDisputeEvidenceSummaryLine[]
): string {
  if (evidence.length === 0) {
    return "(no saved evidence rows on this case yet)";
  }
  return evidence
    .map((row, index) => {
      const title = row.title.trim() || "(untitled)";
      const type = row.evidence_type.trim() || "other";
      const date = row.evidence_date?.trim();
      return date
        ? `${index + 1}. [${type}] ${title} (${date})`
        : `${index + 1}. [${type}] ${title}`;
    })
    .join("\n");
}

export function buildPaymentDisputeFilingTaskNotes(
  caseId: string,
  intake: JusticeIntake,
  draft: PaymentDisputeDraft,
  evidence: readonly PaymentDisputeEvidenceSummaryLine[] = []
): string {
  const marker = paymentDisputeFilingTaskNotesMarker(caseId);
  const company = draft.merchant_name.trim() || intake.company_name.trim() || "(unknown merchant)";
  const letter = buildBankLetter(draft, intake);
  const evidenceBlock = buildPaymentDisputeEvidenceInventory(evidence);
  const packetLines = [
    `payment_method: ${draft.payment_method}`,
    `charge_date: ${draft.charge_date.trim() || "(not set)"}`,
    `charge_amount: ${draft.charge_amount.trim() || "(not set)"}`,
    `merchant_name: ${company}`,
    `dispute_reason: ${draft.dispute_reason}`,
    draft.dispute_reason_other?.trim()
      ? `dispute_reason_other: ${draft.dispute_reason_other.trim()}`
      : null,
    `prior_company_contact: ${draft.prior_company_contact}`,
    `proof_type: ${draft.proof_type}`,
    intake.card_issuer_contact_email?.trim()
      ? `card_issuer_contact_email: ${intake.card_issuer_contact_email.trim()}`
      : `card_issuer_contact_email: (not set)`,
  ].filter(Boolean);
  const header = [
    marker,
    `case_id: ${caseId.trim()}`,
    `company: ${company}`,
    "packet:",
    ...packetLines,
    "evidence:",
    evidenceBlock,
    "draft:",
  ].join("\n");
  const remaining = MAX_NOTES - header.length - 1;
  const draftBody = remaining > 0 ? letter.slice(0, remaining) : "";
  return `${header}\n${draftBody}`;
}

export function taskNotesMatchPaymentDisputeFilingMarker(
  notes: string | null | undefined,
  caseId: string
): boolean {
  const marker = paymentDisputeFilingTaskNotesMarker(caseId);
  const trimmed = notes?.trim() ?? "";
  return trimmed === marker || trimmed.startsWith(`${marker}\n`);
}

export function findOpenPaymentDisputeFilingTask(
  tasks: readonly JusticeCaseTaskRow[],
  caseId: string
): JusticeCaseTaskRow | undefined {
  return tasks.find(
    (task) =>
      taskNotesMatchPaymentDisputeFilingMarker(task.notes, caseId) && !task.completed_at?.trim()
  );
}

export function parsePaymentDisputeFilingTaskDraft(notes: string | null | undefined): string {
  const trimmed = notes?.trim() ?? "";
  const draftIndex = trimmed.indexOf("\ndraft:\n");
  if (draftIndex < 0) return "";
  return trimmed.slice(draftIndex + "\ndraft:\n".length).trim();
}

/** True when client_state calls for an open payment-dispute operator filing queue entry. */
export function shouldQueuePaymentDisputeFilingTask(clientState: unknown): boolean {
  const parsed = parseJusticeCaseClientState(clientState);
  if (!parsed.prepared_packet_approved) return false;
  const next = parsed.approved_next_action;
  if (!next) return false;
  if (next.href?.trim() !== MANUAL_ACTION_TRACKING_REAL_PAYMENT_DISPUTE_PREP_HREF) return false;
  if (next.status === "completed") return false;
  return true;
}

export function isApprovedPaymentDisputeFilingAction(
  next: JusticeApprovedNextAction | undefined
): next is JusticeApprovedNextAction {
  if (!next) return false;
  return next.href?.trim() === MANUAL_ACTION_TRACKING_REAL_PAYMENT_DISPUTE_PREP_HREF;
}

const PAYMENT_DISPUTE_APPROVED_ACTION_FOR_FILING_TRACKING = {
  href: MANUAL_ACTION_TRACKING_REAL_PAYMENT_DISPUTE_PREP_HREF,
  label: "Payment dispute (bank/card)",
} as const;

/**
 * Payment dispute's own action identity — stable regardless of where the case's escalation
 * ladder currently points. Used to ensure payment dispute's own follow-up after a bounce
 * remediation even once the ladder has advanced to a later lane; must never be built from (or
 * written back into) the case's current approved_next_action, which may no longer be payment
 * dispute's.
 *
 * Carries its own follow_up_at, scheduled from the successful remediation itself (filedAt,
 * defaulting to now) — never inherited from the case's current action, since that belongs to a
 * different lane. Without its own due date this follow-up could never become due and would sit
 * open forever (processDueFollowUps only ever evaluates a task's own due_date).
 */
export function paymentDisputeCanonicalApprovedActionForFollowUp(
  filedAt?: string
): JusticeApprovedNextAction {
  return {
    ...PAYMENT_DISPUTE_APPROVED_ACTION_FOR_FILING_TRACKING,
    follow_up_needed: true,
    follow_up_at: buildDefaultFollowUpAtAfterRealBbbAutofill(filedAt),
  };
}

export function paymentDisputeFilingsForManualTracking<T extends ManualActionTrackingFiling>(
  filings: readonly T[]
): T[] {
  return filingsForApprovedActionManualTracking(
    filings,
    PAYMENT_DISPUTE_APPROVED_ACTION_FOR_FILING_TRACKING
  );
}

export function hasPaymentDisputeFilingRecord(
  filings: readonly ManualActionTrackingFiling[]
): boolean {
  return paymentDisputeFilingsForManualTracking(filings).length > 0;
}

export function hasPaymentDisputeFilingWithConfirmation(
  filings: readonly ManualActionTrackingFiling[]
): boolean {
  return paymentDisputeFilingsForManualTracking(filings).some((f) =>
    Boolean(f.confirmation_number?.trim())
  );
}

export function findPaymentDisputeFilingWithConfirmation(
  filings: readonly JusticeCaseFilingRow[]
): JusticeCaseFilingRow | undefined {
  return paymentDisputeFilingsForManualTracking(filings).find((f) =>
    Boolean(f.confirmation_number?.trim())
  );
}

/**
 * Most recently created payment-dispute filing for this case, regardless of confirmation state.
 * After a bounce, remediation creates a fresh filing row alongside the preserved bounced one —
 * this is what chat/status bounce alerts read so they clear once the newer filing lands.
 */
export function findLatestPaymentDisputeFiling(
  filings: readonly JusticeCaseFilingRow[]
): JusticeCaseFilingRow | undefined {
  const laneFilings = paymentDisputeFilingsForManualTracking(filings);
  if (laneFilings.length === 0) return undefined;
  return [...laneFilings].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
}

/**
 * created_at of the most recently created payment-dispute filing for this case, fetched fresh
 * from the database: null if none exists yet (confirmed absence), or the literal "error" if the
 * lookup itself failed. Used by bounce/complaint replay handling to detect whether a given
 * attempt has since been superseded by a newer, successful filing — callers must fail closed on
 * "error" rather than treat it as confirmed absence.
 */
export async function findLatestPaymentDisputeFilingCreatedAt(
  supabase: SupabaseClient,
  userId: string,
  caseId: string
): Promise<string | null | "error"> {
  const { data, error } = await supabase
    .from("justice_case_filings")
    .select(
      "id, user_id, case_id, destination, filed_at, confirmation_number, filing_url, notes, created_at, updated_at"
    )
    .eq("user_id", userId)
    .eq("case_id", caseId);

  if (error) {
    console.warn(
      "justice payment dispute filing task: select latest filing created_at",
      error.message
    );
    return "error";
  }

  const latest = findLatestPaymentDisputeFiling((data ?? []) as JusticeCaseFilingRow[]);
  return latest?.created_at ?? null;
}

/** Stable idempotent timeline id when a payment-dispute operator filing task is completed. */
export function paymentDisputeFilingTaskCompletedTimelineId(taskId: string): string {
  return `payment_dispute_filing_task_done:${taskId}`;
}

export type CompletePaymentDisputeFilingTaskResult = {
  task: JusticeCaseTaskRow | null;
  timeline: TimelineEntry[] | null;
  completed: boolean;
};

/**
 * Completes the payment-dispute operator filing task when filing is recorded.
 * Idempotent: no-op when task is missing or already completed.
 */
export async function completePaymentDisputeFilingTaskIfOpen(
  supabase: SupabaseClient,
  userId: string,
  caseId: string,
  taskId?: string
): Promise<CompletePaymentDisputeFilingTaskResult> {
  const marker = paymentDisputeFilingTaskNotesMarker(caseId);

  let query = supabase
    .from("justice_case_tasks")
    .select(TASK_SELECT)
    .eq("user_id", userId)
    .eq("case_id", caseId)
    .like("notes", `${marker}%`)
    .limit(1);

  if (taskId?.trim()) {
    query = supabase
      .from("justice_case_tasks")
      .select(TASK_SELECT)
      .eq("user_id", userId)
      .eq("case_id", caseId)
      .eq("id", taskId.trim())
      .limit(1);
  }

  const { data: existingRows, error: existingErr } = await query;

  if (existingErr) {
    console.warn("justice payment dispute filing task: select for complete", existingErr.message);
    return { task: null, timeline: null, completed: false };
  }

  const task = existingRows?.[0] as JusticeCaseTaskRow | undefined;
  if (!task || !taskNotesMatchPaymentDisputeFilingMarker(task.notes, caseId)) {
    return { task: null, timeline: null, completed: false };
  }
  if (task.completed_at?.trim()) {
    return { task, timeline: null, completed: false };
  }

  const completedAt = new Date().toISOString();
  const { data, error } = await supabase
    .from("justice_case_tasks")
    .update({ completed_at: completedAt })
    .eq("id", task.id)
    .eq("user_id", userId)
    .select(TASK_SELECT)
    .maybeSingle();

  if (error || !data) {
    console.warn(
      "justice payment dispute filing task: complete update",
      error?.message ?? "not found"
    );
    return { task, timeline: null, completed: false };
  }

  const updated = data as JusticeCaseTaskRow;
  const timeline = await appendCaseTimelineEntry(supabase, userId, caseId, {
    id: paymentDisputeFilingTaskCompletedTimelineId(task.id),
    type: "task_completed",
    label: "Payment dispute filing completed",
    detail: updated.title.trim(),
    ts: completedAt,
  });

  return { task: updated, timeline, completed: true };
}

export type EnsurePaymentDisputeFilingTaskResult = {
  task: JusticeCaseTaskRow | null;
  timeline: TimelineEntry[] | null;
  created: boolean;
};

/**
 * Ensures one payment-dispute operator filing task exists for the case (idempotent by notes marker).
 * Appends `task_added` timeline only when a new row is inserted.
 */
export async function ensurePaymentDisputeFilingTask(
  supabase: SupabaseClient,
  userId: string,
  caseId: string,
  intake: JusticeIntake,
  paymentDisputeDraft?: unknown
): Promise<EnsurePaymentDisputeFilingTaskResult> {
  const marker = paymentDisputeFilingTaskNotesMarker(caseId);

  // Only an OPEN task counts as "already queued" — a closed (completed or operator-cancelled)
  // task must not block a fresh one from being created when this destination is approved again.
  const { data: existingRows, error: existingErr } = await supabase
    .from("justice_case_tasks")
    .select(TASK_SELECT)
    .eq("user_id", userId)
    .eq("case_id", caseId)
    .like("notes", `${marker}%`)
    .is("completed_at", null)
    .limit(1);

  if (existingErr) {
    console.warn("justice payment dispute filing task: select existing", existingErr.message);
    return { task: null, timeline: null, created: false };
  }

  const existing = existingRows?.[0] as JusticeCaseTaskRow | undefined;
  if (existing) {
    return { task: existing, timeline: null, created: false };
  }

  const draft = resolvePaymentDisputeDraftForOperatorPacket(caseId, intake, paymentDisputeDraft);

  let evidence: PaymentDisputeEvidenceSummaryLine[] = [];
  const { data: evidenceRows, error: evidenceErr } = await supabase
    .from("justice_case_evidence")
    .select(EVIDENCE_SELECT)
    .eq("user_id", userId)
    .eq("case_id", caseId)
    .order("created_at", { ascending: true })
    .limit(40);

  if (evidenceErr) {
    console.warn("justice payment dispute filing task: list evidence", evidenceErr.message);
  } else {
    evidence = ((evidenceRows ?? []) as PaymentDisputeEvidenceSummaryLine[]).map((row) => ({
      title: typeof row.title === "string" ? row.title : "",
      evidence_type: typeof row.evidence_type === "string" ? row.evidence_type : "other",
      evidence_date: typeof row.evidence_date === "string" ? row.evidence_date : null,
    }));
  }

  const title = buildPaymentDisputeFilingTaskTitle(intake);
  const notes = buildPaymentDisputeFilingTaskNotes(caseId, intake, draft, evidence);

  const { data, error } = await supabase
    .from("justice_case_tasks")
    .insert({
      user_id: userId,
      case_id: caseId,
      title,
      notes,
    })
    .select(TASK_SELECT)
    .single();

  if (error) {
    console.warn("justice payment dispute filing task: insert", error.message);
    return { task: null, timeline: null, created: false };
  }

  const task = data as JusticeCaseTaskRow;
  const timeline = await appendCaseTimelineEntry(supabase, userId, caseId, {
    id: `justice_task_add:${task.id}`,
    type: "task_added",
    label: "Payment dispute filing queued",
    detail: task.title,
  });

  return { task, timeline, created: true };
}

const BOUNCE_TITLE_PREFIX_PATTERN = /^\[Needs manual follow-up[^\]]*\]\s*/;

export type ReopenPaymentDisputeFilingTaskForBounceResult = {
  task: JusticeCaseTaskRow | null;
  timeline: TimelineEntry[] | null;
  reopened: boolean;
};

/**
 * Reopens the payment-dispute operator task after a bounce/complaint so the case reappears in
 * /operator/fulfillment for manual follow-up, and prefixes the title so the reason is visible
 * directly in the queue. Targets the most recently created task matching this case's marker
 * (a case can accumulate more than one over its lifetime if the step was re-queued).
 */
export async function reopenPaymentDisputeFilingTaskForBounce(
  supabase: SupabaseClient,
  userId: string,
  caseId: string,
  bounceState: "bounced" | "complained"
): Promise<ReopenPaymentDisputeFilingTaskForBounceResult> {
  const marker = paymentDisputeFilingTaskNotesMarker(caseId);

  const { data: existingRows, error: existingErr } = await supabase
    .from("justice_case_tasks")
    .select(TASK_SELECT)
    .eq("user_id", userId)
    .eq("case_id", caseId)
    .like("notes", `${marker}%`)
    .order("created_at", { ascending: false })
    .limit(1);

  if (existingErr) {
    console.warn(
      "justice payment dispute filing task: select for bounce reopen",
      existingErr.message
    );
    return { task: null, timeline: null, reopened: false };
  }

  const task = existingRows?.[0] as JusticeCaseTaskRow | undefined;
  if (!task || !taskNotesMatchPaymentDisputeFilingMarker(task.notes, caseId)) {
    return { task: null, timeline: null, reopened: false };
  }

  const prefix =
    bounceState === "complained"
      ? "[Needs manual follow-up — marked as spam] "
      : "[Needs manual follow-up — bounced] ";
  const bareTitle = task.title.replace(BOUNCE_TITLE_PREFIX_PATTERN, "");
  const nextTitle = clampLen(`${prefix}${bareTitle}`, MAX_TITLE);

  const { data, error } = await supabase
    .from("justice_case_tasks")
    .update({ completed_at: null, title: nextTitle })
    .eq("id", task.id)
    .eq("user_id", userId)
    .select(TASK_SELECT)
    .maybeSingle();

  if (error || !data) {
    console.warn(
      "justice payment dispute filing task: bounce reopen update",
      error?.message ?? "not found"
    );
    return { task, timeline: null, reopened: false };
  }

  const updated = data as JusticeCaseTaskRow;
  const timeline = await appendCaseTimelineEntry(supabase, userId, caseId, {
    id: `payment_dispute_filing_task_reopened_${bounceState}:${task.id}`,
    type: "task_added",
    label: "Payment dispute task reopened for manual follow-up",
    detail:
      "The email did not reach the recipient. Reopened in the operator queue so the bank/card issuer can be contacted another way.",
  });

  return { task: updated, timeline, reopened: true };
}

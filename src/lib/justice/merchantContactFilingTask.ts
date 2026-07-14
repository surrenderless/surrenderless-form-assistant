import type { SupabaseClient } from "@supabase/supabase-js";
import { parseJusticeCaseClientState } from "@/lib/justice/approvedNextActionState";
import { buildMerchantMessage } from "@/lib/justice/buildMerchantContactMessage";
import { buildPacketPlainText } from "@/lib/justice/buildPacketPlainText";
import type { JusticeCaseEvidenceRow } from "@/lib/justice/evidence";
import {
  filingsForApprovedActionManualTracking,
  MANUAL_ACTION_TRACKING_REAL_MERCHANT_PREP_HREF,
  type ManualActionTrackingFiling,
} from "@/lib/justice/handlingTrackingProgress";
import type { JusticeCaseFilingRow } from "@/lib/justice/filings";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";
import type { JusticeApprovedNextAction, JusticeIntake, TimelineEntry } from "@/lib/justice/types";
import { cfpbLikelyRelevant, fccLikelyRelevant } from "@/lib/justice/rules";
import { appendCaseTimelineEntry } from "@/server/justiceTimelineAppend";

const MAX_TITLE = 500;
const MAX_NOTES = 8000;
const MERCHANT_CONTACT_TASK_TITLE_PREFIX = "Merchant contact: ";
const COMPANY_CONTACT_TASK_TITLE_PREFIX = "Company contact: ";

const TASK_SELECT =
  "id, user_id, case_id, title, due_date, notes, completed_at, created_at, updated_at" as const;

const EVIDENCE_SELECT =
  "id, user_id, case_id, title, evidence_type, evidence_date, description, source_url, storage_note, file_name, mime_type, file_size_bytes, created_at, updated_at" as const;

function clampLen(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max);
}

function useCompanyContactLabels(intake: JusticeIntake): boolean {
  return cfpbLikelyRelevant(intake) || fccLikelyRelevant(intake);
}

function desiredResolutionLine(intake: JusticeIntake): string {
  switch (intake.problem_category) {
    case "online_purchase":
      return "a full refund or a correct replacement, whichever fairly applies";
    case "subscription":
      return "cancellation of unwanted recurring charges and any refund owed for improper renewals";
    case "service_failed":
      return "a remedy that matches what was promised (refund, redo, or credit)";
    case "charge_dispute":
      return "reversal of the charge or a clear written justification";
    default:
      return "a fair resolution that puts the consumer back to where they should have been";
  }
}

/** Stable idempotency marker stored at the start of task notes. */
export function merchantContactFilingTaskNotesMarker(caseId: string): string {
  return `merchant_contact_queue:${caseId.trim()}`;
}

export function buildMerchantContactFilingTaskTitle(intake: JusticeIntake): string {
  const company = intake.company_name.trim() || "consumer case";
  const prefix = useCompanyContactLabels(intake)
    ? COMPANY_CONTACT_TASK_TITLE_PREFIX
    : MERCHANT_CONTACT_TASK_TITLE_PREFIX;
  return clampLen(`${prefix}${company}`, MAX_TITLE);
}

export type MerchantContactEvidenceSummaryLine = {
  title: string;
  evidence_type: string;
  evidence_date?: string | null;
};

export function buildMerchantContactEvidenceInventory(
  evidence: readonly MerchantContactEvidenceSummaryLine[]
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

function evidenceRowsForPacket(
  caseId: string,
  userId: string,
  evidence: readonly MerchantContactEvidenceSummaryLine[]
): JusticeCaseEvidenceRow[] {
  const now = new Date().toISOString();
  return evidence.map((row, index) => ({
    id: `merchant-ev-${index}`,
    user_id: userId,
    case_id: caseId,
    title: row.title,
    evidence_type: row.evidence_type,
    evidence_date: row.evidence_date ?? null,
    description: null,
    source_url: null,
    storage_note: null,
    file_name: null,
    mime_type: null,
    file_size_bytes: null,
    created_at: now,
    updated_at: now,
  }));
}

export function buildMerchantContactIdentityBlock(intake: JusticeIntake): string {
  const company = intake.company_name.trim() || "(unknown company)";
  const website = intake.company_website.trim() || "(none on file)";
  const consumer = intake.user_display_name.trim() || "(consumer name missing)";
  const email = intake.reply_email.trim() || "(reply email missing)";
  const companyEmail = intake.company_contact_email?.trim() || "(company contact email not set)";
  const state = intake.consumer_us_state?.trim().toUpperCase() || "(state not set)";
  return [
    `merchant/company: ${company}`,
    `website: ${website}`,
    `company_contact_email: ${companyEmail}`,
    `consumer: ${consumer}`,
    `reply_email: ${email}`,
    `consumer_us_state: ${state}`,
    `purchase_or_signup: ${intake.purchase_or_signup.trim() || "(not set)"}`,
    `money_involved: ${intake.money_involved.trim() || "(not set)"}`,
    `pay_or_order_date: ${intake.pay_or_order_date.trim() || "(not set)"}`,
  ].join("\n");
}

export function buildMerchantContactFilingTaskNotes(
  caseId: string,
  intake: JusticeIntake,
  evidence: readonly MerchantContactEvidenceSummaryLine[] = [],
  opts?: { userId?: string; packetText?: string }
): string {
  const marker = merchantContactFilingTaskNotesMarker(caseId);
  const draft = buildMerchantMessage(intake);
  const evidenceBlock = buildMerchantContactEvidenceInventory(evidence);
  const identity = buildMerchantContactIdentityBlock(intake);
  const resolution = desiredResolutionLine(intake);
  const packet =
    opts?.packetText?.trim() ||
    buildPacketPlainText(
      intake,
      [],
      evidenceRowsForPacket(caseId, opts?.userId ?? "operator", evidence),
      [],
      caseId
    );
  const header = [
    marker,
    `case_id: ${caseId.trim()}`,
    "merchant_identity:",
    identity,
    `requested_resolution: ${resolution}`,
    "packet:",
    packet,
    "evidence:",
    evidenceBlock,
    "draft:",
  ].join("\n");
  const remaining = MAX_NOTES - header.length - 1;
  const draftBody = remaining > 0 ? draft.slice(0, remaining) : "";
  const notes = `${header}\n${draftBody}`;
  return notes.length <= MAX_NOTES ? notes : notes.slice(0, MAX_NOTES);
}

export function taskNotesMatchMerchantContactFilingMarker(
  notes: string | null | undefined,
  caseId: string
): boolean {
  const marker = merchantContactFilingTaskNotesMarker(caseId);
  const trimmed = notes?.trim() ?? "";
  return trimmed === marker || trimmed.startsWith(`${marker}\n`);
}

export function findOpenMerchantContactFilingTask(
  tasks: readonly JusticeCaseTaskRow[],
  caseId: string
): JusticeCaseTaskRow | undefined {
  return tasks.find(
    (task) =>
      taskNotesMatchMerchantContactFilingMarker(task.notes, caseId) && !task.completed_at?.trim()
  );
}

export function parseMerchantContactFilingTaskDraft(notes: string | null | undefined): string {
  const trimmed = notes?.trim() ?? "";
  const draftIndex = trimmed.indexOf("\ndraft:\n");
  if (draftIndex < 0) return "";
  return trimmed.slice(draftIndex + "\ndraft:\n".length).trim();
}

/** True when client_state calls for an open merchant-contact operator queue entry. */
export function shouldQueueMerchantContactFilingTask(clientState: unknown): boolean {
  const parsed = parseJusticeCaseClientState(clientState);
  if (!parsed.prepared_packet_approved) return false;
  const next = parsed.approved_next_action;
  if (!next) return false;
  if (next.href?.trim() !== MANUAL_ACTION_TRACKING_REAL_MERCHANT_PREP_HREF) return false;
  if (next.status === "completed") return false;
  return true;
}

export function isApprovedMerchantContactFilingAction(
  next: JusticeApprovedNextAction | undefined
): next is JusticeApprovedNextAction {
  if (!next) return false;
  return next.href?.trim() === MANUAL_ACTION_TRACKING_REAL_MERCHANT_PREP_HREF;
}

const MERCHANT_APPROVED_ACTION_FOR_FILING_TRACKING = {
  href: MANUAL_ACTION_TRACKING_REAL_MERCHANT_PREP_HREF,
  label: "Merchant contact",
} as const;

export function merchantContactFilingsForManualTracking<T extends ManualActionTrackingFiling>(
  filings: readonly T[]
): T[] {
  return filingsForApprovedActionManualTracking(filings, MERCHANT_APPROVED_ACTION_FOR_FILING_TRACKING);
}

export function hasMerchantContactFilingRecord(
  filings: readonly ManualActionTrackingFiling[]
): boolean {
  return merchantContactFilingsForManualTracking(filings).length > 0;
}

export function hasMerchantContactFilingWithConfirmation(
  filings: readonly ManualActionTrackingFiling[]
): boolean {
  return merchantContactFilingsForManualTracking(filings).some((f) =>
    Boolean(f.confirmation_number?.trim())
  );
}

export function findMerchantContactFilingWithConfirmation(
  filings: readonly JusticeCaseFilingRow[]
): JusticeCaseFilingRow | undefined {
  return merchantContactFilingsForManualTracking(filings).find((f) =>
    Boolean(f.confirmation_number?.trim())
  );
}

/** Stable idempotent timeline id when a merchant-contact operator task is completed. */
export function merchantContactFilingTaskCompletedTimelineId(taskId: string): string {
  return `merchant_contact_task_done:${taskId}`;
}

export type CompleteMerchantContactFilingTaskResult = {
  task: JusticeCaseTaskRow | null;
  timeline: TimelineEntry[] | null;
  completed: boolean;
};

/**
 * Completes the merchant-contact operator task when outreach is recorded.
 * Idempotent: no-op when task is missing or already completed.
 */
export async function completeMerchantContactFilingTaskIfOpen(
  supabase: SupabaseClient,
  userId: string,
  caseId: string,
  taskId?: string
): Promise<CompleteMerchantContactFilingTaskResult> {
  const marker = merchantContactFilingTaskNotesMarker(caseId);

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
    console.warn("justice merchant contact task: select for complete", existingErr.message);
    return { task: null, timeline: null, completed: false };
  }

  const task = existingRows?.[0] as JusticeCaseTaskRow | undefined;
  if (!task || !taskNotesMatchMerchantContactFilingMarker(task.notes, caseId)) {
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
    console.warn("justice merchant contact task: complete update", error?.message ?? "not found");
    return { task, timeline: null, completed: false };
  }

  const updated = data as JusticeCaseTaskRow;
  const timeline = await appendCaseTimelineEntry(supabase, userId, caseId, {
    id: merchantContactFilingTaskCompletedTimelineId(task.id),
    type: "task_completed",
    label: "Merchant contact completed",
    detail: updated.title.trim(),
    ts: completedAt,
  });

  return { task: updated, timeline, completed: true };
}

export type EnsureMerchantContactFilingTaskResult = {
  task: JusticeCaseTaskRow | null;
  timeline: TimelineEntry[] | null;
  created: boolean;
};

/**
 * Ensures one merchant-contact operator task exists for the case (idempotent by notes marker).
 * Appends `task_added` timeline only when a new row is inserted.
 */
export async function ensureMerchantContactFilingTask(
  supabase: SupabaseClient,
  userId: string,
  caseId: string,
  intake: JusticeIntake
): Promise<EnsureMerchantContactFilingTaskResult> {
  const marker = merchantContactFilingTaskNotesMarker(caseId);

  const { data: existingRows, error: existingErr } = await supabase
    .from("justice_case_tasks")
    .select(TASK_SELECT)
    .eq("user_id", userId)
    .eq("case_id", caseId)
    .like("notes", `${marker}%`)
    .limit(1);

  if (existingErr) {
    console.warn("justice merchant contact task: select existing", existingErr.message);
    return { task: null, timeline: null, created: false };
  }

  const existing = existingRows?.[0] as JusticeCaseTaskRow | undefined;
  if (existing) {
    return { task: existing, timeline: null, created: false };
  }

  let evidence: MerchantContactEvidenceSummaryLine[] = [];
  let fullEvidence: JusticeCaseEvidenceRow[] = [];
  const { data: evidenceRows, error: evidenceErr } = await supabase
    .from("justice_case_evidence")
    .select(EVIDENCE_SELECT)
    .eq("user_id", userId)
    .eq("case_id", caseId)
    .order("created_at", { ascending: true })
    .limit(40);

  if (evidenceErr) {
    console.warn("justice merchant contact task: list evidence", evidenceErr.message);
  } else {
    fullEvidence = (evidenceRows ?? []) as JusticeCaseEvidenceRow[];
    evidence = fullEvidence.map((row) => ({
      title: typeof row.title === "string" ? row.title : "",
      evidence_type: typeof row.evidence_type === "string" ? row.evidence_type : "other",
      evidence_date: typeof row.evidence_date === "string" ? row.evidence_date : null,
    }));
  }

  let timeline: TimelineEntry[] = [];
  const { data: caseRow } = await supabase
    .from("justice_cases")
    .select("timeline")
    .eq("id", caseId)
    .eq("user_id", userId)
    .maybeSingle();
  if (Array.isArray(caseRow?.timeline)) {
    timeline = caseRow.timeline as TimelineEntry[];
  }

  let filings: JusticeCaseFilingRow[] = [];
  const { data: filingRows } = await supabase
    .from("justice_case_filings")
    .select(
      "id, user_id, case_id, destination, filed_at, confirmation_number, filing_url, notes, created_at, updated_at"
    )
    .eq("user_id", userId)
    .eq("case_id", caseId);
  if (filingRows) {
    filings = filingRows as JusticeCaseFilingRow[];
  }

  const packetText = buildPacketPlainText(intake, timeline, fullEvidence, filings, caseId);
  const title = buildMerchantContactFilingTaskTitle(intake);
  const notes = buildMerchantContactFilingTaskNotes(caseId, intake, evidence, {
    userId,
    packetText,
  });

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
    console.warn("justice merchant contact task: insert", error.message);
    return { task: null, timeline: null, created: false };
  }

  const task = data as JusticeCaseTaskRow;
  const companyContact = useCompanyContactLabels(intake);
  const appendedTimeline = await appendCaseTimelineEntry(supabase, userId, caseId, {
    id: `justice_task_add:${task.id}`,
    type: "task_added",
    label: companyContact ? "Company contact queued" : "Merchant contact queued",
    detail: task.title,
  });

  return { task, timeline: appendedTimeline, created: true };
}

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  mergeApprovedNextActionTrackingFields,
  mergeClientStateWithApprovedNextAction,
  omitClearedHandlingRequestNoteFromApprovedNextAction,
  parseJusticeCaseClientState,
} from "@/lib/justice/approvedNextActionState";
import { isJusticeIntakePayload } from "@/lib/justice/caseApiValidation";
import {
  ensureBbbFilingTask,
  shouldQueueBbbFilingTask,
} from "@/lib/justice/bbbFilingTask";
import {
  ensureCfpbFilingTask,
  shouldQueueCfpbFilingTask,
} from "@/lib/justice/cfpbFilingTask";
import {
  ensureDemandLetterFilingTask,
  shouldQueueDemandLetterFilingTask,
} from "@/lib/justice/demandLetterFilingTask";
import { attemptAutomatedDemandLetterEmailDeliveryAfterEnsure } from "@/lib/justice/demandLetterEmailDelivery";
import {
  ensureDotFilingTask,
  shouldQueueDotFilingTask,
} from "@/lib/justice/dotFilingTask";
import {
  ensureFccFilingTask,
  shouldQueueFccFilingTask,
} from "@/lib/justice/fccFilingTask";
import {
  ensureFtcFilingTask,
  shouldQueueFtcFilingTask,
} from "@/lib/justice/ftcFilingTask";
import {
  buildUpdatedIntakeAfterMerchantContact,
  validateMerchantContactDocumentation,
  type MerchantContactDocumentationInput,
} from "@/lib/justice/documentMerchantContact";
import {
  completeMerchantContactFilingTaskIfOpen,
  hasMerchantContactFilingWithConfirmation,
  merchantContactFilingsForManualTracking,
  taskNotesMatchMerchantContactFilingMarker,
} from "@/lib/justice/merchantContactFilingTask";
import {
  canonicalFilingDestinationForApprovedActionHref,
  MANUAL_ACTION_TRACKING_REAL_MERCHANT_PREP_HREF,
} from "@/lib/justice/handlingTrackingProgress";
import type { JusticeCaseFilingRow } from "@/lib/justice/filings";
import { mergeResolutionTrackingIntoClientState } from "@/lib/justice/initiateResolutionAfterEscalationTerminal";
import { ensureFollowUpAfterOperatorClientStateWrite } from "@/lib/justice/ensureFollowUpAfterOperatorClientStateWrite";
import {
  ensurePaymentDisputeFilingTask,
  shouldQueuePaymentDisputeFilingTask,
} from "@/lib/justice/paymentDisputeFilingTask";
import { attemptAutomatedPaymentDisputeEmailDelivery } from "@/lib/justice/paymentDisputeEmailDelivery";
import { advanceApprovedNextActionAfterCompleted } from "@/lib/justice/recomputeApprovedNextActionAfterIntake";
import { cfpbLikelyRelevant, fccLikelyRelevant } from "@/lib/justice/rules";
import {
  ensureStateAgFilingTask,
  shouldQueueStateAgFilingTask,
} from "@/lib/justice/stateAgFilingTask";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";
import type {
  ContactMethod,
  JusticeApprovedNextAction,
  JusticeIntake,
  MerchantResponseType,
  TimelineEntry,
} from "@/lib/justice/types";
import { appendCaseTimelineEntry } from "@/server/justiceTimelineAppend";

const FILING_SELECT =
  "id, user_id, case_id, destination, filed_at, confirmation_number, filing_url, notes, created_at, updated_at" as const;

const TASK_SELECT =
  "id, user_id, case_id, title, due_date, notes, completed_at, created_at, updated_at" as const;

const MAX_DEST = 500;
const MAX_FILED_AT = 200;
const MAX_CONFIRM = 200;
const MAX_NOTES = 8000;
const MAX_RECIPIENT = 500;

const CONTACT_METHODS = new Set<ContactMethod>([
  "email",
  "chat",
  "phone",
  "form",
  "in_person",
  "other",
]);

const MERCHANT_RESPONSE_TYPES = new Set<MerchantResponseType>([
  "no_response",
  "refused_help",
  "promised_but_did_not_fix",
  "partial_help",
  "asked_more_info",
  "other",
  "resolved",
]);

function clampLen(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max);
}

function buildCompletedApprovedNextAction(approvedNextAction: JusticeApprovedNextAction): {
  withTracking: JusticeApprovedNextAction;
  local: JusticeApprovedNextAction;
} {
  const targetHref = approvedNextAction.href?.trim() || "/justice/packet";
  const label = approvedNextAction.label?.trim();
  const next: JusticeApprovedNextAction = {
    ...approvedNextAction,
    ...(label ? { label } : {}),
    href: approvedNextAction.href ?? targetHref,
    status: "completed",
    completed_at: approvedNextAction.completed_at ?? new Date().toISOString(),
    ...(approvedNextAction.approved_at ? { approved_at: approvedNextAction.approved_at } : {}),
    ...(approvedNextAction.started_at ? { started_at: approvedNextAction.started_at } : {}),
  };
  const withTracking = mergeApprovedNextActionTrackingFields(approvedNextAction, next);
  const local = omitClearedHandlingRequestNoteFromApprovedNextAction(withTracking);
  return { withTracking, local };
}

function buildOperatorFilingNotes(input: {
  contactMethod: ContactMethod;
  recipient: string;
  operatorNotes: string | null;
}): string | null {
  const lines = [
    `outreach_channel: ${input.contactMethod}`,
    `recipient: ${input.recipient}`,
  ];
  if (input.operatorNotes?.trim()) {
    lines.push(`operator_notes: ${input.operatorNotes.trim()}`);
  }
  return clampLen(lines.join("\n"), MAX_NOTES);
}

export type CompleteMerchantContactOperatorFilingInput = {
  caseId: string;
  taskId: string;
  destination: string;
  filedAt: string;
  confirmationNumber: string;
  contactMethod: ContactMethod;
  merchantResponseType: MerchantResponseType;
  recipient?: string | null;
  notes?: string | null;
};

export type CompleteMerchantContactOperatorFilingResult =
  | {
      ok: true;
      filing: JusticeCaseFilingRow;
      task: JusticeCaseTaskRow;
      intake: JusticeIntake;
      clientState: Record<string, unknown>;
      timeline: TimelineEntry[] | null;
      advanced: boolean;
      idempotent: boolean;
    }
  | { ok: false; error: string; status: number };

export async function completeMerchantContactOperatorFiling(
  supabase: SupabaseClient,
  userId: string,
  input: CompleteMerchantContactOperatorFilingInput
): Promise<CompleteMerchantContactOperatorFilingResult> {
  const caseId = input.caseId.trim();
  const taskId = input.taskId.trim();
  const destination = clampLen(input.destination.trim(), MAX_DEST);
  const filedAt = clampLen(input.filedAt.trim(), MAX_FILED_AT);
  const confirmationNumber = clampLen(input.confirmationNumber.trim(), MAX_CONFIRM);
  const contactMethod = input.contactMethod;
  const merchantResponseType = input.merchantResponseType;
  const operatorNotes = input.notes?.trim() ? clampLen(input.notes.trim(), MAX_NOTES) : null;

  if (!destination) {
    return { ok: false, error: "destination is required", status: 400 };
  }
  if (!filedAt) {
    return { ok: false, error: "filed_at is required", status: 400 };
  }
  if (!confirmationNumber) {
    return { ok: false, error: "confirmation_number is required", status: 400 };
  }
  if (!CONTACT_METHODS.has(contactMethod)) {
    return { ok: false, error: "Invalid contact_method", status: 400 };
  }
  if (!MERCHANT_RESPONSE_TYPES.has(merchantResponseType)) {
    return { ok: false, error: "Invalid merchant_response_type", status: 400 };
  }

  const canonicalDestination =
    canonicalFilingDestinationForApprovedActionHref(MANUAL_ACTION_TRACKING_REAL_MERCHANT_PREP_HREF) ??
    destination;
  if (destination !== canonicalDestination) {
    return { ok: false, error: "Invalid merchant contact destination", status: 400 };
  }

  const { data: caseRow, error: caseErr } = await supabase
    .from("justice_cases")
    .select("intake, client_state, timeline, payment_dispute_draft")
    .eq("id", caseId)
    .eq("user_id", userId)
    .maybeSingle();

  if (caseErr || !caseRow) {
    return { ok: false, error: "Not found", status: 404 };
  }

  if (!isJusticeIntakePayload(caseRow.intake)) {
    return { ok: false, error: "Case intake is invalid", status: 400 };
  }
  const priorIntake = caseRow.intake as JusticeIntake;
  const recipient = clampLen(
    (input.recipient?.trim() || priorIntake.company_name.trim() || "merchant/company"),
    MAX_RECIPIENT
  );

  const documentationInput: MerchantContactDocumentationInput = {
    contactMethod,
    contactDate: filedAt,
    merchantResponseType,
    contactProofType: "ticket",
    contactProofText: confirmationNumber,
  };
  const validation = validateMerchantContactDocumentation(documentationInput);
  if (!validation.ok) {
    return {
      ok: false,
      error: validation.contactDateError ?? validation.contactProofError ?? "Invalid contact details",
      status: 400,
    };
  }
  const updatedIntake = buildUpdatedIntakeAfterMerchantContact(priorIntake, documentationInput);

  const { data: taskRow, error: taskErr } = await supabase
    .from("justice_case_tasks")
    .select(TASK_SELECT)
    .eq("id", taskId)
    .eq("user_id", userId)
    .eq("case_id", caseId)
    .maybeSingle();

  if (taskErr || !taskRow) {
    return { ok: false, error: "Merchant contact operator task not found", status: 404 };
  }

  const task = taskRow as JusticeCaseTaskRow;
  if (!taskNotesMatchMerchantContactFilingMarker(task.notes, caseId)) {
    return { ok: false, error: "Task is not a merchant contact operator task", status: 400 };
  }

  const { data: existingFilings, error: filingsErr } = await supabase
    .from("justice_case_filings")
    .select(FILING_SELECT)
    .eq("case_id", caseId)
    .eq("user_id", userId);

  if (filingsErr) {
    console.warn("justice merchant contact operator: list filings", filingsErr.message);
    return { ok: false, error: filingsErr.message, status: 500 };
  }

  const merchantFilings = merchantContactFilingsForManualTracking(
    (existingFilings ?? []) as JusticeCaseFilingRow[]
  );
  if (merchantFilings.length > 0) {
    if (!hasMerchantContactFilingWithConfirmation(merchantFilings)) {
      return {
        ok: false,
        error: "A merchant contact record already exists for this case without confirmation",
        status: 409,
      };
    }
  }

  let filing: JusticeCaseFilingRow;
  let timeline: TimelineEntry[] | null = null;
  let idempotent = false;

  if (merchantFilings.length > 0 && task.completed_at?.trim()) {
    idempotent = true;
    filing = merchantFilings.find((f) => f.confirmation_number?.trim()) as JusticeCaseFilingRow;
  } else if (merchantFilings.length > 0) {
    filing = merchantFilings.find((f) => f.confirmation_number?.trim()) as JusticeCaseFilingRow;
    idempotent = true;
  } else {
    const filingNotes = buildOperatorFilingNotes({
      contactMethod,
      recipient,
      operatorNotes,
    });
    const insertRow: Record<string, unknown> = {
      user_id: userId,
      case_id: caseId,
      destination,
      filed_at: filedAt,
      confirmation_number: confirmationNumber,
    };
    if (filingNotes) insertRow.notes = filingNotes;

    const { data: inserted, error: insertErr } = await supabase
      .from("justice_case_filings")
      .insert(insertRow)
      .select(FILING_SELECT)
      .single();

    if (insertErr || !inserted) {
      console.warn("justice merchant contact operator: insert", insertErr?.message ?? "failed");
      return {
        ok: false,
        error: insertErr?.message ?? "Could not save contact record",
        status: 500,
      };
    }

    filing = inserted as JusticeCaseFilingRow;
    const detail = `${filing.destination} — ${contactMethod} to ${recipient} — ${confirmationNumber}`;
    timeline = await appendCaseTimelineEntry(supabase, userId, caseId, {
      id: `justice_fil:${filing.id}`,
      type: "filing_recorded",
      label: "Merchant contact recorded",
      detail,
    });
  }

  const companyContact = cfpbLikelyRelevant(updatedIntake) || fccLikelyRelevant(updatedIntake);
  const contactTimeline = await appendCaseTimelineEntry(supabase, userId, caseId, {
    id: `merchant_contact_saved:${caseId}:${filedAt}:${confirmationNumber}`,
    type: "merchant_contact_saved",
    label: companyContact ? "Company contact documented" : "Merchant contact saved",
    detail: `${companyContact ? "Company" : "Merchant"} response: ${merchantResponseType}`,
  });
  if (contactTimeline) {
    timeline = contactTimeline;
  }

  const { error: intakePatchErr } = await supabase
    .from("justice_cases")
    .update({ intake: updatedIntake })
    .eq("id", caseId)
    .eq("user_id", userId);

  if (intakePatchErr) {
    console.warn("justice merchant contact operator: patch intake", intakePatchErr.message);
    return {
      ok: false,
      error: "Contact recorded but could not update case intake",
      status: 500,
    };
  }

  const taskResult = await completeMerchantContactFilingTaskIfOpen(
    supabase,
    userId,
    caseId,
    taskId
  );
  if (!taskResult.task) {
    return {
      ok: false,
      error: "Contact saved but could not complete the merchant contact operator task",
      status: 500,
    };
  }
  if (!taskResult.task.completed_at?.trim()) {
    return {
      ok: false,
      error: "Contact saved but could not complete the merchant contact operator task",
      status: 500,
    };
  }
  if (taskResult.timeline) {
    timeline = taskResult.timeline;
  }

  const parsedClientState = parseJusticeCaseClientState(caseRow.client_state);
  const approvedNext = parsedClientState.approved_next_action;
  let advanced = false;
  let nextApprovedNext: JusticeApprovedNextAction | undefined;

  if (
    approvedNext?.href?.trim() === MANUAL_ACTION_TRACKING_REAL_MERCHANT_PREP_HREF &&
    approvedNext.status !== "completed"
  ) {
    const completedHref = approvedNext.href.trim();
    const { withTracking: completedWithTracking } = buildCompletedApprovedNextAction(approvedNext);
    const advancedAction = advanceApprovedNextActionAfterCompleted(updatedIntake, completedHref, {
      existing: completedWithTracking,
    });
    if (
      advancedAction?.href?.trim() &&
      advancedAction.href.trim() !== completedHref &&
      advancedAction.status === "approved"
    ) {
      nextApprovedNext = omitClearedHandlingRequestNoteFromApprovedNextAction(advancedAction);
      advanced = true;
    } else {
      nextApprovedNext = completedWithTracking;
    }
  } else if (approvedNext) {
    nextApprovedNext = approvedNext;
  }

  let clientState: Record<string, unknown> = parsedClientState as Record<string, unknown>;
  if (nextApprovedNext) {
    clientState = mergeClientStateWithApprovedNextAction(caseRow.client_state, nextApprovedNext);
    const resolutionMerged = mergeResolutionTrackingIntoClientState(clientState, updatedIntake);
    if (resolutionMerged) {
      clientState = resolutionMerged;
    }
    const { error: patchErr } = await supabase
      .from("justice_cases")
      .update({ client_state: clientState })
      .eq("id", caseId)
      .eq("user_id", userId);

    if (patchErr) {
      console.warn("justice merchant contact operator: patch client_state", patchErr.message);
      return {
        ok: false,
        error: "Contact recorded but could not advance the approved next action",
        status: 500,
      };
    }

    const followUpEnsure = await ensureFollowUpAfterOperatorClientStateWrite(supabase, {
      userId,
      caseId,
      existingClientState: caseRow.client_state,
      nextClientState: clientState,
    });
    if (!followUpEnsure.ok) {
      return {
        ok: false,
        error: followUpEnsure.error,
        status: 500,
      };
    }
    if (followUpEnsure.timeline) {
      timeline = followUpEnsure.timeline;
    }

    if (shouldQueuePaymentDisputeFilingTask(clientState)) {
      const queueResult = await ensurePaymentDisputeFilingTask(
        supabase,
        userId,
        caseId,
        updatedIntake,
        caseRow.payment_dispute_draft
      );
      if (queueResult.timeline) {
        timeline = queueResult.timeline;
      }
      const emailResult = await attemptAutomatedPaymentDisputeEmailDelivery(
        supabase,
        userId,
        caseId
      );
      if (
        (emailResult.status === "accepted" || emailResult.status === "failed") &&
        emailResult.timeline
      ) {
        timeline = emailResult.timeline;
      }
    }
    if (shouldQueueCfpbFilingTask(clientState)) {
      const queueResult = await ensureCfpbFilingTask(supabase, userId, caseId, updatedIntake);
      if (queueResult.timeline) {
        timeline = queueResult.timeline;
      }
    }
    if (shouldQueueFccFilingTask(clientState)) {
      const queueResult = await ensureFccFilingTask(supabase, userId, caseId, updatedIntake);
      if (queueResult.timeline) {
        timeline = queueResult.timeline;
      }
    }
    if (shouldQueueDotFilingTask(clientState)) {
      const queueResult = await ensureDotFilingTask(supabase, userId, caseId, updatedIntake);
      if (queueResult.timeline) {
        timeline = queueResult.timeline;
      }
    }
    if (shouldQueueFtcFilingTask(clientState)) {
      const queueResult = await ensureFtcFilingTask(supabase, userId, caseId, updatedIntake);
      if (queueResult.timeline) {
        timeline = queueResult.timeline;
      }
    }
    if (shouldQueueBbbFilingTask(clientState)) {
      const queueResult = await ensureBbbFilingTask(supabase, userId, caseId, updatedIntake);
      if (queueResult.timeline) {
        timeline = queueResult.timeline;
      }
    }
    if (shouldQueueStateAgFilingTask(clientState)) {
      const queueResult = await ensureStateAgFilingTask(supabase, userId, caseId, updatedIntake);
      if (queueResult.timeline) {
        timeline = queueResult.timeline;
      }
    }
    if (shouldQueueDemandLetterFilingTask(clientState)) {
      const queueResult = await ensureDemandLetterFilingTask(supabase, userId, caseId, updatedIntake);
      if (queueResult.timeline) {
        timeline = queueResult.timeline;
      }
      const emailAttempt = await attemptAutomatedDemandLetterEmailDeliveryAfterEnsure(
        supabase,
        userId,
        caseId,
        timeline
      );
      timeline = emailAttempt.timeline;
    }
  }

  return {
    ok: true,
    filing,
    task: taskResult.task,
    intake: updatedIntake,
    clientState,
    timeline,
    advanced,
    idempotent,
  };
}

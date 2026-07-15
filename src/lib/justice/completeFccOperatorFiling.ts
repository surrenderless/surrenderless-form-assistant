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
  completeFccFilingTaskIfOpen,
  fccFilingsForManualTracking,
  hasFccFilingWithConfirmation,
  taskNotesMatchFccFilingMarker,
} from "@/lib/justice/fccFilingTask";
import {
  ensureFtcFilingTask,
  shouldQueueFtcFilingTask,
} from "@/lib/justice/ftcFilingTask";
import {
  canonicalFilingDestinationForApprovedActionHref,
  MANUAL_ACTION_TRACKING_REAL_FCC_PREP_HREF,
} from "@/lib/justice/handlingTrackingProgress";
import type { JusticeCaseFilingRow } from "@/lib/justice/filings";
import { mergeResolutionTrackingIntoClientState } from "@/lib/justice/initiateResolutionAfterEscalationTerminal";
import {
  ensurePaymentDisputeFilingTask,
  shouldQueuePaymentDisputeFilingTask,
} from "@/lib/justice/paymentDisputeFilingTask";
import { advanceApprovedNextActionAfterCompleted } from "@/lib/justice/recomputeApprovedNextActionAfterIntake";
import {
  ensureStateAgFilingTask,
  shouldQueueStateAgFilingTask,
} from "@/lib/justice/stateAgFilingTask";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";
import type { JusticeApprovedNextAction, JusticeIntake, TimelineEntry } from "@/lib/justice/types";
import { appendCaseTimelineEntry } from "@/server/justiceTimelineAppend";

const FILING_SELECT =
  "id, user_id, case_id, destination, filed_at, confirmation_number, filing_url, notes, created_at, updated_at" as const;

const TASK_SELECT =
  "id, user_id, case_id, title, due_date, notes, completed_at, created_at, updated_at" as const;

const MAX_DEST = 500;
const MAX_FILED_AT = 200;
const MAX_CONFIRM = 200;
const MAX_NOTES = 8000;

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

export type CompleteFccOperatorFilingInput = {
  caseId: string;
  taskId: string;
  destination: string;
  filedAt: string;
  confirmationNumber: string;
  notes?: string | null;
};

export type CompleteFccOperatorFilingResult =
  | {
      ok: true;
      filing: JusticeCaseFilingRow;
      task: JusticeCaseTaskRow;
      clientState: Record<string, unknown>;
      timeline: TimelineEntry[] | null;
      advanced: boolean;
      idempotent: boolean;
    }
  | { ok: false; error: string; status: number };

export async function completeFccOperatorFiling(
  supabase: SupabaseClient,
  userId: string,
  input: CompleteFccOperatorFilingInput
): Promise<CompleteFccOperatorFilingResult> {
  const caseId = input.caseId.trim();
  const taskId = input.taskId.trim();
  const destination = clampLen(input.destination.trim(), MAX_DEST);
  const filedAt = clampLen(input.filedAt.trim(), MAX_FILED_AT);
  const confirmationNumber = clampLen(input.confirmationNumber.trim(), MAX_CONFIRM);
  const notes = input.notes?.trim() ? clampLen(input.notes.trim(), MAX_NOTES) : null;

  if (!destination) {
    return { ok: false, error: "destination is required", status: 400 };
  }
  if (!filedAt) {
    return { ok: false, error: "filed_at is required", status: 400 };
  }
  if (!confirmationNumber) {
    return { ok: false, error: "confirmation_number is required", status: 400 };
  }

  const canonicalDestination =
    canonicalFilingDestinationForApprovedActionHref(MANUAL_ACTION_TRACKING_REAL_FCC_PREP_HREF) ??
    destination;
  if (destination !== canonicalDestination) {
    return { ok: false, error: "Invalid FCC filing destination", status: 400 };
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
  const intake = caseRow.intake as JusticeIntake;

  const { data: taskRow, error: taskErr } = await supabase
    .from("justice_case_tasks")
    .select(TASK_SELECT)
    .eq("id", taskId)
    .eq("user_id", userId)
    .eq("case_id", caseId)
    .maybeSingle();

  if (taskErr || !taskRow) {
    return { ok: false, error: "FCC operator task not found", status: 404 };
  }

  const task = taskRow as JusticeCaseTaskRow;
  if (!taskNotesMatchFccFilingMarker(task.notes, caseId)) {
    return { ok: false, error: "Task is not an FCC operator filing task", status: 400 };
  }

  const { data: existingFilings, error: filingsErr } = await supabase
    .from("justice_case_filings")
    .select(FILING_SELECT)
    .eq("case_id", caseId)
    .eq("user_id", userId);

  if (filingsErr) {
    console.warn("justice fcc operator filing: list filings", filingsErr.message);
    return { ok: false, error: filingsErr.message, status: 500 };
  }

  const fccFilings = fccFilingsForManualTracking((existingFilings ?? []) as JusticeCaseFilingRow[]);
  if (fccFilings.length > 0) {
    if (!hasFccFilingWithConfirmation(fccFilings)) {
      return {
        ok: false,
        error: "An FCC filing record already exists for this case without confirmation",
        status: 409,
      };
    }
  }

  let filing: JusticeCaseFilingRow;
  let timeline: TimelineEntry[] | null = null;
  let idempotent = false;

  if (fccFilings.length > 0 && task.completed_at?.trim()) {
    idempotent = true;
    filing = fccFilings.find((f) => f.confirmation_number?.trim()) as JusticeCaseFilingRow;
  } else if (fccFilings.length > 0) {
    filing = fccFilings.find((f) => f.confirmation_number?.trim()) as JusticeCaseFilingRow;
    idempotent = true;
  } else {
    const insertRow: Record<string, unknown> = {
      user_id: userId,
      case_id: caseId,
      destination,
      filed_at: filedAt,
      confirmation_number: confirmationNumber,
    };
    if (notes) insertRow.notes = notes;

    const { data: inserted, error: insertErr } = await supabase
      .from("justice_case_filings")
      .insert(insertRow)
      .select(FILING_SELECT)
      .single();

    if (insertErr || !inserted) {
      console.warn("justice fcc operator filing: insert", insertErr?.message ?? "failed");
      return { ok: false, error: insertErr?.message ?? "Could not save filing record", status: 500 };
    }

    filing = inserted as JusticeCaseFilingRow;
    const detail = `${filing.destination} filed — ${confirmationNumber}`;
    timeline = await appendCaseTimelineEntry(supabase, userId, caseId, {
      id: `justice_fil:${filing.id}`,
      type: "filing_recorded",
      label: "Filing recorded",
      detail,
    });
  }

  const taskResult = await completeFccFilingTaskIfOpen(supabase, userId, caseId, taskId);
  if (!taskResult.task) {
    return {
      ok: false,
      error: "Filing saved but could not complete the FCC operator task",
      status: 500,
    };
  }
  if (!taskResult.task.completed_at?.trim()) {
    return {
      ok: false,
      error: "Filing saved but could not complete the FCC operator task",
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
    approvedNext?.href?.trim() === MANUAL_ACTION_TRACKING_REAL_FCC_PREP_HREF &&
    approvedNext.status !== "completed"
  ) {
    const completedHref = approvedNext.href.trim();
    const { withTracking: completedWithTracking } = buildCompletedApprovedNextAction(approvedNext);
    const advancedAction = advanceApprovedNextActionAfterCompleted(intake, completedHref, {
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
    const resolutionMerged = mergeResolutionTrackingIntoClientState(clientState, intake);
    if (resolutionMerged) {
      clientState = resolutionMerged;
    }
    const { error: patchErr } = await supabase
      .from("justice_cases")
      .update({ client_state: clientState })
      .eq("id", caseId)
      .eq("user_id", userId);

    if (patchErr) {
      console.warn("justice fcc operator filing: patch client_state", patchErr.message);
      return {
        ok: false,
        error: "Filing recorded but could not advance the approved next action",
        status: 500,
      };
    }

    if (shouldQueuePaymentDisputeFilingTask(clientState)) {
      const queueResult = await ensurePaymentDisputeFilingTask(
        supabase,
        userId,
        caseId,
        intake,
        caseRow.payment_dispute_draft
      );
      if (queueResult.timeline) {
        timeline = queueResult.timeline;
      }
    }
    if (shouldQueueCfpbFilingTask(clientState)) {
      const queueResult = await ensureCfpbFilingTask(supabase, userId, caseId, intake);
      if (queueResult.timeline) {
        timeline = queueResult.timeline;
      }
    }
    if (shouldQueueStateAgFilingTask(clientState)) {
      const queueResult = await ensureStateAgFilingTask(supabase, userId, caseId, intake);
      if (queueResult.timeline) {
        timeline = queueResult.timeline;
      }
    }
    if (shouldQueueDemandLetterFilingTask(clientState)) {
      const queueResult = await ensureDemandLetterFilingTask(supabase, userId, caseId, intake);
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
    if (shouldQueueDotFilingTask(clientState)) {
      const queueResult = await ensureDotFilingTask(supabase, userId, caseId, intake);
      if (queueResult.timeline) {
        timeline = queueResult.timeline;
      }
    }
    if (shouldQueueFtcFilingTask(clientState)) {
      const queueResult = await ensureFtcFilingTask(supabase, userId, caseId, intake);
      if (queueResult.timeline) {
        timeline = queueResult.timeline;
      }
    }
    if (shouldQueueBbbFilingTask(clientState)) {
      const queueResult = await ensureBbbFilingTask(supabase, userId, caseId, intake);
      if (queueResult.timeline) {
        timeline = queueResult.timeline;
      }
    }
  }

  return {
    ok: true,
    filing,
    task: taskResult.task,
    clientState,
    timeline,
    advanced,
    idempotent,
  };
}

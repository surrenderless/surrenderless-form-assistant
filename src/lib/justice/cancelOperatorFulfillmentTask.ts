import type { SupabaseClient } from "@supabase/supabase-js";
import {
  MANUAL_ACTION_TRACKING_REAL_BBB_PREP_HREF,
  MANUAL_ACTION_TRACKING_REAL_CFPB_PREP_HREF,
  MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF,
  MANUAL_ACTION_TRACKING_REAL_DOT_PREP_HREF,
  MANUAL_ACTION_TRACKING_REAL_FCC_PREP_HREF,
  MANUAL_ACTION_TRACKING_REAL_FTC_PREP_HREF,
  MANUAL_ACTION_TRACKING_REAL_MERCHANT_PREP_HREF,
  MANUAL_ACTION_TRACKING_REAL_PAYMENT_DISPUTE_PREP_HREF,
  MANUAL_ACTION_TRACKING_REAL_STATE_AG_PREP_HREF,
} from "@/lib/justice/handlingTrackingProgress";
import {
  bbbFilingTaskNotesMarker,
  taskNotesMatchBbbFilingMarker,
} from "@/lib/justice/bbbFilingTask";
import { isJusticeIntakePayload } from "@/lib/justice/caseApiValidation";
import { justiceEvidenceRowHasUploadedFile } from "@/lib/justice/evidence";
import {
  cfpbFilingTaskNotesMarker,
  taskNotesMatchCfpbFilingMarker,
} from "@/lib/justice/cfpbFilingTask";
import {
  demandLetterFilingTaskNotesMarker,
  taskNotesMatchDemandLetterFilingMarker,
} from "@/lib/justice/demandLetterFilingTask";
import { dotFilingTaskNotesMarker, taskNotesMatchDotFilingMarker } from "@/lib/justice/dotFilingTask";
import { fccFilingTaskNotesMarker, taskNotesMatchFccFilingMarker } from "@/lib/justice/fccFilingTask";
import { ftcFilingTaskNotesMarker, taskNotesMatchFtcFilingMarker } from "@/lib/justice/ftcFilingTask";
import {
  merchantContactFilingTaskNotesMarker,
  taskNotesMatchMerchantContactFilingMarker,
} from "@/lib/justice/merchantContactFilingTask";
import {
  paymentDisputeFilingTaskNotesMarker,
  taskNotesMatchPaymentDisputeFilingMarker,
} from "@/lib/justice/paymentDisputeFilingTask";
import {
  buildApprovedNextActionTarget,
  pickNextPreparedActionAfterCancelled,
} from "@/lib/justice/preparedNextAction";
import { cfpbLikelyRelevant, computeJusticeDestinations, dotLikelyRelevant, fccLikelyRelevant } from "@/lib/justice/rules";
import {
  stateAgFilingTaskNotesMarker,
  taskNotesMatchStateAgFilingMarker,
} from "@/lib/justice/stateAgFilingTask";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";

const TASK_SELECT =
  "id, user_id, case_id, title, due_date, notes, completed_at, created_at, updated_at" as const;

const MAX_OPERATOR_NOTE = 2000;

const RPC_NAME = "cancel_operator_fulfillment_task";

/** Bounded read-recompute-write retry bound for persisting a proposed next action after
 * cancellation — mirrors appendCaseTimelineEntry's MAX_APPEND_ATTEMPTS. */
const RECOMPUTE_NEXT_ACTION_MAX_ATTEMPTS = 5;

/**
 * Maps each fulfillment destination's approved-action href to the notes-marker matcher/builder
 * for that destination. Only these nine destinations are cancellable here; follow-up/response-
 * review tasks have their own completion flow and are intentionally excluded.
 *
 * This mapping is used only to classify which (href, marker) pair to assert to the atomic RPC —
 * the RPC re-checks the assertion against live, row-locked data itself, so a stale or incorrect
 * classification here can only cause a rejection, never an incorrect write.
 */
const HREF_DESTINATIONS: Record<
  string,
  {
    matches: (notes: string | null | undefined, caseId: string) => boolean;
    marker: (caseId: string) => string;
  }
> = {
  [MANUAL_ACTION_TRACKING_REAL_MERCHANT_PREP_HREF]: {
    matches: taskNotesMatchMerchantContactFilingMarker,
    marker: merchantContactFilingTaskNotesMarker,
  },
  [MANUAL_ACTION_TRACKING_REAL_STATE_AG_PREP_HREF]: {
    matches: taskNotesMatchStateAgFilingMarker,
    marker: stateAgFilingTaskNotesMarker,
  },
  [MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF]: {
    matches: taskNotesMatchDemandLetterFilingMarker,
    marker: demandLetterFilingTaskNotesMarker,
  },
  [MANUAL_ACTION_TRACKING_REAL_CFPB_PREP_HREF]: {
    matches: taskNotesMatchCfpbFilingMarker,
    marker: cfpbFilingTaskNotesMarker,
  },
  [MANUAL_ACTION_TRACKING_REAL_PAYMENT_DISPUTE_PREP_HREF]: {
    matches: taskNotesMatchPaymentDisputeFilingMarker,
    marker: paymentDisputeFilingTaskNotesMarker,
  },
  [MANUAL_ACTION_TRACKING_REAL_FCC_PREP_HREF]: {
    matches: taskNotesMatchFccFilingMarker,
    marker: fccFilingTaskNotesMarker,
  },
  [MANUAL_ACTION_TRACKING_REAL_DOT_PREP_HREF]: {
    matches: taskNotesMatchDotFilingMarker,
    marker: dotFilingTaskNotesMarker,
  },
  [MANUAL_ACTION_TRACKING_REAL_FTC_PREP_HREF]: {
    matches: taskNotesMatchFtcFilingMarker,
    marker: ftcFilingTaskNotesMarker,
  },
  [MANUAL_ACTION_TRACKING_REAL_BBB_PREP_HREF]: {
    matches: taskNotesMatchBbbFilingMarker,
    marker: bbbFilingTaskNotesMarker,
  },
};

function clampLen(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max);
}

export type CancelOperatorFulfillmentTaskInput = {
  taskId: string;
  operatorNote?: string | null;
};

export type CancelOperatorFulfillmentTaskResult =
  | {
      ok: true;
      task: JusticeCaseTaskRow;
      clientState: Record<string, unknown>;
    }
  | { ok: false; error: string; status: number };

type CancelRpcResult =
  | {
      ok: true;
      task_id: string;
      case_id: string;
      user_id: string;
      cancelled_at: string;
      notes: string | null;
      client_state: Record<string, unknown>;
    }
  | { ok: false; error: string; status?: number };

const RPC_ERROR_MESSAGES: Record<string, string> = {
  invalid_input: "task_id is required",
  task_not_found: "Task not found",
  case_mismatch: "Task does not match the expected case",
  task_already_closed: "Task is already closed",
  task_marker_mismatch: "Task does not match an open, approved fulfillment action for this case",
  case_not_found: "Case not found",
  case_user_mismatch: "Task and case owner do not match",
  approved_action_mismatch: "Task does not match an open, approved fulfillment action for this case",
};

function isCancelRpcResult(value: unknown): value is CancelRpcResult {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof (value as { ok?: unknown }).ok === "boolean"
  );
}

/**
 * Cancels a single open, operator-owned fulfillment task via the `cancel_operator_fulfillment_task`
 * Postgres function: closing the task and clearing the matching case's approved_next_action commit
 * together in one database transaction, so a partial failure can never leave one written without
 * the other. Never inserts a filing, never sends anything, and never invokes follow-up or
 * owned-filing ensure logic — this is a pure withdrawal of an approved-but-not-yet-executed step.
 */
export async function cancelOperatorFulfillmentTask(
  supabase: SupabaseClient,
  input: CancelOperatorFulfillmentTaskInput
): Promise<CancelOperatorFulfillmentTaskResult> {
  const taskId = input.taskId.trim();
  if (!taskId) {
    return { ok: false, error: "task_id is required", status: 400 };
  }

  const { data: taskRow, error: taskErr } = await supabase
    .from("justice_case_tasks")
    .select(TASK_SELECT)
    .eq("id", taskId)
    .maybeSingle();

  if (taskErr) {
    return { ok: false, error: taskErr.message, status: 500 };
  }
  if (!taskRow) {
    return { ok: false, error: "Task not found", status: 404 };
  }

  const task = taskRow as JusticeCaseTaskRow;
  if (task.completed_at?.trim()) {
    return { ok: false, error: "Task is already closed", status: 409 };
  }

  const destination = Object.entries(HREF_DESTINATIONS).find(([, entry]) =>
    entry.matches(task.notes, task.case_id)
  );
  if (!destination) {
    return {
      ok: false,
      error: "Task does not match an open, approved fulfillment action for this case",
      status: 409,
    };
  }
  const [expectedHref, { marker }] = destination;
  const expectedMarker = marker(task.case_id);

  const operatorNote = input.operatorNote?.trim()
    ? clampLen(input.operatorNote.trim(), MAX_OPERATOR_NOTE)
    : null;

  const { data, error } = await supabase.rpc(RPC_NAME, {
    p_task_id: taskId,
    p_case_id: task.case_id,
    p_expected_href: expectedHref,
    p_expected_marker: expectedMarker,
    p_operator_note: operatorNote,
  });

  if (error) {
    return { ok: false, error: error.message, status: 500 };
  }
  if (!isCancelRpcResult(data)) {
    return { ok: false, error: "Unexpected response from cancellation", status: 500 };
  }

  if (!data.ok) {
    const code = data.error;
    return {
      ok: false,
      error: RPC_ERROR_MESSAGES[code] ?? "Could not cancel task",
      status: typeof data.status === "number" ? data.status : 409,
    };
  }

  // The cancellation itself already committed atomically above. Proposing a fresh next action
  // is a best-effort follow-up so chat keeps showing a clear next step; if it fails, the case is
  // left exactly as the RPC left it (no approved_next_action) rather than the cancellation being
  // reported as failed or retried.
  const clientState = await recomputeApprovedNextActionAfterCancellation(supabase, {
    caseId: task.case_id,
    userId: data.user_id,
    clientStateAfterCancel: data.client_state,
    cancelledHref: expectedHref,
  });

  return {
    ok: true,
    task: {
      ...task,
      completed_at: data.cancelled_at,
      notes: data.notes,
    },
    clientState,
  };
}

/**
 * After a cancellation clears approved_next_action, picks and persists a fresh next action using
 * the same routing rules as the initial packet-approval pick (`pickNextPreparedActionAfterCancelled`
 * in preparedNextAction.ts), preferring any destination other than the one just cancelled. Returns
 * the RPC's post-cancel client_state unchanged if intake can't be loaded, no destination is
 * routable, or the write fails — this step never undoes or retries the cancellation itself.
 */
async function recomputeApprovedNextActionAfterCancellation(
  supabase: SupabaseClient,
  input: {
    caseId: string;
    userId: string;
    clientStateAfterCancel: Record<string, unknown>;
    cancelledHref: string;
  }
): Promise<Record<string, unknown>> {
  const { caseId, userId, clientStateAfterCancel, cancelledHref } = input;

  if (clientStateAfterCancel.approved_next_action !== undefined) {
    // Nothing to propose — some other write already set a new action for this case.
    return clientStateAfterCancel;
  }

  const { data: caseRow, error: caseErr } = await supabase
    .from("justice_cases")
    .select("intake")
    .eq("id", caseId)
    .eq("user_id", userId)
    .maybeSingle();

  if (caseErr || !caseRow || !isJusticeIntakePayload(caseRow.intake)) {
    console.warn(
      "cancelOperatorFulfillmentTask: could not load intake to propose a next action",
      caseErr?.message ?? "invalid or missing intake"
    );
    return clientStateAfterCancel;
  }

  const intake = caseRow.intake;
  const contacted = intake.already_contacted === "yes";
  const useCompanyContactLabels =
    cfpbLikelyRelevant(intake) || fccLikelyRelevant(intake) || dotLikelyRelevant(intake);

  const { data: evidenceRows } = await supabase
    .from("justice_case_evidence")
    .select("file_name, mime_type, file_size_bytes")
    .eq("case_id", caseId)
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(200);
  const hasUploadedEvidenceFile = (evidenceRows ?? []).some(justiceEvidenceRowHasUploadedFile);

  const destinations = computeJusticeDestinations(intake, {
    manualFtc: false,
    useCompanyContactLabels,
    hasUploadedEvidenceFile,
  });

  const prepared = pickNextPreparedActionAfterCancelled({
    contacted,
    useCompanyContactLabels,
    destinations,
    cancelledHref,
  });

  if (!prepared.detailHref) {
    // No destination is currently routable at all; leave the case with no approved next action
    // rather than propose a placeholder.
    return clientStateAfterCancel;
  }

  const proposedAction = buildApprovedNextActionTarget(prepared);

  // The authoritative state change (clearing approved_next_action) already committed atomically
  // inside the RPC above — this is a best-effort follow-up. It is NOT a narrow single-field write:
  // it replaces the entire client_state object, so it needs a REAL case_version CAS, re-read fresh
  // on every attempt and recomputed from that fresh state — never from the (by now possibly stale)
  // clientStateAfterCancel snapshot — so a concurrent writer's change to any OTHER client_state
  // field survives instead of being silently reverted to what this function read minutes earlier.
  // A narrow `.is("client_state->approved_next_action", null)` guard alone cannot provide this: it
  // only proves approved_next_action is still unset, not that nothing else in client_state changed
  // (see cancelOperatorFulfillmentTask.test.ts: "a concurrent writer's change to an unrelated
  // client_state field is never silently reverted by this write").
  for (let attempt = 1; attempt <= RECOMPUTE_NEXT_ACTION_MAX_ATTEMPTS; attempt++) {
    const { data: freshRow, error: freshErr } = await supabase
      .from("justice_cases")
      .select("client_state, case_version")
      .eq("id", caseId)
      .eq("user_id", userId)
      .maybeSingle();

    if (freshErr || !freshRow) {
      console.warn(
        "cancelOperatorFulfillmentTask: could not re-read case before persisting proposed next action",
        freshErr?.message ?? "not found"
      );
      return clientStateAfterCancel;
    }

    const freshClientState = (freshRow.client_state ?? {}) as Record<string, unknown>;
    if (freshClientState.approved_next_action !== undefined) {
      // Someone else has already set (or is mid-way through setting) an action since we decided
      // to propose one — never clobber; leave it exactly as it now is.
      return freshClientState;
    }

    const nextClientState: Record<string, unknown> = {
      ...freshClientState,
      approved_next_action: proposedAction,
    };

    const { data: updatedCase, error: updateErr } = await supabase
      .from("justice_cases")
      .update({ client_state: nextClientState })
      .eq("id", caseId)
      .eq("user_id", userId)
      .eq("case_version", freshRow.case_version as number)
      .select("client_state")
      .maybeSingle();

    if (updateErr) {
      console.warn(
        "cancelOperatorFulfillmentTask: could not persist proposed next action",
        updateErr.message
      );
      return clientStateAfterCancel;
    }
    if (updatedCase) {
      return nextClientState;
    }
    // CAS miss — a concurrent writer advanced case_version between the read and write above.
    // Loop: re-read fresh client_state + case_version and recompute from that current state.
  }

  console.warn(
    "cancelOperatorFulfillmentTask: exhausted retries on case_version conflict persisting proposed next action",
    caseId
  );
  return clientStateAfterCancel;
}

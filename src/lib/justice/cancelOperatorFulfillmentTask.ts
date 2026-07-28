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
  stateAgFilingTaskNotesMarker,
  taskNotesMatchStateAgFilingMarker,
} from "@/lib/justice/stateAgFilingTask";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";

const TASK_SELECT =
  "id, user_id, case_id, title, due_date, notes, completed_at, created_at, updated_at" as const;

const MAX_OPERATOR_NOTE = 2000;

const RPC_NAME = "cancel_operator_fulfillment_task";

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

  return {
    ok: true,
    task: {
      ...task,
      completed_at: data.cancelled_at,
      notes: data.notes,
    },
    clientState: data.client_state,
  };
}

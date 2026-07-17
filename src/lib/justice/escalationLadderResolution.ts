import {
  parseApprovedNextActionFromClientState,
  parseJusticeCaseClientState,
} from "@/lib/justice/approvedNextActionState";
import { followUpResponseReviewTaskNotesMarker } from "@/lib/justice/followUpResponseReviewTask";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";
import type { JusticeApprovedNextAction, JusticeCaseClientState } from "@/lib/justice/types";

export type OperatorFulfillmentTerminalFiling = {
  destination: string;
  confirmation_number?: string | null;
};


const MANUAL_ACTION_TRACKING_REAL_BBB_PREP_HREF = "/justice/bbb";

const MANUAL_ACTION_TRACKING_REAL_STATE_AG_PREP_HREF = "/justice/state-ag";

const MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF = "/justice/demand-letter";

const MANUAL_ACTION_TRACKING_REAL_CFPB_PREP_HREF = "/justice/cfpb";

const MANUAL_ACTION_TRACKING_REAL_PAYMENT_DISPUTE_PREP_HREF = "/justice/payment-dispute";

const MANUAL_ACTION_TRACKING_REAL_FCC_PREP_HREF = "/justice/fcc";

const MANUAL_ACTION_TRACKING_REAL_DOT_PREP_HREF = "/justice/dot";

const MANUAL_ACTION_TRACKING_REAL_FTC_PREP_HREF = "/justice/ftc";

const MANUAL_ACTION_TRACKING_REAL_MERCHANT_PREP_HREF = "/justice/merchant";



const HUMAN_FULFILLMENT_ESCALATION_HREFS = new Set([

  MANUAL_ACTION_TRACKING_REAL_MERCHANT_PREP_HREF,

  MANUAL_ACTION_TRACKING_REAL_STATE_AG_PREP_HREF,

  MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF,

  MANUAL_ACTION_TRACKING_REAL_CFPB_PREP_HREF,

  MANUAL_ACTION_TRACKING_REAL_PAYMENT_DISPUTE_PREP_HREF,

  MANUAL_ACTION_TRACKING_REAL_FCC_PREP_HREF,

  MANUAL_ACTION_TRACKING_REAL_DOT_PREP_HREF,

  MANUAL_ACTION_TRACKING_REAL_FTC_PREP_HREF,

  MANUAL_ACTION_TRACKING_REAL_BBB_PREP_HREF,

]);



function stateAgFilingTaskNotesMarker(caseId: string): string {

  return `state_ag_filing_queue:${caseId.trim()}`;

}



function demandLetterFilingTaskNotesMarker(caseId: string): string {

  return `demand_letter_filing_queue:${caseId.trim()}`;

}



function cfpbFilingTaskNotesMarker(caseId: string): string {

  return `cfpb_filing_queue:${caseId.trim()}`;

}



function paymentDisputeFilingTaskNotesMarker(caseId: string): string {

  return `payment_dispute_filing_queue:${caseId.trim()}`;

}



function fccFilingTaskNotesMarker(caseId: string): string {

  return `fcc_filing_queue:${caseId.trim()}`;

}



function dotFilingTaskNotesMarker(caseId: string): string {

  return `dot_filing_queue:${caseId.trim()}`;

}



function bbbFilingTaskNotesMarker(caseId: string): string {

  return `bbb_filing_queue:${caseId.trim()}`;

}



function ftcFilingTaskNotesMarker(caseId: string): string {

  return `ftc_filing_queue:${caseId.trim()}`;

}



function merchantContactFilingTaskNotesMarker(caseId: string): string {

  return `merchant_contact_queue:${caseId.trim()}`;

}



function findOpenStateAgFilingTask(
  tasks: readonly JusticeCaseTaskRow[],
  caseId: string
): JusticeCaseTaskRow | undefined {
  return findOpenEscalationTask(tasks, caseId, stateAgFilingTaskNotesMarker(caseId));
}



function findOpenDemandLetterFilingTask(
  tasks: readonly JusticeCaseTaskRow[],
  caseId: string
): JusticeCaseTaskRow | undefined {
  return findOpenEscalationTask(tasks, caseId, demandLetterFilingTaskNotesMarker(caseId));
}



function findOpenCfpbFilingTask(
  tasks: readonly JusticeCaseTaskRow[],
  caseId: string
): JusticeCaseTaskRow | undefined {
  return findOpenEscalationTask(tasks, caseId, cfpbFilingTaskNotesMarker(caseId));
}



function findOpenPaymentDisputeFilingTask(
  tasks: readonly JusticeCaseTaskRow[],
  caseId: string
): JusticeCaseTaskRow | undefined {
  return findOpenEscalationTask(tasks, caseId, paymentDisputeFilingTaskNotesMarker(caseId));
}



function findOpenFccFilingTask(
  tasks: readonly JusticeCaseTaskRow[],
  caseId: string
): JusticeCaseTaskRow | undefined {
  return findOpenEscalationTask(tasks, caseId, fccFilingTaskNotesMarker(caseId));
}



function findOpenDotFilingTask(
  tasks: readonly JusticeCaseTaskRow[],
  caseId: string
): JusticeCaseTaskRow | undefined {
  return findOpenEscalationTask(tasks, caseId, dotFilingTaskNotesMarker(caseId));
}



function findOpenBbbFilingTask(
  tasks: readonly JusticeCaseTaskRow[],
  caseId: string
): JusticeCaseTaskRow | undefined {
  return findOpenEscalationTask(tasks, caseId, bbbFilingTaskNotesMarker(caseId));
}



function findOpenFtcFilingTask(
  tasks: readonly JusticeCaseTaskRow[],
  caseId: string
): JusticeCaseTaskRow | undefined {
  return findOpenEscalationTask(tasks, caseId, ftcFilingTaskNotesMarker(caseId));
}



function findOpenMerchantContactFilingTask(
  tasks: readonly JusticeCaseTaskRow[],
  caseId: string
): JusticeCaseTaskRow | undefined {
  return findOpenEscalationTask(tasks, caseId, merchantContactFilingTaskNotesMarker(caseId));
}



function hasDemandLetterFilingWithConfirmationFromFilings(
  filings: readonly OperatorFulfillmentTerminalFiling[]
): boolean {
  return filings.some(
    (filing) =>
      filing.destination?.trim() === "Small claims / demand letter" &&
      Boolean(filing.confirmation_number?.trim())
  );
}



function taskNotesMatchMarker(

  notes: string | null | undefined,

  marker: string

): boolean {

  const trimmed = notes?.trim() ?? "";

  return trimmed === marker || trimmed.startsWith(`${marker}\n`);

}



function findOpenEscalationTask(

  tasks: readonly JusticeCaseTaskRow[],

  caseId: string,

  marker: string

): JusticeCaseTaskRow | undefined {

  return tasks.find(

    (task) => taskNotesMatchMarker(task.notes, marker) && !task.completed_at?.trim()

  );

}



export function isHumanFulfillmentEscalationHref(href: string | null | undefined): boolean {

  const trimmed = href?.trim() ?? "";

  return trimmed.length > 0 && HUMAN_FULFILLMENT_ESCALATION_HREFS.has(trimmed);

}



export function isDownstreamHumanFulfillmentEscalationAction(

  action: Pick<JusticeApprovedNextAction, "href" | "status"> | null | undefined

): boolean {

  if (!action) return false;

  if (action.status === "completed") return false;

  return isHumanFulfillmentEscalationHref(action.href);

}



/** Remove BBB-era handling/outcome/follow-up fields from an approved next action. */
export function stripResolutionTrackingFromApprovedAction(
  action: JusticeApprovedNextAction
): JusticeApprovedNextAction {
  const next = { ...action };
  delete next.handling_requested_at;
  delete next.handling_request_note;
  delete next.handling_acknowledged_at;
  delete next.handling_operator_note;
  delete next.outcome_note;
  delete next.follow_up_needed;
  delete next.follow_up_at;
  return next;
}

function shouldQueueStateAgFilingFromClientState(clientState: unknown): boolean {

  const parsed = parseJusticeCaseClientState(clientState);

  if (!parsed.prepared_packet_approved) return false;

  const next = parsed.approved_next_action;

  if (!next) return false;

  if (next.href?.trim() !== MANUAL_ACTION_TRACKING_REAL_STATE_AG_PREP_HREF) return false;

  if (next.status === "completed") return false;

  return true;

}



function shouldQueueDemandLetterFilingFromClientState(clientState: unknown): boolean {

  const parsed = parseJusticeCaseClientState(clientState);

  if (!parsed.prepared_packet_approved) return false;

  const next = parsed.approved_next_action;

  if (!next) return false;

  if (next.href?.trim() !== MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF) return false;

  if (next.status === "completed") return false;

  return true;

}



function shouldQueueCfpbFilingFromClientState(clientState: unknown): boolean {

  const parsed = parseJusticeCaseClientState(clientState);

  if (!parsed.prepared_packet_approved) return false;

  const next = parsed.approved_next_action;

  if (!next) return false;

  if (next.href?.trim() !== MANUAL_ACTION_TRACKING_REAL_CFPB_PREP_HREF) return false;

  if (next.status === "completed") return false;

  return true;

}



function shouldQueuePaymentDisputeFilingFromClientState(clientState: unknown): boolean {

  const parsed = parseJusticeCaseClientState(clientState);

  if (!parsed.prepared_packet_approved) return false;

  const next = parsed.approved_next_action;

  if (!next) return false;

  if (next.href?.trim() !== MANUAL_ACTION_TRACKING_REAL_PAYMENT_DISPUTE_PREP_HREF) return false;

  if (next.status === "completed") return false;

  return true;

}



function shouldQueueFccFilingFromClientState(clientState: unknown): boolean {

  const parsed = parseJusticeCaseClientState(clientState);

  if (!parsed.prepared_packet_approved) return false;

  const next = parsed.approved_next_action;

  if (!next) return false;

  if (next.href?.trim() !== MANUAL_ACTION_TRACKING_REAL_FCC_PREP_HREF) return false;

  if (next.status === "completed") return false;

  return true;

}



function shouldQueueDotFilingFromClientState(clientState: unknown): boolean {

  const parsed = parseJusticeCaseClientState(clientState);

  if (!parsed.prepared_packet_approved) return false;

  const next = parsed.approved_next_action;

  if (!next) return false;

  if (next.href?.trim() !== MANUAL_ACTION_TRACKING_REAL_DOT_PREP_HREF) return false;

  if (next.status === "completed") return false;

  return true;

}



function shouldQueueBbbFilingFromClientState(clientState: unknown): boolean {

  const parsed = parseJusticeCaseClientState(clientState);

  if (!parsed.prepared_packet_approved) return false;

  const next = parsed.approved_next_action;

  if (!next) return false;

  if (next.href?.trim() !== MANUAL_ACTION_TRACKING_REAL_BBB_PREP_HREF) return false;

  if (next.status === "completed") return false;

  return true;

}



function shouldQueueFtcFilingFromClientState(clientState: unknown): boolean {

  const parsed = parseJusticeCaseClientState(clientState);

  if (!parsed.prepared_packet_approved) return false;

  const next = parsed.approved_next_action;

  if (!next) return false;

  if (next.href?.trim() !== MANUAL_ACTION_TRACKING_REAL_FTC_PREP_HREF) return false;

  if (next.status === "completed") return false;

  return true;

}



function shouldQueueMerchantContactFilingFromClientState(clientState: unknown): boolean {

  const parsed = parseJusticeCaseClientState(clientState);

  if (!parsed.prepared_packet_approved) return false;

  const next = parsed.approved_next_action;

  if (!next) return false;

  if (next.href?.trim() !== MANUAL_ACTION_TRACKING_REAL_MERCHANT_PREP_HREF) return false;

  if (next.status === "completed") return false;

  return true;

}



/** True when client_state still calls for a pending human-fulfillment operator queue step. */

export function clientStateHasPendingHumanFulfillmentEscalation(clientState: unknown): boolean {

  return (

    shouldQueueMerchantContactFilingFromClientState(clientState) ||

    shouldQueueStateAgFilingFromClientState(clientState) ||

    shouldQueueDemandLetterFilingFromClientState(clientState) ||

    shouldQueueCfpbFilingFromClientState(clientState) ||

    shouldQueuePaymentDisputeFilingFromClientState(clientState) ||

    shouldQueueFccFilingFromClientState(clientState) ||

    shouldQueueDotFilingFromClientState(clientState) ||

    shouldQueueFtcFilingFromClientState(clientState) ||

    shouldQueueBbbFilingFromClientState(clientState)

  );

}



/**

 * Strip premature BBB resolution tracking from client_state while State AG or demand-letter

 * escalation is still pending.

 */

export function sanitizeClientStateForEscalationLadder(

  clientState: unknown

): JusticeCaseClientState {

  const parsed = parseJusticeCaseClientState(clientState);

  if (!clientStateHasPendingHumanFulfillmentEscalation(parsed)) {

    return parsed;

  }

  const next = parsed.approved_next_action;

  if (!next || !isDownstreamHumanFulfillmentEscalationAction(next)) {

    return parsed;

  }

  return {

    ...parsed,

    approved_next_action: stripResolutionTrackingFromApprovedAction(next),

  };

}



/**

 * True while State AG or demand-letter escalation still requires Surrenderless operator fulfillment.

 */

export function hasPendingHumanFulfillmentEscalation(input: {

  approvedAction: JusticeApprovedNextAction | undefined;

  caseId: string;

  tasks: readonly JusticeCaseTaskRow[];

  filings?: readonly OperatorFulfillmentTerminalFiling[];

}): boolean {

  const caseId = input.caseId.trim();

  if (caseId) {

    if (findOpenEscalationTask(input.tasks, caseId, merchantContactFilingTaskNotesMarker(caseId))) {

      return true;

    }

    if (findOpenEscalationTask(input.tasks, caseId, stateAgFilingTaskNotesMarker(caseId))) {

      return true;

    }

    if (

      findOpenEscalationTask(input.tasks, caseId, demandLetterFilingTaskNotesMarker(caseId))

    ) {

      return true;

    }

    if (findOpenEscalationTask(input.tasks, caseId, cfpbFilingTaskNotesMarker(caseId))) {

      return true;

    }

    if (

      findOpenEscalationTask(input.tasks, caseId, paymentDisputeFilingTaskNotesMarker(caseId))

    ) {

      return true;

    }

    if (findOpenEscalationTask(input.tasks, caseId, fccFilingTaskNotesMarker(caseId))) {

      return true;

    }

    if (findOpenEscalationTask(input.tasks, caseId, dotFilingTaskNotesMarker(caseId))) {

      return true;

    }

    if (findOpenEscalationTask(input.tasks, caseId, bbbFilingTaskNotesMarker(caseId))) {

      return true;

    }

    if (findOpenEscalationTask(input.tasks, caseId, ftcFilingTaskNotesMarker(caseId))) {

      return true;

    }

    if (
      findOpenEscalationTask(input.tasks, caseId, followUpResponseReviewTaskNotesMarker(caseId))
    ) {
      return true;
    }

  }



  if (

    input.filings &&

    input.approvedAction &&

    isOperatorFulfillmentTerminalFromTasksAndFilings({

      caseId,

      tasks: input.tasks,

      filings: input.filings,

    })

  ) {

    return false;

  }



  const action = input.approvedAction;

  if (!action) return false;

  return isDownstreamHumanFulfillmentEscalationAction(action);

}



/**

 * True when the escalation ladder has no remaining human-fulfillment steps and resolution may begin.

 */

export function isEscalationLadderTerminalForResolution(

  action: JusticeApprovedNextAction | undefined

): boolean {

  if (!action) return false;



  const href = action.href?.trim() ?? "";

  const status = action.status;



  if (href === MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF && status === "completed") {

    return true;

  }



  if (href === MANUAL_ACTION_TRACKING_REAL_CFPB_PREP_HREF && status === "completed") {

    return true;

  }



  if (href === MANUAL_ACTION_TRACKING_REAL_PAYMENT_DISPUTE_PREP_HREF && status === "completed") {

    return true;

  }



  if (href === MANUAL_ACTION_TRACKING_REAL_FCC_PREP_HREF && status === "completed") {

    return true;

  }



  if (href === MANUAL_ACTION_TRACKING_REAL_DOT_PREP_HREF && status === "completed") {

    return true;

  }



  if (href === MANUAL_ACTION_TRACKING_REAL_BBB_PREP_HREF && status === "completed") {

    return true;

  }



  if (href === MANUAL_ACTION_TRACKING_REAL_FTC_PREP_HREF && status === "completed") {

    return true;

  }



  if (href === MANUAL_ACTION_TRACKING_REAL_MERCHANT_PREP_HREF && status === "completed") {

    return true;

  }



  // Terminal when State AG completed and the ladder did not advance (e.g. no demand-letter next).
  if (href === MANUAL_ACTION_TRACKING_REAL_STATE_AG_PREP_HREF && status === "completed") {

    return true;

  }



  if (status === "completed" && href && !isHumanFulfillmentEscalationHref(href)) {

    return true;

  }



  return false;

}



/**

 * True when operator tasks and filings prove demand-letter fulfillment is complete

 * (no open State AG / demand-letter operator tasks; demand letter confirmed on file).

 */

export function isOperatorFulfillmentTerminalFromTasksAndFilings(input: {

  caseId: string;

  tasks: readonly JusticeCaseTaskRow[];

  filings: readonly OperatorFulfillmentTerminalFiling[];

}): boolean {

  const caseId = input.caseId.trim();

  if (!caseId) return false;

  if (findOpenMerchantContactFilingTask(input.tasks, caseId)) return false;

  if (findOpenStateAgFilingTask(input.tasks, caseId)) return false;

  if (findOpenDemandLetterFilingTask(input.tasks, caseId)) return false;

  if (findOpenCfpbFilingTask(input.tasks, caseId)) return false;

  if (findOpenPaymentDisputeFilingTask(input.tasks, caseId)) return false;

  if (findOpenFccFilingTask(input.tasks, caseId)) return false;

  if (findOpenDotFilingTask(input.tasks, caseId)) return false;

  return hasDemandLetterFilingWithConfirmationFromFilings(input.filings);

}



/** Normalize a stale approved action to terminal demand-letter completion for resolution. */

export function resolveTerminalApprovedActionForResolution(

  action: JusticeApprovedNextAction,

  options: { completedAt?: string } = {}

): JusticeApprovedNextAction {

  if (isEscalationLadderTerminalForResolution(action)) return action;

  const completedAt = action.completed_at?.trim() || options.completedAt || new Date().toISOString();

  return {

    ...action,

    label: action.label?.trim() || "Small claims / demand letter",

    href: MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF,

    status: "completed",

    completed_at: completedAt,

  };

}

/**
 * True when a client_state PATCH may normalize a stale approved action to terminal
 * and seed resolution tracking because operator tasks + filings prove fulfillment is complete.
 */
export function isAllowedOperatorEvidenceTerminalResolutionClientStatePatch(input: {
  caseId: string;
  existingClientState: unknown;
  incomingClientState: unknown;
  tasks: readonly JusticeCaseTaskRow[];
  filings: readonly OperatorFulfillmentTerminalFiling[];
}): boolean {
  const existingAction = parseApprovedNextActionFromClientState(input.existingClientState);
  const incomingAction = parseApprovedNextActionFromClientState(input.incomingClientState);
  if (!existingAction || !incomingAction) return false;
  if (isEscalationLadderTerminalForResolution(existingAction)) return false;
  if (
    existingAction.handling_requested_at?.trim() &&
    existingAction.outcome_note?.trim()
  ) {
    return false;
  }
  if (
    !isOperatorFulfillmentTerminalFromTasksAndFilings({
      caseId: input.caseId,
      tasks: input.tasks,
      filings: input.filings,
    })
  ) {
    return false;
  }
  if (!isEscalationLadderTerminalForResolution(incomingAction)) return false;
  return (
    Boolean(incomingAction.handling_requested_at?.trim()) &&
    Boolean(incomingAction.outcome_note?.trim())
  );
}

/** Whether follow-up/outcome/archive resolution UI may be shown in chat. */

export function shouldExposeCaseResolutionFlow(input: {

  approvedAction: JusticeApprovedNextAction | undefined;

  caseId: string;

  tasks: readonly JusticeCaseTaskRow[];

  filings?: readonly OperatorFulfillmentTerminalFiling[];

}): boolean {

  if (hasPendingHumanFulfillmentEscalation(input)) return false;

  if (isEscalationLadderTerminalForResolution(input.approvedAction)) return true;

  if (!input.approvedAction || !input.filings) return false;

  return isOperatorFulfillmentTerminalFromTasksAndFilings({

    caseId: input.caseId,

    tasks: input.tasks,

    filings: input.filings,

  });

}



export const ESCALATION_AWAITING_OPERATOR_FULFILLMENT_STEP =

  "Awaiting Surrenderless operator fulfillment for the current escalation step.";



/** True when handling-request resolution tracking is complete enough to archive. */

export function isResolutionTrackingCompleteForArchive(

  action: JusticeApprovedNextAction | undefined

): boolean {

  if (!action) return true;

  if (action.follow_up_needed === true) return false;

  if (!action.handling_requested_at?.trim()) return true;

  if (!action.outcome_note?.trim()) return false;

  if (!action.handling_acknowledged_at?.trim()) return false;

  return true;

}



/** Whether Saved Cases archive may proceed for the current escalation ladder state. */

export function canArchiveCaseForEscalationLadder(input: {

  approvedAction: JusticeApprovedNextAction | undefined;

  caseId: string;

  tasks: readonly JusticeCaseTaskRow[];

  filings?: readonly OperatorFulfillmentTerminalFiling[];

}): boolean {

  if (hasPendingHumanFulfillmentEscalation(input)) return false;

  if (!shouldExposeCaseResolutionFlow(input)) return false;

  if (!isResolutionTrackingCompleteForArchive(input.approvedAction)) return false;

  return true;

}



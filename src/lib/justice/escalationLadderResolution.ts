import { parseJusticeCaseClientState } from "@/lib/justice/approvedNextActionState";

import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";

import type { JusticeApprovedNextAction, JusticeCaseClientState } from "@/lib/justice/types";



const MANUAL_ACTION_TRACKING_REAL_BBB_PREP_HREF = "/justice/bbb";

const MANUAL_ACTION_TRACKING_REAL_STATE_AG_PREP_HREF = "/justice/state-ag";

const MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF = "/justice/demand-letter";



const HUMAN_FULFILLMENT_ESCALATION_HREFS = new Set([

  MANUAL_ACTION_TRACKING_REAL_STATE_AG_PREP_HREF,

  MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF,

]);



function stateAgFilingTaskNotesMarker(caseId: string): string {

  return `state_ag_filing_queue:${caseId.trim()}`;

}



function demandLetterFilingTaskNotesMarker(caseId: string): string {

  return `demand_letter_filing_queue:${caseId.trim()}`;

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



/** True when client_state still calls for a pending human-fulfillment operator queue step. */

export function clientStateHasPendingHumanFulfillmentEscalation(clientState: unknown): boolean {

  return (

    shouldQueueStateAgFilingFromClientState(clientState) ||

    shouldQueueDemandLetterFilingFromClientState(clientState)

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

}): boolean {

  const caseId = input.caseId.trim();

  if (caseId) {

    if (findOpenEscalationTask(input.tasks, caseId, stateAgFilingTaskNotesMarker(caseId))) {

      return true;

    }

    if (

      findOpenEscalationTask(input.tasks, caseId, demandLetterFilingTaskNotesMarker(caseId))

    ) {

      return true;

    }

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



  if (href === MANUAL_ACTION_TRACKING_REAL_BBB_PREP_HREF && status === "completed") {

    return true;

  }



  if (status === "completed" && href && !isHumanFulfillmentEscalationHref(href)) {

    return true;

  }



  return false;

}



/** Whether follow-up/outcome/archive resolution UI may be shown in chat. */

export function shouldExposeCaseResolutionFlow(input: {

  approvedAction: JusticeApprovedNextAction | undefined;

  caseId: string;

  tasks: readonly JusticeCaseTaskRow[];

}): boolean {

  if (hasPendingHumanFulfillmentEscalation(input)) return false;

  return isEscalationLadderTerminalForResolution(input.approvedAction);

}



export const ESCALATION_AWAITING_OPERATOR_FULFILLMENT_STEP =

  "Awaiting Surrenderless operator fulfillment for the current escalation step.";



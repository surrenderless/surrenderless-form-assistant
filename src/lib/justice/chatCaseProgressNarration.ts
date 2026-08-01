import {
  findOpenBbbFilingTask,
  hasBbbFilingWithConfirmation,
  isApprovedBbbFilingAction,
} from "@/lib/justice/bbbFilingTask";
import {
  isBbbOwnedFilingFailed,
  isBbbOwnedFilingSubmitting,
} from "@/lib/justice/bbbOwnedFilingDeliveryState";
import { isChatPendingHumanFulfillmentEscalation } from "@/lib/justice/chatPendingHumanFulfillmentRefresh";
import { shouldExposeCaseResolutionFlow } from "@/lib/justice/escalationLadderResolution";
import {
  findOpenCfpbFilingTask,
  hasCfpbFilingWithConfirmation,
  isApprovedCfpbFilingAction,
} from "@/lib/justice/cfpbFilingTask";
import {
  findOpenDemandLetterFilingTask,
  hasDemandLetterFilingWithConfirmation,
  isApprovedDemandLetterFilingAction,
} from "@/lib/justice/demandLetterFilingTask";
import {
  isDemandLetterEmailFailed,
  isDemandLetterEmailSending,
} from "@/lib/justice/demandLetterEmailDelivery";
import {
  findOpenDotFilingTask,
  hasDotFilingWithConfirmation,
  isApprovedDotFilingAction,
} from "@/lib/justice/dotFilingTask";
import {
  findOpenFccFilingTask,
  hasFccFilingWithConfirmation,
  isApprovedFccFilingAction,
} from "@/lib/justice/fccFilingTask";
import {
  findOpenFtcFilingTask,
  hasFtcFilingWithConfirmation,
  isApprovedFtcFilingAction,
} from "@/lib/justice/ftcFilingTask";
import {
  isFtcOwnedFilingFailed,
  isFtcOwnedFilingSubmitting,
} from "@/lib/justice/ftcOwnedFilingDeliveryState";
import type { ManualActionTrackingFiling } from "@/lib/justice/handlingTrackingProgress";
import {
  findOpenMerchantContactFilingTask,
  hasMerchantContactFilingWithConfirmation,
  isApprovedMerchantContactFilingAction,
} from "@/lib/justice/merchantContactFilingTask";
import {
  isMerchantContactEmailFailed,
  isMerchantContactEmailSending,
} from "@/lib/justice/merchantContactEmailDelivery";
import {
  findOpenPaymentDisputeFilingTask,
  hasPaymentDisputeFilingWithConfirmation,
  isApprovedPaymentDisputeFilingAction,
} from "@/lib/justice/paymentDisputeFilingTask";
import {
  isPaymentDisputeEmailFailed,
  isPaymentDisputeEmailSending,
} from "@/lib/justice/paymentDisputeEmailDelivery";
import {
  findOpenStateAgFilingTask,
  hasStateAgFilingWithConfirmation,
  isApprovedStateAgFilingAction,
} from "@/lib/justice/stateAgFilingTask";
import { hasOperatorTerminalResponseReviewOutcome } from "@/lib/justice/operatorOwnedCaseArchive";
import { CHAT_OPERATOR_OWNED_ARCHIVE_RESPONSE } from "@/lib/justice/chatCaseClosureGates";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";
import type { JusticeApprovedNextAction } from "@/lib/justice/types";

export type ChatCaseProgressMilestone =
  | "merchant_contact_queued"
  | "merchant_contact_queued_stale"
  | "merchant_contact_sending"
  | "merchant_contact_send_failed"
  | "merchant_contact_confirmed"
  | "payment_dispute_queued"
  | "payment_dispute_queued_stale"
  | "payment_dispute_sending"
  | "payment_dispute_send_failed"
  | "payment_dispute_confirmed"
  | "fcc_queued"
  | "fcc_queued_stale"
  | "fcc_confirmed"
  | "dot_queued"
  | "dot_queued_stale"
  | "dot_confirmed"
  | "cfpb_queued"
  | "cfpb_queued_stale"
  | "cfpb_confirmed"
  | "ftc_queued"
  | "ftc_queued_stale"
  | "ftc_submitting"
  | "ftc_submit_failed"
  | "ftc_confirmed"
  | "bbb_queued"
  | "bbb_queued_stale"
  | "bbb_submitting"
  | "bbb_submit_failed"
  | "bbb_confirmed"
  | "bbb_filed"
  | "state_ag_queued"
  | "state_ag_queued_stale"
  | "state_ag_confirmed"
  | "demand_letter_queued"
  | "demand_letter_queued_stale"
  | "demand_letter_sending"
  | "demand_letter_send_failed"
  | "demand_letter_sent"
  | "resolution_ready"
  | "operator_closure_pending"
  | "operator_case_closed";

export const CHAT_CASE_PROGRESS_MILESTONE_ORDER: readonly ChatCaseProgressMilestone[] = [
  "merchant_contact_queued",
  "merchant_contact_queued_stale",
  "merchant_contact_sending",
  "merchant_contact_send_failed",
  "merchant_contact_confirmed",
  "payment_dispute_queued",
  "payment_dispute_queued_stale",
  "payment_dispute_sending",
  "payment_dispute_send_failed",
  "payment_dispute_confirmed",
  "fcc_queued",
  "fcc_queued_stale",
  "fcc_confirmed",
  "dot_queued",
  "dot_queued_stale",
  "dot_confirmed",
  "cfpb_queued",
  "cfpb_queued_stale",
  "cfpb_confirmed",
  "ftc_queued",
  "ftc_queued_stale",
  "ftc_submitting",
  "ftc_submit_failed",
  "ftc_confirmed",
  "bbb_queued",
  "bbb_queued_stale",
  "bbb_submitting",
  "bbb_submit_failed",
  "bbb_confirmed",
  "bbb_filed",
  "state_ag_queued",
  "state_ag_queued_stale",
  "state_ag_confirmed",
  "demand_letter_queued",
  "demand_letter_queued_stale",
  "demand_letter_sending",
  "demand_letter_send_failed",
  "demand_letter_sent",
  "resolution_ready",
  "operator_closure_pending",
  "operator_case_closed",
] as const;

export const STORAGE_CHAT_CASE_PROGRESS_NARRATED_V1 = "justice_chat_case_progress_narrated_v1";

/** Age past which an operator-queued milestone's narration switches to a "taking longer" message. */
const OPERATOR_QUEUE_STALE_NARRATION_THRESHOLD_MS = 24 * 60 * 60 * 1000;

type QueuedMilestoneStaleConfig = {
  /** Destination phrase substituted into the "taking longer than expected" sentence. */
  destinationPhrase: string;
  findOpenTask: (
    tasks: readonly JusticeCaseTaskRow[],
    caseId: string
  ) => JusticeCaseTaskRow | undefined;
  /** The distinct milestone identity narrated once, separately from the base queued milestone. */
  staleMilestone: ChatCaseProgressMilestone;
};

/**
 * Operator-fulfillment-queued milestones eligible for a separate, one-time "taking longer than
 * expected" staleness update, keyed by the same task age used server-side by the operator-queue
 * alert escalation (reconcileOperatorFallbackAlerts). CFPB automation itself is out of scope, but
 * its manual operator queue still gets the same staleness handling as every other destination.
 */
const QUEUED_MILESTONE_STALE_CONFIG: Partial<
  Record<ChatCaseProgressMilestone, QueuedMilestoneStaleConfig>
> = {
  merchant_contact_queued: {
    destinationPhrase: "merchant or company contact outreach",
    findOpenTask: findOpenMerchantContactFilingTask,
    staleMilestone: "merchant_contact_queued_stale",
  },
  payment_dispute_queued: {
    destinationPhrase: "payment dispute filing",
    findOpenTask: findOpenPaymentDisputeFilingTask,
    staleMilestone: "payment_dispute_queued_stale",
  },
  fcc_queued: {
    destinationPhrase: "FCC complaint filing",
    findOpenTask: findOpenFccFilingTask,
    staleMilestone: "fcc_queued_stale",
  },
  dot_queued: {
    destinationPhrase: "USDOT aviation complaint filing",
    findOpenTask: findOpenDotFilingTask,
    staleMilestone: "dot_queued_stale",
  },
  cfpb_queued: {
    destinationPhrase: "CFPB complaint filing",
    findOpenTask: findOpenCfpbFilingTask,
    staleMilestone: "cfpb_queued_stale",
  },
  ftc_queued: {
    destinationPhrase: "FTC consumer complaint filing",
    findOpenTask: findOpenFtcFilingTask,
    staleMilestone: "ftc_queued_stale",
  },
  bbb_queued: {
    destinationPhrase: "Better Business Bureau complaint filing",
    findOpenTask: findOpenBbbFilingTask,
    staleMilestone: "bbb_queued_stale",
  },
  state_ag_queued: {
    destinationPhrase: "State Attorney General complaint filing",
    findOpenTask: findOpenStateAgFilingTask,
    staleMilestone: "state_ag_queued_stale",
  },
  demand_letter_queued: {
    destinationPhrase: "demand letter",
    findOpenTask: findOpenDemandLetterFilingTask,
    staleMilestone: "demand_letter_queued_stale",
  },
};

/** Authoritative task age for a queued milestone: null when the task or its created_at is unknown. */
function resolveQueuedMilestoneAgeMs(
  milestone: ChatCaseProgressMilestone,
  tasks: readonly JusticeCaseTaskRow[],
  caseId: string,
  nowMs: number
): number | null {
  const cfg = QUEUED_MILESTONE_STALE_CONFIG[milestone];
  if (!cfg) return null;
  const task = cfg.findOpenTask(tasks, caseId);
  const createdAtMs = task?.created_at ? Date.parse(task.created_at) : NaN;
  if (!Number.isFinite(createdAtMs)) return null;
  return Math.max(0, nowMs - createdAtMs);
}

export type ChatCaseProgressObservation = {
  caseId: string;
  approvedAction: JusticeApprovedNextAction | undefined;
  tasks: readonly JusticeCaseTaskRow[];
  filings: readonly ManualActionTrackingFiling[];
  /** Server archived_at when known (from case refresh). */
  archivedAt?: string | null;
};

/** @deprecated Prefer hasBbbFilingWithConfirmation from bbbFilingTask — re-exported for older imports. */
export { hasBbbFilingWithConfirmation };

export function deriveSatisfiedChatCaseProgressMilestones(
  input: ChatCaseProgressObservation,
  nowMs: number = Date.now()
): ChatCaseProgressMilestone[] {
  const caseId = input.caseId.trim();
  if (!caseId) return [];

  const action = input.approvedAction;
  const satisfied: ChatCaseProgressMilestone[] = [];

  if (
    isApprovedMerchantContactFilingAction(action) &&
    action.status === "approved" &&
    isChatPendingHumanFulfillmentEscalation({
      approvedAction: action,
      caseId,
      tasks: input.tasks,
      filings: input.filings,
    })
  ) {
    satisfied.push("merchant_contact_queued");
    const openMerchantTask = findOpenMerchantContactFilingTask(input.tasks, caseId);
    if (isMerchantContactEmailSending(openMerchantTask)) {
      satisfied.push("merchant_contact_sending");
    }
    if (isMerchantContactEmailFailed(openMerchantTask)) {
      satisfied.push("merchant_contact_send_failed");
    }
  }

  if (hasMerchantContactFilingWithConfirmation(input.filings)) {
    satisfied.push("merchant_contact_confirmed");
  }

  if (
    isApprovedPaymentDisputeFilingAction(action) &&
    action.status === "approved" &&
    isChatPendingHumanFulfillmentEscalation({
      approvedAction: action,
      caseId,
      tasks: input.tasks,
      filings: input.filings,
    })
  ) {
    satisfied.push("payment_dispute_queued");
    const openPaymentDisputeTask = findOpenPaymentDisputeFilingTask(input.tasks, caseId);
    if (isPaymentDisputeEmailSending(openPaymentDisputeTask)) {
      satisfied.push("payment_dispute_sending");
    }
    if (isPaymentDisputeEmailFailed(openPaymentDisputeTask)) {
      satisfied.push("payment_dispute_send_failed");
    }
  }

  if (hasPaymentDisputeFilingWithConfirmation(input.filings)) {
    satisfied.push("payment_dispute_confirmed");
  }

  if (
    isApprovedFccFilingAction(action) &&
    action.status === "approved" &&
    isChatPendingHumanFulfillmentEscalation({
      approvedAction: action,
      caseId,
      tasks: input.tasks,
      filings: input.filings,
    })
  ) {
    satisfied.push("fcc_queued");
  }

  if (hasFccFilingWithConfirmation(input.filings)) {
    satisfied.push("fcc_confirmed");
  }

  if (
    isApprovedDotFilingAction(action) &&
    action.status === "approved" &&
    isChatPendingHumanFulfillmentEscalation({
      approvedAction: action,
      caseId,
      tasks: input.tasks,
      filings: input.filings,
    })
  ) {
    satisfied.push("dot_queued");
  }

  if (hasDotFilingWithConfirmation(input.filings)) {
    satisfied.push("dot_confirmed");
  }

  if (
    isApprovedCfpbFilingAction(action) &&
    action.status === "approved" &&
    isChatPendingHumanFulfillmentEscalation({
      approvedAction: action,
      caseId,
      tasks: input.tasks,
      filings: input.filings,
    })
  ) {
    satisfied.push("cfpb_queued");
  }

  if (hasCfpbFilingWithConfirmation(input.filings)) {
    satisfied.push("cfpb_confirmed");
  }

  if (
    isApprovedFtcFilingAction(action) &&
    action.status === "approved" &&
    isChatPendingHumanFulfillmentEscalation({
      approvedAction: action,
      caseId,
      tasks: input.tasks,
      filings: input.filings,
    })
  ) {
    satisfied.push("ftc_queued");
    const openFtcTask = findOpenFtcFilingTask(input.tasks, caseId);
    if (isFtcOwnedFilingSubmitting(openFtcTask)) {
      satisfied.push("ftc_submitting");
    }
    if (isFtcOwnedFilingFailed(openFtcTask)) {
      satisfied.push("ftc_submit_failed");
    }
  }

  if (hasFtcFilingWithConfirmation(input.filings)) {
    satisfied.push("ftc_confirmed");
  }

  if (
    isApprovedBbbFilingAction(action) &&
    action.status === "approved" &&
    isChatPendingHumanFulfillmentEscalation({
      approvedAction: action,
      caseId,
      tasks: input.tasks,
      filings: input.filings,
    })
  ) {
    satisfied.push("bbb_queued");
    const openBbbTask = findOpenBbbFilingTask(input.tasks, caseId);
    if (isBbbOwnedFilingSubmitting(openBbbTask)) {
      satisfied.push("bbb_submitting");
    }
    if (isBbbOwnedFilingFailed(openBbbTask)) {
      satisfied.push("bbb_submit_failed");
    }
  }

  if (hasBbbFilingWithConfirmation(input.filings)) {
    satisfied.push("bbb_confirmed");
  }

  if (
    isApprovedStateAgFilingAction(action) &&
    action.status === "approved" &&
    isChatPendingHumanFulfillmentEscalation({
      approvedAction: action,
      caseId,
      tasks: input.tasks,
      filings: input.filings,
    })
  ) {
    satisfied.push("state_ag_queued");
  }

  if (hasStateAgFilingWithConfirmation(input.filings)) {
    satisfied.push("state_ag_confirmed");
  }

  if (
    isApprovedDemandLetterFilingAction(action) &&
    action.status === "approved" &&
    isChatPendingHumanFulfillmentEscalation({
      approvedAction: action,
      caseId,
      tasks: input.tasks,
      filings: input.filings,
    })
  ) {
    satisfied.push("demand_letter_queued");
    const openDemandLetterTask = findOpenDemandLetterFilingTask(input.tasks, caseId);
    if (isDemandLetterEmailSending(openDemandLetterTask)) {
      satisfied.push("demand_letter_sending");
    }
    if (isDemandLetterEmailFailed(openDemandLetterTask)) {
      satisfied.push("demand_letter_send_failed");
    }
  }

  if (hasDemandLetterFilingWithConfirmation(input.filings)) {
    satisfied.push("demand_letter_sent");
  }

  if (
    action &&
    shouldExposeCaseResolutionFlow({
      approvedAction: action,
      caseId,
      tasks: input.tasks,
      filings: input.filings,
    }) &&
    Boolean(action.outcome_note?.trim())
  ) {
    satisfied.push("resolution_ready");
  }

  const archivedAt = input.archivedAt?.trim() ?? "";
  if (hasOperatorTerminalResponseReviewOutcome(action)) {
    if (archivedAt) {
      satisfied.push("operator_case_closed");
    } else {
      satisfied.push("operator_closure_pending");
    }
  }

  // Second pass: a queued milestone that is also stale (>= 24h old) additionally satisfies its
  // own distinct stale milestone, so it can be narrated as a separate, later, one-time update.
  for (const baseMilestone of Object.keys(
    QUEUED_MILESTONE_STALE_CONFIG
  ) as ChatCaseProgressMilestone[]) {
    if (!satisfied.includes(baseMilestone)) continue;
    const cfg = QUEUED_MILESTONE_STALE_CONFIG[baseMilestone];
    if (!cfg) continue;
    const ageMs = resolveQueuedMilestoneAgeMs(baseMilestone, input.tasks, caseId, nowMs);
    if (ageMs != null && ageMs >= OPERATOR_QUEUE_STALE_NARRATION_THRESHOLD_MS) {
      satisfied.push(cfg.staleMilestone);
    }
  }

  return CHAT_CASE_PROGRESS_MILESTONE_ORDER.filter((milestone) => satisfied.includes(milestone));
}

/** Shared wording for every destination's separate, one-time staleness update. */
function stalePhraseMessage(destinationPhrase: string): string {
  return `Your ${destinationPhrase} is taking longer than expected. Surrenderless operators are still working on this — stay here in chat for updates.`;
}

export function buildChatCaseProgressNarrationMessage(
  milestone: ChatCaseProgressMilestone
): string {
  switch (milestone) {
    case "merchant_contact_queued":
      return "I've queued merchant or company contact with Surrenderless. Stay here in chat — I'll update you when outreach is sending or sent.";
    case "merchant_contact_queued_stale":
      return stalePhraseMessage(QUEUED_MILESTONE_STALE_CONFIG.merchant_contact_queued!.destinationPhrase);
    case "merchant_contact_sending":
      return "Surrenderless is sending your merchant or company first-contact email now. Stay here in chat for confirmation.";
    case "merchant_contact_send_failed":
      return "Automated merchant email delivery did not go through. Surrenderless operators will complete outreach manually — stay here in chat for updates.";
    case "merchant_contact_confirmed":
      return "Merchant or company contact is confirmed on file. Surrenderless is advancing your case to the next step.";
    case "payment_dispute_queued":
      return "I've queued your payment dispute with Surrenderless. Stay here in chat — I'll update you when it's sending or filed with your bank or card issuer.";
    case "payment_dispute_queued_stale":
      return stalePhraseMessage(QUEUED_MILESTONE_STALE_CONFIG.payment_dispute_queued!.destinationPhrase);
    case "payment_dispute_sending":
      return "Surrenderless is sending your payment dispute email to your bank or card issuer now. Stay here in chat for confirmation.";
    case "payment_dispute_send_failed":
      return "Automated payment dispute email delivery did not go through. Surrenderless operators will complete filing manually — stay here in chat for updates.";
    case "payment_dispute_confirmed":
      return "Your payment dispute filing is confirmed on file. Surrenderless is advancing your case to the next step.";
    case "fcc_queued":
      return "I've queued your FCC complaint with Surrenderless for operator filing. Stay here in chat — I'll update you when it's filed.";
    case "fcc_queued_stale":
      return stalePhraseMessage(QUEUED_MILESTONE_STALE_CONFIG.fcc_queued!.destinationPhrase);
    case "fcc_confirmed":
      return "Your FCC filing is confirmed on file. Surrenderless is advancing your case to the next step.";
    case "dot_queued":
      return "I've queued your USDOT aviation complaint with Surrenderless for operator filing. Stay here in chat — I'll update you when it's filed.";
    case "dot_queued_stale":
      return stalePhraseMessage(QUEUED_MILESTONE_STALE_CONFIG.dot_queued!.destinationPhrase);
    case "dot_confirmed":
      return "Your USDOT aviation filing is confirmed on file. Surrenderless is advancing your case to the next step.";
    case "cfpb_queued":
      return "I've queued your CFPB complaint with Surrenderless for operator filing. Stay here in chat — I'll update you when it's filed.";
    case "cfpb_queued_stale":
      return stalePhraseMessage(QUEUED_MILESTONE_STALE_CONFIG.cfpb_queued!.destinationPhrase);
    case "cfpb_confirmed":
      return "Your CFPB filing is confirmed on file. Surrenderless is advancing your case to the next step.";
    case "ftc_queued":
      return "I've queued your FTC consumer complaint with Surrenderless for operator filing. Stay here in chat — I'll update you when it's filed.";
    case "ftc_queued_stale":
      return stalePhraseMessage(QUEUED_MILESTONE_STALE_CONFIG.ftc_queued!.destinationPhrase);
    case "ftc_submitting":
      return "Surrenderless is filing your FTC consumer complaint now. Stay here in chat for confirmation.";
    case "ftc_submit_failed":
      return "Automated FTC filing did not complete. Surrenderless operators will finish the filing manually — stay here in chat for updates.";
    case "ftc_confirmed":
      return "Your FTC consumer complaint filing is confirmed on file. Surrenderless is advancing your case to the next step.";
    case "bbb_queued":
      return "I've queued your Better Business Bureau complaint with Surrenderless for operator filing. Stay here in chat — I'll update you when it's filed.";
    case "bbb_queued_stale":
      return stalePhraseMessage(QUEUED_MILESTONE_STALE_CONFIG.bbb_queued!.destinationPhrase);
    case "bbb_submitting":
      return "Surrenderless is filing your Better Business Bureau complaint now. Stay here in chat for confirmation.";
    case "bbb_submit_failed":
      return "Automated BBB filing did not complete. Surrenderless operators will finish the filing manually — stay here in chat for updates.";
    case "bbb_confirmed":
      return "Your Better Business Bureau filing is confirmed on file. Surrenderless is advancing your case to the next step.";
    case "bbb_filed":
      return "Your Better Business Bureau complaint is on file with confirmation recorded. Surrenderless will carry your case to the next escalation step — you can stay in this chat.";
    case "state_ag_queued":
      return "I've queued your State Attorney General complaint with Surrenderless for operator filing. Stay here in chat — I'll update you when it's filed.";
    case "state_ag_queued_stale":
      return stalePhraseMessage(QUEUED_MILESTONE_STALE_CONFIG.state_ag_queued!.destinationPhrase);
    case "state_ag_confirmed":
      return "Your State Attorney General filing is confirmed on file. Surrenderless is advancing your case to the next step.";
    case "demand_letter_queued":
      return "Your demand letter is queued with Surrenderless. Stay here in chat — I'll update you when it's sending or sent.";
    case "demand_letter_queued_stale":
      return stalePhraseMessage(QUEUED_MILESTONE_STALE_CONFIG.demand_letter_queued!.destinationPhrase);
    case "demand_letter_sending":
      return "Surrenderless is sending your demand letter email to the company now. Stay here in chat for confirmation.";
    case "demand_letter_send_failed":
      return "Automated demand letter email delivery did not go through. Surrenderless operators will complete sending manually — stay here in chat for updates.";
    case "demand_letter_sent":
      return "Your demand letter is sent and confirmed on file. Escalation steps are complete — I'll help you track follow-up next.";
    case "resolution_ready":
      return "Surrenderless is tracking follow-up for this case. Stay here in chat — I'll update you when follow-up is reviewed and the case can be closed.";
    case "operator_closure_pending":
      return CHAT_OPERATOR_OWNED_ARCHIVE_RESPONSE;
    case "operator_case_closed":
      return "Surrenderless has closed this case. You can start a new matter here in chat whenever you're ready.";
    default: {
      const _exhaustive: never = milestone;
      return _exhaustive;
    }
  }
}

function getProgressNarrationStorage(): Storage | null {
  if (typeof window !== "undefined") return window.sessionStorage;
  if (typeof globalThis.sessionStorage !== "undefined") return globalThis.sessionStorage;
  return null;
}

function readNarratedMap(): Record<string, ChatCaseProgressMilestone[]> {
  const storage = getProgressNarrationStorage();
  if (!storage) return {};
  try {
    const raw = storage.getItem(STORAGE_CHAT_CASE_PROGRESS_NARRATED_V1);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, ChatCaseProgressMilestone[]>;
  } catch {
    return {};
  }
}

export function readNarratedChatCaseProgressMilestones(
  caseId: string
): ReadonlySet<ChatCaseProgressMilestone> {
  const trimmed = caseId.trim();
  if (!trimmed) return new Set();
  const rows = readNarratedMap()[trimmed];
  if (!Array.isArray(rows)) return new Set();
  return new Set(rows);
}

export function markChatCaseProgressMilestonesNarrated(
  caseId: string,
  milestones: readonly ChatCaseProgressMilestone[]
): void {
  const trimmed = caseId.trim();
  if (!trimmed || milestones.length === 0) return;
  const storage = getProgressNarrationStorage();
  if (!storage) return;
  const map = readNarratedMap();
  const existing = new Set(map[trimmed] ?? []);
  for (const milestone of milestones) {
    existing.add(milestone);
  }
  map[trimmed] = CHAT_CASE_PROGRESS_MILESTONE_ORDER.filter((milestone) => existing.has(milestone));
  storage.setItem(STORAGE_CHAT_CASE_PROGRESS_NARRATED_V1, JSON.stringify(map));
}

/** New milestones to narrate in ladder order; marks them durable in session storage. */
export function collectNewChatCaseProgressNarrationMessages(
  input: ChatCaseProgressObservation,
  nowMs: number = Date.now()
): string[] {
  const caseId = input.caseId.trim();
  if (!caseId) return [];

  const alreadyNarrated = readNarratedChatCaseProgressMilestones(caseId);
  const satisfied = deriveSatisfiedChatCaseProgressMilestones(input, nowMs);
  const toNarrate = satisfied.filter((milestone) => !alreadyNarrated.has(milestone));
  if (toNarrate.length === 0) return [];

  // Mark every newly-satisfied milestone narrated, including a base queued milestone that is
  // suppressed below — once resolved (sent or superseded), it must never be reconsidered.
  markChatCaseProgressMilestonesNarrated(caseId, toNarrate);

  const toNarrateSet = new Set(toNarrate);
  return toNarrate
    .filter((milestone) => {
      // A base queued milestone whose stale variant is satisfied in this same batch means the
      // task was first observed already stale — send only the stale "taking longer" message,
      // never both together.
      const staleVariant = QUEUED_MILESTONE_STALE_CONFIG[milestone]?.staleMilestone;
      return !(staleVariant && toNarrateSet.has(staleVariant));
    })
    .map((milestone) => buildChatCaseProgressNarrationMessage(milestone));
}

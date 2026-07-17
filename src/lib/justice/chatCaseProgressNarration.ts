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
  hasDotFilingWithConfirmation,
  isApprovedDotFilingAction,
} from "@/lib/justice/dotFilingTask";
import {
  hasFccFilingWithConfirmation,
  isApprovedFccFilingAction,
} from "@/lib/justice/fccFilingTask";
import {
  hasFtcFilingWithConfirmation,
  isApprovedFtcFilingAction,
} from "@/lib/justice/ftcFilingTask";
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
  hasStateAgFilingWithConfirmation,
  isApprovedStateAgFilingAction,
} from "@/lib/justice/stateAgFilingTask";
import { hasOperatorTerminalResponseReviewOutcome } from "@/lib/justice/operatorOwnedCaseArchive";
import { CHAT_OPERATOR_OWNED_ARCHIVE_RESPONSE } from "@/lib/justice/chatCaseClosureGates";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";
import type { JusticeApprovedNextAction } from "@/lib/justice/types";

export type ChatCaseProgressMilestone =
  | "merchant_contact_queued"
  | "merchant_contact_sending"
  | "merchant_contact_send_failed"
  | "merchant_contact_confirmed"
  | "payment_dispute_queued"
  | "payment_dispute_sending"
  | "payment_dispute_send_failed"
  | "payment_dispute_confirmed"
  | "fcc_queued"
  | "fcc_confirmed"
  | "dot_queued"
  | "dot_confirmed"
  | "cfpb_queued"
  | "cfpb_confirmed"
  | "ftc_queued"
  | "ftc_confirmed"
  | "bbb_queued"
  | "bbb_submitting"
  | "bbb_submit_failed"
  | "bbb_confirmed"
  | "bbb_filed"
  | "state_ag_queued"
  | "state_ag_confirmed"
  | "demand_letter_queued"
  | "demand_letter_sending"
  | "demand_letter_send_failed"
  | "demand_letter_sent"
  | "resolution_ready"
  | "operator_closure_pending"
  | "operator_case_closed";

export const CHAT_CASE_PROGRESS_MILESTONE_ORDER: readonly ChatCaseProgressMilestone[] = [
  "merchant_contact_queued",
  "merchant_contact_sending",
  "merchant_contact_send_failed",
  "merchant_contact_confirmed",
  "payment_dispute_queued",
  "payment_dispute_sending",
  "payment_dispute_send_failed",
  "payment_dispute_confirmed",
  "fcc_queued",
  "fcc_confirmed",
  "dot_queued",
  "dot_confirmed",
  "cfpb_queued",
  "cfpb_confirmed",
  "ftc_queued",
  "ftc_confirmed",
  "bbb_queued",
  "bbb_submitting",
  "bbb_submit_failed",
  "bbb_confirmed",
  "bbb_filed",
  "state_ag_queued",
  "state_ag_confirmed",
  "demand_letter_queued",
  "demand_letter_sending",
  "demand_letter_send_failed",
  "demand_letter_sent",
  "resolution_ready",
  "operator_closure_pending",
  "operator_case_closed",
] as const;

export const STORAGE_CHAT_CASE_PROGRESS_NARRATED_V1 = "justice_chat_case_progress_narrated_v1";

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
  input: ChatCaseProgressObservation
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

  return CHAT_CASE_PROGRESS_MILESTONE_ORDER.filter((milestone) => satisfied.includes(milestone));
}

export function buildChatCaseProgressNarrationMessage(
  milestone: ChatCaseProgressMilestone
): string {
  switch (milestone) {
    case "merchant_contact_queued":
      return "I've queued merchant or company contact with Surrenderless. Stay here in chat — I'll update you when outreach is sending or sent.";
    case "merchant_contact_sending":
      return "Surrenderless is sending your merchant or company first-contact email now. Stay here in chat for confirmation.";
    case "merchant_contact_send_failed":
      return "Automated merchant email delivery did not go through. Surrenderless operators will complete outreach manually — stay here in chat for updates.";
    case "merchant_contact_confirmed":
      return "Merchant or company contact is confirmed on file. Surrenderless is advancing your case to the next step.";
    case "payment_dispute_queued":
      return "I've queued your payment dispute with Surrenderless. Stay here in chat — I'll update you when it's sending or filed with your bank or card issuer.";
    case "payment_dispute_sending":
      return "Surrenderless is sending your payment dispute email to your bank or card issuer now. Stay here in chat for confirmation.";
    case "payment_dispute_send_failed":
      return "Automated payment dispute email delivery did not go through. Surrenderless operators will complete filing manually — stay here in chat for updates.";
    case "payment_dispute_confirmed":
      return "Your payment dispute filing is confirmed on file. Surrenderless is advancing your case to the next step.";
    case "fcc_queued":
      return "I've queued your FCC complaint with Surrenderless for operator filing. Stay here in chat — I'll update you when it's filed.";
    case "fcc_confirmed":
      return "Your FCC filing is confirmed on file. Surrenderless is advancing your case to the next step.";
    case "dot_queued":
      return "I've queued your USDOT aviation complaint with Surrenderless for operator filing. Stay here in chat — I'll update you when it's filed.";
    case "dot_confirmed":
      return "Your USDOT aviation filing is confirmed on file. Surrenderless is advancing your case to the next step.";
    case "cfpb_queued":
      return "I've queued your CFPB complaint with Surrenderless for operator filing. Stay here in chat — I'll update you when it's filed.";
    case "cfpb_confirmed":
      return "Your CFPB filing is confirmed on file. Surrenderless is advancing your case to the next step.";
    case "ftc_queued":
      return "I've queued your FTC consumer complaint with Surrenderless for operator filing. Stay here in chat — I'll update you when it's filed.";
    case "ftc_confirmed":
      return "Your FTC consumer complaint filing is confirmed on file. Surrenderless is advancing your case to the next step.";
    case "bbb_queued":
      return "I've queued your Better Business Bureau complaint with Surrenderless. Stay here in chat — I'll update you when it's filing or filed.";
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
    case "state_ag_confirmed":
      return "Your State Attorney General filing is confirmed on file. Surrenderless is advancing your case to the next step.";
    case "demand_letter_queued":
      return "Your demand letter is queued with Surrenderless. Stay here in chat — I'll update you when it's sending or sent.";
    case "demand_letter_sending":
      return "Surrenderless is sending your demand letter email to the company now. Stay here in chat for confirmation.";
    case "demand_letter_send_failed":
      return "Automated demand letter email delivery did not go through. Surrenderless operators will complete sending manually — stay here in chat for updates.";
    case "demand_letter_sent":
      return "Your demand letter is sent and confirmed on file. Escalation steps are complete — I'll help you track follow-up next.";
    case "resolution_ready":
      return "Follow-up and outcome tracking are ready below. Review the summary when you're ready, or tell me if anything changed.";
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
  input: ChatCaseProgressObservation
): string[] {
  const caseId = input.caseId.trim();
  if (!caseId) return [];

  const alreadyNarrated = readNarratedChatCaseProgressMilestones(caseId);
  const satisfied = deriveSatisfiedChatCaseProgressMilestones(input);
  const toNarrate = satisfied.filter((milestone) => !alreadyNarrated.has(milestone));
  if (toNarrate.length === 0) return [];

  markChatCaseProgressMilestonesNarrated(caseId, toNarrate);
  return toNarrate.map((milestone) => buildChatCaseProgressNarrationMessage(milestone));
}

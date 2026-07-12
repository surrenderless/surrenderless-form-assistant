import {
  filingsForApprovedActionManualTracking,
  MANUAL_ACTION_TRACKING_REAL_BBB_PREP_HREF,
  type ManualActionTrackingFiling,
} from "@/lib/justice/handlingTrackingProgress";
import { isChatPendingHumanFulfillmentEscalation } from "@/lib/justice/chatPendingHumanFulfillmentRefresh";
import { shouldExposeCaseResolutionFlow } from "@/lib/justice/escalationLadderResolution";
import {
  hasCfpbFilingWithConfirmation,
  isApprovedCfpbFilingAction,
} from "@/lib/justice/cfpbFilingTask";
import {
  hasDemandLetterFilingWithConfirmation,
  isApprovedDemandLetterFilingAction,
} from "@/lib/justice/demandLetterFilingTask";
import {
  hasStateAgFilingWithConfirmation,
  isApprovedStateAgFilingAction,
} from "@/lib/justice/stateAgFilingTask";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";
import type { JusticeApprovedNextAction } from "@/lib/justice/types";

const BBB_TRACKING_ACTION = {
  href: MANUAL_ACTION_TRACKING_REAL_BBB_PREP_HREF,
  label: "Better Business Bureau",
} as const;

export type ChatCaseProgressMilestone =
  | "cfpb_queued"
  | "cfpb_confirmed"
  | "bbb_filed"
  | "state_ag_queued"
  | "state_ag_confirmed"
  | "demand_letter_queued"
  | "demand_letter_sent"
  | "resolution_ready";

export const CHAT_CASE_PROGRESS_MILESTONE_ORDER: readonly ChatCaseProgressMilestone[] = [
  "cfpb_queued",
  "cfpb_confirmed",
  "bbb_filed",
  "state_ag_queued",
  "state_ag_confirmed",
  "demand_letter_queued",
  "demand_letter_sent",
  "resolution_ready",
] as const;

export const STORAGE_CHAT_CASE_PROGRESS_NARRATED_V1 = "justice_chat_case_progress_narrated_v1";

export type ChatCaseProgressObservation = {
  caseId: string;
  approvedAction: JusticeApprovedNextAction | undefined;
  tasks: readonly JusticeCaseTaskRow[];
  filings: readonly ManualActionTrackingFiling[];
};

export function hasBbbFilingWithConfirmation(
  filings: readonly ManualActionTrackingFiling[]
): boolean {
  return filingsForApprovedActionManualTracking(filings, BBB_TRACKING_ACTION).some((filing) =>
    Boolean(filing.confirmation_number?.trim())
  );
}

export function deriveSatisfiedChatCaseProgressMilestones(
  input: ChatCaseProgressObservation
): ChatCaseProgressMilestone[] {
  const caseId = input.caseId.trim();
  if (!caseId) return [];

  const action = input.approvedAction;
  const satisfied: ChatCaseProgressMilestone[] = [];

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

  if (hasBbbFilingWithConfirmation(input.filings)) {
    satisfied.push("bbb_filed");
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

  return CHAT_CASE_PROGRESS_MILESTONE_ORDER.filter((milestone) => satisfied.includes(milestone));
}

export function buildChatCaseProgressNarrationMessage(
  milestone: ChatCaseProgressMilestone
): string {
  switch (milestone) {
    case "cfpb_queued":
      return "I've queued your CFPB complaint with Surrenderless for operator filing. Stay here in chat — I'll update you when it's filed.";
    case "cfpb_confirmed":
      return "Your CFPB filing is confirmed on file. Surrenderless is advancing your case to the next step.";
    case "bbb_filed":
      return "Your Better Business Bureau complaint is on file with confirmation recorded. Surrenderless will carry your case to the next escalation step — you can stay in this chat.";
    case "state_ag_queued":
      return "I've queued your State Attorney General complaint with Surrenderless for operator filing. Stay here in chat — I'll update you when it's filed.";
    case "state_ag_confirmed":
      return "Your State Attorney General filing is confirmed on file. Surrenderless is advancing your case to the next step.";
    case "demand_letter_queued":
      return "Your demand letter is queued with Surrenderless for operator fulfillment. I'll keep you posted here in chat.";
    case "demand_letter_sent":
      return "Your demand letter is sent and confirmed on file. Escalation steps are complete — I'll help you track follow-up next.";
    case "resolution_ready":
      return "Follow-up and outcome tracking are ready below. Review the summary when you're ready, or tell me if anything changed.";
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

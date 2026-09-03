"use client";

import { useAuth, useUser } from "@clerk/nextjs";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { validate as isUuid } from "uuid";
import Header from "@/app/components/Header";
import JusticeActionResumeSignInPrompt from "@/app/components/JusticeActionResumeSignInPrompt";
import { ApprovedNextActionFollowUpTimingLine } from "@/lib/justice/approvedNextActionFollowUp";
import { clearLocalJusticeSession } from "@/lib/justice/clearLocalJusticeSession";
import {
  APPROVED_NEXT_ACTION_HANDLING_ACKNOWLEDGE_HELPER,
  ApprovedNextActionHandlingHandledOpenTriageNote,
  ApprovedNextActionHandlingQueueStatusReadOnly,
  ApprovedNextActionHandlingRequestBlock,
  ApprovedNextActionHandlingRequestedReadOnly,
  formatApprovedNextActionHandlingTimestamp,
  HANDLING_TRACKING_STEP_COMPLETE,
} from "@/lib/justice/approvedNextActionHandlingDisplay";
import {
  acknowledgeHandlingRequestInApprovedNextAction,
  applyHandlingRequestNoteToApprovedNextAction,
  omitClearedHandlingRequestNoteFromApprovedNextAction,
  approvedNextActionStatusLabel,
  clearFollowUpFromApprovedNextAction,
  hydrateApprovedNextActionForDisplay,
  mergeApprovedNextActionTrackingFields,
  parseJusticeCaseClientState,
  mergeClientStateWithAcknowledgedHandling,
  mergeClientStateWithApprovedNextAction,
  mergeClientStateWithClearedFollowUp,
  readSessionApprovedNextAction,
  writeSessionApprovedNextAction,
} from "@/lib/justice/approvedNextActionState";
import {
  canonicalFilingDestinationForApprovedActionHref,
  chatResolutionTrackingFormOpen,
  deriveChatHandlingTrackingLine,
  handlingClosureAcknowledgmentVisible,
} from "@/lib/justice/handlingTrackingProgress";
import { buildChatConfirmedFilingSummaryLines } from "@/lib/justice/chatConfirmedFilingsSummary";
import {
  CHAT_PENDING_HUMAN_FULFILLMENT_POLL_MS,
  isChatOperatorOwnedClosurePollPending,
  isChatOwnedEndgameWaitPollPending,
  isChatPendingHumanFulfillmentEscalation,
} from "@/lib/justice/chatPendingHumanFulfillmentRefresh";
import {
  ensureChatResolutionAfterEscalationFulfillment,
  shouldRehydrateCaseAfterResolutionSync,
} from "@/lib/justice/chatEscalationFulfillmentSync";
import { OWNED_FILING_TASK_ENSURE_RETRYABLE_ERROR } from "@/lib/justice/ensureOwnedFilingTaskAfterClientStateWrite";
import { persistPreparedPacketApprovalToCase } from "@/lib/justice/persistPreparedPacketApprovalToCase";
import {
  observeChatOwnedFulfillmentCompletionSync,
  shouldRehydrateCaseAfterOwnedFulfillmentSync,
  type ChatOwnedFulfillmentObservationSnapshot,
} from "@/lib/justice/chatOwnedFulfillmentCompletionSync";
import {
  collectNewChatCaseProgressNarrationMessages,
  type ChatCaseProgressObservation,
} from "@/lib/justice/chatCaseProgressNarration";
import {
  MAX_JUSTICE_CASE_CHAT_APPEND_BATCH,
  type JusticeCaseChatMessageSource,
} from "@/lib/justice/justiceCaseChatMessages";
import { chunkArray } from "@/lib/chunkArray";
import {
  appendCaseChatTranscriptTurns,
  fetchCaseChatTranscript,
  type JusticeCaseChatPersistTurn,
  type JusticeCaseChatUiMessage,
} from "@/lib/justice/justiceCaseChatTranscriptClient";
import { syncChatProgressNarrationFromTranscript } from "@/lib/justice/syncChatProgressNarrationFromTranscript";
import { shouldAutopilotMerchantContactDocumentation } from "@/lib/justice/chatSafeChecklistAutopilot";
import {
  buildChatLegalConsentAssistantResponse,
  buildChatLegalConsentGateContext,
  clearChatBbbAccuracyConsented,
  markChatBbbAccuracyConsented,
  parseChatLegalConsentMessage,
  readChatBbbAccuracyConsented,
  resolvePendingChatLegalConsentGate,
} from "@/lib/justice/chatLegalConsentGates";
import {
  buildChatCaseRestoreAssistantResponse,
  buildChatCaseRestoreGateContext,
  parseChatCaseRestoreMessage,
} from "@/lib/justice/chatCaseRestoreGates";
import {
  applyChatStartNewCaseLocalSessionReset,
  buildChatStartNewCaseAssistantResponse,
  buildChatStartNewCaseGateContext,
  buildChatStartNewCaseStartedResponse,
  buildIsolatedStartNewCaseTranscript,
  parseChatStartNewCaseMessage,
  stagedProofNotesAfterStartNewCaseReset,
} from "@/lib/justice/chatStartNewCaseGates";
import {
  buildChatCaseSelectionAmbiguousMatchResponse,
  buildChatCaseSelectionAssistantResponse,
  buildChatCaseSelectionGateContext,
  buildChatCaseSelectionNotFoundResponse,
  buildChatCaseSelectionOpenedResponse,
  parseChatCaseSelectionMessage,
} from "@/lib/justice/chatCaseSelectionGates";
import {
  buildChatCaseSelectionList,
  clearChatCaseSelectionOffer,
  formatChatCaseSelectionListMessage,
  readChatCaseSelectionOffer,
  resolveChatCaseSelectionChoice,
  resolveChatCaseSelectionLiveStatus,
  writeChatCaseSelectionOffer,
  type ChatCaseSelectionListEntry,
} from "@/lib/justice/chatCaseSelectionList";
import {
  buildChatCaseClosureAssistantResponse,
  buildChatCaseClosureGateContext,
  parseChatCaseClosureMessage,
  parseOperatorOwnedArchiveIntent,
  parsePrematureArchiveIntent,
  resolvePendingChatCaseClosureGate,
} from "@/lib/justice/chatCaseClosureGates";
import {
  buildChatIntakeCommitAssistantResponse,
  buildChatIntakeCommitContext,
  canCommitIntakeViaChat,
  parseChatIntakeCommitMessage,
} from "@/lib/justice/chatIntakeCommitGates";
import {
  CHAT_AI_ENTRY_DISCLAIMER,
  CHAT_AI_EVIDENCE_ESCALATION_HINT,
  CHAT_CONTINUE_HANDOFF_CHAT_FIRST_DRAFT_STEP,
  CHAT_CONTINUE_HANDOFF_CHAT_FIRST_PACKET_STEP,
  CHAT_CONTINUE_HANDOFF_CHAT_FIRST_TRACKING_STEP,
  CHAT_CONTINUE_HANDOFF_POST_PREVIEW_STEP,
  CHAT_CONTINUE_HANDOFF_PREVIEW_STEP,
} from "@/lib/justice/chatContinueHandoffCopy";
import {
  hasPendingHumanFulfillmentEscalation,
  shouldExposeCaseResolutionFlow,
} from "@/lib/justice/escalationLadderResolution";
import { hasOperatorTerminalResponseReviewOutcome } from "@/lib/justice/operatorOwnedCaseArchive";
import { shouldSuppressChatManualActionForSurrenderlessOwnedStep } from "@/lib/justice/surrenderlessOwnedStep";
import {
  OWNED_ENDGAME_WAIT_COPY,
  OWNED_STEP_CHAT_STATUS_COPY,
  OWNED_STEP_HANDLING_TRACKING_COPY,
  resolveChatOwnedHandlingTrackingStep,
  shouldShowChatConsumerArchiveControl,
  shouldShowChatConsumerEndgameDiyControls,
  shouldShowChatConsumerManualHandlingControls,
  shouldShowChatMerchantContactConfirmationControls,
} from "@/lib/justice/surrenderlessOwnedChatManualUi";
import {
  isJusticeEvidenceType,
  justiceEvidenceRowHasUploadedFile,
  JUSTICE_EVIDENCE_TYPE_LABELS,
  JUSTICE_EVIDENCE_TYPES,
  type JusticeCaseEvidenceRow,
  type JusticeEvidenceType,
} from "@/lib/justice/evidence";
import {
  buildChatEvidenceUploadFailureMessage,
  buildChatEvidenceUploadProgressMessage,
  buildChatEvidenceUploadSuccessMessage,
  JUSTICE_EVIDENCE_UPLOAD_MAX_BYTES,
} from "@/lib/justice/chatEvidenceUpload";
import { buildPrivateEvidenceFileAccessPath } from "@/lib/justice/evidenceFileAccess";
import { uploadJusticeEvidenceFile } from "@/lib/justice/uploadJusticeEvidenceFile";
import type { JusticeCaseFilingRow } from "@/lib/justice/filings";
import { buildSubmissionDraftPreview } from "@/lib/justice/buildSubmissionDraftPreview";
import { buildPacketPlainText } from "@/lib/justice/buildPacketPlainText";
import {
  buildBankLetter,
  type DisputeReasonOption,
  type PaymentDisputeProofType,
  type PaymentMethodOption,
} from "@/lib/justice/buildPaymentDisputeBankLetter";
import {
  CHAT_INLINE_BBB_PREP_HREF,
  CHAT_INLINE_FTC_REVIEW_PREP_HREF,
  CHAT_INLINE_PACKET_FALLBACK_PREP_HREF,
  CHAT_INLINE_PAYMENT_DISPUTE_PREP_HREF,
  buildChatInlineAssistedPracticeSummaryLines,
  getChatInlineApprovedPrepContent,
  resolveAssistedPracticeSubmissionLaneId,
  shouldResetAssistedPracticeRunUiState,
  shouldShowChatInlineBbbMockPracticePrep,
  shouldShowChatInlineBbbMockReadOnlyPrep,
  shouldShowChatInlineFtcMockPracticePrep,
  shouldShowChatInlineFtcMockReadOnlyPrep,
  shouldShowChatInlinePacketFallbackReadOnlyPrep,
  shouldShowChatInlinePaymentDisputeReadOnlyPrep,
  shouldShowChatInlineReadOnlyApprovedPrep,
  shouldShowChatInlineRealBbbComplaintPrep,
  shouldShowChatInlineRealBbbComplaintReadOnlyPrep,
} from "@/lib/justice/chatInlineApprovedPrep";
import { documentMerchantContact, type MerchantContactDocumentationInput } from "@/lib/justice/documentMerchantContact";
import {
  buildChatCapturedMerchantContactSummaryLines,
  buildMerchantContactDocumentationInputFromIntakeParts,
  isMerchantContactDocumentedInTimeline,
} from "@/lib/justice/deriveChatCapturedMerchantContact";
import {
  MOCK_BBB_PRACTICE_ASSISTED_SUBMISSION_LANE,
  MOCK_FTC_PRACTICE_ASSISTED_SUBMISSION_LANE,
  REAL_BBB_ASSISTED_SUBMISSION_LANE,
  resolveAssistedSubmissionLaneForApprovedHref,
} from "@/lib/justice/assistedSubmissionLane";
import {
  recomputeApprovedNextActionAfterIntake,
  shouldRecomputeApprovedNextActionOnEvidenceChange,
} from "@/lib/justice/recomputeApprovedNextActionAfterIntake";
import {
  buildPaymentDisputeDraftFromFields,
  logPaymentDisputeChecklistViewed,
  preparePaymentDisputeChecklist,
  resolvePaymentDisputeFormFields,
} from "@/lib/justice/preparePaymentDisputeChecklist";
import { executeAssistedBbbPracticeSubmission } from "@/lib/justice/executeAssistedBbbPracticeSubmission";
import { executeAssistedFtcPracticeSubmission } from "@/lib/justice/executeAssistedFtcPracticeSubmission";
import { executeAssistedRealBbbComplaintSubmission } from "@/lib/justice/executeAssistedRealBbbComplaintSubmission";
import { LastAssistedSubmissionAttemptSummaryReadOnly } from "@/lib/justice/LastAssistedSubmissionAttemptSummaryReadOnly";
import {
  isLastAssistedSubmissionAttemptVisibleForApprovedHref,
  isLastAssistedSubmissionAttemptFailed,
  readLastAssistedSubmissionAttemptFromClientState,
  type LastAssistedSubmissionAttemptSnapshot,
} from "@/lib/justice/submissionAttemptState";
import {
  followUpTaskOwnerHref,
  taskNotesMatchFollowUpMarker,
} from "@/lib/justice/followUpCaseTask";
import {
  taskNotesMatchFollowUpResponseReviewMarker,
  type SupersededLaneReviewOutcome,
} from "@/lib/justice/followUpResponseReviewTask";
import { taskNotesMatchHandlingRequestMarker } from "@/lib/justice/handlingRequestTask";
import {
  parseReviewTaskDeepLinkParams,
  resolveReviewTaskDeepLinkAction,
} from "@/lib/justice/resolveReviewTaskDeepLink";
import {
  buildCheckoutPriceHeadline,
  CHECKOUT_CONFIRMATION_TIMEOUT_MESSAGE,
  CHECKOUT_CONFIRMING_PAYMENT_MESSAGE,
  CHECKOUT_DISCLOSURE_PARAGRAPHS,
  CHECKOUT_PRICE_LOADING_MESSAGE,
  CHECKOUT_PRICE_UNAVAILABLE_MESSAGE,
  isCheckoutApprovalBlockedByPricing,
  isCheckoutAwaitingPaymentConfirmation,
  type CheckoutPriceState,
} from "@/lib/stripe/checkoutDisclosureCopy";
import { checkoutConfirmationDelayForAttempt } from "@/lib/stripe/checkoutConfirmationPolling";
import {
  isCheckoutPriceResponseStale,
  nextCheckoutPriceRequestId,
  shouldClearFetchedGuardOnFailure,
  shouldSkipCheckoutPriceFetchForPaidCase,
} from "@/lib/stripe/checkoutPriceRequestTracker";
import { parseCheckoutReturnStatus } from "@/lib/stripe/parseCheckoutReturnStatus";
import {
  buildSupersededLaneReviewCompletionRequest,
  selectOpenSupersededLaneReviewTasks,
} from "@/lib/justice/supersededLaneReviewChatPrompt";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";
import {
  getJusticeTaskDueKind,
  justiceTaskDueBadgeClass,
  justiceTaskDueKindLabel,
} from "@/lib/justice/taskDueStatus";
import {
  applyServerTimelineFromResponse,
  appendSubmissionDraftReviewedOnce,
  mergeServerTimelinePreservingLocalEntries,
  readTimeline,
  replaceTimelineForCase,
  SUBMISSION_DRAFT_REVIEWED_TIMELINE_ID,
} from "@/lib/justice/timeline";
import {
  buildApprovedNextActionTarget,
  pickPreparedNextAction,
} from "@/lib/justice/preparedNextAction";
import {
  cfpbLikelyRelevant,
  computeJusticeDestinations,
  dotLikelyRelevant,
  fccLikelyRelevant,
} from "@/lib/justice/rules";
import type {
  JusticeApprovedNextAction,
  JusticeCaseClientState,
  JusticeDestination,
  JusticeIntake,
  TimelineEntry,
} from "@/lib/justice/types";
import { STORAGE_CASE_ID, STORAGE_FTC_MANUAL_UNLOCK } from "@/lib/justice/types";
import {
  buildJusticeIntakeFromParts,
  justiceIntakeToBuildJusticeIntakeParts,
  type BuildJusticeIntakeParts,
  validateContactProofForIntake,
} from "@/lib/justice/buildJusticeIntake";
import { enrichContactProofPartsAfterChatTurn } from "@/lib/justice/enrichContactProofFromChat";
import {
  getPreviewBasicsMissing,
  stillNeededBeforePreviewMessage,
} from "@/lib/justice/previewBasicsReadiness";
import { resolveSignedInConsumerReplyEmail } from "@/lib/justice/resolveSignedInConsumerReplyEmail";
import { isBasicCaseInfoReadyForEscalation } from "@/lib/justice/caseReadiness";
import {
  fetchJusticeCaseById,
  fetchJusticeCasesForChatSelection,
  fetchLatestActiveJusticeCaseRow,
  fetchMostRecentlyArchivedEligibleJusticeCase,
  hydrateSessionFromCaseListRow,
  restoreArchivedJusticeCaseOnServer,
  type JusticeCaseListRow,
} from "@/lib/justice/hydrateActiveCaseFromServer";
import {
  commitIntakeToSessionAndServer,
  shouldRouteToChatAiAfterIntakeCommit,
} from "@/lib/justice/commitIntakeToSessionAndServer";
import {
  CHAT_AI_APPROVED_ACTION_TRACKING_ELEMENT_ID,
  resolveChatAiActiveCaseWorkHref,
  resolveChatAiActiveCaseWorkLabel,
  resolveChatAiChecklistDraftReviewAction,
  resolveChatAiChecklistPacketApprovalAction,
  scrollChatAiInlineElementWithHydrationWait,
  shouldBlockChatAiOffChatNavigation,
  shouldKeepSignedInChatAiActiveCaseInChat,
  shouldSuppressChatInlineMainLadderHubEscapeLinks,
} from "@/lib/justice/chatAiLadderNavigation";
import { readValidLocalJusticeIntake } from "@/lib/justice/hydrateActiveCaseFromServer";
import {
  clearIntakeDraft,
  readValidIntakeDraft,
  saveIntakeDraft,
} from "@/lib/justice/intakeDraftPersistence";
import {
  clearPreviewChatUpdateSummary,
  writePreviewChatUpdateSummary,
} from "@/lib/justice/previewChatUpdateHandoff";
import { requestJusticePreviewDraft } from "@/lib/justice/requestJusticePreviewDraft";
import {
  cloneBuildJusticeIntakeParts,
  summarizeBuildJusticeIntakePartsSessionChanges,
} from "@/lib/justice/summarizeBuildJusticeIntakePartsSessionChanges";
import {
  appendStagedProofNote,
  readStagedProofNotes,
  removeStagedProofNotesByClientIds,
  type StagedProofNote,
} from "@/lib/justice/stagedProofNotes";
import {
  defaultBuildJusticeIntakeParts,
  MAX_INTAKE_CHAT_USER_MESSAGE,
} from "@/lib/justice/parseIntakeChatAiResponse";
import {
  findOpenBbbFilingTask,
  hasBbbFilingWithConfirmation,
  isApprovedBbbFilingAction,
} from "@/lib/justice/bbbFilingTask";
import {
  findOpenFtcFilingTask,
  hasFtcFilingWithConfirmation,
  isApprovedFtcFilingAction,
} from "@/lib/justice/ftcFilingTask";
import {
  findLatestMerchantContactFiling,
  findOpenMerchantContactFilingTask,
  hasMerchantContactFilingWithConfirmation,
  isApprovedMerchantContactFilingAction,
} from "@/lib/justice/merchantContactFilingTask";
import {
  isMerchantContactEmailFailed,
  isMerchantContactEmailSending,
  merchantContactEmailBounceState,
} from "@/lib/justice/merchantContactEmailDelivery";
import {
  hasValidMerchantContactRecipient,
  isMerchantContactOperatorFallbackChosen,
  MERCHANT_CONTACT_RECIPIENT_REQUIRED_MESSAGE,
} from "@/lib/justice/merchantContactRecipient";
import { hasValidPaymentDisputeRecipient } from "@/lib/justice/paymentDisputeRecipient";
import {
  findOpenStateAgFilingTask,
  hasStateAgFilingWithConfirmation,
  isApprovedStateAgFilingAction,
} from "@/lib/justice/stateAgFilingTask";
import {
  findLatestDemandLetterFiling,
  findOpenDemandLetterFilingTask,
  hasDemandLetterFilingWithConfirmation,
  isApprovedDemandLetterFilingAction,
} from "@/lib/justice/demandLetterFilingTask";
import {
  demandLetterEmailBounceState,
  isDemandLetterEmailFailed,
  isDemandLetterEmailSending,
} from "@/lib/justice/demandLetterEmailDelivery";
import {
  findOpenCfpbFilingTask,
  hasCfpbFilingWithConfirmation,
  isApprovedCfpbFilingAction,
} from "@/lib/justice/cfpbFilingTask";
import {
  findOpenFccFilingTask,
  hasFccFilingWithConfirmation,
  isApprovedFccFilingAction,
} from "@/lib/justice/fccFilingTask";
import {
  findOpenDotFilingTask,
  hasDotFilingWithConfirmation,
  isApprovedDotFilingAction,
} from "@/lib/justice/dotFilingTask";
import {
  findLatestPaymentDisputeFiling,
  findOpenPaymentDisputeFilingTask,
  hasPaymentDisputeFilingWithConfirmation,
  isApprovedPaymentDisputeFilingAction,
} from "@/lib/justice/paymentDisputeFilingTask";
import {
  isPaymentDisputeEmailFailed,
  isPaymentDisputeEmailSending,
  paymentDisputeEmailBounceState,
} from "@/lib/justice/paymentDisputeEmailDelivery";
import {
  isBbbOwnedFilingFailed,
  isBbbOwnedFilingSubmitting,
} from "@/lib/justice/bbbOwnedFilingDeliveryState";
import {
  isFtcOwnedFilingFailed,
  isFtcOwnedFilingSubmitting,
} from "@/lib/justice/ftcOwnedFilingDeliveryState";
import { isPlaywrightMockIntakeCaseHydrationCaseId } from "@/lib/testing/playwrightMockIntakeCaseHydrationPipeline";

type UiMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

const CATEGORIES: { value: JusticeIntake["problem_category"]; label: string }[] = [
  { value: "online_purchase", label: "Something I bought online" },
  {
    value: "financial_account_issue",
    label: "Bank, credit, loan, payment, debt, billing, or financial account issue",
  },
  { value: "subscription", label: "A subscription or recurring charge" },
  { value: "service_failed", label: "A service that didn’t work as promised" },
  { value: "charge_dispute", label: "A charge I didn’t agree to" },
  { value: "something_else", label: "Something else" },
];

const OPENING_GREETING =
  "Hi — tell me what’s going on with your consumer issue. I’ll ask follow-up questions and keep track of your case details. When we’re done, you can review everything and save and continue in chat.";

const UPDATE_GREETING =
  "Your current case is loaded in the recap below. Tell me what you’d like to add or change — I’ll update the details as we go. When you’re ready, save and continue in chat.";

// Staged proof notes have no case_id of their own (pure sessionStorage) — switching the active
// case out from under one would silently attach it to the wrong dispute on next save. Shared by
// handleSelectCaseFromChat and handleRestoreMostRecentArchivedCaseFromChat.
const CHAT_CASE_SWITCH_STAGED_PROOF_NOTE_MESSAGE =
  "You have a proof note staged that hasn't been saved to a case yet. Save and continue in chat to attach it to your current case before switching to a different case.";

const RECAP_STORY_MAX_LEN = 120;
const ACTIVE_CASE_PRODUCT_MAX_LEN = 80;
const activeCaseChecklistLinkCls =
  "inline-flex text-sm font-semibold text-blue-600 hover:underline dark:text-blue-400";

const SESSION_PROOF_ADDED_LINE = "Added proof note(s) this visit";

const STORAGE_PREPARED_PACKET_APPROVED_V1 = "justice_prepared_packet_approved_v1";
const STORAGE_SUBMISSION_DRAFT_REVIEWED_V1 = "justice_submission_draft_reviewed_v1";

/**
 * TEMPORARY diagnostics for the packet-approval premature-auto-approve E2E investigation.
 * Gated on the fixed Playwright mock case ids — a real user's case id can never match, so
 * this never logs in production. Logs booleans/enums/hrefs and a browser stack only, no
 * chat/user content. Remove once the auto-approval trigger is identified.
 */
function logPlaywrightApprovePacketDiagnostic(
  event: string,
  caseId: string,
  details: Record<string, unknown>
): void {
  if (!isPlaywrightMockIntakeCaseHydrationCaseId(caseId)) return;
  const stack = new Error().stack ?? "";
  console.error(`[e2e-diag:approve-packet] ${event}`, {
    ...details,
    stack,
  });
  // Relay to the Node test process via the same exposeBinding the fetch-stack diagnostic
  // uses, when the E2E spec has wired it up. Only kind/event/time/stack cross the bridge —
  // never `details`, which may include booleans derived from case state.
  const relay = (
    window as unknown as {
      __e2ePatchStackRelay?: (payload: {
        kind: "approval";
        event: string;
        time: number;
        stack: string;
      }) => void;
    }
  ).__e2ePatchStackRelay;
  if (typeof relay === "function") {
    relay({ kind: "approval", event, time: Date.now(), stack });
  }
}

function readSessionPreparedPacketApproved(caseId: string): boolean {
  if (typeof window === "undefined" || !caseId) return false;
  try {
    const raw = sessionStorage.getItem(STORAGE_PREPARED_PACKET_APPROVED_V1);
    if (!raw) return false;
    const map = JSON.parse(raw) as Record<string, boolean>;
    return map[caseId] === true;
  } catch {
    return false;
  }
}

function writePreparedPacketApproved(caseId: string): void {
  if (typeof window === "undefined" || !caseId) return;
  try {
    const raw = sessionStorage.getItem(STORAGE_PREPARED_PACKET_APPROVED_V1);
    const map: Record<string, boolean> = raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
    map[caseId] = true;
    sessionStorage.setItem(STORAGE_PREPARED_PACKET_APPROVED_V1, JSON.stringify(map));
  } catch {
    // ignore corrupt session data
  }
}

function readSessionSubmissionDraftReviewed(caseId: string): boolean {
  if (typeof window === "undefined" || !caseId) return false;
  try {
    const raw = sessionStorage.getItem(STORAGE_SUBMISSION_DRAFT_REVIEWED_V1);
    if (!raw) return false;
    const map = JSON.parse(raw) as Record<string, boolean>;
    return map[caseId] === true;
  } catch {
    return false;
  }
}

function writeSessionSubmissionDraftReviewed(caseId: string): void {
  if (typeof window === "undefined" || !caseId) return;
  try {
    const raw = sessionStorage.getItem(STORAGE_SUBMISSION_DRAFT_REVIEWED_V1);
    const map: Record<string, boolean> = raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
    map[caseId] = true;
    sessionStorage.setItem(STORAGE_SUBMISSION_DRAFT_REVIEWED_V1, JSON.stringify(map));
  } catch {
    // ignore corrupt session data
  }
}

type ContinueHandoffStepsInput = {
  isUpdatingExistingCase: boolean;
  stagedCount: number;
  isStagedFlushRetry: boolean;
  savedEvidenceCount: number;
  sessionChangeLines?: string[];
  chatFirstContinuity?: boolean;
};

function getContinueHandoffSteps(input: ContinueHandoffStepsInput): string[] {
  const previewStep = CHAT_CONTINUE_HANDOFF_PREVIEW_STEP;
  const postPreviewFunnelStep = CHAT_CONTINUE_HANDOFF_POST_PREVIEW_STEP;
  const chatFirstDraftStep = CHAT_CONTINUE_HANDOFF_CHAT_FIRST_DRAFT_STEP;
  const chatFirstPacketStep = CHAT_CONTINUE_HANDOFF_CHAT_FIRST_PACKET_STEP;
  const chatFirstTrackingStep = CHAT_CONTINUE_HANDOFF_CHAT_FIRST_TRACKING_STEP;
  const funnelSteps = input.chatFirstContinuity
    ? [chatFirstDraftStep, chatFirstPacketStep, chatFirstTrackingStep]
    : [previewStep, postPreviewFunnelStep];

  if (input.isStagedFlushRetry) {
    const noteWord = input.stagedCount === 1 ? "note" : "notes";
    return [`Save ${input.stagedCount} pending proof ${noteWord} to your case.`, ...funnelSteps];
  }

  const steps: string[] = [];
  const sessionChangeLines = input.sessionChangeLines ?? [];

  if (input.isUpdatingExistingCase) {
    if (sessionChangeLines.length > 0) {
      steps.push("Save your updates from this chat to your case:");
      steps.push(...sessionChangeLines);
    } else {
      steps.push("Save updates to your case.");
    }
    const proofAddedInSession = sessionChangeLines.includes(SESSION_PROOF_ADDED_LINE);
    if (input.savedEvidenceCount > 0 && !proofAddedInSession) {
      const itemWord = input.savedEvidenceCount === 1 ? "item" : "items";
      steps.push(`Your ${input.savedEvidenceCount} saved proof ${itemWord} stay on your case.`);
    }
  } else {
    steps.push("Save your case.");
    if (input.stagedCount > 0) {
      const noteWord = input.stagedCount === 1 ? "note" : "notes";
      steps.push(`Save ${input.stagedCount} pending proof ${noteWord} to your case.`);
    }
  }

  steps.push(...funnelSteps);
  return steps;
}

function recapStoryDisplay(story: string): string | null {
  const trimmed = story.trim();
  if (!trimmed) return null;
  if (trimmed.length <= RECAP_STORY_MAX_LEN) return trimmed;
  return `${trimmed.slice(0, RECAP_STORY_MAX_LEN)}…`;
}

function formatIntakeChatApiError(status: number, serverError?: string): string {
  const err = serverError?.trim() ?? "";
  if (status === 401) {
    return "Your session may have expired. Sign in again, then resend your message.";
  }
  if (status === 429) {
    return "You’re sending messages too quickly. Wait a moment, then try again.";
  }
  if (status === 502) {
    return "We couldn’t get a usable AI reply. Check your message and try again.";
  }
  if (status === 500) {
    if (err.includes("OPENAI_API_KEY")) {
      return "AI intake isn’t available right now. Please try again later.";
    }
    return "Something went wrong on our side. Please try again.";
  }
  if (status === 413 || err.toLowerCase().includes("too large")) {
    return "That message is too large. Shorten it and try again.";
  }
  if (status === 400) {
    return "Something went wrong sending your message. Please try again.";
  }
  return "Something went wrong. Please try again.";
}

function msgId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `m_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function isEphemeralChatGreeting(text: string): boolean {
  return text === OPENING_GREETING || text === UPDATE_GREETING;
}

function uiMessagesToPersistTurns(
  turns: readonly JusticeCaseChatUiMessage[],
  source: JusticeCaseChatMessageSource
) {
  return turns
    .filter((turn) => !isEphemeralChatGreeting(turn.text))
    .map((turn) => ({
      clientTurnId: turn.id,
      role: turn.role,
      content: turn.text,
      source,
    }));
}

function categoryLabel(cat: JusticeIntake["problem_category"]): string {
  return CATEGORIES.find((c) => c.value === cat)?.label ?? cat.replace(/_/g, " ");
}

function truncateAttentionNote(text: string, maxLen: number): string {
  const t = text.trim();
  if (t.length <= maxLen) return t;
  return `${t.slice(0, maxLen).trimEnd()}…`;
}

function truncateActiveCaseProduct(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  if (trimmed.length <= ACTIVE_CASE_PRODUCT_MAX_LEN) return trimmed;
  return `${trimmed.slice(0, ACTIVE_CASE_PRODUCT_MAX_LEN)}…`;
}

function submissionDraftReviewedInTimeline(caseId: string): boolean {
  const entries = caseId ? readTimeline(caseId) : [];
  return entries.some(
    (e) => e.id === SUBMISSION_DRAFT_REVIEWED_TIMELINE_ID || e.type === "submission_draft_reviewed"
  );
}

const CHAT_DRAFT_PREVIEW_TRUNCATE = 720;

const CHAT_INLINE_SUBMISSION_DRAFT_REVIEWED_CHECKBOX_ID =
  "chat-inline-submission-draft-reviewed-checkbox";

const CHAT_INLINE_PREPARED_PACKET_REVIEWED_CHECKBOX_ID =
  "chat-inline-prepared-packet-reviewed-checkbox";
const CHAT_INLINE_MERCHANT_CONTACT_EMAIL_INPUT_ID = "chat-inline-merchant-contact-email-input";
const CHAT_MERCHANT_CONTACT_RECIPIENT_RETRY_INPUT_ID = "chat-merchant-contact-recipient-retry-input";
const CHAT_DEMAND_LETTER_RECIPIENT_RETRY_INPUT_ID = "chat-demand-letter-recipient-retry-input";

const CHAT_AI_CHECKOUT_PRICE_DISCLOSURE_ELEMENT_ID = "chat-ai-checkout-price-disclosure";

function isChatPreviewSelectableDestination(d: JusticeDestination): boolean {
  return d.status === "recommended" || d.status === "available";
}

function resolveChatPreviewDestination(
  intake: JusticeIntake,
  hasUploadedEvidenceFile: boolean
): JusticeDestination | null {
  const manualFtc =
    typeof window !== "undefined" && sessionStorage.getItem(STORAGE_FTC_MANUAL_UNLOCK) === "1";
  const useCompanyContactLabels = cfpbLikelyRelevant(intake) || fccLikelyRelevant(intake);
  const destinations = computeJusticeDestinations(intake, {
    manualFtc,
    useCompanyContactLabels,
    hasUploadedEvidenceFile,
  });
  const selectable = destinations.filter(isChatPreviewSelectableDestination);
  const options = selectable.length > 0 ? selectable : destinations;
  return options[0] ?? null;
}

function ChatInlineSubmissionDraftReviewBlock({
  draftText,
  aiDraftText,
  destinationLabel,
  checked,
  onCheckedChange,
  expanded,
  onExpandedChange,
  saving,
  error,
  onSubmit,
  suppressHubLink,
  copyHint,
  onCopyDraft,
  aiLoading,
  aiError,
  onGenerateAiDraft,
}: {
  draftText: string;
  aiDraftText: string | null;
  destinationLabel?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  saving: boolean;
  error: string | null;
  onSubmit: () => void;
  suppressHubLink: boolean;
  copyHint: string | null;
  onCopyDraft: () => void;
  aiLoading: boolean;
  aiError: string | null;
  onGenerateAiDraft: () => void;
}) {
  const reviewSourceText = aiDraftText?.trim() || draftText;
  const canTruncate = reviewSourceText.length > CHAT_DRAFT_PREVIEW_TRUNCATE;
  const displayText =
    expanded || !canTruncate
      ? reviewSourceText
      : `${reviewSourceText.slice(0, CHAT_DRAFT_PREVIEW_TRUNCATE)}…`;

  return (
    <div className="mt-3 space-y-2 rounded-lg border border-blue-300/80 bg-blue-50/60 px-3 py-2.5 dark:border-blue-800/60 dark:bg-blue-950/30">
      <p className="text-xs font-medium text-blue-950 dark:text-blue-100">Review submission draft</p>
      <p className="text-[11px] leading-relaxed text-blue-900/90 dark:text-blue-100/90">
        {aiDraftText
          ? "AI-assisted draft for your review in chat — not filed or sent automatically."
          : "Deterministic draft for your review in chat — not filed or sent automatically."}{" "}
        After you mark it reviewed, approve your prepared packet so Surrenderless can carry owned
        outreach and filings while you stay here for updates.
        {destinationLabel ? (
          <>
            {" "}
            Related action: <strong>{destinationLabel}</strong>.
          </>
        ) : null}
      </p>
      {draftText ? (
        <>
          <pre className="max-h-[min(280px,40vh)] overflow-auto whitespace-pre-wrap rounded-md border border-blue-200/80 bg-white/80 p-2 text-[11px] leading-relaxed text-neutral-900 dark:border-blue-900/40 dark:bg-neutral-950/80 dark:text-neutral-100">
            {displayText}
          </pre>
          {canTruncate ? (
            <button
              type="button"
              onClick={() => onExpandedChange(!expanded)}
              className="text-[11px] font-medium text-blue-700 underline underline-offset-2 hover:text-blue-900 dark:text-blue-300 dark:hover:text-blue-100"
            >
              {expanded ? "Show less" : "Show more"}
            </button>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={!reviewSourceText}
              onClick={() => onCopyDraft()}
              className="inline-flex rounded-lg border border-blue-400/80 bg-white px-3 py-1.5 text-xs font-medium text-blue-900 shadow-sm transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-blue-700 dark:bg-neutral-900 dark:text-blue-100 dark:hover:bg-neutral-800"
            >
              Copy draft for your records
            </button>
            <button
              type="button"
              disabled={aiLoading || !draftText}
              onClick={() => void onGenerateAiDraft()}
              className="inline-flex rounded-lg border border-blue-400/80 bg-white px-3 py-1.5 text-xs font-medium text-blue-900 shadow-sm transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-blue-700 dark:bg-neutral-900 dark:text-blue-100 dark:hover:bg-neutral-800"
            >
              {aiLoading
                ? "Generating…"
                : aiDraftText
                  ? "Regenerate AI-assisted draft"
                  : "Generate AI-assisted draft"}
            </button>
            {copyHint ? (
              <span className="text-[11px] text-blue-800 dark:text-blue-200">{copyHint}</span>
            ) : null}
          </div>
          {aiError ? <p className="text-[11px] text-red-700 dark:text-red-300">{aiError}</p> : null}
        </>
      ) : (
        <p className="text-[11px] text-blue-900/90 dark:text-blue-100/90">
          Draft preview is loading. Stay in this chat — it will appear here when ready.
        </p>
      )}
      <div className="flex items-start gap-2 text-[11px] text-blue-900 dark:text-blue-100">
        <input
          id={CHAT_INLINE_SUBMISSION_DRAFT_REVIEWED_CHECKBOX_ID}
          type="checkbox"
          checked={checked}
          onChange={(e) => onCheckedChange(e.target.checked)}
          disabled={!draftText}
          className="mt-0.5 shrink-0"
        />
        <label htmlFor={CHAT_INLINE_SUBMISSION_DRAFT_REVIEWED_CHECKBOX_ID} className="cursor-pointer">
          I reviewed the submission draft shown above.
        </label>
      </div>
      {error ? <p className="text-[11px] text-red-700 dark:text-red-300">{error}</p> : null}
      <button
        type="button"
        disabled={!checked || !draftText || saving}
        onClick={() => void onSubmit()}
        className="inline-flex rounded-lg border border-blue-500/80 bg-blue-700 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-blue-600 dark:hover:bg-blue-500"
      >
        {saving ? "Saving…" : "Mark draft reviewed"}
      </button>
      {!suppressHubLink ? (
        <p className="text-xs text-blue-800 dark:text-blue-200">
          Prefer to stay in chat — draft review and packet approval continue here after you mark this
          draft reviewed.
        </p>
      ) : null}
    </div>
  );
}

function ChatInlinePreparedPacketApprovalBlock({
  packetText,
  loading,
  checked,
  onCheckedChange,
  expanded,
  onExpandedChange,
  approving,
  onSubmit,
  suppressHubLink,
  copyHint,
  onCopyPacket,
  checkoutPriceState,
  onRetryPricing,
  onRetryPaymentConfirmation,
  merchantContactRecipientRequired,
  merchantContactRecipientValid,
  merchantContactRecipientValue,
  onMerchantContactRecipientChange,
  merchantContactOperatorFallbackChosen,
  onChooseMerchantContactOperatorFallback,
}: {
  packetText: string;
  loading: boolean;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  approving: boolean;
  onSubmit: () => void;
  suppressHubLink: boolean;
  copyHint: string | null;
  onCopyPacket: () => void;
  checkoutPriceState: CheckoutPriceState;
  onRetryPricing: () => void;
  onRetryPaymentConfirmation: () => void;
  merchantContactRecipientRequired: boolean;
  merchantContactRecipientValid: boolean;
  merchantContactRecipientValue: string;
  onMerchantContactRecipientChange: (value: string) => void;
  merchantContactOperatorFallbackChosen: boolean;
  onChooseMerchantContactOperatorFallback: () => void;
}) {
  const merchantContactRecipientBlocking =
    merchantContactRecipientRequired &&
    !merchantContactRecipientValid &&
    !merchantContactOperatorFallbackChosen;
  const canTruncate = packetText.length > CHAT_DRAFT_PREVIEW_TRUNCATE;
  const displayText =
    expanded || !canTruncate ? packetText : `${packetText.slice(0, CHAT_DRAFT_PREVIEW_TRUNCATE)}…`;

  return (
    <div className="mt-3 space-y-2 rounded-lg border border-emerald-300/80 bg-emerald-50/60 px-3 py-2.5 dark:border-emerald-700/60 dark:bg-emerald-950/30">
      <p className="text-xs font-medium text-emerald-950 dark:text-emerald-100">Approve prepared packet</p>
      <p className="text-[11px] leading-relaxed text-emerald-800/90 dark:text-emerald-200/90">
        Review your prepared case packet below, then approve to continue to payment and next steps.
      </p>
      {loading ? (
        <p className="text-[11px] text-emerald-900/90 dark:text-emerald-100/90">Loading packet preview…</p>
      ) : packetText ? (
        <>
          <pre className="max-h-[min(280px,40vh)] overflow-auto whitespace-pre-wrap rounded-md border border-emerald-200/80 bg-white/80 p-2 text-[11px] leading-relaxed text-neutral-900 dark:border-emerald-900/40 dark:bg-neutral-950/80 dark:text-neutral-100">
            {displayText}
          </pre>
          {canTruncate ? (
            <button
              type="button"
              onClick={() => onExpandedChange(!expanded)}
              className="text-[11px] font-medium text-emerald-700 underline underline-offset-2 hover:text-emerald-900 dark:text-emerald-300 dark:hover:text-emerald-100"
            >
              {expanded ? "Show less" : "Show more"}
            </button>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={!packetText}
              onClick={() => onCopyPacket()}
              className="inline-flex rounded-lg border border-emerald-400/80 bg-white px-3 py-1.5 text-xs font-medium text-emerald-900 shadow-sm transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-emerald-700 dark:bg-neutral-900 dark:text-emerald-100 dark:hover:bg-neutral-800"
            >
              Copy packet
            </button>
            {copyHint ? (
              <span className="text-[11px] text-emerald-800 dark:text-emerald-200">{copyHint}</span>
            ) : null}
          </div>
        </>
      ) : (
        <p className="text-[11px] text-emerald-900/90 dark:text-emerald-100/90">
          Packet preview is loading. Stay in this chat — it will appear here when ready.
        </p>
      )}
      {merchantContactRecipientRequired ? (
        <div className="space-y-1 rounded-md border border-emerald-300/70 bg-white/70 px-2.5 py-2 text-[11px] leading-relaxed text-emerald-900 dark:border-emerald-800/60 dark:bg-neutral-950/40 dark:text-emerald-100">
          <label htmlFor={CHAT_INLINE_MERCHANT_CONTACT_EMAIL_INPUT_ID} className="block font-medium">
            Company / merchant contact email
          </label>
          <p className="text-emerald-800/90 dark:text-emerald-200/90">
            Surrenderless sends this to the company for you, so add a valid email address to send it to
            — or, if you don&apos;t have one, let our operators handle it.
          </p>
          <input
            id={CHAT_INLINE_MERCHANT_CONTACT_EMAIL_INPUT_ID}
            type="email"
            inputMode="email"
            autoComplete="off"
            value={merchantContactRecipientValue}
            onChange={(e) => onMerchantContactRecipientChange(e.target.value)}
            placeholder="support@company.com"
            className="w-full rounded-md border border-emerald-300 bg-white px-2 py-1 text-[12px] text-neutral-900 outline-none focus:border-emerald-500 dark:border-emerald-800/60 dark:bg-neutral-950 dark:text-neutral-100"
          />
          {!merchantContactRecipientValid && merchantContactRecipientValue.trim() ? (
            <p className="text-red-700 dark:text-red-300">
              Enter a valid email address (for example, support@company.com).
            </p>
          ) : null}
          {merchantContactOperatorFallbackChosen ? (
            <p className="font-medium text-emerald-800 dark:text-emerald-200">
              No email needed — Surrenderless operators will handle company outreach for you.
            </p>
          ) : !merchantContactRecipientValid ? (
            <button
              type="button"
              onClick={() => onChooseMerchantContactOperatorFallback()}
              className="text-[11px] font-medium text-emerald-700 underline underline-offset-2 hover:text-emerald-900 dark:text-emerald-300 dark:hover:text-emerald-100"
            >
              I don&apos;t have the company&apos;s email — let operators handle it
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="flex items-start gap-2 text-[11px] text-emerald-900 dark:text-emerald-100">
        <input
          id={CHAT_INLINE_PREPARED_PACKET_REVIEWED_CHECKBOX_ID}
          type="checkbox"
          checked={checked}
          onChange={(e) => onCheckedChange(e.target.checked)}
          disabled={!packetText}
          className="mt-0.5 shrink-0"
        />
        <label htmlFor={CHAT_INLINE_PREPARED_PACKET_REVIEWED_CHECKBOX_ID} className="cursor-pointer">
          I reviewed this prepared packet
        </label>
      </div>
      {checkoutPriceState.status !== "not_needed" ? (
        <div
          id={CHAT_AI_CHECKOUT_PRICE_DISCLOSURE_ELEMENT_ID}
          className="space-y-1.5 rounded-md border border-emerald-300/70 bg-white/70 px-2.5 py-2 text-[11px] leading-relaxed text-emerald-900 dark:border-emerald-800/60 dark:bg-neutral-950/40 dark:text-emerald-100"
        >
          {checkoutPriceState.status === "ready" ? (
            <>
              <p className="font-medium">
                {buildCheckoutPriceHeadline(checkoutPriceState.unitAmount, checkoutPriceState.currency)}
              </p>
              {CHECKOUT_DISCLOSURE_PARAGRAPHS.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </>
          ) : checkoutPriceState.status === "unavailable" ? (
            <>
              <p className="text-red-700 dark:text-red-300">{CHECKOUT_PRICE_UNAVAILABLE_MESSAGE}</p>
              <button
                type="button"
                onClick={() => onRetryPricing()}
                className="inline-flex rounded-lg border border-red-400/80 bg-white px-2.5 py-1 text-[11px] font-medium text-red-800 shadow-sm transition hover:bg-red-50 dark:border-red-700/60 dark:bg-neutral-950 dark:text-red-200 dark:hover:bg-red-950/40"
              >
                Retry pricing
              </button>
            </>
          ) : checkoutPriceState.status === "confirming" ? (
            <p className="font-medium">{CHECKOUT_CONFIRMING_PAYMENT_MESSAGE}</p>
          ) : checkoutPriceState.status === "confirm_timeout" ? (
            <>
              <p>{CHECKOUT_CONFIRMATION_TIMEOUT_MESSAGE}</p>
              <button
                type="button"
                onClick={() => onRetryPaymentConfirmation()}
                className="inline-flex rounded-lg border border-emerald-500/80 bg-white px-2.5 py-1 text-[11px] font-medium text-emerald-800 shadow-sm transition hover:bg-emerald-50 dark:border-emerald-700/60 dark:bg-neutral-950 dark:text-emerald-200 dark:hover:bg-emerald-950/40"
              >
                Keep checking
              </button>
            </>
          ) : (
            <p>{CHECKOUT_PRICE_LOADING_MESSAGE}</p>
          )}
        </div>
      ) : null}
      <button
        type="button"
        disabled={
          !checked ||
          !packetText ||
          approving ||
          merchantContactRecipientBlocking ||
          isCheckoutApprovalBlockedByPricing(checkoutPriceState)
        }
        onClick={() => void onSubmit()}
        className="inline-flex rounded-lg border border-emerald-500/80 bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-emerald-600 dark:hover:bg-emerald-500"
      >
        {approving
          ? "Saving…"
          : merchantContactRecipientBlocking
            ? "Add the company's email to approve"
            : checkoutPriceState.status === "confirming" ||
                checkoutPriceState.status === "confirm_timeout"
              ? "Confirming your payment…"
              : checkoutPriceState.status === "loading"
                ? "Loading price…"
                : checkoutPriceState.status === "unavailable"
                  ? "Pricing unavailable"
                  : "Approve prepared packet"}
      </button>
      {!suppressHubLink ? (
        <p className="text-xs text-emerald-800 dark:text-emerald-200">
          <Link
            href="/justice/packet"
            prefetch={false}
            className="font-medium underline underline-offset-2 hover:text-emerald-950 dark:text-emerald-300 dark:hover:text-emerald-100"
          >
            Continue packet approval in chat
          </Link>
          <span className="text-[11px] text-emerald-900/80 dark:text-emerald-100/80">
            {" "}
            (optional — print and copy tools)
          </span>
        </p>
      ) : null}
    </div>
  );
}

function ChatInlineApprovedPrepActionBlock({
  title,
  messageText,
  helperText,
  copyButtonLabel,
  optionalPageHref,
  optionalPageLabel,
  optionalPageNote,
  expanded,
  onExpandedChange,
  copyHint,
  onCopy,
}: {
  title: string;
  messageText: string;
  helperText: string;
  copyButtonLabel: string;
  optionalPageHref?: string;
  optionalPageLabel?: string;
  optionalPageNote?: string;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  copyHint: string | null;
  onCopy: () => void;
}) {
  const canTruncate = messageText.length > CHAT_DRAFT_PREVIEW_TRUNCATE;
  const displayText =
    expanded || !canTruncate ? messageText : `${messageText.slice(0, CHAT_DRAFT_PREVIEW_TRUNCATE)}…`;

  return (
    <div className="mt-3 space-y-2 rounded-lg border border-emerald-300/80 bg-emerald-50/60 px-3 py-2.5 dark:border-emerald-700/60 dark:bg-emerald-950/30">
      <p className="text-xs font-medium text-emerald-950 dark:text-emerald-100">{title}</p>
      <p className="text-[11px] leading-relaxed text-emerald-800/90 dark:text-emerald-200/90">{helperText}</p>
      {messageText ? (
        <>
          <pre className="max-h-[min(280px,40vh)] overflow-auto whitespace-pre-wrap rounded-md border border-emerald-200/80 bg-white/80 p-2 text-[11px] leading-relaxed text-neutral-900 dark:border-emerald-900/40 dark:bg-neutral-950/80 dark:text-neutral-100">
            {displayText}
          </pre>
          {canTruncate ? (
            <button
              type="button"
              onClick={() => onExpandedChange(!expanded)}
              className="text-[11px] font-medium text-emerald-700 underline underline-offset-2 hover:text-emerald-900 dark:text-emerald-300 dark:hover:text-emerald-100"
            >
              {expanded ? "Show less" : "Show more"}
            </button>
          ) : null}
        </>
      ) : (
        <p className="text-[11px] text-emerald-900/90 dark:text-emerald-100/90">
          Prep content is not available yet.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={!messageText}
          onClick={() => onCopy()}
          className="inline-flex rounded-lg border border-emerald-500/80 bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-emerald-600 dark:hover:bg-emerald-500"
        >
          {copyButtonLabel}
        </button>
        {copyHint ? (
          <span className="text-[11px] text-emerald-800 dark:text-emerald-200">{copyHint}</span>
        ) : null}
      </div>
      {optionalPageHref && optionalPageLabel ? (
        <p className="text-xs text-emerald-800 dark:text-emerald-200">
          <Link
            href={optionalPageHref}
            className="font-medium underline underline-offset-2 hover:text-emerald-950 dark:text-emerald-300 dark:hover:text-emerald-100"
          >
            {optionalPageLabel}
          </Link>
          {optionalPageNote ? (
            <span className="text-[11px] text-emerald-900/80 dark:text-emerald-100/80">
              {" "}
              ({optionalPageNote})
            </span>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}

function ChatInlinePaymentDisputePrepBlock({
  letterText,
  letterExpanded,
  onLetterExpandedChange,
  copyHint,
  onCopyLetter,
  paymentMethod,
  onPaymentMethodChange,
  chargeDate,
  onChargeDateChange,
  chargeAmount,
  onChargeAmountChange,
  merchantName,
  onMerchantNameChange,
  disputeReason,
  onDisputeReasonChange,
  disputeReasonOther,
  onDisputeReasonOtherChange,
  priorContact,
  onPriorContactChange,
  proofType,
  onProofTypeChange,
  saving,
  saveSuccess,
  onSubmit,
  suppressOptionalPageLink = false,
}: {
  letterText: string;
  letterExpanded: boolean;
  onLetterExpandedChange: (expanded: boolean) => void;
  copyHint: string | null;
  onCopyLetter: () => void;
  paymentMethod: PaymentMethodOption;
  onPaymentMethodChange: (value: PaymentMethodOption) => void;
  chargeDate: string;
  onChargeDateChange: (value: string) => void;
  chargeAmount: string;
  onChargeAmountChange: (value: string) => void;
  merchantName: string;
  onMerchantNameChange: (value: string) => void;
  disputeReason: DisputeReasonOption;
  onDisputeReasonChange: (value: DisputeReasonOption) => void;
  disputeReasonOther: string;
  onDisputeReasonOtherChange: (value: string) => void;
  priorContact: "yes" | "no";
  onPriorContactChange: (value: "yes" | "no") => void;
  proofType: PaymentDisputeProofType;
  onProofTypeChange: (value: PaymentDisputeProofType) => void;
  saving: boolean;
  saveSuccess: string | null;
  onSubmit: (e: FormEvent) => void;
  suppressOptionalPageLink?: boolean;
}) {
  const canTruncateLetter = letterText.length > CHAT_DRAFT_PREVIEW_TRUNCATE;
  const displayLetter =
    letterExpanded || !canTruncateLetter
      ? letterText
      : `${letterText.slice(0, CHAT_DRAFT_PREVIEW_TRUNCATE)}…`;

  return (
    <form
      onSubmit={onSubmit}
      className="mt-3 space-y-2 rounded-lg border border-emerald-300/80 bg-emerald-50/60 px-3 py-2.5 dark:border-emerald-700/60 dark:bg-emerald-950/30"
    >
      <p className="text-xs font-medium text-emerald-950 dark:text-emerald-100">Payment dispute (bank/card)</p>
      <p className="text-[11px] leading-relaxed text-emerald-800/90 dark:text-emerald-200/90">
        Fill in dispute details, copy the bank letter below, then save to record it on your case timeline.
        After you approve, Surrenderless can send payment-dispute outreach for you. Stay in chat for status — operators finish delivery when automation is unavailable.
      </p>
      <div>
        <label className="text-[11px] font-medium text-emerald-900 dark:text-emerald-100">Payment method</label>
        <select
          className={CHAT_FILING_INPUT_CLS}
          value={paymentMethod}
          onChange={(e) => onPaymentMethodChange(e.target.value as PaymentMethodOption)}
          required
        >
          <option value="credit_card">Credit card</option>
          <option value="debit_card">Debit card</option>
          <option value="bank_account_ach">Bank account / ACH</option>
          <option value="paypal">PayPal / similar wallet</option>
          <option value="apple_google_pay">Apple Pay / Google Pay</option>
          <option value="other">Other</option>
        </select>
      </div>
      <div>
        <label className="text-[11px] font-medium text-emerald-900 dark:text-emerald-100">Charge date</label>
        <input
          className={CHAT_FILING_INPUT_CLS}
          value={chargeDate}
          onChange={(e) => onChargeDateChange(e.target.value)}
          required
          placeholder="As shown on your statement"
        />
      </div>
      <div>
        <label className="text-[11px] font-medium text-emerald-900 dark:text-emerald-100">Charge amount</label>
        <input
          className={CHAT_FILING_INPUT_CLS}
          value={chargeAmount}
          onChange={(e) => onChargeAmountChange(e.target.value)}
          required
          placeholder="e.g. $49.99"
        />
      </div>
      <div>
        <label className="text-[11px] font-medium text-emerald-900 dark:text-emerald-100">Merchant / company name</label>
        <input
          className={CHAT_FILING_INPUT_CLS}
          value={merchantName}
          onChange={(e) => onMerchantNameChange(e.target.value)}
          required
          placeholder="As on your statement"
        />
      </div>
      <div>
        <label className="text-[11px] font-medium text-emerald-900 dark:text-emerald-100">Dispute reason</label>
        <select
          className={CHAT_FILING_INPUT_CLS}
          value={disputeReason}
          onChange={(e) => onDisputeReasonChange(e.target.value as DisputeReasonOption)}
          required
        >
          <option value="unauthorized_charge">Unauthorized charge</option>
          <option value="duplicate_charge">Duplicate charge</option>
          <option value="wrong_amount">Wrong amount</option>
          <option value="canceled_refunded_still_charged">Canceled or refunded but still charged</option>
          <option value="goods_not_received">Goods or services not received</option>
          <option value="service_not_as_promised">Service not as promised</option>
          <option value="other">Other</option>
        </select>
        {disputeReason === "other" ? (
          <textarea
            className={`${CHAT_FILING_INPUT_CLS} mt-1.5 min-h-[56px] resize-y`}
            rows={2}
            value={disputeReasonOther}
            onChange={(e) => onDisputeReasonOtherChange(e.target.value)}
            required
            placeholder="Briefly explain what happened."
          />
        ) : null}
      </div>
      <div>
        <span className="text-[11px] font-medium text-emerald-900 dark:text-emerald-100">
          Prior contact about this charge?
        </span>
        <div className="mt-1.5 flex gap-3">
          <label className="flex items-center gap-1.5 text-[11px] text-emerald-900 dark:text-emerald-100">
            <input
              type="radio"
              name="chat-payment-dispute-prior"
              checked={priorContact === "yes"}
              onChange={() => onPriorContactChange("yes")}
            />
            Yes
          </label>
          <label className="flex items-center gap-1.5 text-[11px] text-emerald-900 dark:text-emerald-100">
            <input
              type="radio"
              name="chat-payment-dispute-prior"
              checked={priorContact === "no"}
              onChange={() => onPriorContactChange("no")}
            />
            No
          </label>
        </div>
      </div>
      <div>
        <label className="text-[11px] font-medium text-emerald-900 dark:text-emerald-100">Proof type</label>
        <select
          className={CHAT_FILING_INPUT_CLS}
          value={proofType}
          onChange={(e) => onProofTypeChange(e.target.value as PaymentDisputeProofType)}
          required
        >
          <option value="receipt_order_confirmation">Receipt or order confirmation</option>
          <option value="screenshot">Screenshot(s)</option>
          <option value="email_chain">Email thread with merchant</option>
          <option value="merchant_chat_log">Chat log with merchant</option>
          <option value="bank_statement">Bank or card statement</option>
          <option value="none_yet">No proof gathered yet</option>
          <option value="other">Other</option>
        </select>
      </div>
      {letterText ? (
        <>
          <p className="text-[11px] font-medium text-emerald-900 dark:text-emerald-100">Bank / card issuer letter</p>
          <pre className="max-h-[min(220px,36vh)] overflow-auto whitespace-pre-wrap rounded-md border border-emerald-200/80 bg-white/80 p-2 text-[11px] leading-relaxed text-neutral-900 dark:border-emerald-900/40 dark:bg-neutral-950/80 dark:text-neutral-100">
            {displayLetter}
          </pre>
          {canTruncateLetter ? (
            <button
              type="button"
              onClick={() => onLetterExpandedChange(!letterExpanded)}
              className="text-[11px] font-medium text-emerald-800 underline underline-offset-2 hover:text-emerald-950 dark:text-emerald-300 dark:hover:text-emerald-100"
            >
              {letterExpanded ? "Show less" : "Show full letter"}
            </button>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onCopyLetter}
              className="inline-flex rounded-lg border border-emerald-400/80 bg-white/80 px-3 py-1.5 text-xs font-medium text-emerald-900 shadow-sm transition hover:bg-emerald-50 dark:border-emerald-600/60 dark:bg-emerald-950/50 dark:text-emerald-100 dark:hover:bg-emerald-900/60"
            >
              Copy letter
            </button>
            {copyHint ? (
              <span className="text-[11px] text-emerald-800 dark:text-emerald-300">{copyHint}</span>
            ) : null}
          </div>
        </>
      ) : null}
      {saveSuccess ? (
        <p className="text-[11px] font-medium text-emerald-800 dark:text-emerald-300">{saveSuccess}</p>
      ) : null}
      <button
        type="submit"
        disabled={saving}
        className="inline-flex rounded-lg border border-emerald-500/80 bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-emerald-600 dark:hover:bg-emerald-500"
      >
        {saving ? "Saving…" : "Save checklist"}
      </button>
      {!suppressOptionalPageLink ? (
        <p className="text-[11px] text-emerald-800/80 dark:text-emerald-200/80">
          <Link
            href={CHAT_INLINE_PAYMENT_DISPUTE_PREP_HREF}
            className="font-medium underline underline-offset-2 hover:text-emerald-950 dark:text-emerald-300 dark:hover:text-emerald-100"
          >
            Continue payment dispute in chat
          </Link>
          <span className="text-emerald-900/80 dark:text-emerald-100/80"> (optional — evidence list)</span>
        </p>
      ) : null}
    </form>
  );
}

type AssistedMockPracticeLaneId =
  | typeof MOCK_FTC_PRACTICE_ASSISTED_SUBMISSION_LANE.id
  | typeof MOCK_BBB_PRACTICE_ASSISTED_SUBMISSION_LANE.id;

function assistedMockPracticeUi(laneId: AssistedMockPracticeLaneId) {
  if (laneId === MOCK_BBB_PRACTICE_ASSISTED_SUBMISSION_LANE.id) {
    return {
      title: "BBB practice complaint",
      mockUrlPath: MOCK_BBB_PRACTICE_ASSISTED_SUBMISSION_LANE.mockUrlPath,
      notRealLabel: "real BBB filing",
    };
  }
  return {
    title: "FTC practice complaint",
    mockUrlPath: MOCK_FTC_PRACTICE_ASSISTED_SUBMISSION_LANE.mockUrlPath,
    notRealLabel: "real government submission",
    optionalPageHref: CHAT_INLINE_FTC_REVIEW_PREP_HREF,
    optionalPageLabel: undefined,
  };
}

function ChatInlineAssistedPracticeBlock({
  laneId,
  summaryLines,
  confirmed,
  onConfirmedChange,
  running,
  practiceSuccess,
  storageSkipped,
  error,
  lastAssistedSubmissionAttempt,
  approvedHref,
  onRunPractice,
  suppressOptionalPageLink = false,
}: {
  laneId: AssistedMockPracticeLaneId;
  summaryLines: string[];
  confirmed: boolean;
  onConfirmedChange: (confirmed: boolean) => void;
  running: boolean;
  practiceSuccess: boolean;
  storageSkipped: boolean;
  error: string | null;
  lastAssistedSubmissionAttempt: LastAssistedSubmissionAttemptSnapshot | null;
  approvedHref: string | undefined;
  onRunPractice: () => void;
  suppressOptionalPageLink?: boolean;
}) {
  const ui = assistedMockPracticeUi(laneId);
  return (
    <div className="mt-3 space-y-2 rounded-lg border border-emerald-300/80 bg-emerald-50/60 px-3 py-2.5 dark:border-emerald-700/60 dark:bg-emerald-950/30">
      <p className="text-xs font-medium text-emerald-950 dark:text-emerald-100">{ui.title}</p>
      <p className="rounded-md border border-amber-300/80 bg-amber-50/90 px-2 py-1.5 text-[11px] leading-relaxed text-amber-950 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-100">
        Runs the <strong>internal practice form</strong> only (<code className="text-[10px]">{ui.mockUrlPath}</code>
        ). It is <strong>not</strong> a {ui.notRealLabel}.
      </p>
      <ul className="space-y-1 rounded-md border border-emerald-200/80 bg-white/70 px-2 py-1.5 text-[11px] leading-relaxed text-neutral-800 dark:border-emerald-900/40 dark:bg-neutral-950/50 dark:text-neutral-100">
        {summaryLines.map((line) => (
          <li key={line.slice(0, 48)}>{line}</li>
        ))}
      </ul>
      <label className="flex items-start gap-2 text-[11px] text-emerald-900 dark:text-emerald-100">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => onConfirmedChange(e.target.checked)}
          className="mt-0.5"
          disabled={running || practiceSuccess}
        />
        <span>I confirm this information is accurate to the best of my knowledge.</span>
      </label>
      <button
        type="button"
        disabled={!confirmed || running || practiceSuccess}
        onClick={onRunPractice}
        className="inline-flex rounded-lg border border-emerald-500/80 bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-emerald-600 dark:hover:bg-emerald-500"
      >
        {running ? "Running practice autofill…" : practiceSuccess ? "Practice completed" : "Run practice autofill"}
      </button>
      {error ? (
        <p className="text-[11px] text-red-700 dark:text-red-300">{error}</p>
      ) : null}
      {practiceSuccess ? (
        <p className="text-[11px] font-medium text-emerald-800 dark:text-emerald-300">
          Practice autofill completed.
          {storageSkipped ? " Screenshot storage was skipped locally." : ""}
        </p>
      ) : null}
      {isLastAssistedSubmissionAttemptVisibleForApprovedHref(
        lastAssistedSubmissionAttempt,
        approvedHref
      ) ? (
        <LastAssistedSubmissionAttemptSummaryReadOnly snapshot={lastAssistedSubmissionAttempt!} />
      ) : null}
      {!suppressOptionalPageLink && ui.optionalPageHref && ui.optionalPageLabel ? (
        <p className="text-[11px] text-emerald-800/80 dark:text-emerald-200/80">
          <Link
            href={ui.optionalPageHref}
            className="font-medium underline underline-offset-2 hover:text-emerald-950 dark:text-emerald-300 dark:hover:text-emerald-100"
          >
            {ui.optionalPageLabel}
          </Link>
          <span className="text-emerald-900/80 dark:text-emerald-100/80"> (optional — evidence list)</span>
        </p>
      ) : null}
    </div>
  );
}

function ChatInlineRealBbbComplaintBlock({
  summaryLines,
  confirmed,
  onConfirmedChange,
  running,
  complaintSuccess,
  storageSkipped,
  error,
  lastAssistedSubmissionAttempt,
  approvedHref,
  onRunComplaint,
  suppressOptionalPageLink = false,
}: {
  summaryLines: string[];
  confirmed: boolean;
  onConfirmedChange: (confirmed: boolean) => void;
  running: boolean;
  complaintSuccess: boolean;
  storageSkipped: boolean;
  error: string | null;
  lastAssistedSubmissionAttempt: LastAssistedSubmissionAttemptSnapshot | null;
  approvedHref: string | undefined;
  onRunComplaint: () => void;
  suppressOptionalPageLink?: boolean;
}) {
  return (
    <div className="mt-3 space-y-2 rounded-lg border border-emerald-300/80 bg-emerald-50/60 px-3 py-2.5 dark:border-emerald-700/60 dark:bg-emerald-950/30">
      <p className="text-xs font-medium text-emerald-950 dark:text-emerald-100">BBB complaint</p>
      <p className="rounded-md border border-amber-300/80 bg-amber-50/90 px-2 py-1.5 text-[11px] leading-relaxed text-amber-950 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-100">
        Runs assisted autofill on the official BBB.org complaint flow (
        <code className="text-[10px]">{REAL_BBB_ASSISTED_SUBMISSION_LANE.submissionUrl}</code>
        ). Verify the correct business profile before you submit. You remain responsible for the final submission.
      </p>
      <ul className="space-y-1 rounded-md border border-emerald-200/80 bg-white/70 px-2 py-1.5 text-[11px] leading-relaxed text-neutral-800 dark:border-emerald-900/40 dark:bg-neutral-950/50 dark:text-neutral-100">
        {summaryLines.map((line) => (
          <li key={line.slice(0, 48)}>{line}</li>
        ))}
      </ul>
      <label className="flex items-start gap-2 text-[11px] text-emerald-900 dark:text-emerald-100">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => onConfirmedChange(e.target.checked)}
          className="mt-0.5"
          disabled={running || complaintSuccess}
        />
        <span>I confirm this information is accurate to the best of my knowledge.</span>
      </label>
      <button
        type="button"
        disabled={!confirmed || running || complaintSuccess}
        onClick={onRunComplaint}
        className="inline-flex rounded-lg border border-emerald-500/80 bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-emerald-600 dark:hover:bg-emerald-500"
      >
        {running ? "Running BBB autofill…" : complaintSuccess ? "BBB autofill completed" : "Run BBB autofill"}
      </button>
      {error ? (
        <p className="text-[11px] text-red-700 dark:text-red-300">{error}</p>
      ) : null}
      {complaintSuccess ? (
        <p className="text-[11px] font-medium text-emerald-800 dark:text-emerald-300">
          BBB autofill completed.
          {storageSkipped ? " Screenshot storage was skipped locally." : ""}
        </p>
      ) : null}
      {isLastAssistedSubmissionAttemptVisibleForApprovedHref(
        lastAssistedSubmissionAttempt,
        approvedHref
      ) ? (
        <LastAssistedSubmissionAttemptSummaryReadOnly snapshot={lastAssistedSubmissionAttempt!} />
      ) : null}
      {!suppressOptionalPageLink ? (
        <p className="text-[11px] text-emerald-800/80 dark:text-emerald-200/80">
          Continue BBB progress in chat — destination-prep DIY pages are not used for this step.
        </p>
      ) : null}
    </div>
  );
}

function ChatInlineMerchantContactDocumentationBlock({
  useCompanyContactLabels,
  contactMethod,
  onContactMethodChange,
  contactDate,
  onContactDateChange,
  merchantResponseType,
  onMerchantResponseTypeChange,
  contactProofType,
  onContactProofTypeChange,
  contactProofText,
  onContactProofTextChange,
  contactDateError,
  contactProofError,
  saving,
  onSubmit,
}: {
  useCompanyContactLabels: boolean;
  contactMethod: NonNullable<BuildJusticeIntakeParts["contact_method"]>;
  onContactMethodChange: (value: NonNullable<BuildJusticeIntakeParts["contact_method"]>) => void;
  contactDate: string;
  onContactDateChange: (value: string) => void;
  merchantResponseType: NonNullable<BuildJusticeIntakeParts["merchant_response_type"]>;
  onMerchantResponseTypeChange: (value: NonNullable<BuildJusticeIntakeParts["merchant_response_type"]>) => void;
  contactProofType: NonNullable<BuildJusticeIntakeParts["contact_proof_type"]>;
  onContactProofTypeChange: (value: NonNullable<BuildJusticeIntakeParts["contact_proof_type"]>) => void;
  contactProofText: string;
  onContactProofTextChange: (value: string) => void;
  contactDateError: string | null;
  contactProofError: string | null;
  saving: boolean;
  onSubmit: (e: FormEvent) => void;
}) {
  const proofDetailsLabel =
    contactProofType === "none"
      ? "Describe your contact attempt"
      : contactProofType === "ticket"
        ? "Ticket or case number"
        : "Proof details (optional)";
  const proofDetailsPlaceholder =
    contactProofType === "none"
      ? "Example: I emailed on 04/27 and they said they could not help."
      : contactProofType === "ticket"
        ? "e.g. Case #12345 or support ticket ID"
        : "Ticket number, paste of email, case ID, etc.";

  return (
    <form
      onSubmit={onSubmit}
      className="mt-3 space-y-2 rounded-lg border border-emerald-300/80 bg-emerald-50/60 px-3 py-2.5 dark:border-emerald-700/60 dark:bg-emerald-950/30"
    >
      <p className="text-xs font-medium text-emerald-950 dark:text-emerald-100">After you contact them</p>
      <p className="text-[11px] leading-relaxed text-emerald-800/90 dark:text-emerald-200/90">
        Record how you reached out, when, and what they did. This keeps your case accurate in chat and unlocks
        escalation when appropriate.
      </p>
      <div>
        <label className="text-[11px] font-medium text-emerald-900 dark:text-emerald-100">Contact method</label>
        <select
          className={CHAT_FILING_INPUT_CLS}
          value={contactMethod}
          onChange={(e) =>
            onContactMethodChange(e.target.value as NonNullable<BuildJusticeIntakeParts["contact_method"]>)
          }
          required
        >
          <option value="email">Email</option>
          <option value="chat">Live chat</option>
          <option value="phone">Phone</option>
          <option value="form">Online contact form</option>
          <option value="in_person">In person</option>
          <option value="other">Other</option>
        </select>
      </div>
      <div>
        <label
          className="text-[11px] font-medium text-emerald-900 dark:text-emerald-100"
          htmlFor="chat-merchant-contact-date"
        >
          Contact date
        </label>
        <input
          id="chat-merchant-contact-date"
          type="date"
          className={CHAT_FILING_INPUT_CLS}
          value={contactDate}
          onChange={(e) => onContactDateChange(e.target.value)}
          aria-invalid={contactDateError ? true : undefined}
        />
        {contactDateError ? (
          <p className="mt-1 text-[11px] text-red-700 dark:text-red-300">{contactDateError}</p>
        ) : null}
      </div>
      <div>
        <label className="text-[11px] font-medium text-emerald-900 dark:text-emerald-100">
          {useCompanyContactLabels ? "Company response" : "Merchant response"}
        </label>
        <select
          className={CHAT_FILING_INPUT_CLS}
          value={merchantResponseType}
          onChange={(e) =>
            onMerchantResponseTypeChange(
              e.target.value as NonNullable<BuildJusticeIntakeParts["merchant_response_type"]>
            )
          }
          required
        >
          <option value="no_response">No response yet</option>
          <option value="refused_help">They refused a refund or real help</option>
          <option value="promised_but_did_not_fix">They said they would fix it but did not</option>
          <option value="resolved">
            {useCompanyContactLabels ? "Resolved — company fixed the issue" : "Resolved — merchant fixed the issue"}
          </option>
          <option value="partial_help">They gave partial refund or partial help</option>
          <option value="asked_more_info">They asked for more information</option>
          <option value="other">Other</option>
        </select>
      </div>
      <div>
        <label className="text-[11px] font-medium text-emerald-900 dark:text-emerald-100">Proof type</label>
        <select
          className={CHAT_FILING_INPUT_CLS}
          value={contactProofType}
          onChange={(e) =>
            onContactProofTypeChange(e.target.value as NonNullable<BuildJusticeIntakeParts["contact_proof_type"]>)
          }
          required
        >
          <option value="upload">I can upload a file</option>
          <option value="paste">I can paste text</option>
          <option value="ticket">I have a ticket or case number</option>
          <option value="screenshot">I have a screenshot</option>
          <option value="none">No written proof — I can describe the attempt</option>
        </select>
      </div>
      <div>
        <label
          className="text-[11px] font-medium text-emerald-900 dark:text-emerald-100"
          htmlFor="chat-merchant-contact-proof"
        >
          {proofDetailsLabel}
        </label>
        <textarea
          id="chat-merchant-contact-proof"
          className={`${CHAT_FILING_INPUT_CLS} min-h-[72px] resize-y`}
          rows={3}
          value={contactProofText}
          onChange={(e) => onContactProofTextChange(e.target.value)}
          placeholder={proofDetailsPlaceholder}
          aria-invalid={contactProofError ? true : undefined}
        />
        {contactProofError ? (
          <p className="mt-1 text-[11px] text-red-700 dark:text-red-300">{contactProofError}</p>
        ) : null}
      </div>
      <button
        type="submit"
        disabled={saving}
        className="inline-flex rounded-lg border border-emerald-500/80 bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-emerald-600 dark:hover:bg-emerald-500"
      >
        {saving ? "Saving…" : "Save contact details"}
      </button>
    </form>
  );
}

function ChatInlineMerchantContactConfirmationBlock({
  useCompanyContactLabels,
  summaryLines,
  saving,
  onConfirm,
}: {
  useCompanyContactLabels: boolean;
  summaryLines: string[];
  saving: boolean;
  onConfirm: () => void;
}) {
  return (
    <div className="mt-3 space-y-2 rounded-lg border border-emerald-300/80 bg-emerald-50/60 px-3 py-2.5 dark:border-emerald-700/60 dark:bg-emerald-950/30">
      <p className="text-xs font-medium text-emerald-950 dark:text-emerald-100">
        {useCompanyContactLabels ? "Confirm company contact" : "Confirm merchant contact"}
      </p>
      <p className="text-[11px] leading-relaxed text-emerald-800/90 dark:text-emerald-200/90">
        Surrenderless captured this from your chat. Confirm to save it to your case and continue.
      </p>
      <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-emerald-900 dark:text-emerald-100">
        {summaryLines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <button
        type="button"
        disabled={saving}
        onClick={onConfirm}
        className="inline-flex rounded-lg border border-emerald-500/80 bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-emerald-600 dark:hover:bg-emerald-500"
      >
        {saving ? "Saving…" : "Confirm contact details"}
      </button>
    </div>
  );
}

const CHAT_FILING_INPUT_CLS =
  "mt-1 w-full rounded-md border border-emerald-300/80 bg-white px-2 py-1.5 text-xs text-neutral-900 placeholder:text-neutral-400 dark:border-emerald-700 dark:bg-neutral-950 dark:text-neutral-100";

const CHAT_TRACKING_SAVE_ERROR_MESSAGE =
  "Your tracking update was not saved to your case on the server. This device still shows your latest changes — try the action again.";

const CHAT_ARCHIVE_ERROR_MESSAGE =
  "This case could not be archived on the server. Try again.";

function ChatHandlingWorkbenchInChatNotice() {
  return (
    <p className="mt-2 text-[11px] leading-relaxed text-emerald-800/65 dark:text-emerald-200/65">
      Operator queue updates continue here in chat.
    </p>
  );
}

function showChatApprovedPacketActionHandlingTracking(input: {
  preparedPacketApproved: boolean;
  approvedNextAction: JusticeApprovedNextAction;
}): boolean {
  if (!input.preparedPacketApproved) return false;
  if (input.approvedNextAction.handling_requested_at?.trim()) return false;
  const status = input.approvedNextAction.status;
  return status === "approved" || status === "started" || status === "completed";
}

// chatReadyForManualReview, deriveChatManualActionNextStep, and deriveChatHandlingTrackingLine
// moved to handlingTrackingProgress.ts — pure derivation logic, extracted so it's directly
// unit-testable (verifying the real production decision, not a hardcoded stand-in) without
// needing this page component.

function formatChatPersistedTaskLine(
  task: JusticeCaseTaskRow | undefined,
  label: string
): { text: string; dueKind?: ReturnType<typeof getJusticeTaskDueKind> } | null {
  if (!task) return null;
  if (task.completed_at?.trim()) {
    return { text: `${label}: completed` };
  }
  const dueKind = getJusticeTaskDueKind(task);
  return { text: `${label}: open`, dueKind };
}

function formatChatPersistedFollowUpDue(iso?: string): string {
  const raw = iso?.trim();
  if (!raw) return "";
  const ymd = isoToDateInputValue(raw);
  if (ymd) {
    const [y, mo, day] = ymd.split("-").map(Number);
    return new Date(y, mo - 1, day).toLocaleDateString(undefined, { dateStyle: "medium" });
  }
  return formatApprovedNextActionHandlingTimestamp(raw);
}

function ChatHandlingPersistedStatusReadOnly({
  caseId,
  filings,
  tasks,
  approvedNextAction,
  refreshing = false,
}: {
  caseId: string;
  filings: JusticeCaseFilingRow[];
  tasks: JusticeCaseTaskRow[];
  approvedNextAction: JusticeApprovedNextAction;
  refreshing?: boolean;
}) {
  if (!caseId) return null;

  const handlingRequested = Boolean(approvedNextAction.handling_requested_at?.trim());
  const handlingTask = tasks.find((t) => taskNotesMatchHandlingRequestMarker(t.notes, caseId));
  const followUpTask = tasks.find((t) => taskNotesMatchFollowUpMarker(t.notes, caseId));
  const followUpFlagged = approvedNextAction.follow_up_needed === true;
  const filingsCount = filings.length;
  const hasConfirmation = filings.some((f) => f.confirmation_number?.trim());
  const confirmedFilingLines = buildChatConfirmedFilingSummaryLines(filings);

  const outcomeNote = approvedNextAction.outcome_note?.trim() ?? "";
  const handlingAcknowledgedAt = approvedNextAction.handling_acknowledged_at?.trim() ?? "";
  const hasAnything =
    filingsCount > 0 ||
    handlingTask ||
    followUpTask ||
    followUpFlagged ||
    handlingRequested ||
    Boolean(outcomeNote) ||
    Boolean(handlingAcknowledgedAt);
  if (!hasAnything) return null;

  const filingText =
    filingsCount === 0
      ? "No filing records saved"
      : hasConfirmation
        ? `${filingsCount} filing record${filingsCount === 1 ? "" : "s"} · confirmation on file`
        : `${filingsCount} filing record${filingsCount === 1 ? "" : "s"} · confirmation missing`;

  const handlingLine = handlingTask
    ? formatChatPersistedTaskLine(handlingTask, "Handling task")
    : handlingRequested
      ? { text: "Handling task: not saved yet" }
      : null;
  const followUpLine = followUpTask
    ? formatChatPersistedTaskLine(followUpTask, "Follow-up task")
    : followUpFlagged
      ? { text: "Follow-up task: not saved yet" }
      : null;

  return (
    <div className="mt-1.5 space-y-0.5 rounded-md border border-emerald-400/35 bg-white/50 px-2 py-1.5 dark:border-emerald-600/35 dark:bg-emerald-950/30">
      <p className="text-[11px] font-medium text-emerald-950 dark:text-emerald-100">Saved status</p>
      {refreshing ? (
        <p className="text-[10px] text-emerald-800/75 dark:text-emerald-200/75">Updating saved status…</p>
      ) : null}
      <p className="text-[11px] text-emerald-800/90 dark:text-emerald-200/90">Filing: {filingText}</p>
      {confirmedFilingLines.length > 0 ? (
        <ul className="ml-2 list-disc space-y-0.5">
          {confirmedFilingLines.map((line) => (
            <li key={line.id} className="text-[11px] text-emerald-800/90 dark:text-emerald-200/90">
              {line.destination}
              {line.filedAtLabel ? ` · filed ${line.filedAtLabel}` : ""}
              {" · confirmation "}
              <span className="font-medium">{line.confirmationNumber}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {handlingLine ? (
        <p className="text-[11px] text-emerald-800/90 dark:text-emerald-200/90">
          {handlingLine.text}
          {handlingLine.dueKind ? (
            <>
              {" "}
              <span className={justiceTaskDueBadgeClass(handlingLine.dueKind)}>
                {justiceTaskDueKindLabel(handlingLine.dueKind)}
              </span>
            </>
          ) : null}
        </p>
      ) : null}
      {outcomeNote ? (
        <p className="text-[11px] text-emerald-800/90 dark:text-emerald-200/90">
          Outcome: {truncateAttentionNote(outcomeNote, 200)}
        </p>
      ) : null}
      {handlingAcknowledgedAt ? (
        <p className="text-[11px] text-emerald-800/90 dark:text-emerald-200/90">
          Acknowledged: {formatApprovedNextActionHandlingTimestamp(handlingAcknowledgedAt)}
        </p>
      ) : null}
      {followUpFlagged ? (
        <p className="text-[11px] text-emerald-800/90 dark:text-emerald-200/90">
          Follow-up: flagged
          {approvedNextAction.follow_up_at?.trim()
            ? ` · due ${formatChatPersistedFollowUpDue(approvedNextAction.follow_up_at)}`
            : ""}
        </p>
      ) : null}
      {followUpLine ? (
        <p className="text-[11px] text-emerald-800/90 dark:text-emerald-200/90">
          {followUpLine.text}
          {followUpLine.dueKind ? (
            <>
              {" "}
              <span className={justiceTaskDueBadgeClass(followUpLine.dueKind)}>
                {justiceTaskDueKindLabel(followUpLine.dueKind)}
              </span>
            </>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The only chat-reachable way for a consumer to report that a follow-up destination actually
 * responded/resolved their issue — otherwise every due follow-up is unconditionally recorded as
 * "no response" by the cron reconciler and the case keeps escalating regardless of the truth.
 * Shown whenever the case has an open follow-up-response-review task (created once a follow-up
 * comes due with no operator-recorded outcome yet).
 */
function ChatFollowUpResponseReviewPrompt({
  caseId,
  tasks,
  saving,
  error,
  onOutcome,
}: {
  caseId: string;
  tasks: JusticeCaseTaskRow[];
  saving: boolean;
  error: string | null;
  onOutcome: (taskId: string, outcome: "resolved" | "no_resolution") => void;
}) {
  if (!caseId) return null;
  const reviewTask = tasks.find(
    (t) => !t.completed_at?.trim() && taskNotesMatchFollowUpResponseReviewMarker(t.notes, caseId)
  );
  if (!reviewTask) return null;

  return (
    <div className="mt-2 space-y-1.5 rounded-md border border-amber-400/40 bg-amber-50/60 px-2 py-1.5 dark:border-amber-600/40 dark:bg-amber-950/30">
      <p className="text-[11px] font-medium text-amber-950 dark:text-amber-100">
        Was your issue resolved?
      </p>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <button
          type="button"
          disabled={saving}
          onClick={() => onOutcome(reviewTask.id, "resolved")}
          className="rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-xs font-medium text-emerald-800 shadow-sm transition hover:bg-emerald-50 disabled:opacity-60 dark:border-emerald-700 dark:bg-neutral-900 dark:text-emerald-200 dark:hover:bg-emerald-950"
        >
          {saving ? "Saving…" : "Yes, resolved"}
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={() => onOutcome(reviewTask.id, "no_resolution")}
          className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-800 shadow-sm transition hover:bg-neutral-50 disabled:opacity-60 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800"
        >
          {saving ? "Saving…" : "No, still unresolved"}
        </button>
      </div>
      {error ? (
        <p className="text-[11px] text-red-700 dark:text-red-300">{error}</p>
      ) : null}
    </div>
  );
}

/**
 * Renders every open superseded_lane_review task for this case — never just one, since more than
 * one prior lane can have its own open review simultaneously. When a notification email's deep
 * link identifies an exact task (deepLinkTaskId), that task is sorted first and highlighted, so
 * it stays visible even with several open reviews — never hidden or silently dropped.
 */
function ChatSupersededLaneReviewPrompt({
  caseId,
  tasks,
  savingTaskId,
  errorByTaskId,
  deepLinkTaskId,
  onOutcome,
}: {
  caseId: string;
  tasks: JusticeCaseTaskRow[];
  savingTaskId: string | null;
  errorByTaskId: Record<string, string>;
  deepLinkTaskId: string | null;
  onOutcome: (task: JusticeCaseTaskRow, outcome: SupersededLaneReviewOutcome) => void;
}) {
  if (!caseId) return null;
  const sortedReviews = selectOpenSupersededLaneReviewTasks(tasks, caseId, deepLinkTaskId);
  if (sortedReviews.length === 0) return null;

  return (
    <div className="mt-2 space-y-2">
      {sortedReviews.map((task) => {
        const ownerHref = followUpTaskOwnerHref(task.notes) ?? "";
        const laneLabel = canonicalFilingDestinationForApprovedActionHref(ownerHref) ?? "this step";
        const isDeepLinked = deepLinkTaskId != null && task.id === deepLinkTaskId;
        const saving = savingTaskId === task.id;
        const error = errorByTaskId[task.id];
        return (
          <div
            key={task.id}
            className={
              isDeepLinked
                ? "space-y-1.5 rounded-md border border-blue-400/60 bg-blue-50/60 px-2 py-1.5 dark:border-blue-600/50 dark:bg-blue-950/30"
                : "space-y-1.5 rounded-md border border-amber-400/40 bg-amber-50/60 px-2 py-1.5 dark:border-amber-600/40 dark:bg-amber-950/30"
            }
          >
            <p className="text-[11px] font-medium text-amber-950 dark:text-amber-100">
              Did {laneLabel} ever receive a response?
            </p>
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
              <button
                type="button"
                disabled={saving}
                onClick={() => onOutcome(task, "response_received")}
                className="rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-xs font-medium text-emerald-800 shadow-sm transition hover:bg-emerald-50 disabled:opacity-60 dark:border-emerald-700 dark:bg-neutral-900 dark:text-emerald-200 dark:hover:bg-emerald-950"
              >
                {saving ? "Saving…" : "Response received"}
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => onOutcome(task, "no_response")}
                className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-800 shadow-sm transition hover:bg-neutral-50 disabled:opacity-60 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800"
              >
                {saving ? "Saving…" : "No response"}
              </button>
            </div>
            {error ? <p className="text-[11px] text-red-700 dark:text-red-300">{error}</p> : null}
          </div>
        );
      })}
    </div>
  );
}

function ChatHandlingTrackingStatusReadOnly({
  readinessLoading,
  approvedNextAction,
  basicsReady,
  draftReviewed,
  preparedPacketApproved,
  evidenceCount,
  filings,
  tasks,
  markAcknowledgedOnScreen = false,
  prepInlineInChat = false,
  suppressOwnedStepManualNavigation = false,
  suppressDestinationPrepHubEscapes = false,
  canCaptureFiling = false,
  caseId = "",
  onFilingsSaved,
  canArchiveCase = false,
  onArchiveCase,
  archiving = false,
  archiveError = null,
  savingFollowUpResponseReviewOutcome = false,
  followUpResponseReviewError = null,
  onFollowUpResponseReviewOutcome,
  savingSupersededLaneReviewTaskId = null,
  supersededLaneReviewErrorByTaskId = {},
  reviewDeepLinkTaskId = null,
  onSupersededLaneReviewOutcome,
}: {
  readinessLoading: boolean;
  approvedNextAction: JusticeApprovedNextAction;
  basicsReady: boolean;
  draftReviewed: boolean;
  preparedPacketApproved: boolean;
  evidenceCount: number;
  filings: JusticeCaseFilingRow[];
  tasks: JusticeCaseTaskRow[];
  markAcknowledgedOnScreen?: boolean;
  prepInlineInChat?: boolean;
  suppressOwnedStepManualNavigation?: boolean;
  suppressDestinationPrepHubEscapes?: boolean;
  canCaptureFiling?: boolean;
  caseId?: string;
  onFilingsSaved?: (result: { hasConfirmation: boolean }) => void | Promise<void>;
  canArchiveCase?: boolean;
  onArchiveCase?: (caseId: string) => void;
  archiving?: boolean;
  archiveError?: string | null;
  savingFollowUpResponseReviewOutcome?: boolean;
  followUpResponseReviewError?: string | null;
  onFollowUpResponseReviewOutcome?: (
    taskId: string,
    outcome: "resolved" | "no_resolution"
  ) => void;
  savingSupersededLaneReviewTaskId?: string | null;
  supersededLaneReviewErrorByTaskId?: Record<string, string>;
  reviewDeepLinkTaskId?: string | null;
  onSupersededLaneReviewOutcome?: (
    task: JusticeCaseTaskRow,
    outcome: SupersededLaneReviewOutcome
  ) => void;
}) {
  const handlingRequested = Boolean(approvedNextAction.handling_requested_at?.trim());
  const showApprovedPacketActionPath = preparedPacketApproved && !handlingRequested;
  if (!handlingRequested && !showApprovedPacketActionPath) return null;

  const canCaptureFilingInline = canCaptureFiling && Boolean(caseId);
  const rawDerivedStep = readinessLoading
    ? null
    : deriveChatHandlingTrackingLine({
        basicsReady,
        draftReviewed,
        preparedPacketApproved,
        evidenceCount,
        filings,
        next: approvedNextAction,
        canCaptureFilingInline,
        canCaptureFilingInChat: canCaptureFiling,
        caseId,
        tasks,
      });
  const resolutionFlowExposed = shouldExposeCaseResolutionFlow({
    approvedAction: approvedNextAction,
    caseId,
    tasks,
    filings,
  });
  const pendingHumanFulfillmentEscalationForDisplay = hasPendingHumanFulfillmentEscalation({
    approvedAction: approvedNextAction,
    caseId,
    tasks,
  });
  const derivedStep = resolveChatOwnedHandlingTrackingStep({
    suppressOwnedManualUi: suppressOwnedStepManualNavigation,
    resolutionFlowExposed,
    manualDerivedStep: rawDerivedStep,
    next: approvedNextAction,
    pendingHumanFulfillmentEscalation: pendingHumanFulfillmentEscalationForDisplay,
  });
  const showArchiveWhenComplete =
    !readinessLoading &&
    canArchiveCase &&
    Boolean(caseId) &&
    rawDerivedStep === HANDLING_TRACKING_STEP_COMPLETE &&
    resolutionFlowExposed &&
    Boolean(onArchiveCase) &&
    shouldShowChatConsumerArchiveControl({
      suppressOwnedManualUi: suppressOwnedStepManualNavigation,
      hasOperatorTerminalResponseReviewOutcome:
        hasOperatorTerminalResponseReviewOutcome(approvedNextAction),
    });
  // Keep DIY-related props in the signature for call-site stability; capture UI is retired.
  void markAcknowledgedOnScreen;
  void prepInlineInChat;
  void suppressDestinationPrepHubEscapes;
  void onFilingsSaved;
  return (
    <>
      <p className="mt-1 text-xs text-emerald-800/90 dark:text-emerald-200/90">
        <span className="font-medium text-emerald-900 dark:text-emerald-100">Handling tracking:</span>{" "}
        {readinessLoading ? "Loading handling tracking context..." : derivedStep}
      </p>
      <p className="mt-0.5 text-[11px] text-emerald-800/80 dark:text-emerald-200/80">
        {OWNED_STEP_HANDLING_TRACKING_COPY}
      </p>
      {caseId ? (
        <ChatHandlingPersistedStatusReadOnly
          caseId={caseId}
          filings={filings}
          tasks={tasks}
          approvedNextAction={approvedNextAction}
          refreshing={readinessLoading}
        />
      ) : null}
      {caseId && onFollowUpResponseReviewOutcome ? (
        <ChatFollowUpResponseReviewPrompt
          caseId={caseId}
          tasks={tasks}
          saving={savingFollowUpResponseReviewOutcome}
          error={followUpResponseReviewError}
          onOutcome={onFollowUpResponseReviewOutcome}
        />
      ) : null}
      {caseId && onSupersededLaneReviewOutcome ? (
        <ChatSupersededLaneReviewPrompt
          caseId={caseId}
          tasks={tasks}
          savingTaskId={savingSupersededLaneReviewTaskId}
          errorByTaskId={supersededLaneReviewErrorByTaskId}
          deepLinkTaskId={reviewDeepLinkTaskId}
          onOutcome={onSupersededLaneReviewOutcome}
        />
      ) : null}
      {showArchiveWhenComplete ? (
        <div className="mt-2 space-y-2 rounded-lg border border-emerald-400/50 bg-white/70 px-3 py-2.5 dark:border-emerald-600/40 dark:bg-emerald-950/40">
          <p className="text-xs font-medium text-emerald-950 dark:text-emerald-100">Close this case</p>
          <p className="text-[11px] leading-relaxed text-emerald-800/90 dark:text-emerald-200/90">
            This archives the case in Surrenderless. It does not submit, file, or contact anyone.
          </p>
          <button
            type="button"
            disabled={archiving}
            onClick={() => onArchiveCase?.(caseId)}
            className="inline-flex rounded-lg border border-emerald-500/80 bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-emerald-800 disabled:opacity-60 dark:bg-emerald-600 dark:hover:bg-emerald-500"
          >
            {archiving ? "Archiving…" : "Archive case"}
          </button>
          {archiveError ? (
            <p className="text-[11px] text-red-700 dark:text-red-300" role="alert">
              {archiveError}
            </p>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

const CHAT_RECENT_EVIDENCE_MAX = 3;
const CHAT_EVIDENCE_DESC_PREVIEW_MAX = 120;

function chatEvidenceTypeLabel(t: string): string {
  return isJusticeEvidenceType(t) ? JUSTICE_EVIDENCE_TYPE_LABELS[t] : t.replace(/_/g, " ");
}

function isCreatedEvidenceRow(payload: unknown): payload is JusticeCaseEvidenceRow {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  const row = payload as JusticeCaseEvidenceRow;
  return typeof row.id === "string" && typeof row.title === "string";
}

function truncateChatEvidenceDescription(text: string | null, max: number): string {
  if (!text?.trim()) return "";
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max)}…`;
}

const PROOF_KEYWORD_STRONG =
  /\b(screenshots?|receipts?|invoices?|tracking|confirmations?|transcripts?|call\s+notes?|chat\s+logs?|account\s+pages?)\b/i;

const PROOF_KEYWORD_NEGATIVE =
  /\b(?:no|not|don'?t|doesn'?t|didn'?t|without|never)\b[^.?!]{0,48}\b(?:proof|evidence|screenshots?|receipts?)\b/i;

function userMessageSuggestsProofNote(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (PROOF_KEYWORD_NEGATIVE.test(trimmed)) return false;
  return PROOF_KEYWORD_STRONG.test(trimmed);
}

const PROOF_NOTE_PREFILL_TITLE_MAX = 120;

function collapseProofNoteWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function truncateProofNoteTitle(collapsed: string): string {
  if (collapsed.length <= PROOF_NOTE_PREFILL_TITLE_MAX) return collapsed;
  const slice = collapsed.slice(0, PROOF_NOTE_PREFILL_TITLE_MAX);
  const lastSpace = slice.lastIndexOf(" ");
  const cut =
    lastSpace > PROOF_NOTE_PREFILL_TITLE_MAX * 0.5 ? slice.slice(0, lastSpace) : slice;
  return `${cut.trimEnd()}…`;
}

function buildProofNotePrefillFromUserMessage(text: string): { title: string; description: string } {
  const collapsed = collapseProofNoteWhitespace(text);
  if (collapsed.length <= PROOF_NOTE_PREFILL_TITLE_MAX) {
    return { title: collapsed, description: "" };
  }
  return {
    title: truncateProofNoteTitle(collapsed),
    description: collapsed,
  };
}

function isoToDateInputValue(iso?: string): string {
  if (!iso?.trim()) return "";
  const d = iso.trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : "";
}

function ApprovedNextActionOutcomeTrackingForm({
  action,
  onSave,
}: {
  action: JusticeApprovedNextAction;
  onSave: (draft: {
    outcome_note: string;
    follow_up_needed: boolean;
    follow_up_at: string;
  }) => Promise<void>;
}) {
  const [outcomeNote, setOutcomeNote] = useState(action.outcome_note ?? "");
  const [followUpNeeded, setFollowUpNeeded] = useState(action.follow_up_needed === true);
  const [followUpAt, setFollowUpAt] = useState(() => isoToDateInputValue(action.follow_up_at));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setOutcomeNote(action.outcome_note ?? "");
    setFollowUpNeeded(action.follow_up_needed === true);
    setFollowUpAt(isoToDateInputValue(action.follow_up_at));
  }, [action.outcome_note, action.follow_up_needed, action.follow_up_at, action.completed_at]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave({
        outcome_note: outcomeNote,
        follow_up_needed: followUpNeeded,
        follow_up_at: followUpAt,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={(e) => void handleSubmit(e)}
      className="mt-3 space-y-2 rounded-lg border border-emerald-400/50 bg-white/70 px-3 py-2.5 dark:border-emerald-600/40 dark:bg-emerald-950/40"
      aria-label="Outcome and follow-up tracking"
    >
      <p className="text-xs font-medium text-emerald-950 dark:text-emerald-100">Record outcome / follow-up</p>
      <label className="block text-[11px] font-medium text-emerald-900 dark:text-emerald-200">
        Outcome / note
        <textarea
          value={outcomeNote}
          onChange={(e) => setOutcomeNote(e.target.value)}
          rows={3}
          placeholder="What happened, or what should Surrenderless track next?"
          className="mt-1 w-full resize-y rounded-md border border-emerald-300/80 bg-white px-2 py-1.5 text-xs text-neutral-900 placeholder:text-neutral-400 dark:border-emerald-700 dark:bg-neutral-950 dark:text-neutral-100"
        />
      </label>
      <label className="flex cursor-pointer items-start gap-2 text-[11px] text-emerald-900 dark:text-emerald-100">
        <input
          type="checkbox"
          checked={followUpNeeded}
          onChange={(e) => setFollowUpNeeded(e.target.checked)}
          className="mt-0.5"
        />
        Follow-up needed
      </label>
      {followUpNeeded ? (
        <label className="block text-[11px] font-medium text-emerald-900 dark:text-emerald-200">
          Follow-up date (optional, your pace)
          <input
            type="date"
            value={followUpAt}
            onChange={(e) => setFollowUpAt(e.target.value)}
            className="mt-1 w-full rounded-md border border-emerald-300/80 bg-white px-2 py-1.5 text-xs text-neutral-900 dark:border-emerald-700 dark:bg-neutral-950 dark:text-neutral-100"
          />
          <span className="mt-1 block font-normal text-emerald-800/80 dark:text-emerald-200/75">
            Optional reminder for you — not a deadline.
          </span>
        </label>
      ) : null}
      <button
        type="submit"
        disabled={saving}
        className="inline-flex rounded-lg border border-emerald-500/80 bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-emerald-800 disabled:opacity-60 dark:bg-emerald-600 dark:hover:bg-emerald-500"
      >
        {saving ? "Saving…" : "Save tracking note"}
      </button>
      <p className="text-[11px] text-emerald-800/80 dark:text-emerald-200/80">
        Tracking only — not automatic filing or submission.
      </p>
    </form>
  );
}

/** Visually differentiates a completed Active Case checklist row from a pending one, instead of
 * relying on a skimming user to read "yes" vs "not yet" as plain text. */
function ActiveCaseChecklistStatus({ done }: { done: boolean }) {
  return done ? (
    <span className="inline-flex items-center gap-1 font-medium text-emerald-700 dark:text-emerald-400">
      yes
      <span aria-hidden="true">✓</span>
    </span>
  ) : (
    <span className="text-neutral-500 dark:text-neutral-400">not yet</span>
  );
}

export default function JusticeChatAiPage() {
  const router = useRouter();
  const { isSignedIn, isLoaded } = useAuth();
  const { user } = useUser();
  const signedInConsumerEmail = resolveSignedInConsumerReplyEmail(user);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sendInFlightRef = useRef(false);
  /** Skips the pre-commit draft-save effect's very first (mount) invocation, which otherwise
   *  races the mount-time draft-restore effect: both observe the fresh-mount default parts/
   *  messages within the same initial effect flush (setters from restore don't land until the
   *  next render), so an unguarded save on mount would overwrite a real saved draft with empty
   *  defaults before restore ever gets to read it back. */
  const skipInitialDraftSaveRef = useRef(true);
  const sessionBaselinePartsRef = useRef<BuildJusticeIntakeParts | null>(null);
  const sessionBaselineEvidenceCountRef = useRef<number | null>(null);
  /** Last-observed hasUploadedEvidenceFile, scoped to its case — a caseId mismatch (including
   *  switching cases) is treated the same as "not yet observed", so a stale value from a
   *  different case can never suppress or falsely trigger a recompute. */
  const hasUploadedEvidenceFileRef = useRef<{ caseId: string; value: boolean } | null>(null);
  const transcriptCaseIdRef = useRef("");
  /** Guards the review-task deep-link effect below so a `?case=&task=` link is resolved at most
   *  once per page load — set only once we've actually settled sign-in state (see the effect),
   *  never on a signed-out visit, so it can still retry once the consumer signs in. */
  const reviewDeepLinkHandledRef = useRef(false);
  /** Guards the Stripe checkout-return effect below (?case=&checkout=success|cancelled) so it
   *  resolves at most once per page load, same lifecycle as reviewDeepLinkHandledRef. */
  const checkoutReturnHandledRef = useRef(false);
  /** Guards the "no local case, resume latest from server" fallback effect below so it runs at
   *  most once per page load, same lifecycle as reviewDeepLinkHandledRef. */
  const latestCaseHydrationAttemptedRef = useRef(false);
  const persistedTurnIdsRef = useRef<Set<string>>(new Set());
  const messagesRef = useRef<UiMessage[]>([]);
  const prevApprovedActionHrefForAssistedPracticeRef = useRef<string | undefined>(undefined);

  const [parts, setParts] = useState<BuildJusticeIntakeParts>(() => defaultBuildJusticeIntakeParts());
  const [isUpdatingExistingCase, setIsUpdatingExistingCase] = useState(false);

  // Seed the consumer's OWN reply email from the signed-in account's verified email so the
  // user is not unnecessarily asked for it. This only fills an empty `reply_email` (never
  // overwrites an explicitly captured value), reseeds if hydration clears it, and never
  // touches the separate merchant `company_contact_email`. When no verified account email is
  // available, `signedInConsumerEmail` is null and chat asks the user for their own email.
  useEffect(() => {
    if (!signedInConsumerEmail) return;
    if (parts.reply_email.trim()) return;
    setParts((prev) =>
      prev.reply_email.trim() ? prev : { ...prev, reply_email: signedInConsumerEmail }
    );
  }, [signedInConsumerEmail, parts.reply_email]);
  const [messages, setMessages] = useState<UiMessage[]>(() => [
    { id: msgId(), role: "assistant", text: OPENING_GREETING },
  ]);
  const [inputValue, setInputValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [contactProofError, setContactProofError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [clearingFollowUp, setClearingFollowUp] = useState(false);
  const [requestingHandling, setRequestingHandling] = useState(false);
  const [updatingHandlingNote, setUpdatingHandlingNote] = useState(false);
  const [acknowledgingHandling, setAcknowledgingHandling] = useState(false);
  const [savingFollowUpResponseReviewOutcome, setSavingFollowUpResponseReviewOutcome] =
    useState(false);
  const [followUpResponseReviewError, setFollowUpResponseReviewError] = useState<string | null>(
    null
  );
  const [savingSupersededLaneReviewTaskId, setSavingSupersededLaneReviewTaskId] = useState<
    string | null
  >(null);
  const [supersededLaneReviewErrorByTaskId, setSupersededLaneReviewErrorByTaskId] = useState<
    Record<string, string>
  >({});
  /** Source task id from a notification email's `?case=&task=` deep link — kept independent of
   *  the hydrate/reject decision so it still prioritizes/highlights the right review once tasks
   *  load, including when the link's case already matched the active session (same-case links). */
  const [reviewDeepLinkTaskId, setReviewDeepLinkTaskId] = useState<string | null>(null);
  const [markingActionHandled, setMarkingActionHandled] = useState(false);
  const [markingActionStarted, setMarkingActionStarted] = useState(false);
  const [approvedNextAction, setApprovedNextAction] = useState<JusticeApprovedNextAction | undefined>(
    undefined
  );
  const [preparedPacketApproved, setPreparedPacketApproved] = useState(false);
  const [savedEvidenceCount, setSavedEvidenceCount] = useState<number | null>(null);
  const [savedFilings, setSavedFilings] = useState<JusticeCaseFilingRow[]>([]);
  const [savedTasks, setSavedTasks] = useState<JusticeCaseTaskRow[]>([]);
  const [chatHandlingReadinessLoading, setChatHandlingReadinessLoading] = useState(false);
  const [savedEvidenceRows, setSavedEvidenceRows] = useState<JusticeCaseEvidenceRow[]>([]);
  const [recentEvidenceRows, setRecentEvidenceRows] = useState<JusticeCaseEvidenceRow[]>([]);
  const [proofNoteTitle, setProofNoteTitle] = useState("");
  const [proofNoteType, setProofNoteType] = useState<JusticeEvidenceType>("other");
  const [proofNoteEvidenceDate, setProofNoteEvidenceDate] = useState("");
  const [proofNoteDescription, setProofNoteDescription] = useState("");
  const [savingProofNote, setSavingProofNote] = useState(false);
  const [proofNoteError, setProofNoteError] = useState<string | null>(null);
  const [proofNoteSuccess, setProofNoteSuccess] = useState<string | null>(null);
  const [editingRecentEvidenceId, setEditingRecentEvidenceId] = useState<string | null>(null);
  const [editRecentEvidenceTitle, setEditRecentEvidenceTitle] = useState("");
  const [editRecentEvidenceType, setEditRecentEvidenceType] = useState<JusticeEvidenceType>("other");
  const [editRecentEvidenceDate, setEditRecentEvidenceDate] = useState("");
  const [editRecentEvidenceDescription, setEditRecentEvidenceDescription] = useState("");
  const [savingRecentEvidenceEdit, setSavingRecentEvidenceEdit] = useState(false);
  const [recentEvidenceEditError, setRecentEvidenceEditError] = useState<string | null>(null);
  const [recentEvidenceEditSuccess, setRecentEvidenceEditSuccess] = useState<string | null>(null);
  const [deletingRecentEvidenceId, setDeletingRecentEvidenceId] = useState<string | null>(null);
  const [recentEvidenceDeleteError, setRecentEvidenceDeleteError] = useState<string | null>(null);
  const [recentEvidenceDeleteSuccess, setRecentEvidenceDeleteSuccess] = useState<string | null>(null);
  const [showProofKeywordNudge, setShowProofKeywordNudge] = useState(false);
  const [proofNoteDetailsOpen, setProofNoteDetailsOpen] = useState(false);
  const [stagedProofNotes, setStagedProofNotes] = useState<StagedProofNote[]>([]);
  const [stagedProofFlushError, setStagedProofFlushError] = useState<string | null>(null);
  const [evidenceUploadFileName, setEvidenceUploadFileName] = useState<string | null>(null);
  const [evidenceUploadProgress, setEvidenceUploadProgress] = useState<number | null>(null);
  const [uploadingEvidenceFile, setUploadingEvidenceFile] = useState(false);
  const [evidenceUploadError, setEvidenceUploadError] = useState<string | null>(null);
  const [evidenceUploadSuccess, setEvidenceUploadSuccess] = useState<string | null>(null);
  const evidenceFileInputRef = useRef<HTMLInputElement | null>(null);
  const evidenceUploadProgressTurnIdRef = useRef<string | null>(null);
  const [archivingCase, setArchivingCase] = useState(false);
  const [archiveCaseError, setArchiveCaseError] = useState<string | null>(null);
  const [approvePreparedPacketChecked, setApprovePreparedPacketChecked] = useState(false);
  const [approvingPreparedPacket, setApprovingPreparedPacket] = useState(false);
  const [addingMerchantContactRecipient, setAddingMerchantContactRecipient] = useState(false);
  // Consumer's explicit "I have no merchant email — operators will handle outreach" choice, mirrored
  // from the durable client_state flag so it survives the Stripe payment redirect and reloads.
  const [merchantContactOperatorFallbackChosen, setMerchantContactOperatorFallbackChosen] =
    useState(false);
  /** Pre-checkout price disclosure state — "loading" until the first fetch resolves for the
   *  active case, so checkout is disabled by default rather than ever appearing available before
   *  a real price has been confirmed. */
  const [checkoutPriceState, setCheckoutPriceState] = useState<CheckoutPriceState>({
    status: "loading",
  });
  const [submissionDraftReviewChecked, setSubmissionDraftReviewChecked] = useState(false);
  const [markingSubmissionDraftReviewed, setMarkingSubmissionDraftReviewed] = useState(false);
  const [submissionDraftReviewError, setSubmissionDraftReviewError] = useState<string | null>(null);
  const [trackingSaveError, setTrackingSaveError] = useState<string | null>(null);
  const [submissionDraftReviewOverride, setSubmissionDraftReviewOverride] = useState(false);
  const [draftPreviewExpanded, setDraftPreviewExpanded] = useState(false);
  const [packetPreviewExpanded, setPacketPreviewExpanded] = useState(false);
  const [prepMessageExpanded, setPrepMessageExpanded] = useState(false);
  const [prepCopyHint, setPrepCopyHint] = useState<string | null>(null);
  const [inlineDraftCopyHint, setInlineDraftCopyHint] = useState<string | null>(null);
  const [inlinePacketCopyHint, setInlinePacketCopyHint] = useState<string | null>(null);
  const [chatAiDraftText, setChatAiDraftText] = useState<string | null>(null);
  const [chatAiDraftLoading, setChatAiDraftLoading] = useState(false);
  const [chatAiDraftError, setChatAiDraftError] = useState<string | null>(null);
  const [merchantDocContactMethod, setMerchantDocContactMethod] =
    useState<NonNullable<BuildJusticeIntakeParts["contact_method"]>>("email");
  const [merchantDocContactDate, setMerchantDocContactDate] = useState("");
  const [merchantDocMerchantResponseType, setMerchantDocMerchantResponseType] =
    useState<NonNullable<BuildJusticeIntakeParts["merchant_response_type"]>>("no_response");
  const [merchantDocContactProofType, setMerchantDocContactProofType] =
    useState<NonNullable<BuildJusticeIntakeParts["contact_proof_type"]>>("none");
  const [merchantDocContactProofText, setMerchantDocContactProofText] = useState("");
  const [merchantDocContactDateError, setMerchantDocContactDateError] = useState<string | null>(null);
  const [merchantDocContactProofError, setMerchantDocContactProofError] = useState<string | null>(null);
  const [savingMerchantContactDocumentation, setSavingMerchantContactDocumentation] = useState(false);
  const [paymentDisputePaymentMethod, setPaymentDisputePaymentMethod] =
    useState<PaymentMethodOption>("credit_card");
  const [paymentDisputeChargeDate, setPaymentDisputeChargeDate] = useState("");
  const [paymentDisputeChargeAmount, setPaymentDisputeChargeAmount] = useState("");
  const [paymentDisputeMerchantName, setPaymentDisputeMerchantName] = useState("");
  const [paymentDisputeReason, setPaymentDisputeReason] =
    useState<DisputeReasonOption>("unauthorized_charge");
  const [paymentDisputeReasonOther, setPaymentDisputeReasonOther] = useState("");
  const [paymentDisputePriorContact, setPaymentDisputePriorContact] = useState<"yes" | "no">("no");
  const [paymentDisputeProofType, setPaymentDisputeProofType] =
    useState<PaymentDisputeProofType>("receipt_order_confirmation");
  const [paymentDisputeLetterExpanded, setPaymentDisputeLetterExpanded] = useState(false);
  const [paymentDisputeCopyHint, setPaymentDisputeCopyHint] = useState<string | null>(null);
  const [savingPaymentDisputeChecklist, setSavingPaymentDisputeChecklist] = useState(false);
  const [paymentDisputeSaveSuccess, setPaymentDisputeSaveSuccess] = useState<string | null>(null);
  const paymentDisputeFormHydratedForCaseRef = useRef<string | null>(null);
  const [ftcPracticeConfirmed, setFtcPracticeConfirmed] = useState(false);
  const [ftcPracticeRunning, setFtcPracticeRunning] = useState(false);
  const [ftcPracticeSuccess, setFtcPracticeSuccess] = useState(false);
  const [ftcPracticeStorageSkipped, setFtcPracticeStorageSkipped] = useState(false);
  const [ftcPracticeError, setFtcPracticeError] = useState<string | null>(null);
  const [ftcPracticeLastAssistedSubmissionAttempt, setFtcPracticeLastAssistedSubmissionAttempt] =
    useState<LastAssistedSubmissionAttemptSnapshot | null>(null);
  const evidencePreviewFetchGenerationRef = useRef(0);
  const wasPendingHumanFulfillmentEscalationRef = useRef(false);
  const ownedFulfillmentSnapshotRef = useRef<ChatOwnedFulfillmentObservationSnapshot | null>(null);
  /** Latest server archived_at for the active case (from case GET refresh). */
  const caseArchivedAtRef = useRef<string | null>(null);
  /** Durable one-time-payment entitlement for the active case, read from the server's own
   *  paid_at on every case refresh — never set from a redirect param or any other client-side
   *  signal. Only the Stripe webhook (server-side, signature-verified) can make this non-null. */
  const casePaidAtRef = useRef<string | null>(null);
  /** Immediate (synchronous) reentrancy guard for handleApprovePreparedPacketFromChat — a ref so
   *  a second invocation arriving before the next render still sees it, unlike React state. */
  const approvingPreparedPacketRef = useRef(false);
  /** Case id the checkout price has already been fetched for (successfully or is currently
   *  in flight for) — cleared back to null on failure so a retry is always possible. Set to the
   *  active case id without a fetch when casePaidAtRef already shows the case paid. */
  const checkoutPriceFetchedForCaseRef = useRef<string | null>(null);
  /** Identifies the most recent price request per case, so a stale/superseded response (an
   *  older attempt resolving after a retry, or after the consumer switched to a different case)
   *  can never overwrite state for a request that is no longer the one in flight. */
  const checkoutPriceRequestRef = useRef<{ caseId: string; requestId: number } | null>(null);
  // Generation guard for the post-checkout payment-confirmation polling loop: incremented whenever a
  // new confirmation run starts (return from checkout, or "keep checking") and on session reset, so a
  // superseded/abandoned loop can never keep polling or write UI state for a case that is no longer
  // active. paid_at itself always comes from the server (webhook-authoritative) — never set here.
  const paymentConfirmationGenerationRef = useRef(0);
  const partsRef = useRef(parts);
  const savedTasksRef = useRef<JusticeCaseTaskRow[]>([]);
  const pendingChatContextRefreshRef = useRef<Promise<void> | null>(null);
  const approvedNextActionRef = useRef<JusticeApprovedNextAction | undefined>(undefined);
  const merchantContactAutopilotCaseRef = useRef<string | null>(null);
  const legalConsentTrackedCaseIdRef = useRef<string | null>(null);
  const proofKeywordNudgeOfferedRef = useRef(false);
  approvedNextActionRef.current = approvedNextAction;
  partsRef.current = parts;
  savedTasksRef.current = savedTasks;

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    // Skip the mount-time invocation: parts/messages are still fresh-mount defaults here even
    // when a real draft exists in storage (the sibling restore effect's setParts/setMessages
    // haven't landed yet within this same initial flush) — saving now would clobber the real
    // draft with empty defaults before restore ever reads it. Every subsequent invocation (the
    // restore's own state update, or a real chat turn) runs with genuinely current values.
    if (skipInitialDraftSaveRef.current) {
      skipInitialDraftSaveRef.current = false;
      return;
    }
    // Only while genuinely pre-commit: no committed case id yet, and not hydrating/updating an
    // already-existing case. Once commitIntakeToSessionAndServer succeeds, STORAGE_CASE_ID is
    // set and this stops saving on its own; the explicit clearIntakeDraft() call after commit
    // (and inside clearLocalJusticeSession for explicit resets) removes the stored draft itself.
    if (isUpdatingExistingCase) return;
    const hasCommittedCaseId = Boolean(sessionStorage.getItem(STORAGE_CASE_ID)?.trim());
    if (hasCommittedCaseId) return;
    saveIntakeDraft({ parts, messages });
  }, [parts, messages, isUpdatingExistingCase]);

  const persistChatTurnsForCase = useCallback(
    async (caseId: string, turns: readonly UiMessage[], source: JusticeCaseChatMessageSource) => {
      if (!isLoaded || !isSignedIn || !caseId || !isUuid(caseId) || turns.length === 0) {
        return;
      }
      const toPersist = turns.filter((turn) => !persistedTurnIdsRef.current.has(turn.id));
      if (toPersist.length === 0) return;
      const payload = uiMessagesToPersistTurns(toPersist, source);
      if (payload.length === 0) return;
      try {
        await appendCaseChatTranscriptTurns(caseId, payload);
        toPersist.forEach((turn) => persistedTurnIdsRef.current.add(turn.id));
      } catch (error) {
        console.warn("justice chat-ai: transcript persist failed", error);
      }
    },
    [isLoaded, isSignedIn]
  );

  const backfillChatTranscriptForCase = useCallback(
    async (caseId: string, turns: readonly UiMessage[]) => {
      if (!isLoaded || !isSignedIn || !caseId || !isUuid(caseId) || turns.length === 0) {
        return;
      }
      const toPersist = turns.filter(
        (turn) =>
          !isEphemeralChatGreeting(turn.text) && !persistedTurnIdsRef.current.has(turn.id)
      );
      if (toPersist.length === 0) return;
      // The server hard-rejects any single request over MAX_JUSTICE_CASE_CHAT_APPEND_BATCH
      // messages with no partial save — chunk here so a long pre-commit intake conversation
      // (routinely 20+ turns) doesn't get silently and entirely dropped in one oversized call.
      const chunks = chunkArray(toPersist, MAX_JUSTICE_CASE_CHAT_APPEND_BATCH);
      for (const chunk of chunks) {
        const payload = uiMessagesToPersistTurns(chunk, "intake_chat");
        if (payload.length === 0) continue;
        try {
          await appendCaseChatTranscriptTurns(caseId, payload);
          chunk.forEach((turn) => persistedTurnIdsRef.current.add(turn.id));
        } catch (error) {
          console.warn("justice chat-ai: transcript backfill persist failed", error);
          break;
        }
      }
    },
    [isLoaded, isSignedIn]
  );

  const addChatMessages = useCallback(
    (
      newTurns: UiMessage[],
      options?: { caseId?: string; source?: JusticeCaseChatMessageSource }
    ) => {
      messagesRef.current = [...messagesRef.current, ...newTurns];
      setMessages(messagesRef.current);
      const caseId =
        options?.caseId?.trim() ||
        (typeof window !== "undefined" ? sessionStorage.getItem(STORAGE_CASE_ID)?.trim() ?? "" : "");
      if (caseId) {
        void persistChatTurnsForCase(caseId, newTurns, options?.source ?? "intake_chat");
      }
    },
    [persistChatTurnsForCase]
  );

  const resetActiveChatTranscriptState = useCallback((options?: { openingGreeting?: boolean }) => {
    transcriptCaseIdRef.current = "";
    persistedTurnIdsRef.current.clear();
    if (options?.openingGreeting !== false) {
      const greeting = { id: msgId(), role: "assistant" as const, text: OPENING_GREETING };
      messagesRef.current = [greeting];
      setMessages(messagesRef.current);
    }
  }, []);

  const appendChatCaseProgressNarration = useCallback((observation: ChatCaseProgressObservation) => {
    // Re-sync from the visible transcript so restore/switch hydrates do not re-narrate
    // milestones already present in messages (including after a later context refresh).
    syncChatProgressNarrationFromTranscript(observation.caseId, messagesRef.current);
    const narrationMessages = collectNewChatCaseProgressNarrationMessages(observation);
    if (narrationMessages.length === 0) return;
    const turns = narrationMessages.map((text) => ({
      id: msgId(),
      role: "assistant" as const,
      text,
    }));
    addChatMessages(turns, {
      caseId: observation.caseId,
      source: "progress_narration",
    });
  }, [addChatMessages]);

  async function handleMarkSubmissionDraftReviewedFromChat(options?: {
    fromChatConsent?: boolean;
  }): Promise<boolean> {
    if ((!submissionDraftReviewChecked && !options?.fromChatConsent) || !isLoaded) return false;
    const caseId =
      typeof window !== "undefined" ? sessionStorage.getItem(STORAGE_CASE_ID)?.trim() ?? "" : "";
    if (!caseId) return false;

    setMarkingSubmissionDraftReviewed(true);
    setSubmissionDraftReviewError(null);
    try {
      const intake = buildJusticeIntakeFromParts(parts);
      const destination = resolveChatPreviewDestination(
        intake,
        savedEvidenceRows.some(justiceEvidenceRowHasUploadedFile)
      );
      const destinationLabel = destination?.label;

      if (isSignedIn && isUuid(caseId)) {
        const res = await fetch("/api/justice/submission-draft-reviewed", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            case_id: caseId,
            ...(destinationLabel ? { destination_label: destinationLabel } : {}),
            used_ai: Boolean(chatAiDraftText?.trim()),
          }),
        });
        const data = (await res.json().catch(() => ({}))) as { timeline?: unknown; error?: string };
        if (!res.ok) {
          setSubmissionDraftReviewError(
            data.error ??
              "The submission draft review was not saved to your case timeline. Please try again."
          );
          return false;
        }
        if (!Array.isArray(data.timeline)) {
          setSubmissionDraftReviewError(
            "The submission draft review was not saved (invalid server response). Please try again."
          );
          return false;
        }
        applyServerTimelineFromResponse(caseId, { timeline: data.timeline });
      } else {
        appendSubmissionDraftReviewedOnce(caseId, {
          destinationLabel,
          usedAi: Boolean(chatAiDraftText?.trim()),
        });
      }

      writeSessionSubmissionDraftReviewed(caseId);
      setSubmissionDraftReviewOverride(true);
      setSubmissionDraftReviewChecked(false);
      setDraftPreviewExpanded(false);
      setChatAiDraftText(null);
      setChatAiDraftError(null);
      return true;
    } catch {
      setSubmissionDraftReviewError("Could not save draft review. Please try again.");
      return false;
    } finally {
      setMarkingSubmissionDraftReviewed(false);
    }
  }

  async function handleGenerateChatAiAssistedDraft(): Promise<void> {
    if (!isLoaded || !isSignedIn) {
      setChatAiDraftError("Sign in to generate an AI-assisted draft.");
      return;
    }
    const destination = chatPreviewDestination;
    if (!destination || !chatSubmissionDraftText) {
      setChatAiDraftError("Draft is not ready yet.");
      return;
    }
    setChatAiDraftLoading(true);
    setChatAiDraftError(null);
    try {
      const caseId =
        typeof window !== "undefined" ? sessionStorage.getItem(STORAGE_CASE_ID)?.trim() ?? "" : "";
      const timeline = caseId ? readTimeline(caseId) : [];
      const result = await requestJusticePreviewDraft({
        intake: chatPreviewIntake,
        destinationId: destination.id,
        destinationLabel: destination.label,
        ...(caseId && isUuid(caseId) ? { caseId } : {}),
        evidenceItems: recentEvidenceRows.map((row) => ({
          title: row.title,
          evidence_type: row.evidence_type,
          ...(row.description?.trim() ? { description: row.description.trim() } : {}),
          ...(row.evidence_date != null && row.evidence_date !== ""
            ? { evidence_date: row.evidence_date }
            : {}),
        })),
        timeline,
      });
      if (!result.ok) {
        setChatAiDraftError(result.error);
        return;
      }
      setChatAiDraftText(result.draft);
      setDraftPreviewExpanded(true);
    } catch {
      setChatAiDraftError("Could not generate AI-assisted draft.");
    } finally {
      setChatAiDraftLoading(false);
    }
  }

  async function handleArchiveActiveCase(
    archiveCaseId: string,
    options?: { fromChat?: boolean; transcriptTurns?: JusticeCaseChatPersistTurn[] }
  ): Promise<boolean> {
    if (!isLoaded) return false;
    const caseId = archiveCaseId.trim();
    if (!caseId || !isUuid(caseId)) return false;

    setArchivingCase(true);
    setArchiveCaseError(null);
    try {
      // Persist closure turns while the case is still active/owned, then archive.
      if (options?.transcriptTurns?.length) {
        try {
          await appendCaseChatTranscriptTurns(caseId, options.transcriptTurns);
          options.transcriptTurns.forEach((turn) => {
            persistedTurnIdsRef.current.add(turn.clientTurnId);
          });
        } catch (error) {
          console.warn("justice chat-ai: archive transcript persist failed", error);
        }
      }
      const res = await fetch(`/api/justice/cases/${encodeURIComponent(caseId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived_at: new Date().toISOString() }),
      });
      if (!res.ok) {
        console.warn("justice chat-ai: archive failed", res.status);
        setArchiveCaseError(CHAT_ARCHIVE_ERROR_MESSAGE);
        return false;
      }
      clearLocalJusticeSession();
      if (options?.fromChat) {
        resetChatPostClosureUiState();
        resetActiveChatTranscriptState();
        return true;
      }
      router.push("/justice");
      return true;
    } catch (e) {
      console.warn("justice chat-ai: archive error", e);
      setArchiveCaseError(CHAT_ARCHIVE_ERROR_MESSAGE);
      return false;
    } finally {
      setArchivingCase(false);
    }
  }

  async function hydrateChatFromJusticeCaseRow(freshCase: JusticeCaseListRow): Promise<{
    ok: boolean;
    companyName?: string;
  }> {
    const caseId = freshCase.id?.trim() ?? "";
    if (!caseId || !isUuid(caseId)) return { ok: false };

    const intake = hydrateSessionFromCaseListRow(freshCase);
    if (!intake) return { ok: false };

    const hydratedParts = justiceIntakeToBuildJusticeIntakeParts(intake);
    sessionBaselinePartsRef.current = cloneBuildJusticeIntakeParts(hydratedParts);
    setParts(hydratedParts);
    setIsUpdatingExistingCase(true);
    setArchiveCaseError(null);

    const hydratedAction = hydrateApprovedNextActionForDisplay(caseId, freshCase.client_state);
    if (hydratedAction) writeSessionApprovedNextAction(caseId, hydratedAction);
    setApprovedNextAction(hydratedAction);
    const serverPacketApproved =
      parseJusticeCaseClientState(freshCase.client_state).prepared_packet_approved === true;
    setPreparedPacketApproved(readSessionPreparedPacketApproved(caseId) || serverPacketApproved);
    legalConsentTrackedCaseIdRef.current = caseId;

    // Claim the case id before awaiting fetch so the transcript useEffect does not
    // race and overwrite a successful hydrate with a stale/empty load.
    transcriptCaseIdRef.current = caseId;
    const loaded = await fetchCaseChatTranscript(caseId);
    persistedTurnIdsRef.current = new Set(loaded.map((turn) => turn.id));
    if (loaded.length > 0) {
      messagesRef.current = loaded;
      setMessages(loaded);
      syncChatProgressNarrationFromTranscript(caseId, loaded);
    } else {
      const greeting = { id: msgId(), role: "assistant" as const, text: UPDATE_GREETING };
      messagesRef.current = [greeting];
      setMessages(messagesRef.current);
    }

    await refreshFullChatCaseContextFromServer(caseId, {
      // Transcript already carries prior progress narrations; don't re-append on switch/restore.
      skipProgressNarration: loaded.length > 0,
    });

    return { ok: true, companyName: intake.company_name?.trim() || undefined };
  }

  // Resolves a consumer-review-notification email's `?case=&task=` deep link. Runs at most once
  // per page load. Handles the fresh-tab case (sessionStorage empty — the confirmed blocker this
  // exists to fix) and the wrong-existing-session case (a different case already active) by
  // hydrating the EXACT linked case, never a "most recent" substitute. Malformed, unauthorized,
  // completed, cross-case, or mismatched-type links are rejected silently: no active-state change,
  // no distinguishing error, so nothing about which case/task exists is ever leaked.
  useEffect(() => {
    if (!isLoaded || typeof window === "undefined") return;
    if (reviewDeepLinkHandledRef.current) return;

    const search = window.location.search;
    const deepLink = parseReviewTaskDeepLinkParams(search);
    if (!deepLink) {
      reviewDeepLinkHandledRef.current = true;
      return;
    }
    // Set independent of the hydrate/reject decision below (including the same-case case, which
    // never reaches the fetch flow) — inert unless it happens to match an already-legitimately-
    // loaded open task, so it's safe to record before authorization/case-matching is resolved.
    setReviewDeepLinkTaskId(deepLink.taskId);
    // Not yet known whether this consumer is signed in — wait rather than reject, so a link
    // opened before auth finishes loading still resolves once isSignedIn settles.
    if (!isSignedIn) return;
    reviewDeepLinkHandledRef.current = true;

    const sessionCaseId = sessionStorage.getItem(STORAGE_CASE_ID)?.trim() ?? "";

    // A staged-but-unflushed proof note has no case_id of its own, and a valid local
    // intake/draft or a real in-progress conversation is unsaved work that lives only in this
    // tab — hydrating a different case out from under any of them would silently attach or
    // overwrite it. Leave state untouched rather than resolve the link, matching this effect's
    // own "no active-state change" contract for every other reject path.
    if (
      readValidLocalJusticeIntake() ||
      readValidIntakeDraft() ||
      readStagedProofNotes().length > 0
    ) {
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const caseLookup = await fetchJusticeCaseById(deepLink.caseId);
        if (cancelled) return;

        let tasks: JusticeCaseTaskRow[] | null = null;
        if (caseLookup?.id === deepLink.caseId) {
          const res = await fetch(
            `/api/justice/tasks?case_id=${encodeURIComponent(deepLink.caseId)}`
          );
          if (cancelled) return;
          const body: unknown = res.ok ? await res.json() : null;
          tasks = Array.isArray(body) ? (body as JusticeCaseTaskRow[]) : null;
        }
        if (cancelled) return;

        const action = resolveReviewTaskDeepLinkAction({
          search,
          sessionCaseId,
          caseLookup: caseLookup?.id ? { id: caseLookup.id } : null,
          tasks,
        });
        if (action.kind !== "hydrate" || !caseLookup) return;

        // Re-check: local state may have changed while the lookup was in flight. A draft alone
        // isn't checked here — the signed-in reply-email auto-seed effect can produce one with
        // no real turns in it, so only an actual non-greeting message counts as in-progress.
        if (readValidLocalJusticeIntake() || readStagedProofNotes().length > 0) return;
        const hasRealConversation = messagesRef.current.some(
          (turn) => !isEphemeralChatGreeting(turn.text)
        );
        if (hasRealConversation) return;

        await hydrateChatFromJusticeCaseRow(caseLookup);
      } catch (e) {
        console.warn("justice chat-ai: review deep link resolve error", e);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isLoaded, isSignedIn]);

  // Resolves a return from Stripe Checkout (?case=&checkout=success|cancelled). Never treats the
  // redirect itself as proof of payment — it only ensures the exact case is loaded, then
  // refreshes from the server (paid_at only ever comes from there) with a few bounded retries to
  // absorb ordinary webhook-delivery latency, so approval can resume cleanly without the
  // consumer needing to manually reload.
  useEffect(() => {
    if (!isLoaded || typeof window === "undefined") return;
    if (checkoutReturnHandledRef.current) return;

    const search = window.location.search;
    const checkoutStatus = parseCheckoutReturnStatus(search);
    if (!checkoutStatus) {
      checkoutReturnHandledRef.current = true;
      return;
    }
    if (!isSignedIn) return;
    checkoutReturnHandledRef.current = true;

    const returnCaseId = new URLSearchParams(search).get("case")?.trim() ?? "";
    if (!returnCaseId || !isUuid(returnCaseId)) return;

    if (checkoutStatus === "success") {
      // Claim pricing for this case synchronously (before hydration/async confirmation) so the
      // price-fetch effect can never win a race and replace the "Confirming your payment…" state
      // with a fresh pay prompt while the webhook confirmation is still pending.
      checkoutPriceFetchedForCaseRef.current = returnCaseId;
    }

    let cancelled = false;
    void (async () => {
      try {
        const sessionCaseId = sessionStorage.getItem(STORAGE_CASE_ID)?.trim() ?? "";
        if (sessionCaseId !== returnCaseId) {
          // A staged-but-unflushed proof note has no case_id of its own, and a valid local
          // intake/draft or a real in-progress conversation is unsaved work that lives only in
          // this tab — hydrating a different case out from under any of them would silently
          // attach or overwrite it. Leave state untouched; the payment itself is already
          // recorded server-side by the webhook regardless of whether this tab reflects it.
          if (
            readValidLocalJusticeIntake() ||
            readValidIntakeDraft() ||
            readStagedProofNotes().length > 0
          ) {
            return;
          }

          const caseRow = await fetchJusticeCaseById(returnCaseId);
          if (cancelled || !caseRow?.id) return;

          // Re-check: local state may have changed while the lookup was in flight. A draft
          // alone isn't checked here — the signed-in reply-email auto-seed effect can produce
          // one with no real turns in it, so only an actual non-greeting message counts as
          // in-progress.
          if (readValidLocalJusticeIntake() || readStagedProofNotes().length > 0) return;
          const hasRealConversation = messagesRef.current.some(
            (turn) => !isEphemeralChatGreeting(turn.text)
          );
          if (hasRealConversation) return;

          await hydrateChatFromJusticeCaseRow(caseRow);
        } else {
          await refreshChatCaseFromServer(returnCaseId);
        }
        if (cancelled || checkoutStatus !== "success") return;

        // Keep the approval UI in a persistent "Confirming your payment…" state and poll the server
        // (whose paid_at is written only by the signature-verified webhook) with bounded backoff
        // until confirmed — instead of giving up after a fixed short window and reverting to a pay
        // prompt that would invite a second checkout. On success it clears to "not_needed"; on an
        // unusually long wait it shows a truthful, recoverable timeout. Never sets paid_at itself.
        await confirmPaymentWithBackoff(returnCaseId);
      } catch (e) {
        console.warn("justice chat-ai: checkout return resolve error", e);
      }
    })();

    return () => {
      cancelled = true;
      // Cancel any in-flight confirmation polling so it can't write UI state after unmount.
      paymentConfirmationGenerationRef.current += 1;
    };
  }, [isLoaded, isSignedIn]);

  /**
   * Polls the server for webhook-confirmed payment (paid_at) after a successful Stripe Checkout
   * return, with bounded backoff. paid_at is written ONLY by the signature-verified webhook — this
   * reads the refreshed value, never sets it. Holds the approval UI in a persistent "confirming"
   * state until confirmation lands (then "not_needed"); if the bounded budget is exhausted it shows
   * a truthful, recoverable timeout and still never re-opens checkout. A generation + active-case
   * guard cancels a superseded/abandoned run so it can't write state for a no-longer-active case.
   */
  async function confirmPaymentWithBackoff(caseId: string): Promise<void> {
    const trimmed = caseId.trim();
    if (!trimmed || !isUuid(trimmed)) return;
    if (casePaidAtRef.current) return;
    const generation = (paymentConfirmationGenerationRef.current += 1);
    const isCurrent = () =>
      paymentConfirmationGenerationRef.current === generation &&
      (typeof window === "undefined" ||
        sessionStorage.getItem(STORAGE_CASE_ID)?.trim() === trimmed);

    if (isCurrent()) {
      // Mark pricing resolved for this case so the price-fetch effect never overwrites the
      // "Confirming your payment…" state with a fresh pay prompt while confirmation is pending.
      checkoutPriceFetchedForCaseRef.current = trimmed;
      setCheckoutPriceState((prev) =>
        prev.status === "not_needed" ? prev : { status: "confirming" }
      );
    }

    await refreshChatCaseFromServer(trimmed);
    let attempt = 0;
    while (isCurrent() && !casePaidAtRef.current) {
      const delay = checkoutConfirmationDelayForAttempt(attempt);
      if (delay === null) {
        // Bounded budget exhausted — truthful, recoverable timeout. Still no second checkout.
        if (isCurrent() && !casePaidAtRef.current) {
          setCheckoutPriceState({ status: "confirm_timeout" });
        }
        return;
      }
      await new Promise((resolve) => window.setTimeout(resolve, delay));
      if (!isCurrent()) return;
      await refreshChatCaseFromServer(trimmed);
      attempt += 1;
    }

    if (isCurrent() && casePaidAtRef.current) {
      // Confirmed — the price/payment disclosure no longer applies. Invalidate any in-flight price
      // request so a late response can't clobber "not_needed" back to a pay prompt.
      checkoutPriceFetchedForCaseRef.current = trimmed;
      checkoutPriceRequestRef.current = {
        caseId: trimmed,
        requestId: nextCheckoutPriceRequestId(checkoutPriceRequestRef.current, trimmed),
      };
      setCheckoutPriceState({ status: "not_needed" });
    }
  }

  async function handleRestoreMostRecentArchivedCaseFromChat(): Promise<{
    ok: boolean;
    companyName?: string;
    blockedMessage?: string;
  }> {
    if (!isLoaded || !isSignedIn) return { ok: false };

    // A staged-but-unflushed proof note has no case_id of its own (see hydrateChatFromJusticeCaseRow
    // guards elsewhere) — restoring a different case out from under it would silently attach it to
    // that case's evidence once the consumer next saves. Block the switch instead.
    if (readStagedProofNotes().length > 0) {
      return { ok: false, blockedMessage: CHAT_CASE_SWITCH_STAGED_PROOF_NOTE_MESSAGE };
    }

    const activeCaseId =
      typeof window !== "undefined" ? sessionStorage.getItem(STORAGE_CASE_ID)?.trim() ?? "" : "";
    if (activeCaseId && isUuid(activeCaseId)) return { ok: false };

    try {
      const archivedRow = await fetchMostRecentlyArchivedEligibleJusticeCase();
      if (!archivedRow?.id || !isUuid(archivedRow.id)) {
        return { ok: false };
      }

      const restored = await restoreArchivedJusticeCaseOnServer(archivedRow.id);
      if (!restored) return { ok: false };

      const freshCase = await fetchJusticeCaseById(archivedRow.id);
      if (!freshCase) return { ok: false };

      return await hydrateChatFromJusticeCaseRow(freshCase);
    } catch (e) {
      console.warn("justice chat-ai: restore archived case error", e);
      return { ok: false };
    }
  }

  async function handleListCasesForChatSelection(): Promise<string> {
    if (!isLoaded || !isSignedIn) {
      return "Sign in to see your cases in chat.";
    }
    try {
      const { activeRows, archivedRows } = await fetchJusticeCasesForChatSelection();
      const entries = buildChatCaseSelectionList({ activeRows, archivedRows });
      writeChatCaseSelectionOffer(entries);
      return formatChatCaseSelectionListMessage(entries);
    } catch (e) {
      console.warn("justice chat-ai: list cases for selection error", e);
      return "I couldn't load your cases right now. Try again in a moment.";
    }
  }

  async function handleSelectCaseFromChat(query: string): Promise<{
    ok: boolean;
    assistantText: string;
  }> {
    if (!isLoaded || !isSignedIn) {
      return { ok: false, assistantText: "Sign in to switch cases in chat." };
    }

    // A staged-but-unflushed proof note has no case_id of its own (see hydrateChatFromJusticeCaseRow
    // guards elsewhere) — switching to a different case out from under it would silently attach it
    // to that case's evidence once the consumer next saves. Block the switch instead.
    if (readStagedProofNotes().length > 0) {
      return { ok: false, assistantText: CHAT_CASE_SWITCH_STAGED_PROOF_NOTE_MESSAGE };
    }

    try {
      // Offer is identity/order only — never trust stored active/archived status.
      let offerEntries = readChatCaseSelectionOffer();
      if (offerEntries.length === 0) {
        const { activeRows, archivedRows } = await fetchJusticeCasesForChatSelection();
        offerEntries = buildChatCaseSelectionList({ activeRows, archivedRows });
        writeChatCaseSelectionOffer(offerEntries);
      }

      const resolved = resolveChatCaseSelectionChoice(query, offerEntries);
      if (resolved.kind === "ambiguous") {
        return { ok: false, assistantText: buildChatCaseSelectionAmbiguousMatchResponse() };
      }
      if (resolved.kind === "none") {
        return { ok: false, assistantText: buildChatCaseSelectionNotFoundResponse() };
      }

      const entry: ChatCaseSelectionListEntry = resolved.entry;

      const { activeRows, archivedRows } = await fetchJusticeCasesForChatSelection();
      const liveStatus = resolveChatCaseSelectionLiveStatus({
        caseId: entry.id,
        activeRows,
        archivedRows,
      });
      if (!liveStatus) {
        clearChatCaseSelectionOffer();
        return { ok: false, assistantText: buildChatCaseSelectionNotFoundResponse() };
      }

      const activeCaseId =
        typeof window !== "undefined" ? sessionStorage.getItem(STORAGE_CASE_ID)?.trim() ?? "" : "";
      if (activeCaseId === entry.id && liveStatus === "active") {
        clearChatCaseSelectionOffer();
        return {
          ok: true,
          assistantText: buildChatCaseSelectionOpenedResponse({
            companyName: entry.companyName,
            alreadyActive: true,
          }),
        };
      }

      let restoredFromArchive = false;
      if (liveStatus === "archived") {
        const restored = await restoreArchivedJusticeCaseOnServer(entry.id);
        if (!restored) {
          return {
            ok: false,
            assistantText:
              "I couldn't restore that archived case right now. Try again in a moment.",
          };
        }
        restoredFromArchive = true;
      }

      const freshCase = await fetchJusticeCaseById(entry.id);
      if (!freshCase) {
        return {
          ok: false,
          assistantText: "I couldn't load that case right now. Try again in a moment.",
        };
      }

      const hydrated = await hydrateChatFromJusticeCaseRow(freshCase);
      if (!hydrated.ok) {
        return {
          ok: false,
          assistantText: "I couldn't open that case in chat right now. Try again in a moment.",
        };
      }

      clearChatCaseSelectionOffer();
      return {
        ok: true,
        assistantText: buildChatCaseSelectionOpenedResponse({
          companyName: hydrated.companyName || entry.companyName,
          restoredFromArchive,
        }),
      };
    } catch (e) {
      console.warn("justice chat-ai: select case from chat error", e);
      return {
        ok: false,
        assistantText: "I couldn't switch cases right now. Try again in a moment.",
      };
    }
  }

  function resetChatPostClosureUiState() {
    setIsUpdatingExistingCase(false);
    setApprovedNextAction(undefined);
    approvedNextActionRef.current = undefined;
    setPreparedPacketApproved(false);
    setApprovePreparedPacketChecked(false);
    setSavedEvidenceCount(null);
    setSavedFilings([]);
    setSavedTasks([]);
    setChatHandlingReadinessLoading(false);
    setSavedEvidenceRows([]);
    setRecentEvidenceRows([]);
    setEditingRecentEvidenceId(null);
    setRecentEvidenceEditError(null);
    setRecentEvidenceEditSuccess(null);
    setDeletingRecentEvidenceId(null);
    setRecentEvidenceDeleteError(null);
    setRecentEvidenceDeleteSuccess(null);
    setSubmissionDraftReviewOverride(false);
    setSubmissionDraftReviewChecked(false);
    setSubmissionDraftReviewError(null);
    setDraftPreviewExpanded(false);
    setPacketPreviewExpanded(false);
    setPrepMessageExpanded(false);
    setPrepCopyHint(null);
    setFtcPracticeConfirmed(false);
    setFtcPracticeRunning(false);
    setFtcPracticeSuccess(false);
    setFtcPracticeStorageSkipped(false);
    setFtcPracticeError(null);
    setFtcPracticeLastAssistedSubmissionAttempt(null);
    setArchiveCaseError(null);
    setStagedProofNotes(stagedProofNotesAfterStartNewCaseReset(stagedProofNotes));
    setStagedProofFlushError(null);
    setShowProofKeywordNudge(false);
    setProofNoteDetailsOpen(false);
    setProofNoteTitle("");
    setProofNoteEvidenceDate("");
    setProofNoteDescription("");
    setProofNoteError(null);
    setProofNoteSuccess(null);
    setChatAiDraftText(null);
    setChatAiDraftError(null);
    const emptyParts = defaultBuildJusticeIntakeParts();
    sessionBaselinePartsRef.current = cloneBuildJusticeIntakeParts(emptyParts);
    sessionBaselineEvidenceCountRef.current = null;
    setParts(emptyParts);
    setMerchantContactOperatorFallbackChosen(false);
    // Cancel any in-flight payment-confirmation polling from a prior case so it can't write state.
    paymentConfirmationGenerationRef.current += 1;
    legalConsentTrackedCaseIdRef.current = null;
    merchantContactAutopilotCaseRef.current = null;
    wasPendingHumanFulfillmentEscalationRef.current = false;
    ownedFulfillmentSnapshotRef.current = null;
    caseArchivedAtRef.current = null;
    proofKeywordNudgeOfferedRef.current = false;
    evidenceUploadProgressTurnIdRef.current = null;
    paymentDisputeFormHydratedForCaseRef.current = null;
  }

  async function handleApprovePreparedPacketFromChat(options?: {
    fromChatConsent?: boolean;
  }): Promise<boolean> {
    logPlaywrightApprovePacketDiagnostic(
      "handler:entry",
      typeof window !== "undefined" ? sessionStorage.getItem(STORAGE_CASE_ID)?.trim() ?? "" : "",
      {
        fromChatConsent: options?.fromChatConsent === true,
        approvePreparedPacketChecked,
        isLoaded,
        isSignedIn: Boolean(isSignedIn),
      }
    );
    if ((!approvePreparedPacketChecked && !options?.fromChatConsent) || !isLoaded || !isSignedIn) {
      return false;
    }
    const caseId =
      typeof window !== "undefined" ? sessionStorage.getItem(STORAGE_CASE_ID)?.trim() ?? "" : "";
    if (!caseId || !isUuid(caseId)) return false;

    // Immediate reentrancy guard — a ref (not React state) so it is visible synchronously to a
    // second invocation arriving before the next render, covering both the button click (already
    // disabled while approvingPreparedPacket is true) and the fromChatConsent trigger path (which
    // isn't gated by that button state). This is a client-side UX guard only — the server
    // independently enforces payment on PATCH and Stripe's own idempotency key (below) guarantees
    // at most one payable session server-side regardless of what happens here.
    if (approvingPreparedPacketRef.current) return false;
    approvingPreparedPacketRef.current = true;

    try {
      // Merchant-contact outreach is sent by Surrenderless itself, so it can only be approved once
      // the case has a real recipient email — otherwise the server rejects the approval and, even if
      // it slipped through, automated delivery would silently skip and the action would sit "queued".
      // Enforce this BEFORE payment so the consumer is never charged and then blocked, and persist the
      // recipient to the stored intake now: the approval PATCH below sends only client_state, and both
      // the server gate and the inline delivery read the intake already stored on the case.
      if (approvePreparedTargetNeedsCompanyEmail) {
        const intakeForRecipient = buildJusticeIntakeFromParts(parts);
        const hasRecipient = hasValidMerchantContactRecipient(intakeForRecipient);
        if (!hasRecipient && !merchantContactOperatorFallbackChosen) {
          setTrackingSaveError(MERCHANT_CONTACT_RECIPIENT_REQUIRED_MESSAGE);
          return false;
        }
        setTrackingSaveError(null);
        if (hasRecipient) {
          // Valid email: persist it to the stored intake so both the server gate and the inline
          // delivery (which read the intake already stored on the case) send automatically.
          try {
            const intakeRes = await fetch(`/api/justice/cases/${encodeURIComponent(caseId)}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ intake: intakeForRecipient }),
            });
            if (!intakeRes.ok) {
              setTrackingSaveError("Could not save the company's contact email. Try again.");
              return false;
            }
          } catch (e) {
            console.warn("justice chat-ai: save merchant recipient before approve error", e);
            setTrackingSaveError("Could not save the company's contact email. Try again.");
            return false;
          }
        } else {
          // Operator fallback chosen (no email): persist the durable client_state flag now so it
          // survives the Stripe payment redirect and the approval PATCH's server-side gate allows
          // the approval. No automated email will be attempted — operators handle outreach.
          const flagSaved = await persistMerchantContactOperatorFallbackFlag(caseId);
          if (!flagSaved) {
            setTrackingSaveError("Could not save your choice. Try again.");
            return false;
          }
        }
      }

      // One-time payment gate: the server independently enforces this on PATCH regardless of what
      // happens here — this is purely the consumer-facing redirect to Stripe. casePaidAtRef is
      // read-only client state populated from the server's own paid_at; never treated as proof by
      // itself, only used to decide whether to send the consumer to checkout first.
      if (!casePaidAtRef.current) {
        // A completed payment is still being confirmed by the webhook — never start a SECOND
        // checkout. Keep waiting on the persistent confirmation state (covers the fromChatConsent
        // path too, which isn't gated by the disabled button).
        if (isCheckoutAwaitingPaymentConfirmation(checkoutPriceState)) {
          setTrackingSaveError(
            "We're still confirming your payment — no need to pay again. This will continue automatically."
          );
          return false;
        }
        // Never trigger checkout without a confirmed, disclosed price — covers the
        // fromChatConsent trigger path too, which isn't gated by the Approve button's disabled
        // state. The price/disclosure must already be visible before this can ever be reached
        // from the button; this is the same rule enforced for the chat-consent path.
        if (isCheckoutApprovalBlockedByPricing(checkoutPriceState)) {
          setTrackingSaveError("Pricing is not available yet. Try again in a moment.");
          return false;
        }
        setApprovingPreparedPacket(true);
        setTrackingSaveError(null);
        try {
          const res = await fetch(`/api/justice/cases/${encodeURIComponent(caseId)}/checkout`, {
            method: "POST",
          });
          const payload = (await res.json().catch(() => null)) as {
            url?: string;
            alreadyPaid?: boolean;
            error?: string;
          } | null;
          if (!res.ok || !payload) {
            setTrackingSaveError(payload?.error ?? "Could not start payment. Try again.");
            return false;
          }
          if (payload.alreadyPaid) {
            // Paid via another tab/session since our last refresh — sync the ref and let the
            // consumer retry the same click rather than silently proceeding on a stale read.
            casePaidAtRef.current = new Date().toISOString();
            setCheckoutPriceState({ status: "not_needed" });
            setTrackingSaveError("Payment already confirmed — click Approve again to continue.");
            return false;
          }
          if (!payload.url) {
            setTrackingSaveError("Could not start payment. Try again.");
            return false;
          }
          window.location.href = payload.url;
          return false;
        } catch (e) {
          console.warn("justice chat-ai: checkout start error", e);
          setTrackingSaveError("Could not start payment. Try again.");
          return false;
        } finally {
          setApprovingPreparedPacket(false);
        }
      }

      const intake = buildJusticeIntakeFromParts(parts);
      const manualFtc =
        typeof window !== "undefined" && sessionStorage.getItem(STORAGE_FTC_MANUAL_UNLOCK) === "1";
      const contacted = intake.already_contacted === "yes";
      const cfpbRel = cfpbLikelyRelevant(intake);
      const fccRel = fccLikelyRelevant(intake);
      const dotRel = dotLikelyRelevant(intake);
      const useCompanyContactLabels = cfpbRel || fccRel || dotRel;
      const destinations = computeJusticeDestinations(intake, {
        manualFtc,
        useCompanyContactLabels,
        hasUploadedEvidenceFile: savedEvidenceRows.some(justiceEvidenceRowHasUploadedFile),
      });
      const prepared = pickPreparedNextAction({ contacted, useCompanyContactLabels, destinations });
      const nextActionTarget = buildApprovedNextActionTarget(prepared);
      const withTracking = mergeApprovedNextActionTrackingFields(
        approvedNextAction,
        nextActionTarget
      );

      // Persist first — never commit optimistic approved session/UI state before PATCH succeeds.
      setApprovingPreparedPacket(true);
      setTrackingSaveError(null);
      try {
        logPlaywrightApprovePacketDiagnostic("handler:before-persist", caseId, {
          fromChatConsent: options?.fromChatConsent === true,
          approvePreparedPacketChecked,
          nextActionHref: withTracking.href,
          contacted,
        });
        const result = await persistPreparedPacketApprovalToCase({
          caseId,
          nextAction: withTracking,
          logLabel: "justice chat-ai",
        });
        if (!result.ok) {
          console.warn(
            "justice chat-ai: prepared packet approve failed",
            result.retryableOwnedFilingEnsure ? "owned-filing ensure" : result.error
          );
          setTrackingSaveError(
            result.retryableOwnedFilingEnsure
              ? OWNED_FILING_TASK_ENSURE_RETRYABLE_ERROR
              : CHAT_TRACKING_SAVE_ERROR_MESSAGE
          );
          return false;
        }

        const hydrated =
          hydrateApprovedNextActionForDisplay(caseId, result.clientState) ?? withTracking;
        writePreparedPacketApproved(caseId);
        writeSessionApprovedNextAction(caseId, hydrated);
        setPreparedPacketApproved(
          parseJusticeCaseClientState(result.clientState).prepared_packet_approved === true
        );
        setApprovedNextAction(hydrated);
        setApprovePreparedPacketChecked(false);
        setTrackingSaveError(null);
        return true;
      } catch (e) {
        console.warn("justice chat-ai: prepared packet approve error", e);
        setTrackingSaveError(CHAT_TRACKING_SAVE_ERROR_MESSAGE);
        return false;
      } finally {
        setApprovingPreparedPacket(false);
      }
    } finally {
      approvingPreparedPacketRef.current = false;
    }
  }

  /**
   * Durably records the consumer's "I have no merchant email — operators will handle it" choice on
   * the case's client_state (merged, preserving existing fields). Returns false on failure so the
   * caller can surface an error rather than proceeding on an unsaved choice.
   */
  async function persistMerchantContactOperatorFallbackFlag(caseId: string): Promise<boolean> {
    if (!caseId || !isUuid(caseId) || !isLoaded || !isSignedIn) return false;
    try {
      const getRes = await fetch(`/api/justice/cases/${encodeURIComponent(caseId)}`);
      if (!getRes.ok) return false;
      const existing = (await getRes.json()) as { client_state?: unknown };
      const merged = {
        ...parseJusticeCaseClientState(existing.client_state),
        merchant_contact_operator_fallback: true,
      };
      const patchRes = await fetch(`/api/justice/cases/${encodeURIComponent(caseId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_state: merged }),
      });
      return patchRes.ok;
    } catch (e) {
      console.warn("justice chat-ai: persist merchant operator fallback error", e);
      return false;
    }
  }

  /**
   * Consumer chose operator fallback (no merchant email). Optimistically reflects the choice so the
   * approve gate unblocks immediately, persists it durably, and refreshes so the operator-handling
   * status replaces any "queued"/needs-recipient copy. Never falsely shows automated delivery.
   */
  async function handleChooseMerchantContactOperatorFallback(): Promise<void> {
    setMerchantContactOperatorFallbackChosen(true);
    setTrackingSaveError(null);
    const caseId =
      activeUuidCaseId ||
      (typeof window !== "undefined" ? sessionStorage.getItem(STORAGE_CASE_ID)?.trim() ?? "" : "");
    if (!caseId || !isUuid(caseId)) return;
    setAddingMerchantContactRecipient(true);
    try {
      const saved = await persistMerchantContactOperatorFallbackFlag(caseId);
      if (!saved) {
        setTrackingSaveError("Could not save your choice. Try again.");
        return;
      }
      requestSavedEvidencePreviewRefresh();
    } finally {
      setAddingMerchantContactRecipient(false);
    }
  }

  /**
   * Recovery path for an already-approved merchant-contact case that has no recipient on file (its
   * outreach is stuck showing "queued" because automated delivery skipped). Saves the newly supplied
   * company email to the case intake, then re-sends the SAME approved next action so the PATCH route
   * re-runs inline delivery — this is not a first approval transition, so the payment and recipient
   * gates pass straight through and delivery now finds the recipient.
   */
  async function handleAddMerchantContactRecipientAndRetry(): Promise<void> {
    const caseId = activeUuidCaseId;
    if (!caseId || !isUuid(caseId) || !isLoaded || !isSignedIn) return;
    const intake = buildJusticeIntakeFromParts(parts);
    if (!hasValidMerchantContactRecipient(intake) || !approvedNextAction) {
      setTrackingSaveError(MERCHANT_CONTACT_RECIPIENT_REQUIRED_MESSAGE);
      return;
    }
    setAddingMerchantContactRecipient(true);
    setTrackingSaveError(null);
    try {
      const intakeRes = await fetch(`/api/justice/cases/${encodeURIComponent(caseId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intake }),
      });
      if (!intakeRes.ok) {
        setTrackingSaveError("Could not save the company's contact email. Try again.");
        return;
      }
      // The recipient is now persisted, so advance the session baseline that drives the
      // needs-recipient prompt's visibility — it no longer reflects a missing recipient.
      sessionBaselinePartsRef.current = cloneBuildJusticeIntakeParts(parts);
      const getRes = await fetch(`/api/justice/cases/${encodeURIComponent(caseId)}`);
      if (!getRes.ok) {
        setTrackingSaveError(CHAT_TRACKING_SAVE_ERROR_MESSAGE);
        return;
      }
      const existing = (await getRes.json()) as { client_state?: unknown };
      const merged = mergeClientStateWithApprovedNextAction(existing.client_state, approvedNextAction);
      const patchRes = await fetch(`/api/justice/cases/${encodeURIComponent(caseId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_state: merged }),
      });
      if (!patchRes.ok) {
        setTrackingSaveError(CHAT_TRACKING_SAVE_ERROR_MESSAGE);
        return;
      }
      requestSavedEvidencePreviewRefresh();
    } catch (e) {
      console.warn("justice chat-ai: add merchant recipient retry error", e);
      setTrackingSaveError(CHAT_TRACKING_SAVE_ERROR_MESSAGE);
    } finally {
      setAddingMerchantContactRecipient(false);
    }
  }

  async function persistMerchantContactDocumentationFromChat(
    input: MerchantContactDocumentationInput
  ): Promise<
    | { ok: true; updatedIntake: JusticeIntake }
    | { ok: false; contactDateError?: string; contactProofError?: string }
  > {
    if (!isLoaded) return { ok: false };
    const caseId =
      typeof window !== "undefined" ? sessionStorage.getItem(STORAGE_CASE_ID)?.trim() ?? "" : "";
    const intake = buildJusticeIntakeFromParts(parts);
    const hasUploadedEvidenceFileNow = savedEvidenceRows.some(justiceEvidenceRowHasUploadedFile);
    const result = await documentMerchantContact({
      intake,
      input,
      caseId: caseId || null,
      isLoaded,
      isSignedIn: Boolean(isSignedIn),
      logLabel: "justice chat-ai",
      hasUploadedEvidenceFile: hasUploadedEvidenceFileNow,
    });
    if (!result.ok) {
      return result;
    }

    const hydratedParts = justiceIntakeToBuildJusticeIntakeParts(result.updatedIntake);
    setParts(hydratedParts);
    sessionBaselinePartsRef.current = cloneBuildJusticeIntakeParts(hydratedParts);

    const manualFtc =
      typeof window !== "undefined" && sessionStorage.getItem(STORAGE_FTC_MANUAL_UNLOCK) === "1";
    const nextAction = recomputeApprovedNextActionAfterIntake(result.updatedIntake, {
      existing: approvedNextAction,
      manualFtc,
      hasUploadedEvidenceFile: hasUploadedEvidenceFileNow,
    });
    setApprovedNextAction(nextAction);
    if (caseId) {
      writeSessionApprovedNextAction(caseId, nextAction);
    }

    if (isLoaded && isSignedIn && caseId && isUuid(caseId)) {
      try {
        const getRes = await fetch(`/api/justice/cases/${encodeURIComponent(caseId)}`);
        if (!getRes.ok) {
          console.warn("justice chat-ai: GET before contact doc next action failed", getRes.status);
          return { ok: true, updatedIntake: result.updatedIntake };
        }
        const existing = (await getRes.json()) as { client_state?: unknown };
        const merged = mergeClientStateWithApprovedNextAction(existing.client_state, nextAction);
        if (isPlaywrightMockIntakeCaseHydrationCaseId(caseId)) {
          console.log(
            "[e2e-merge-diag:merchant-contact-doc]",
            JSON.stringify({
              site: "merchant-contact-doc",
              existingClientState: existing.client_state,
              merged,
              time: Date.now(),
            })
          );
        }
        const patchRes = await fetch(`/api/justice/cases/${encodeURIComponent(caseId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ client_state: merged }),
        });
        if (!patchRes.ok) {
          console.warn("justice chat-ai: PATCH contact doc next action failed", patchRes.status);
        }
      } catch (err) {
        console.warn("justice chat-ai: contact doc next action error", err);
      }
    }

    return { ok: true, updatedIntake: result.updatedIntake };
  }

  async function handleSaveMerchantContactDocumentationFromChat(e: FormEvent) {
    e.preventDefault();
    setSavingMerchantContactDocumentation(true);
    setMerchantDocContactDateError(null);
    setMerchantDocContactProofError(null);
    try {
      const result = await persistMerchantContactDocumentationFromChat({
        contactMethod: merchantDocContactMethod,
        contactDate: merchantDocContactDate,
        merchantResponseType: merchantDocMerchantResponseType,
        contactProofType: merchantDocContactProofType,
        contactProofText: merchantDocContactProofText,
      });
      if (!result.ok) {
        setMerchantDocContactDateError(result.contactDateError ?? null);
        setMerchantDocContactProofError(result.contactProofError ?? null);
      }
    } finally {
      setSavingMerchantContactDocumentation(false);
    }
  }

  async function handleConfirmMerchantContactFromChat() {
    const captured = buildMerchantContactDocumentationInputFromIntakeParts(parts);
    if (!captured) return;
    setSavingMerchantContactDocumentation(true);
    try {
      await persistMerchantContactDocumentationFromChat(captured);
    } finally {
      setSavingMerchantContactDocumentation(false);
    }
  }

  useEffect(() => {
    if (!isUpdatingExistingCase || !isLoaded || !isSignedIn) return;
    const caseId =
      typeof window !== "undefined" ? sessionStorage.getItem(STORAGE_CASE_ID)?.trim() ?? "" : "";
    if (!caseId || !isUuid(caseId)) return;
    if (merchantContactAutopilotCaseRef.current === caseId) return;

    const timeline = readTimeline(caseId);
    if (
      !shouldAutopilotMerchantContactDocumentation({
        preparedPacketApproved,
        handlingRequested: Boolean(approvedNextAction?.handling_requested_at?.trim()),
        timeline,
        parts,
      })
    ) {
      return;
    }

    const captured = buildMerchantContactDocumentationInputFromIntakeParts(parts);
    if (!captured) return;

    merchantContactAutopilotCaseRef.current = caseId;
    void persistMerchantContactDocumentationFromChat(captured).then((result) => {
      if (!result.ok) {
        merchantContactAutopilotCaseRef.current = null;
      }
    });
  }, [
    isUpdatingExistingCase,
    isLoaded,
    isSignedIn,
    preparedPacketApproved,
    approvedNextAction?.handling_requested_at,
    parts,
  ]);

  async function handleSavePaymentDisputeChecklistFromChat(e: FormEvent) {
    e.preventDefault();
    if (!isLoaded) return;
    const caseId =
      typeof window !== "undefined" ? sessionStorage.getItem(STORAGE_CASE_ID)?.trim() ?? "" : "";
    if (!caseId) return;

    const draft = buildPaymentDisputeDraftFromFields(caseId, {
      paymentMethod: paymentDisputePaymentMethod,
      chargeDate: paymentDisputeChargeDate,
      chargeAmount: paymentDisputeChargeAmount,
      merchantName: paymentDisputeMerchantName,
      disputeReason: paymentDisputeReason,
      disputeReasonOther: paymentDisputeReasonOther,
      priorContact: paymentDisputePriorContact,
      proofType: paymentDisputeProofType,
    });

    setSavingPaymentDisputeChecklist(true);
    setPaymentDisputeSaveSuccess(null);
    try {
      await preparePaymentDisputeChecklist({
        draft,
        caseId,
        isLoaded,
        isSignedIn: Boolean(isSignedIn),
        logLabel: "justice chat-ai",
      });
      setPaymentDisputeSaveSuccess("Checklist saved on your case timeline.");

      // After checklist save, open the payment-dispute step so inline filing capture
      // is available without a separate "Mark step opened" detour.
      if (
        approvedNextAction?.href?.trim() === CHAT_INLINE_PAYMENT_DISPUTE_PREP_HREF &&
        approvedNextAction.status === "approved"
      ) {
        const label = approvedNextAction.label?.trim();
        const next: JusticeApprovedNextAction = {
          ...approvedNextAction,
          ...(label ? { label } : {}),
          href: approvedNextAction.href,
          status: "started",
          started_at: approvedNextAction.started_at ?? new Date().toISOString(),
          ...(approvedNextAction.approved_at
            ? { approved_at: approvedNextAction.approved_at }
            : {}),
        };
        const withTracking = mergeApprovedNextActionTrackingFields(approvedNextAction, next);
        const local = omitClearedHandlingRequestNoteFromApprovedNextAction(withTracking);
        setApprovedNextAction(local);
        writeSessionApprovedNextAction(caseId, local);
        if (isLoaded && isSignedIn && isUuid(caseId)) {
          try {
            const getRes = await fetch(`/api/justice/cases/${encodeURIComponent(caseId)}`);
            if (getRes.ok) {
              const existing = (await getRes.json()) as { client_state?: unknown };
              const merged = mergeClientStateWithApprovedNextAction(existing.client_state, withTracking);
              const patchRes = await fetch(`/api/justice/cases/${encodeURIComponent(caseId)}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ client_state: merged }),
              });
              if (patchRes.ok) {
                applyServerTimelineFromResponse(caseId, await patchRes.json());
              }
            }
          } catch (err) {
            console.warn("justice chat-ai: payment dispute auto-open error", err);
          }
        }
      }
    } finally {
      setSavingPaymentDisputeChecklist(false);
    }
  }

  async function handleRunFtcPracticeFromChat(options?: { fromChatConsent?: boolean }): Promise<boolean> {
    if (!ftcPracticeConfirmed && !options?.fromChatConsent) return false;
    const caseId = activeUuidCaseId;
    const assistedPracticePrepInput = {
      isUpdatingExistingCase,
      caseId,
      isLoaded,
      isSignedIn: Boolean(isSignedIn),
      preparedPacketApproved,
      approvedNextAction,
    };
    if (
      (!shouldShowChatInlineFtcMockPracticePrep(assistedPracticePrepInput) &&
        !shouldShowChatInlineBbbMockPracticePrep(assistedPracticePrepInput) &&
        !shouldShowChatInlineRealBbbComplaintPrep(assistedPracticePrepInput)) ||
      !approvedNextAction
    ) {
      return false;
    }

    const assistedLaneId = resolveAssistedPracticeSubmissionLaneId(approvedNextAction.href);
    if (
      assistedLaneId !== "ftc_practice" &&
      assistedLaneId !== "bbb_practice" &&
      assistedLaneId !== "bbb_complaint"
    ) {
      return false;
    }

    const isRealBbbComplaint = assistedLaneId === "bbb_complaint";

    setFtcPracticeRunning(true);
    setFtcPracticeError(null);
    setFtcPracticeSuccess(false);
    setFtcPracticeStorageSkipped(false);
    setFtcPracticeLastAssistedSubmissionAttempt(null);
    try {
      const submissionParams = {
        intake: buildJusticeIntakeFromParts(parts),
        caseId,
        isLoaded,
        isSignedIn: Boolean(isSignedIn),
        preparedPacketApproved,
        approvedNextAction,
        hasUploadedEvidenceFile,
        logLabel: "justice chat-ai",
        onApprovedNextActionPromoted: (local: JusticeApprovedNextAction) => {
          setApprovedNextAction(local);
          if (caseId) writeSessionApprovedNextAction(caseId, local);
        },
        onApprovedNextActionCompleted: (local: JusticeApprovedNextAction) => {
          setApprovedNextAction(local);
          if (caseId) writeSessionApprovedNextAction(caseId, local);
        },
        onAssistedSubmissionRecorded: requestSavedEvidencePreviewRefresh,
      };
      const result =
        assistedLaneId === "bbb_complaint"
          ? await executeAssistedRealBbbComplaintSubmission(submissionParams)
          : assistedLaneId === "bbb_practice"
            ? await executeAssistedBbbPracticeSubmission(submissionParams)
            : await executeAssistedFtcPracticeSubmission(submissionParams);
      let ftcSnapshotFallback: LastAssistedSubmissionAttemptSnapshot | null = null;
      if (!result.ok) {
        setFtcPracticeError(result.error);
        if (result.lastAssistedSubmissionAttempt) {
          setFtcPracticeLastAssistedSubmissionAttempt(result.lastAssistedSubmissionAttempt);
          ftcSnapshotFallback = result.lastAssistedSubmissionAttempt;
        }
        return false;
      } else if (!result.assistedSubmissionRecorded) {
        const snapshotError = result.lastAssistedSubmissionAttempt?.error?.trim();
        setFtcPracticeError(
          snapshotError
            ? isRealBbbComplaint
              ? `BBB autofill completed, but assisted filing recording failed: ${snapshotError}. You can retry when ready.`
              : `Practice completed, but assisted filing recording failed: ${snapshotError}. You can retry when ready.`
            : isRealBbbComplaint
              ? "BBB autofill completed, but assisted filing recording failed. You can retry when ready."
              : "Practice completed, but assisted filing recording failed. You can retry when ready."
        );
        if (result.lastAssistedSubmissionAttempt) {
          setFtcPracticeLastAssistedSubmissionAttempt(result.lastAssistedSubmissionAttempt);
          ftcSnapshotFallback = result.lastAssistedSubmissionAttempt;
        }
        return false;
      } else {
        if (result.approvedNextActionForSubmission) {
          setApprovedNextAction(result.approvedNextActionForSubmission);
          if (caseId) writeSessionApprovedNextAction(caseId, result.approvedNextActionForSubmission);
        }
        if (result.lastAssistedSubmissionAttempt) {
          setFtcPracticeLastAssistedSubmissionAttempt(result.lastAssistedSubmissionAttempt);
          ftcSnapshotFallback = result.lastAssistedSubmissionAttempt;
        }
        setFtcPracticeSuccess(true);
        setFtcPracticeStorageSkipped(result.storageSkipped);
        if (caseId) clearChatBbbAccuracyConsented(caseId);
      }
      if (result.ok || ftcSnapshotFallback) {
        await refreshFullChatCaseContextFromServer(caseId, { ftcSnapshotFallback });
      }
      return result.ok && result.assistedSubmissionRecorded;
    } finally {
      setFtcPracticeRunning(false);
    }
  }

  async function handleRequestSurrenderlessHandling(_note?: string) {
    // Consumer DIY request-handling retired on chat-ai (fail-closed).
    return;
  }

  async function handleUpdateHandlingRequestNote(note?: string) {
    if (!approvedNextAction?.handling_requested_at?.trim()) return;

    const withNoteUpdate = applyHandlingRequestNoteToApprovedNextAction(
      approvedNextAction,
      note ?? ""
    );
    const withTracking = mergeApprovedNextActionTrackingFields(approvedNextAction, withNoteUpdate);
    const next = omitClearedHandlingRequestNoteFromApprovedNextAction(withTracking);
    setApprovedNextAction(next);

    const caseId =
      typeof window !== "undefined" ? sessionStorage.getItem(STORAGE_CASE_ID)?.trim() ?? "" : "";

    if (caseId) {
      writeSessionApprovedNextAction(caseId, next);
    }

    if (!isLoaded || !isSignedIn || !caseId || !isUuid(caseId)) return;

    setUpdatingHandlingNote(true);
    setTrackingSaveError(null);
    try {
      const getRes = await fetch(`/api/justice/cases/${encodeURIComponent(caseId)}`);
      if (!getRes.ok) {
        console.warn("justice chat-ai: GET before handling note update failed", getRes.status);
        setTrackingSaveError(CHAT_TRACKING_SAVE_ERROR_MESSAGE);
        return;
      }
      const existing = (await getRes.json()) as { client_state?: unknown };
      const merged = mergeClientStateWithApprovedNextAction(existing.client_state, withTracking);
      const patchRes = await fetch(`/api/justice/cases/${encodeURIComponent(caseId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_state: merged }),
      });
      if (!patchRes.ok) {
        console.warn("justice chat-ai: PATCH handling note update failed", patchRes.status);
        setTrackingSaveError(CHAT_TRACKING_SAVE_ERROR_MESSAGE);
        return;
      }
      setTrackingSaveError(null);
    } catch (e) {
      console.warn("justice chat-ai: handling note update error", e);
      setTrackingSaveError(CHAT_TRACKING_SAVE_ERROR_MESSAGE);
    } finally {
      setUpdatingHandlingNote(false);
    }
  }

  async function handleAcknowledgeHandlingRequest() {
    if (!approvedNextAction?.handling_requested_at?.trim()) return;
    if (approvedNextAction.handling_acknowledged_at?.trim()) return;

    const acknowledged = acknowledgeHandlingRequestInApprovedNextAction(approvedNextAction);
    const withTracking = mergeApprovedNextActionTrackingFields(approvedNextAction, acknowledged);
    const local = omitClearedHandlingRequestNoteFromApprovedNextAction(withTracking);
    setApprovedNextAction(local);

    const caseId =
      typeof window !== "undefined" ? sessionStorage.getItem(STORAGE_CASE_ID)?.trim() ?? "" : "";

    if (caseId) {
      writeSessionApprovedNextAction(caseId, local);
    }

    if (!isLoaded || !isSignedIn || !caseId || !isUuid(caseId)) return;

    setAcknowledgingHandling(true);
    setTrackingSaveError(null);
    try {
      const getRes = await fetch(`/api/justice/cases/${encodeURIComponent(caseId)}`);
      if (!getRes.ok) {
        console.warn("justice chat-ai: GET before acknowledge handling failed", getRes.status);
        setTrackingSaveError(CHAT_TRACKING_SAVE_ERROR_MESSAGE);
        return;
      }
      const existing = (await getRes.json()) as { client_state?: unknown };
      const merged = mergeClientStateWithAcknowledgedHandling(existing.client_state, acknowledged);
      const patchRes = await fetch(`/api/justice/cases/${encodeURIComponent(caseId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_state: merged }),
      });
      if (!patchRes.ok) {
        console.warn("justice chat-ai: PATCH acknowledge handling failed", patchRes.status);
        setTrackingSaveError(CHAT_TRACKING_SAVE_ERROR_MESSAGE);
        return;
      }
      const data = (await patchRes.json()) as { client_state?: unknown; timeline?: unknown };
      if (data.client_state !== undefined) {
        const hydrated = hydrateApprovedNextActionForDisplay(caseId, data.client_state) ?? local;
        writeSessionApprovedNextAction(caseId, hydrated);
        setApprovedNextAction(hydrated);
      }
      applyServerTimelineFromResponse(caseId, data);
      requestSavedEvidencePreviewRefresh();
      setTrackingSaveError(null);
    } catch (e) {
      console.warn("justice chat-ai: acknowledge handling error", e);
      setTrackingSaveError(CHAT_TRACKING_SAVE_ERROR_MESSAGE);
    } finally {
      setAcknowledgingHandling(false);
    }
  }

  async function handleMarkApprovedNextActionHandled() {
    // Consumer DIY Record action handled retired on chat-ai (fail-closed).
    return;
  }

  async function handleApprovedNextActionOpen() {
    // Consumer DIY Mark step opened retired on chat-ai (fail-closed).
    if (!approvedNextAction) return;
    if (approvedNextAction.status === "completed") {
      const caseId =
        typeof window !== "undefined" ? sessionStorage.getItem(STORAGE_CASE_ID)?.trim() ?? "" : "";
      const shouldStayInChat =
        isLoaded &&
        shouldKeepSignedInChatAiActiveCaseInChat({
          isSignedIn: Boolean(isSignedIn),
          caseId,
          isUpdatingExistingCase,
        }) &&
        Boolean(caseId) &&
        isUuid(caseId);
      const blockOffChatNavigation = shouldBlockChatAiOffChatNavigation({
        isSignedIn: Boolean(isSignedIn),
        isUpdatingExistingCase,
        isLoaded,
        caseId,
        targetHref: approvedNextAction.href?.trim() || "/justice/packet",
      });
      if (shouldStayInChat || blockOffChatNavigation) {
        scrollChatAiInlineElementWithHydrationWait(CHAT_AI_APPROVED_ACTION_TRACKING_ELEMENT_ID);
      }
    }
  }

  async function clearApprovedNextActionFollowUp(): Promise<boolean> {
    if (!approvedNextAction || approvedNextAction.follow_up_needed !== true) return false;

    const previousApprovedNextAction = approvedNextAction;
    const cleared = clearFollowUpFromApprovedNextAction(approvedNextAction);
    const withTracking = mergeApprovedNextActionTrackingFields(approvedNextAction, cleared);
    const local = omitClearedHandlingRequestNoteFromApprovedNextAction(withTracking);
    setApprovedNextAction(local);
    approvedNextActionRef.current = local;

    const caseId =
      typeof window !== "undefined" ? sessionStorage.getItem(STORAGE_CASE_ID)?.trim() ?? "" : "";

    if (caseId) {
      writeSessionApprovedNextAction(caseId, local);
    }

    if (!isLoaded || !isSignedIn || !caseId || !isUuid(caseId)) return true;

    function revertClearFollowUpOptimistic() {
      setApprovedNextAction(previousApprovedNextAction);
      if (caseId) {
        writeSessionApprovedNextAction(caseId, previousApprovedNextAction);
      }
    }

    setClearingFollowUp(true);
    setTrackingSaveError(null);
    try {
      const getRes = await fetch(`/api/justice/cases/${encodeURIComponent(caseId)}`);
      if (!getRes.ok) {
        console.warn("justice chat-ai: GET before clear follow-up failed", getRes.status);
        revertClearFollowUpOptimistic();
        setTrackingSaveError(CHAT_TRACKING_SAVE_ERROR_MESSAGE);
        return false;
      }
      const existing = (await getRes.json()) as { client_state?: unknown };
      const merged = mergeClientStateWithClearedFollowUp(existing.client_state, withTracking);
      const patchRes = await fetch(`/api/justice/cases/${encodeURIComponent(caseId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_state: merged }),
      });
      if (!patchRes.ok) {
        console.warn("justice chat-ai: PATCH clear follow-up failed", patchRes.status);
        revertClearFollowUpOptimistic();
        setTrackingSaveError(CHAT_TRACKING_SAVE_ERROR_MESSAGE);
        return false;
      }
      const data = (await patchRes.json()) as { timeline?: unknown };
      applyServerTimelineFromResponse(caseId, data);
      requestSavedEvidencePreviewRefresh();
      setTrackingSaveError(null);
      return true;
    } catch (e) {
      console.warn("justice chat-ai: clear follow-up error", e);
      revertClearFollowUpOptimistic();
      setTrackingSaveError(CHAT_TRACKING_SAVE_ERROR_MESSAGE);
      return false;
    } finally {
      setClearingFollowUp(false);
    }
  }

  async function handleSaveApprovedNextActionTracking(_draft: {
    outcome_note: string;
    follow_up_needed: boolean;
    follow_up_at: string;
  }) {
    // Consumer DIY outcome / follow-up capture retired on chat-ai (fail-closed).
    return;
  }

  useEffect(() => {
    const intake = readValidLocalJusticeIntake();
    if (intake) {
      const hydrated = justiceIntakeToBuildJusticeIntakeParts(intake);
      sessionBaselinePartsRef.current = cloneBuildJusticeIntakeParts(hydrated);
      setParts(hydrated);
      setIsUpdatingExistingCase(true);
    } else {
      // No committed case yet — restore a pre-commit intake draft (if any) instead. Replaces
      // (never appends to) the initial opening-greeting message, so this cannot duplicate turns.
      const draft = readValidIntakeDraft();
      if (draft) {
        setParts(draft.parts);
        setMessages(draft.messages);
        messagesRef.current = draft.messages;
      }
    }
    setStagedProofNotes(readStagedProofNotes());
  }, []);

  // Signed-in, no local session and no in-progress draft — this is either a first visit or a
  // returning consumer whose sessionStorage expired (e.g. tab closed mid multi-day workflow). Try
  // resuming their most recent case from the server so `handleContinueToPreview` sees
  // `isUpdatingExistingCase = true` and commits an update rather than forking a duplicate case
  // (see commitIntakeToSessionAndServer's create/update mode). Skips entirely when a review-task
  // or checkout-return deep link is present in the URL — those effects own case selection for
  // this mount and must not race with a concurrent "latest case" fetch.
  useEffect(() => {
    if (!isLoaded || typeof window === "undefined") return;
    if (latestCaseHydrationAttemptedRef.current) return;

    // Not yet known whether this consumer is signed in — wait rather than give up, so a visitor
    // who signs in via the in-page modal (JusticeActionResumeSignInPrompt's <SignInButton
    // mode="modal">, no navigation/remount) still gets resumed once isSignedIn settles, instead
    // of the guard being consumed on the earlier signed-out render (same pattern as
    // reviewDeepLinkHandledRef below).
    if (!isSignedIn) return;

    const search = window.location.search;
    if (parseReviewTaskDeepLinkParams(search) || parseCheckoutReturnStatus(search)) {
      latestCaseHydrationAttemptedRef.current = true;
      return;
    }

    // A staged-but-unflushed proof note has no case_id of its own — it's pure sessionStorage,
    // valid regardless of which case is active — so resuming an old case out from under it
    // would attach it to the wrong dispute the moment the consumer clicks Continue. Never
    // start the fetch while one is already staged.
    if (readValidLocalJusticeIntake() || readValidIntakeDraft() || readStagedProofNotes().length > 0) {
      latestCaseHydrationAttemptedRef.current = true;
      return;
    }

    latestCaseHydrationAttemptedRef.current = true;

    let cancelled = false;
    void (async () => {
      try {
        const latest = await fetchLatestActiveJusticeCaseRow();
        if (cancelled || !latest) return;
        // A case may have been committed while this request was in flight — never clobber it.
        if (readValidLocalJusticeIntake()) return;
        // A draft alone isn't a reliable "user started a new conversation" signal: the signed-in
        // reply-email auto-seed above touches `parts` only (never `messages`), but still fires the
        // draft-autosave effect, so a draft can exist from that alone with no real turns in it.
        // Check for an actual non-greeting message instead, so that seed can never masquerade as
        // an in-progress conversation and permanently block resumption.
        const hasRealConversation = messagesRef.current.some(
          (turn) => !isEphemeralChatGreeting(turn.text)
        );
        if (hasRealConversation) return;
        // Same reasoning as the pre-fetch check above — a note staged while this request was in
        // flight must not get silently attached to whatever case the fetch found.
        if (readStagedProofNotes().length > 0) return;
        await hydrateChatFromJusticeCaseRow(latest);
      } catch (e) {
        console.warn("justice chat-ai: latest case hydrate error", e);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isLoaded, isSignedIn]);

  const loadSavedEvidencePreview = useCallback(async (
    signal?: AbortSignal,
    background = false,
    options?: { skipProgressNarration?: boolean }
  ): Promise<{ tasks: JusticeCaseTaskRow[]; filings: JusticeCaseFilingRow[] } | null> => {
    const generation = evidencePreviewFetchGenerationRef.current;
    const caseId =
      typeof window !== "undefined" ? sessionStorage.getItem(STORAGE_CASE_ID)?.trim() ?? "" : "";
    // Gate on session case id (not React isUpdatingExistingCase) so restore/hydrate
    // can load evidence in the same turn as setIsUpdatingExistingCase(true).
    if (!isLoaded || !isSignedIn || !caseId || !isUuid(caseId)) {
      setSavedEvidenceCount(null);
      setSavedFilings([]);
      setSavedTasks([]);
      setChatHandlingReadinessLoading(false);
      setSavedEvidenceRows([]);
      setRecentEvidenceRows([]);
      return null;
    }
    if (!background) {
      setChatHandlingReadinessLoading(true);
    }
    try {
      const [evRes, filRes, taskRes] = await Promise.all([
        fetch(`/api/justice/evidence?case_id=${encodeURIComponent(caseId)}`, { signal }),
        fetch(`/api/justice/filings?case_id=${encodeURIComponent(caseId)}`, { signal }),
        fetch(`/api/justice/tasks?case_id=${encodeURIComponent(caseId)}`, { signal }),
      ]);
      if (generation !== evidencePreviewFetchGenerationRef.current) return null;
      if (signal?.aborted) return null;
      const evJson: unknown = evRes.ok ? await evRes.json() : [];
      const filJson: unknown = filRes.ok ? await filRes.json() : [];
      const taskJson: unknown = taskRes.ok ? await taskRes.json() : [];
      if (generation !== evidencePreviewFetchGenerationRef.current) return null;
      const rows = Array.isArray(evJson) ? (evJson as JusticeCaseEvidenceRow[]) : [];
      const count = rows.length;
      const filings = Array.isArray(filJson) ? (filJson as JusticeCaseFilingRow[]) : [];
      const tasks = Array.isArray(taskJson) ? (taskJson as JusticeCaseTaskRow[]) : [];
      if (sessionBaselineEvidenceCountRef.current === null) {
        sessionBaselineEvidenceCountRef.current = count;
      }
      setSavedEvidenceCount(count);
      setSavedFilings(filings);
      setSavedTasks(tasks);
      setSavedEvidenceRows(rows);
      setRecentEvidenceRows(rows.slice(0, CHAT_RECENT_EVIDENCE_MAX));
      if (!options?.skipProgressNarration) {
        appendChatCaseProgressNarration({
          caseId,
          approvedAction: approvedNextActionRef.current,
          tasks,
          filings,
          archivedAt: caseArchivedAtRef.current,
        });
      }
      return { tasks, filings };
    } catch {
      if (generation !== evidencePreviewFetchGenerationRef.current || signal?.aborted) return null;
      setSavedEvidenceCount(null);
      setSavedFilings([]);
      setSavedTasks([]);
      setSavedEvidenceRows([]);
      setRecentEvidenceRows([]);
      return null;
    } finally {
      if (!background && generation === evidencePreviewFetchGenerationRef.current) {
        setChatHandlingReadinessLoading(false);
      }
    }
  }, [isLoaded, isSignedIn, appendChatCaseProgressNarration]);

  const requestSavedEvidencePreviewRefresh = useCallback(() => {
    evidencePreviewFetchGenerationRef.current += 1;
    void loadSavedEvidencePreview();
  }, [loadSavedEvidencePreview]);

  const refreshChatCaseFromServer = useCallback(
    async (
      caseId: string,
      options?: {
        signal?: AbortSignal;
        ftcSnapshotFallback?: LastAssistedSubmissionAttemptSnapshot | null;
        skipEvidenceRefresh?: boolean;
      }
    ): Promise<JusticeApprovedNextAction | undefined> => {
      if (!caseId || !isUuid(caseId)) return undefined;
      const sessionFallback = hydrateApprovedNextActionForDisplay(caseId);
      let hydrated: JusticeApprovedNextAction | undefined = sessionFallback;
      try {
        const res = await fetch(`/api/justice/cases/${encodeURIComponent(caseId)}`, {
          signal: options?.signal,
        });
        if (!res.ok) return hydrated;
        const data = (await res.json()) as {
          client_state?: unknown;
          timeline?: unknown;
          archived_at?: string | null;
          paid_at?: string | null;
        };
        if (options?.signal?.aborted) return hydrated;
        caseArchivedAtRef.current =
          typeof data.archived_at === "string" && data.archived_at.trim()
            ? data.archived_at.trim()
            : null;
        casePaidAtRef.current =
          typeof data.paid_at === "string" && data.paid_at.trim() ? data.paid_at.trim() : null;
        setMerchantContactOperatorFallbackChosen(
          isMerchantContactOperatorFallbackChosen(data.client_state)
        );
        if (Array.isArray(data.timeline)) {
          const localTimeline = readTimeline(caseId);
          replaceTimelineForCase(
            caseId,
            mergeServerTimelinePreservingLocalEntries(
              localTimeline,
              data.timeline as TimelineEntry[]
            )
          );
        }
        // data.client_state was successfully loaded from the server, so its result is
        // authoritative here — including an absent approved_next_action — and must not fall
        // back to the pre-fetch sessionFallback snapshot.
        hydrated = hydrateApprovedNextActionForDisplay(caseId, data.client_state);
        if (hydrated) writeSessionApprovedNextAction(caseId, hydrated);
        setApprovedNextAction(hydrated);
        approvedNextActionRef.current = hydrated;
        const sessionPacketApproved = readSessionPreparedPacketApproved(caseId);
        const serverPacketApproved =
          parseJusticeCaseClientState(data.client_state).prepared_packet_approved === true;
        setPreparedPacketApproved(sessionPacketApproved || serverPacketApproved);
        if (resolveAssistedSubmissionLaneForApprovedHref(hydrated?.href) !== undefined) {
          setFtcPracticeLastAssistedSubmissionAttempt(
            readLastAssistedSubmissionAttemptFromClientState(data.client_state) ??
              options?.ftcSnapshotFallback ??
              null
          );
        } else {
          setFtcPracticeLastAssistedSubmissionAttempt(null);
        }
      } catch {
        // keep session fallback and post-run local state
      }
      if (!options?.skipEvidenceRefresh) {
        await loadSavedEvidencePreview(options?.signal);
      }
      return hydrated;
    },
    [loadSavedEvidencePreview]
  );

  const refreshFullChatCaseContextFromServer = useCallback(
    async (
      caseId: string,
      options?: {
        signal?: AbortSignal;
        ftcSnapshotFallback?: LastAssistedSubmissionAttemptSnapshot | null;
        skipProgressNarration?: boolean;
      }
    ) => {
      const runRefresh = async () => {
        let approvedAction = await refreshChatCaseFromServer(caseId, {
          ...options,
          skipEvidenceRefresh: true,
        });
        if (options?.signal?.aborted) return;
        let preview = await loadSavedEvidencePreview(options?.signal, true, {
          skipProgressNarration: options?.skipProgressNarration,
        });
        if (!preview || options?.signal?.aborted) return;

        let observation = {
          caseId,
          approvedAction: approvedAction ?? approvedNextActionRef.current,
          tasks: preview.tasks,
          filings: preview.filings,
          archivedAt: caseArchivedAtRef.current,
        };
        let fulfillmentSync = observeChatOwnedFulfillmentCompletionSync({
          observation,
          previousSnapshot: ownedFulfillmentSnapshotRef.current,
          wasPending: wasPendingHumanFulfillmentEscalationRef.current,
        });
        wasPendingHumanFulfillmentEscalationRef.current = fulfillmentSync.isPending;

        if (fulfillmentSync.shouldInitiateResolution) {
          const resolutionSync = await ensureChatResolutionAfterEscalationFulfillment({
            caseId,
            approvedAction: observation.approvedAction,
            tasks: observation.tasks,
            filings: observation.filings,
            intakeFallback: buildJusticeIntakeFromParts(partsRef.current),
            logLabel: "justice chat-ai escalation-terminal",
            onLocalAction: (local) => {
              writeSessionApprovedNextAction(caseId, local);
              setApprovedNextAction(local);
              approvedNextActionRef.current = local;
            },
          });
          if (resolutionSync.action) {
            approvedAction = resolutionSync.action;
          }
          if (
            shouldRehydrateCaseAfterResolutionSync(resolutionSync) &&
            !options?.signal?.aborted
          ) {
            approvedAction = await refreshChatCaseFromServer(caseId, {
              ...options,
              skipEvidenceRefresh: true,
            });
            if (options?.signal?.aborted) return;
            preview = (await loadSavedEvidencePreview(options?.signal, true, {
              skipProgressNarration: options?.skipProgressNarration,
            })) ?? preview;
            if (preview) {
              observation = {
                caseId,
                approvedAction: approvedAction ?? approvedNextActionRef.current,
                tasks: preview.tasks,
                filings: preview.filings,
                archivedAt: caseArchivedAtRef.current,
              };
              fulfillmentSync = observeChatOwnedFulfillmentCompletionSync({
                observation,
                previousSnapshot: ownedFulfillmentSnapshotRef.current,
                wasPending: wasPendingHumanFulfillmentEscalationRef.current,
              });
              wasPendingHumanFulfillmentEscalationRef.current = fulfillmentSync.isPending;
            }
          }
        } else if (
          shouldRehydrateCaseAfterOwnedFulfillmentSync(fulfillmentSync) &&
          !options?.signal?.aborted
        ) {
          approvedAction = await refreshChatCaseFromServer(caseId, {
            ...options,
            skipEvidenceRefresh: true,
          });
          if (options?.signal?.aborted) return;
          preview = (await loadSavedEvidencePreview(options?.signal, true, {
            skipProgressNarration: options?.skipProgressNarration,
          })) ?? preview;
          if (preview) {
            observation = {
              caseId,
              approvedAction: approvedAction ?? approvedNextActionRef.current,
              tasks: preview.tasks,
              filings: preview.filings,
              archivedAt: caseArchivedAtRef.current,
            };
            fulfillmentSync = observeChatOwnedFulfillmentCompletionSync({
              observation,
              previousSnapshot: ownedFulfillmentSnapshotRef.current,
              wasPending: wasPendingHumanFulfillmentEscalationRef.current,
            });
            wasPendingHumanFulfillmentEscalationRef.current = fulfillmentSync.isPending;
          }
        }

        ownedFulfillmentSnapshotRef.current = fulfillmentSync.currentSnapshot;

        if (options?.signal?.aborted || !preview) return;
        if (!options?.skipProgressNarration) {
          appendChatCaseProgressNarration({
            caseId,
            approvedAction: approvedAction ?? approvedNextActionRef.current,
            tasks: preview.tasks,
            filings: preview.filings,
            archivedAt: caseArchivedAtRef.current,
          });
        }
        if (
          caseArchivedAtRef.current?.trim() &&
          hasOperatorTerminalResponseReviewOutcome(
            approvedAction ?? approvedNextActionRef.current
          )
        ) {
          clearLocalJusticeSession();
          resetChatPostClosureUiState();
        }
      };

      const previous = pendingChatContextRefreshRef.current;
      const current = (async () => {
        if (previous) {
          await previous.catch(() => undefined);
        }
        await runRefresh();
      })();
      pendingChatContextRefreshRef.current = current;
      try {
        await current;
      } finally {
        if (pendingChatContextRefreshRef.current === current) {
          pendingChatContextRefreshRef.current = null;
        }
      }
    },
    [refreshChatCaseFromServer, loadSavedEvidencePreview, appendChatCaseProgressNarration]
  );

  async function handleFollowUpResponseReviewOutcome(
    taskId: string,
    outcome: "resolved" | "no_resolution"
  ) {
    const caseId =
      typeof window !== "undefined" ? sessionStorage.getItem(STORAGE_CASE_ID)?.trim() ?? "" : "";
    if (!caseId || !isUuid(caseId) || !taskId) return;

    setSavingFollowUpResponseReviewOutcome(true);
    setFollowUpResponseReviewError(null);
    try {
      const res = await fetch("/api/justice/follow-up-response-review/consumer-complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ case_id: caseId, task_id: taskId, outcome }),
      });
      if (!res.ok) {
        console.warn("justice chat-ai: follow-up response review outcome failed", res.status);
        setFollowUpResponseReviewError(CHAT_TRACKING_SAVE_ERROR_MESSAGE);
        return;
      }
      await refreshFullChatCaseContextFromServer(caseId);
      setFollowUpResponseReviewError(null);
    } catch (e) {
      console.warn("justice chat-ai: follow-up response review outcome error", e);
      setFollowUpResponseReviewError(CHAT_TRACKING_SAVE_ERROR_MESSAGE);
    } finally {
      setSavingFollowUpResponseReviewOutcome(false);
    }
  }

  async function handleSupersededLaneReviewOutcome(
    task: JusticeCaseTaskRow,
    outcome: SupersededLaneReviewOutcome
  ) {
    const caseId =
      typeof window !== "undefined" ? sessionStorage.getItem(STORAGE_CASE_ID)?.trim() ?? "" : "";
    const requestBody = buildSupersededLaneReviewCompletionRequest(caseId, task, outcome);
    if (!requestBody) return;

    setSavingSupersededLaneReviewTaskId(task.id);
    setSupersededLaneReviewErrorByTaskId((prev) => ({ ...prev, [task.id]: "" }));
    try {
      const res = await fetch(
        "/api/justice/follow-up-response-review/consumer-complete-superseded",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
        }
      );
      if (!res.ok) {
        console.warn("justice chat-ai: superseded lane review outcome failed", res.status);
        setSupersededLaneReviewErrorByTaskId((prev) => ({
          ...prev,
          [task.id]: CHAT_TRACKING_SAVE_ERROR_MESSAGE,
        }));
        return;
      }
      // Re-fetches tasks from the server, so the now-completed task's completed_at excludes it
      // from ChatSupersededLaneReviewPrompt's open-task filter — this IS the refresh/remove step.
      await refreshFullChatCaseContextFromServer(caseId);
      setSupersededLaneReviewErrorByTaskId((prev) => ({ ...prev, [task.id]: "" }));
    } catch (e) {
      console.warn("justice chat-ai: superseded lane review outcome error", e);
      setSupersededLaneReviewErrorByTaskId((prev) => ({
        ...prev,
        [task.id]: CHAT_TRACKING_SAVE_ERROR_MESSAGE,
      }));
    } finally {
      setSavingSupersededLaneReviewTaskId(null);
    }
  }

  useEffect(() => {
    if (!isUpdatingExistingCase || !isLoaded || !isSignedIn) return;
    const caseId =
      typeof window !== "undefined" ? sessionStorage.getItem(STORAGE_CASE_ID)?.trim() ?? "" : "";
    if (!caseId || !isUuid(caseId) || !approvedNextAction) return;

    let cancelled = false;
    let intervalId: number | undefined;

    const isPollPending = () =>
      wasPendingHumanFulfillmentEscalationRef.current ||
      isChatOperatorOwnedClosurePollPending({
        approvedAction: approvedNextActionRef.current,
        archivedAt: caseArchivedAtRef.current,
      }) ||
      isChatOwnedEndgameWaitPollPending({
        approvedAction: approvedNextActionRef.current,
        caseId,
        tasks: savedTasksRef.current,
        filings: savedFilings,
        archivedAt: caseArchivedAtRef.current,
      });

    const tick = async () => {
      if (cancelled) return;
      await refreshFullChatCaseContextFromServer(caseId);
      if (cancelled) return;
      if (!isPollPending() && intervalId !== undefined) {
        window.clearInterval(intervalId);
        intervalId = undefined;
      }
    };

    const initialPending =
      isChatPendingHumanFulfillmentEscalation({
        approvedAction: approvedNextActionRef.current,
        caseId,
        tasks: savedTasksRef.current,
        filings: savedFilings,
      }) ||
      isChatOperatorOwnedClosurePollPending({
        approvedAction: approvedNextActionRef.current,
        archivedAt: caseArchivedAtRef.current,
      }) ||
      isChatOwnedEndgameWaitPollPending({
        approvedAction: approvedNextActionRef.current,
        caseId,
        tasks: savedTasksRef.current,
        filings: savedFilings,
        archivedAt: caseArchivedAtRef.current,
      });

    if (initialPending) {
      void tick();
      intervalId = window.setInterval(() => void tick(), CHAT_PENDING_HUMAN_FULFILLMENT_POLL_MS);
    } else if (wasPendingHumanFulfillmentEscalationRef.current) {
      void tick();
    } else {
      wasPendingHumanFulfillmentEscalationRef.current = false;
    }

    return () => {
      cancelled = true;
      if (intervalId !== undefined) {
        window.clearInterval(intervalId);
      }
    };
  }, [
    isUpdatingExistingCase,
    isLoaded,
    isSignedIn,
    approvedNextAction,
    savedTasks,
    savedFilings,
    refreshFullChatCaseContextFromServer,
  ]);

  useEffect(() => {
    if (!isUpdatingExistingCase || !isLoaded || !isSignedIn) {
      setSavedEvidenceCount(null);
      setSavedFilings([]);
      setSavedTasks([]);
      setChatHandlingReadinessLoading(false);
      setSavedEvidenceRows([]);
      setRecentEvidenceRows([]);
      return;
    }
    const caseId =
      typeof window !== "undefined" ? sessionStorage.getItem(STORAGE_CASE_ID)?.trim() ?? "" : "";
    if (!caseId || !isUuid(caseId)) {
      setSavedEvidenceCount(null);
      setSavedFilings([]);
      setSavedTasks([]);
      setChatHandlingReadinessLoading(false);
      setSavedEvidenceRows([]);
      setRecentEvidenceRows([]);
      return;
    }

    requestSavedEvidencePreviewRefresh();
  }, [isUpdatingExistingCase, isLoaded, isSignedIn, requestSavedEvidencePreviewRefresh]);

  const refreshChatFilings = requestSavedEvidencePreviewRefresh;

  async function handleChatManualFilingsSaved(_result: { hasConfirmation: boolean }) {
    // Consumer DIY manual filing capture retired on chat-ai (fail-closed).
    return;
  }

  useEffect(() => {
    if (!isUpdatingExistingCase || !isLoaded || !isSignedIn) return;

    function refetchEvidence() {
      const caseId =
        typeof window !== "undefined" ? sessionStorage.getItem(STORAGE_CASE_ID)?.trim() ?? "" : "";
      if (!caseId || !isUuid(caseId)) return;
      requestSavedEvidencePreviewRefresh();
    }

    function onFocus() {
      refetchEvidence();
    }

    function onVisibilityChange() {
      if (document.visibilityState === "visible") {
        refetchEvidence();
      }
    }

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      evidencePreviewFetchGenerationRef.current += 1;
    };
  }, [isUpdatingExistingCase, isLoaded, isSignedIn, requestSavedEvidencePreviewRefresh]);

  const showSavedEvidenceCount =
    isUpdatingExistingCase &&
    isLoaded &&
    isSignedIn &&
    savedEvidenceCount !== null;

  const showRecentEvidencePreview =
    showSavedEvidenceCount &&
    savedEvidenceCount > 0 &&
    recentEvidenceRows.length > 0;

  const sessionChangeLines = useMemo(() => {
    if (!isUpdatingExistingCase) return [];
    const baseline = sessionBaselinePartsRef.current;
    if (!baseline) return [];
    const evidenceAddedThisVisit =
      showSavedEvidenceCount &&
      sessionBaselineEvidenceCountRef.current !== null &&
      savedEvidenceCount !== null &&
      savedEvidenceCount > sessionBaselineEvidenceCountRef.current;
    return summarizeBuildJusticeIntakePartsSessionChanges({
      baseline,
      current: parts,
      evidenceAddedThisVisit,
    });
  }, [isUpdatingExistingCase, parts, showSavedEvidenceCount, savedEvidenceCount]);

  const chatPreviewIntake = useMemo(() => buildJusticeIntakeFromParts(parts), [parts]);
  const hasUploadedEvidenceFile = useMemo(
    () => savedEvidenceRows.some(justiceEvidenceRowHasUploadedFile),
    [savedEvidenceRows]
  );
  const chatPreviewDestination = useMemo(
    () => resolveChatPreviewDestination(chatPreviewIntake, hasUploadedEvidenceFile),
    [chatPreviewIntake, hasUploadedEvidenceFile]
  );
  const chatSubmissionDraftText = useMemo(() => {
    if (!chatPreviewDestination) return "";
    return buildSubmissionDraftPreview({
      intake: chatPreviewIntake,
      destinationId: chatPreviewDestination.id,
      destinationLabel: chatPreviewDestination.label,
      evidenceLines: recentEvidenceRows.map((row) => ({ title: row.title })),
    });
  }, [chatPreviewIntake, chatPreviewDestination, recentEvidenceRows]);

  useEffect(() => {
    setChatAiDraftText(null);
    setChatAiDraftError(null);
  }, [chatSubmissionDraftText]);

  const activeUuidCaseId =
    typeof window !== "undefined"
      ? (() => {
          const id = sessionStorage.getItem(STORAGE_CASE_ID)?.trim() ?? "";
          return id && isUuid(id) ? id : "";
        })()
      : "";

  useEffect(() => {
    if (!isLoaded) return;

    const validCaseId = activeUuidCaseId;

    if (!isSignedIn || !validCaseId) {
      if (transcriptCaseIdRef.current) {
        resetActiveChatTranscriptState({ openingGreeting: !readValidLocalJusticeIntake() });
      }
      return;
    }

    if (transcriptCaseIdRef.current === validCaseId) return;

    let cancelled = false;
    void (async () => {
      try {
        const loaded = await fetchCaseChatTranscript(validCaseId);
        if (cancelled) return;

        transcriptCaseIdRef.current = validCaseId;
        persistedTurnIdsRef.current = new Set(loaded.map((turn) => turn.id));

        if (loaded.length > 0) {
          messagesRef.current = loaded;
          setMessages(loaded);
          syncChatProgressNarrationFromTranscript(validCaseId, loaded);
          return;
        }

        const hasInMemoryConversation = messagesRef.current.some(
          (turn) => !isEphemeralChatGreeting(turn.text)
        );
        if (isUpdatingExistingCase && !hasInMemoryConversation) {
          setMessages([{ id: msgId(), role: "assistant", text: UPDATE_GREETING }]);
        }
      } catch (error) {
        console.warn("justice chat-ai: transcript hydrate failed", error);
        if (cancelled) return;
        transcriptCaseIdRef.current = validCaseId;
        const hasInMemoryConversation = messagesRef.current.some(
          (turn) => !isEphemeralChatGreeting(turn.text)
        );
        if (isUpdatingExistingCase && !hasInMemoryConversation) {
          setMessages([{ id: msgId(), role: "assistant", text: UPDATE_GREETING }]);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isLoaded, isSignedIn, isUpdatingExistingCase, activeUuidCaseId, resetActiveChatTranscriptState]);

  // Re-evaluate the CFPB proof_required flag whenever the evidence-has-file signal changes —
  // covers upload, delete, and edit uniformly, since all three funnel through savedEvidenceRows.
  // Skips the initial mount (nothing "changed" yet, just hydrated) and only writes when the
  // recomputed action actually differs, so this never PATCHes on every unrelated render.
  useEffect(() => {
    if (!isLoaded || !isSignedIn || !isUpdatingExistingCase) return;
    const caseId = activeUuidCaseId;
    if (!caseId) return;
    const previous = hasUploadedEvidenceFileRef.current;
    const isFirstObservationForCase = !previous || previous.caseId !== caseId;
    const changed = !isFirstObservationForCase && previous.value !== hasUploadedEvidenceFile;
    hasUploadedEvidenceFileRef.current = { caseId, value: hasUploadedEvidenceFile };
    // Only recompute/persist the approved next action AFTER the packet is actually approved. The
    // recompute yields a status:"approved" action, so persisting it pre-approval would falsely mark
    // an unpaid, un-reviewed case "Approved" and queue its operator-fulfillment narration — the
    // exact evidence-upload leak. (Ref above still tracks the signal across the approval boundary.)
    if (
      !shouldRecomputeApprovedNextActionOnEvidenceChange({
        preparedPacketApproved,
        evidenceFileChanged: changed,
      })
    ) {
      return;
    }

    const manualFtc =
      typeof window !== "undefined" && sessionStorage.getItem(STORAGE_FTC_MANUAL_UNLOCK) === "1";
    const intake = buildJusticeIntakeFromParts(parts);
    const nextAction = recomputeApprovedNextActionAfterIntake(intake, {
      existing: approvedNextAction,
      manualFtc,
      hasUploadedEvidenceFile,
    });
    if (
      nextAction.href === approvedNextAction?.href &&
      nextAction.proof_required === approvedNextAction?.proof_required
    ) {
      return;
    }

    setApprovedNextAction(nextAction);
    writeSessionApprovedNextAction(caseId, nextAction);
    void (async () => {
      try {
        const getRes = await fetch(`/api/justice/cases/${encodeURIComponent(caseId)}`);
        if (!getRes.ok) {
          console.warn("justice chat-ai: GET before evidence-triggered next action failed", getRes.status);
          return;
        }
        const existing = (await getRes.json()) as { client_state?: unknown };
        const merged = mergeClientStateWithApprovedNextAction(existing.client_state, nextAction);
        if (isPlaywrightMockIntakeCaseHydrationCaseId(caseId)) {
          console.log(
            "[e2e-merge-diag:evidence-effect]",
            JSON.stringify({
              site: "evidence-effect",
              existingClientState: existing.client_state,
              merged,
              time: Date.now(),
            })
          );
        }
        const patchRes = await fetch(`/api/justice/cases/${encodeURIComponent(caseId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ client_state: merged }),
        });
        if (!patchRes.ok) {
          console.warn("justice chat-ai: PATCH evidence-triggered next action failed", patchRes.status);
        }
      } catch (err) {
        console.warn("justice chat-ai: evidence-triggered next action error", err);
      }
    })();
  }, [
    hasUploadedEvidenceFile,
    isLoaded,
    isSignedIn,
    isUpdatingExistingCase,
    activeUuidCaseId,
    parts,
    approvedNextAction,
    preparedPacketApproved,
  ]);

  const chatPacketPlainText = useMemo(() => {
    if (!activeUuidCaseId) return "";
    const intake = buildJusticeIntakeFromParts(parts);
    const timeline = readTimeline(activeUuidCaseId);
    return buildPacketPlainText(
      intake,
      timeline,
      savedEvidenceRows,
      savedFilings,
      activeUuidCaseId
    );
  }, [activeUuidCaseId, parts, savedEvidenceRows, savedFilings]);

  const canAddProofNoteInChat =
    isUpdatingExistingCase && isLoaded && isSignedIn && Boolean(activeUuidCaseId);

  const canStageProofNoteInChat = !isUpdatingExistingCase && isLoaded && Boolean(isSignedIn);

  const canUseProofNoteForm = canAddProofNoteInChat || canStageProofNoteInChat;

  const showStagedProofNotes = Boolean(isSignedIn) && stagedProofNotes.length > 0;

  function tryShowProofKeywordNudge(userMessage: string) {
    if (proofKeywordNudgeOfferedRef.current || !canAddProofNoteInChat) return;
    if (!userMessageSuggestsProofNote(userMessage)) return;
    proofKeywordNudgeOfferedRef.current = true;
    setShowProofKeywordNudge(true);

    const { title, description } = buildProofNotePrefillFromUserMessage(userMessage);
    if (!proofNoteTitle.trim()) {
      setProofNoteTitle(title);
    }
    if (!proofNoteDescription.trim() && description) {
      setProofNoteDescription(description);
    }
    setProofNoteDetailsOpen(true);
  }

  async function handleAddProofNote(e: React.FormEvent) {
    e.preventDefault();
    setProofNoteSuccess(null);
    const trimmed = proofNoteTitle.trim();
    if (!trimmed) {
      setProofNoteError("Title is required.");
      return;
    }
    if (!isSignedIn) return;

    if (canStageProofNoteInChat) {
      setSavingProofNote(true);
      setProofNoteError(null);
      try {
        const d = proofNoteEvidenceDate.trim();
        const desc = proofNoteDescription.trim();
        const next = appendStagedProofNote({
          title: trimmed,
          evidence_type: proofNoteType,
          ...(d ? { evidence_date: d } : {}),
          ...(desc ? { description: desc } : {}),
        });
        setStagedProofNotes(next);
        setProofNoteTitle("");
        setProofNoteEvidenceDate("");
        setProofNoteDescription("");
        setProofNoteSuccess("Proof note staged on this device.");
        setStagedProofFlushError(null);
      } catch {
        setProofNoteError("Could not stage proof note.");
      } finally {
        setSavingProofNote(false);
      }
      return;
    }

    const caseId = sessionStorage.getItem(STORAGE_CASE_ID)?.trim() ?? "";
    if (!caseId || !isUuid(caseId)) return;

    setSavingProofNote(true);
    setProofNoteError(null);
    try {
      const body: Record<string, unknown> = {
        case_id: caseId,
        title: trimmed,
        evidence_type: proofNoteType,
      };
      const d = proofNoteEvidenceDate.trim();
      if (d) body.evidence_date = d;
      const desc = proofNoteDescription.trim();
      if (desc) body.description = desc;

      const res = await fetch("/api/justice/evidence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const err = (
          payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {}
        ) as { error?: string };
        setProofNoteError(err.error ?? "Could not save proof note.");
        return;
      }
      applyServerTimelineFromResponse(caseId, payload);
      if (isCreatedEvidenceRow(payload)) {
        setSavedEvidenceCount((prev) => (prev ?? 0) + 1);
        setSavedEvidenceRows((prev) =>
          [payload, ...prev.filter((row) => row.id !== payload.id)]
        );
        setRecentEvidenceRows((prev) =>
          [payload, ...prev.filter((row) => row.id !== payload.id)].slice(0, CHAT_RECENT_EVIDENCE_MAX)
        );
      }
      setProofNoteTitle("");
      setProofNoteEvidenceDate("");
      setProofNoteDescription("");
      setProofNoteSuccess("Proof note saved.");
      setShowProofKeywordNudge(false);
      requestSavedEvidencePreviewRefresh();
    } catch {
      setProofNoteError("Could not save proof note.");
    } finally {
      setSavingProofNote(false);
    }
  }

  async function handleUploadEvidenceFile(fileList: FileList | null) {
    setEvidenceUploadError(null);
    setEvidenceUploadSuccess(null);
    const file = fileList?.[0] ?? null;
    if (evidenceFileInputRef.current) {
      evidenceFileInputRef.current.value = "";
    }
    if (!file) return;
    if (!isLoaded || !isSignedIn || !canAddProofNoteInChat) {
      setEvidenceUploadError("Save your case in chat before attaching evidence files.");
      return;
    }
    const caseId = sessionStorage.getItem(STORAGE_CASE_ID)?.trim() ?? "";
    if (!caseId || !isUuid(caseId)) {
      setEvidenceUploadError("No active case is loaded in chat.");
      return;
    }

    setUploadingEvidenceFile(true);
    setEvidenceUploadFileName(file.name);
    setEvidenceUploadProgress(0);
    const progressTurnId = msgId();
    evidenceUploadProgressTurnIdRef.current = progressTurnId;
    addChatMessages(
      [{ id: progressTurnId, role: "assistant", text: buildChatEvidenceUploadProgressMessage(0) }],
      { caseId, source: "evidence_upload" }
    );

    const updateProgressTurn = (percent: number) => {
      setEvidenceUploadProgress(percent);
      const text = buildChatEvidenceUploadProgressMessage(percent);
      messagesRef.current = messagesRef.current.map((turn) =>
        turn.id === progressTurnId ? { ...turn, text } : turn
      );
      setMessages(messagesRef.current);
    };

    try {
      const result = await uploadJusticeEvidenceFile({
        caseId,
        file,
        title: file.name.replace(/\.[^.]+$/, "") || file.name,
        onProgress: updateProgressTurn,
      });
      if (!result.ok) {
        const failureText = buildChatEvidenceUploadFailureMessage(result.error);
        setEvidenceUploadError(result.error);
        addChatMessages([{ id: msgId(), role: "assistant", text: failureText }], {
          caseId,
          source: "evidence_upload",
        });
        return;
      }

      applyServerTimelineFromResponse(caseId, result.row);
      setSavedEvidenceCount((prev) => (prev ?? 0) + 1);
      setSavedEvidenceRows((prev) => [result.row, ...prev.filter((row) => row.id !== result.row.id)]);
      setRecentEvidenceRows((prev) =>
        [result.row, ...prev.filter((row) => row.id !== result.row.id)].slice(
          0,
          CHAT_RECENT_EVIDENCE_MAX
        )
      );
      const successText = buildChatEvidenceUploadSuccessMessage({
        title: result.row.title,
        fileName: result.row.file_name ?? file.name,
      });
      setEvidenceUploadSuccess(successText);
      setEvidenceUploadProgress(100);
      addChatMessages([{ id: msgId(), role: "assistant", text: successText }], {
        caseId,
        source: "evidence_upload",
      });
      requestSavedEvidencePreviewRefresh();
    } catch {
      const failureText = buildChatEvidenceUploadFailureMessage();
      setEvidenceUploadError(failureText);
      addChatMessages([{ id: msgId(), role: "assistant", text: failureText }], {
        caseId,
        source: "evidence_upload",
      });
    } finally {
      setUploadingEvidenceFile(false);
      evidenceUploadProgressTurnIdRef.current = null;
    }
  }

  async function flushStagedProofNotesToServer(
    caseId: string,
    notes: StagedProofNote[]
  ): Promise<{ flushedClientIds: string[]; errorMessage: string | null }> {
    const flushedClientIds: string[] = [];
    for (const note of notes) {
      try {
        const body: Record<string, unknown> = {
          case_id: caseId,
          title: note.title,
          evidence_type: note.evidence_type,
        };
        if (note.evidence_date) body.evidence_date = note.evidence_date;
        if (note.description) body.description = note.description;

        const res = await fetch("/api/justice/evidence", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const payload: unknown = await res.json().catch(() => null);
        if (!res.ok) {
          const err = (
            payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {}
          ) as { error?: string };
          return {
            flushedClientIds,
            errorMessage:
              err.error ??
              "Some staged proof notes could not be saved. Remaining notes stay staged on this device.",
          };
        }
        applyServerTimelineFromResponse(caseId, payload);
        flushedClientIds.push(note.clientId);
      } catch {
        return {
          flushedClientIds,
          errorMessage:
            "Some staged proof notes could not be saved. Remaining notes stay staged on this device.",
        };
      }
    }
    return { flushedClientIds, errorMessage: null };
  }

  function cancelEditRecentEvidence() {
    setEditingRecentEvidenceId(null);
    setRecentEvidenceEditError(null);
  }

  function startEditRecentEvidence(row: JusticeCaseEvidenceRow) {
    setEditingRecentEvidenceId(row.id);
    setEditRecentEvidenceTitle(row.title);
    setEditRecentEvidenceType(
      isJusticeEvidenceType(row.evidence_type) ? row.evidence_type : "other"
    );
    setEditRecentEvidenceDate(row.evidence_date ?? "");
    setEditRecentEvidenceDescription(row.description ?? "");
    setRecentEvidenceEditError(null);
    setRecentEvidenceEditSuccess(null);
    setRecentEvidenceDeleteError(null);
    setRecentEvidenceDeleteSuccess(null);
  }

  async function handleSaveRecentEvidenceEdit(e: React.FormEvent, id: string) {
    e.preventDefault();
    if (!isSignedIn) return;
    const trimmedTitle = editRecentEvidenceTitle.trim();
    if (!trimmedTitle) {
      setRecentEvidenceEditError("Title is required.");
      return;
    }
    setSavingRecentEvidenceEdit(true);
    setRecentEvidenceEditError(null);
    setRecentEvidenceEditSuccess(null);
    setRecentEvidenceDeleteError(null);
    setRecentEvidenceDeleteSuccess(null);
    try {
      const body: Record<string, unknown> = {
        title: trimmedTitle,
        evidence_type: editRecentEvidenceType,
        evidence_date: editRecentEvidenceDate.trim() ? editRecentEvidenceDate.trim() : null,
        description: editRecentEvidenceDescription.trim() ? editRecentEvidenceDescription.trim() : null,
      };
      const res = await fetch(`/api/justice/evidence/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const err = (
          payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {}
        ) as { error?: string };
        setRecentEvidenceEditError(err.error ?? "Could not update proof note.");
        return;
      }
      setEditingRecentEvidenceId(null);
      setRecentEvidenceEditSuccess("Proof note updated.");
      requestSavedEvidencePreviewRefresh();
    } catch {
      setRecentEvidenceEditError("Could not update proof note.");
    } finally {
      setSavingRecentEvidenceEdit(false);
    }
  }

  async function handleDeleteRecentEvidence(id: string) {
    if (!window.confirm("Delete this proof note?")) return;
    if (!isSignedIn) return;

    setDeletingRecentEvidenceId(id);
    setRecentEvidenceDeleteError(null);
    setRecentEvidenceDeleteSuccess(null);
    setRecentEvidenceEditSuccess(null);

    try {
      const res = await fetch(`/api/justice/evidence/${encodeURIComponent(id)}`, { method: "DELETE" });
      const payload: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const err = (
          payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {}
        ) as { error?: string };
        setRecentEvidenceDeleteError(err.error ?? "Could not delete proof note.");
        return;
      }
      if (editingRecentEvidenceId === id) {
        cancelEditRecentEvidence();
      }
      setRecentEvidenceDeleteSuccess("Proof note deleted.");
      requestSavedEvidencePreviewRefresh();
    } catch {
      setRecentEvidenceDeleteError("Could not delete proof note.");
    } finally {
      setDeletingRecentEvidenceId(null);
    }
  }

  useEffect(() => {
    if (!isUpdatingExistingCase) {
      setApprovedNextAction(undefined);
      setPreparedPacketApproved(false);
      setSavedEvidenceCount(null);
      setSavedFilings([]);
      setChatHandlingReadinessLoading(false);
      setSavedEvidenceRows([]);
      setRecentEvidenceRows([]);
      setEditingRecentEvidenceId(null);
      setRecentEvidenceEditError(null);
      setRecentEvidenceEditSuccess(null);
      setDeletingRecentEvidenceId(null);
      setRecentEvidenceDeleteError(null);
      setRecentEvidenceDeleteSuccess(null);
      setShowProofKeywordNudge(false);
      setProofNoteDetailsOpen(false);
      setSubmissionDraftReviewOverride(false);
      setSubmissionDraftReviewChecked(false);
      setSubmissionDraftReviewError(null);
      setDraftPreviewExpanded(false);
      setPacketPreviewExpanded(false);
      setPrepMessageExpanded(false);
      setPrepCopyHint(null);
      setFtcPracticeConfirmed(false);
      setFtcPracticeRunning(false);
      setFtcPracticeSuccess(false);
      setFtcPracticeStorageSkipped(false);
      setFtcPracticeError(null);
      setFtcPracticeLastAssistedSubmissionAttempt(null);
      return;
    }

    const caseId =
      typeof window !== "undefined" ? sessionStorage.getItem(STORAGE_CASE_ID)?.trim() ?? "" : "";

    if (!caseId) {
      if (legalConsentTrackedCaseIdRef.current) {
        clearChatBbbAccuracyConsented(legalConsentTrackedCaseIdRef.current);
        legalConsentTrackedCaseIdRef.current = null;
      }
      setPreparedPacketApproved(false);
      setApprovedNextAction(undefined);
      setFtcPracticeConfirmed(false);
      setFtcPracticeRunning(false);
      setFtcPracticeSuccess(false);
      setFtcPracticeStorageSkipped(false);
      setFtcPracticeError(null);
      setFtcPracticeLastAssistedSubmissionAttempt(null);
      return;
    }

    if (legalConsentTrackedCaseIdRef.current !== caseId) {
      if (legalConsentTrackedCaseIdRef.current) {
        clearChatBbbAccuracyConsented(legalConsentTrackedCaseIdRef.current);
      }
      legalConsentTrackedCaseIdRef.current = caseId;
    }

    const sessionFallback = hydrateApprovedNextActionForDisplay(caseId);
    setApprovedNextAction(sessionFallback);
    setPreparedPacketApproved(readSessionPreparedPacketApproved(caseId));
    setSubmissionDraftReviewOverride(false);
    setSubmissionDraftReviewChecked(false);
    setSubmissionDraftReviewError(null);
    setDraftPreviewExpanded(false);

    if (!isLoaded || !isSignedIn || !isUuid(caseId)) return;

    wasPendingHumanFulfillmentEscalationRef.current = false;
    ownedFulfillmentSnapshotRef.current = null;
    caseArchivedAtRef.current = null;
    const ac = new AbortController();
    void refreshFullChatCaseContextFromServer(caseId, { signal: ac.signal });

    return () => ac.abort();
  }, [isUpdatingExistingCase, isLoaded, isSignedIn, refreshFullChatCaseContextFromServer]);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, loading]);

  useEffect(() => {
    const proofCheck = validateContactProofForIntake({
      already_contacted: parts.already_contacted,
      contact_proof_type: parts.contact_proof_type,
      contact_proof_text: parts.contact_proof_text,
    });
    if (proofCheck.ok) {
      setContactProofError(null);
    }
  }, [parts.already_contacted, parts.contact_proof_type, parts.contact_proof_text]);

  useEffect(() => {
    if (!isUpdatingExistingCase || !isLoaded || !isSignedIn) return;
    const caseId =
      typeof window !== "undefined" ? sessionStorage.getItem(STORAGE_CASE_ID)?.trim() ?? "" : "";
    if (!caseId || !isUuid(caseId)) return;
    if (!preparedPacketApproved || !approvedNextAction) return;
    if (approvedNextAction.href?.trim() !== CHAT_INLINE_PAYMENT_DISPUTE_PREP_HREF) {
      paymentDisputeFormHydratedForCaseRef.current = null;
      return;
    }
    if (
      approvedNextAction.handling_requested_at?.trim() ||
      (approvedNextAction.status !== "approved" && approvedNextAction.status !== "started")
    ) {
      return;
    }
    if (paymentDisputeFormHydratedForCaseRef.current === caseId) return;

    const intake = buildJusticeIntakeFromParts(parts);
    const fields = resolvePaymentDisputeFormFields(caseId, intake);
    setPaymentDisputePaymentMethod(fields.paymentMethod);
    setPaymentDisputeChargeDate(fields.chargeDate);
    setPaymentDisputeChargeAmount(fields.chargeAmount);
    setPaymentDisputeMerchantName(fields.merchantName);
    setPaymentDisputeReason(fields.disputeReason);
    setPaymentDisputeReasonOther(fields.disputeReasonOther);
    setPaymentDisputePriorContact(fields.priorContact);
    setPaymentDisputeProofType(fields.proofType);
    setPaymentDisputeSaveSuccess(null);
    paymentDisputeFormHydratedForCaseRef.current = caseId;
    void logPaymentDisputeChecklistViewed(caseId, "justice chat-ai");
  }, [
    isUpdatingExistingCase,
    isLoaded,
    isSignedIn,
    preparedPacketApproved,
    approvedNextAction,
    parts,
  ]);

  useEffect(() => {
    const nextHref = approvedNextAction?.href;
    const previousHref = prevApprovedActionHrefForAssistedPracticeRef.current;

    if (shouldResetAssistedPracticeRunUiState(previousHref, nextHref)) {
      setFtcPracticeConfirmed(false);
      setFtcPracticeRunning(false);
      setFtcPracticeSuccess(false);
      setFtcPracticeStorageSkipped(false);
      setFtcPracticeError(null);
      if (resolveAssistedPracticeSubmissionLaneId(nextHref) === undefined) {
        setFtcPracticeLastAssistedSubmissionAttempt(null);
      }
    }

    prevApprovedActionHrefForAssistedPracticeRef.current = nextHref;
  }, [approvedNextAction?.href]);

  async function handleSend() {
    if (sendInFlightRef.current || loading) return;

    setApiError(null);
    const trimmed = inputValue.trim();
    if (!trimmed) return;
    if (trimmed.length > MAX_INTAKE_CHAT_USER_MESSAGE) {
      setApiError("Message is too long. Please shorten it and try again.");
      return;
    }

    const selectionContext = buildChatCaseSelectionGateContext({
      isLoaded,
      isSignedIn: Boolean(isSignedIn),
      hasOfferedList: readChatCaseSelectionOffer().length > 0,
    });
    const parsedSelection = parseChatCaseSelectionMessage(trimmed, selectionContext);
    if (parsedSelection.kind !== "none") {
      sendInFlightRef.current = true;
      setLoading(true);
      setInputValue("");
      const userTurn = { id: msgId(), role: "user" as const, text: trimmed };
      try {
        let assistantText = "";
        if (parsedSelection.kind === "list_cases") {
          assistantText = await handleListCasesForChatSelection();
        } else if (parsedSelection.kind === "select_case") {
          const selectResult = await handleSelectCaseFromChat(parsedSelection.query);
          assistantText = selectResult.assistantText;
        } else {
          if (parsedSelection.kind === "decline") {
            clearChatCaseSelectionOffer();
          }
          assistantText = buildChatCaseSelectionAssistantResponse(parsedSelection);
        }
        const selectedCaseId =
          typeof window !== "undefined"
            ? sessionStorage.getItem(STORAGE_CASE_ID)?.trim() ?? ""
            : "";
        addChatMessages(
          [userTurn, { id: msgId(), role: "assistant", text: assistantText }],
          {
            caseId: selectedCaseId || undefined,
            source: "case_selection_gate",
          }
        );
      } finally {
        sendInFlightRef.current = false;
        setLoading(false);
      }
      return;
    }

    const restoreContext = buildChatCaseRestoreGateContext({
      isLoaded,
      isSignedIn: Boolean(isSignedIn),
      activeCaseId:
        typeof window !== "undefined" ? sessionStorage.getItem(STORAGE_CASE_ID)?.trim() ?? "" : "",
    });
    const parsedRestore = parseChatCaseRestoreMessage(trimmed, restoreContext);
    if (parsedRestore.kind !== "none") {
      sendInFlightRef.current = true;
      setLoading(true);
      setInputValue("");
      const userTurn = { id: msgId(), role: "user" as const, text: trimmed };
      try {
        if (parsedRestore.kind === "restore_most_recent_archived") {
          const restoreResult = await handleRestoreMostRecentArchivedCaseFromChat();
          const assistantText = restoreResult.ok
            ? buildChatCaseRestoreAssistantResponse(parsedRestore, {
                companyName: restoreResult.companyName,
              })
            : (restoreResult.blockedMessage ??
              "I could not restore your most recently archived case. If you still have an archived case, try again in a moment.");
          const restoredCaseId =
            typeof window !== "undefined"
              ? sessionStorage.getItem(STORAGE_CASE_ID)?.trim() ?? ""
              : "";
          addChatMessages(
            [userTurn, { id: msgId(), role: "assistant", text: assistantText }],
            {
              caseId: restoredCaseId || undefined,
              source: "case_restore_gate",
            }
          );
        } else {
          addChatMessages(
            [
              userTurn,
              {
                id: msgId(),
                role: "assistant",
                text: buildChatCaseRestoreAssistantResponse(parsedRestore),
              },
            ],
            { source: "case_restore_gate" }
          );
        }
      } finally {
        sendInFlightRef.current = false;
        setLoading(false);
      }
      return;
    }

    const startNewCaseContext = buildChatStartNewCaseGateContext({
      isLoaded,
      isSignedIn: Boolean(isSignedIn),
      activeCaseId:
        typeof window !== "undefined" ? sessionStorage.getItem(STORAGE_CASE_ID)?.trim() ?? "" : "",
    });
    const parsedStartNewCase = parseChatStartNewCaseMessage(trimmed, startNewCaseContext);
    if (parsedStartNewCase.kind !== "none") {
      sendInFlightRef.current = true;
      setLoading(true);
      setInputValue("");
      const userTurn = { id: msgId(), role: "user" as const, text: trimmed };
      try {
        if (parsedStartNewCase.kind === "start_new_case") {
          const priorCaseId =
            typeof window !== "undefined"
              ? sessionStorage.getItem(STORAGE_CASE_ID)?.trim() ?? ""
              : "";
          const priorTranscript = messagesRef.current;
          // Detach local session only — prior server case stays intact (no PATCH/archive/delete).
          applyChatStartNewCaseLocalSessionReset();
          resetChatPostClosureUiState();
          // Replace transcript entirely so prior turns cannot backfill onto the next create.
          resetActiveChatTranscriptState();
          const assistantText = buildChatStartNewCaseStartedResponse({ priorCaseId });
          const startNewTurns = [
            userTurn,
            { id: msgId(), role: "assistant" as const, text: assistantText },
          ];
          const isolated = buildIsolatedStartNewCaseTranscript({
            priorTurns: priorTranscript,
            startNewTurns: [...messagesRef.current, ...startNewTurns],
          });
          messagesRef.current = isolated;
          setMessages(isolated);
        } else {
          const assistantText = buildChatStartNewCaseAssistantResponse(parsedStartNewCase);
          addChatMessages(
            [userTurn, { id: msgId(), role: "assistant", text: assistantText }],
            { source: "start_new_case_gate" }
          );
        }
      } finally {
        sendInFlightRef.current = false;
        setLoading(false);
      }
      return;
    }

    const basicsMissingForCommit = getPreviewBasicsMissing(parts);
    const contactProofCheckForCommit = validateContactProofForIntake({
      already_contacted: parts.already_contacted,
      contact_proof_type: parts.contact_proof_type,
      contact_proof_text: parts.contact_proof_text,
    });
    const intakeCommitContext = buildChatIntakeCommitContext({
      caseId:
        typeof window !== "undefined" ? sessionStorage.getItem(STORAGE_CASE_ID)?.trim() ?? "" : "",
      intakeReady:
        basicsMissingForCommit.length === 0 && contactProofCheckForCommit.ok,
      isLoaded,
      isSignedIn: Boolean(isSignedIn),
      isUpdatingExistingCase,
    });

    if (canCommitIntakeViaChat(intakeCommitContext)) {
      const parsedIntakeCommit = parseChatIntakeCommitMessage(trimmed, intakeCommitContext);
      if (parsedIntakeCommit.kind !== "none") {
        sendInFlightRef.current = true;
        setLoading(true);
        setInputValue("");
        const userTurn = { id: msgId(), role: "user" as const, text: trimmed };
        messagesRef.current = [...messagesRef.current, userTurn];
        setMessages(messagesRef.current);
        try {
          let assistantText = buildChatIntakeCommitAssistantResponse(parsedIntakeCommit);
          let commitSucceeded = false;

          if (parsedIntakeCommit.kind === "intake_commit") {
            const ok = await handleContinueToPreview();
            commitSucceeded = ok;
            if (!ok) {
              assistantText =
                contactProofCheckForCommit.ok && basicsMissingForCommit.length === 0
                  ? "I could not save your case on the server. Please try again or use Save and continue in chat below."
                  : "I could not save your case yet. Finish the required intake details first, or use Save and continue in chat below.";
            }
          }

          const assistantTurn = { id: msgId(), role: "assistant" as const, text: assistantText };
          messagesRef.current = [...messagesRef.current, assistantTurn];
          setMessages(messagesRef.current);

          if (parsedIntakeCommit.kind === "intake_commit" && commitSucceeded) {
            const caseIdAfterCommit =
              typeof window !== "undefined"
                ? sessionStorage.getItem(STORAGE_CASE_ID)?.trim() ?? ""
                : "";
            if (caseIdAfterCommit && isUuid(caseIdAfterCommit)) {
              transcriptCaseIdRef.current = caseIdAfterCommit;
              await backfillChatTranscriptForCase(caseIdAfterCommit, messagesRef.current);
            }
          }
        } finally {
          sendInFlightRef.current = false;
          setLoading(false);
        }
        return;
      }
    } else {
      const parsedWrongStage = parseChatIntakeCommitMessage(trimmed, intakeCommitContext);
      if (parsedWrongStage.kind === "wrong_stage" || parsedWrongStage.kind === "ambiguous") {
        sendInFlightRef.current = true;
        setLoading(true);
        setInputValue("");
        try {
          addChatMessages(
            [
              { id: msgId(), role: "user", text: trimmed },
              {
                id: msgId(),
                role: "assistant",
                text: buildChatIntakeCommitAssistantResponse(parsedWrongStage),
              },
            ],
            { source: "intake_commit_gate" }
          );
        } finally {
          sendInFlightRef.current = false;
          setLoading(false);
        }
        return;
      }
    }

    const consentCaseId =
      typeof window !== "undefined" ? sessionStorage.getItem(STORAGE_CASE_ID)?.trim() ?? "" : "";

    if (
      isUpdatingExistingCase &&
      isLoaded &&
      isSignedIn &&
      consentCaseId &&
      isUuid(consentCaseId)
    ) {
      const submissionDraftReviewed =
        submissionDraftReviewOverride ||
        readSessionSubmissionDraftReviewed(consentCaseId) ||
        submissionDraftReviewedInTimeline(consentCaseId);
      const bbbComplaintPrepVisible = shouldShowChatInlineRealBbbComplaintPrep({
        isUpdatingExistingCase,
        caseId: consentCaseId,
        isLoaded,
        isSignedIn: Boolean(isSignedIn),
        preparedPacketApproved,
        approvedNextAction,
      });
      const gateContext = buildChatLegalConsentGateContext({
        caseId: consentCaseId,
        submissionDraftReviewed,
        preparedPacketApproved,
        bbbComplaintPrepVisible,
        bbbAutofillCompleted: ftcPracticeSuccess,
      });
      const pendingGate = resolvePendingChatLegalConsentGate(gateContext);
      if (pendingGate) {
        const parsed = parseChatLegalConsentMessage(trimmed, pendingGate, gateContext);
        if (parsed.kind !== "none") {
          sendInFlightRef.current = true;
          setLoading(true);
          setInputValue("");
          const userTurn = { id: msgId(), role: "user" as const, text: trimmed };
          try {
            let assistantText = buildChatLegalConsentAssistantResponse(parsed);

            if (parsed.kind === "submission_draft_review") {
              const ok = await handleMarkSubmissionDraftReviewedFromChat({ fromChatConsent: true });
              if (!ok) {
                assistantText =
                  "I could not save your draft review on the server. Please try again or use the checklist below.";
              }
            } else if (parsed.kind === "prepared_packet_approval") {
              logPlaywrightApprovePacketDiagnostic("origin:chat-consent", consentCaseId, {
                pendingGate,
                parsedKind: parsed.kind,
                submissionDraftReviewed,
                preparedPacketApproved,
                bbbComplaintPrepVisible,
                bbbAutofillCompleted: ftcPracticeSuccess,
              });
              const ok = await handleApprovePreparedPacketFromChat({ fromChatConsent: true });
              if (!ok) {
                assistantText =
                  "I could not save your packet approval on the server. Please try again or use the checklist below.";
              }
            } else if (parsed.kind === "bbb_accuracy_consent") {
              markChatBbbAccuracyConsented(consentCaseId);
              setFtcPracticeConfirmed(true);
            } else if (parsed.kind === "bbb_run_autofill") {
              const ok = await handleRunFtcPracticeFromChat({ fromChatConsent: true });
              if (!ok) {
                assistantText =
                  "BBB autofill did not complete successfully. Review the BBB summary below and try again when ready.";
              }
            } else if (parsed.kind === "bbb_accuracy_and_run") {
              markChatBbbAccuracyConsented(consentCaseId);
              setFtcPracticeConfirmed(true);
              const ok = await handleRunFtcPracticeFromChat({ fromChatConsent: true });
              if (!ok) {
                assistantText =
                  "I recorded your accuracy confirmation, but BBB autofill did not complete successfully. Review the BBB summary below and try again when ready.";
              }
            }

            addChatMessages(
              [userTurn, { id: msgId(), role: "assistant", text: assistantText }],
              { caseId: consentCaseId, source: "legal_consent_gate" }
            );
          } finally {
            sendInFlightRef.current = false;
            setLoading(false);
          }
          return;
        }
      }

      const closureApprovedAction =
        readSessionApprovedNextAction(consentCaseId) ??
        approvedNextActionRef.current ??
        approvedNextAction;
      const resolutionFlowExposed =
        Boolean(closureApprovedAction) &&
        shouldExposeCaseResolutionFlow({
          approvedAction: closureApprovedAction,
          caseId: consentCaseId,
          tasks: savedTasks,
          filings: savedFilings,
        });
      const closureReadinessLoading =
        chatHandlingReadinessLoading ||
        (Boolean(consentCaseId) && savedEvidenceCount === null);
      const handlingTrackingStep =
        closureApprovedAction
          ? deriveChatHandlingTrackingLine({
              basicsReady: isBasicCaseInfoReadyForEscalation(buildJusticeIntakeFromParts(parts)),
              draftReviewed: submissionDraftReviewed,
              preparedPacketApproved,
              evidenceCount: savedEvidenceCount ?? 0,
              filings: savedFilings,
              next: closureApprovedAction,
              canCaptureFilingInline: Boolean(consentCaseId) && isLoaded && Boolean(isSignedIn),
              caseId: consentCaseId,
              tasks: savedTasks,
            })
          : null;
      const closureOwnedEndgame = Boolean(
        closureApprovedAction &&
          shouldSuppressChatManualActionForSurrenderlessOwnedStep({
            approvedAction: closureApprovedAction,
            caseId: consentCaseId,
            tasks: savedTasks,
            filings: savedFilings,
          })
      );
      const closureContext = buildChatCaseClosureGateContext({
        caseId: consentCaseId,
        resolutionFlowExposed,
        followUpNeeded: closureApprovedAction?.follow_up_needed === true,
        handlingTrackingStep,
        readinessLoading: closureReadinessLoading,
        operatorOwnsClosure:
          closureOwnedEndgame ||
          hasOperatorTerminalResponseReviewOutcome(closureApprovedAction),
      });
      const pendingClosureGate = resolvePendingChatCaseClosureGate(closureContext);
      if (pendingClosureGate) {
        const parsedClosure = parseChatCaseClosureMessage(
          trimmed,
          pendingClosureGate,
          closureContext
        );
        if (parsedClosure.kind !== "none") {
          sendInFlightRef.current = true;
          setLoading(true);
          setInputValue("");
          const userTurn = { id: msgId(), role: "user" as const, text: trimmed };
          try {
            let assistantText = buildChatCaseClosureAssistantResponse(parsedClosure);

            if (parsedClosure.kind === "follow_up_handled") {
              const ok = await clearApprovedNextActionFollowUp();
              if (!ok) {
                assistantText =
                  "I could not mark follow-up handled on the server. Please try again or use the button below.";
              }
              addChatMessages(
                [userTurn, { id: msgId(), role: "assistant", text: assistantText }],
                { caseId: consentCaseId, source: "closure_gate" }
              );
            } else if (parsedClosure.kind === "archive_case") {
              const assistantTurn = { id: msgId(), role: "assistant" as const, text: assistantText };
              const archiveTranscriptTurns = uiMessagesToPersistTurns(
                [userTurn, assistantTurn],
                "closure_gate"
              );
              const ok = await handleArchiveActiveCase(consentCaseId, {
                fromChat: true,
                transcriptTurns: archiveTranscriptTurns,
              });
              if (!ok) {
                assistantText =
                  "I could not archive your case on the server. Please try again or use the Archive case button below.";
                addChatMessages(
                  [userTurn, { id: msgId(), role: "assistant", text: assistantText }],
                  { caseId: consentCaseId, source: "closure_gate" }
                );
              }
            } else {
              addChatMessages(
                [userTurn, { id: msgId(), role: "assistant", text: assistantText }],
                { caseId: consentCaseId, source: "closure_gate" }
              );
            }
          } finally {
            sendInFlightRef.current = false;
            setLoading(false);
          }
          return;
        }
      } else if (parseOperatorOwnedArchiveIntent(trimmed, closureContext)) {
        sendInFlightRef.current = true;
        setLoading(true);
        setInputValue("");
        try {
          addChatMessages(
            [
              { id: msgId(), role: "user", text: trimmed },
              {
                id: msgId(),
                role: "assistant",
                text: buildChatCaseClosureAssistantResponse({ kind: "operator_owned_archive" }),
              },
            ],
            { caseId: consentCaseId, source: "closure_gate" }
          );
        } finally {
          sendInFlightRef.current = false;
          setLoading(false);
        }
        return;
      } else if (
        resolutionFlowExposed &&
        parsePrematureArchiveIntent(trimmed, closureContext)
      ) {
        sendInFlightRef.current = true;
        setLoading(true);
        setInputValue("");
        try {
          addChatMessages(
            [
              { id: msgId(), role: "user", text: trimmed },
              {
                id: msgId(),
                role: "assistant",
                text: buildChatCaseClosureAssistantResponse({ kind: "premature_archive" }),
              },
            ],
            { caseId: consentCaseId, source: "closure_gate" }
          );
        } finally {
          sendInFlightRef.current = false;
          setLoading(false);
        }
        return;
      }
    }

    const conversation_history = messages.map((m) => ({
      role: m.role,
      content: m.text,
    }));

    sendInFlightRef.current = true;
    setLoading(true);
    try {
      const res = await fetch("/api/justice/intake-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_message: trimmed,
          parts,
          conversation_history,
        }),
      });

      const data = (await res.json().catch(() => ({}))) as {
        assistantMessage?: string;
        parts?: BuildJusticeIntakeParts;
        error?: string;
      };

      if (!res.ok) {
        setApiError(formatIntakeChatApiError(res.status, data.error));
        return;
      }

      if (typeof data.assistantMessage !== "string" || !data.assistantMessage.trim() || !data.parts) {
        setApiError("Invalid response from AI intake. Please try again.");
        return;
      }

      addChatMessages(
        [
          { id: msgId(), role: "user", text: trimmed },
          { id: msgId(), role: "assistant", text: data.assistantMessage!.trim() },
        ],
        { source: "intake_chat" }
      );
      setParts(enrichContactProofPartsAfterChatTurn(data.parts, trimmed, parts.already_contacted));
      setInputValue("");
      tryShowProofKeywordNudge(trimmed);
    } catch {
      setApiError("Could not reach AI intake. Please try again.");
    } finally {
      sendInFlightRef.current = false;
      setLoading(false);
    }
  }

  async function handleContinueToPreview(): Promise<boolean> {
    setContactProofError(null);
    setStagedProofFlushError(null);
    const basicsMissing = getPreviewBasicsMissing(parts);
    if (basicsMissing.length > 0) {
      return false;
    }
    const proofCheck = validateContactProofForIntake({
      already_contacted: parts.already_contacted,
      contact_proof_type: parts.contact_proof_type,
      contact_proof_text: parts.contact_proof_text,
    });
    if (!proofCheck.ok) {
      setContactProofError(proofCheck.message);
      return false;
    }

    const stagedToFlush = readStagedProofNotes();
    const existingCaseId =
      typeof window !== "undefined" ? sessionStorage.getItem(STORAGE_CASE_ID)?.trim() ?? "" : "";
    const existingLocalIntake = readValidLocalJusticeIntake();
    const isStagedFlushRetry =
      stagedToFlush.length > 0 &&
      Boolean(existingLocalIntake) &&
      Boolean(existingCaseId && isUuid(existingCaseId));

    setSubmitting(true);
    try {
      if (isStagedFlushRetry) {
        const { flushedClientIds, errorMessage } = await flushStagedProofNotesToServer(
          existingCaseId,
          stagedToFlush
        );
        const remaining = removeStagedProofNotesByClientIds(flushedClientIds);
        setStagedProofNotes(remaining);

        if (errorMessage || remaining.length > 0) {
          setStagedProofFlushError(
            errorMessage ??
              "Some staged proof notes could not be saved. Remaining notes stay staged on this device."
          );
          return false;
        }

        if (
          shouldRouteToChatAiAfterIntakeCommit({
            commitResult: { caseId: existingCaseId, serverPersisted: true },
            isLoaded,
            isSignedIn: Boolean(isSignedIn),
            isUpdatingExistingCase,
          })
        ) {
          return true;
        }

        return false;
      }

      const intake = buildJusticeIntakeFromParts(parts);
      const commitResult = await commitIntakeToSessionAndServer({
        intake,
        isLoaded,
        isSignedIn: Boolean(isSignedIn),
        commitLogLabel: "justice chat-ai",
        mode: isUpdatingExistingCase ? "update" : "create",
      });
      // STORAGE_INTAKE/STORAGE_CASE_ID are durable from this point on (set synchronously inside
      // commitIntakeToSessionAndServer regardless of server round-trip outcome) — the pre-commit
      // draft's protective purpose is fulfilled, so it is cleared here rather than left to expire.
      clearIntakeDraft();

      if (!isUpdatingExistingCase && stagedToFlush.length > 0) {
        if (!commitResult.serverPersisted || !isUuid(commitResult.caseId)) {
          setStagedProofFlushError(
            "Your case could not be saved on the server yet. Staged proof notes were not uploaded. Try again."
          );
          return false;
        }

        const { flushedClientIds, errorMessage } = await flushStagedProofNotesToServer(
          commitResult.caseId,
          stagedToFlush
        );
        const remaining = removeStagedProofNotesByClientIds(flushedClientIds);
        setStagedProofNotes(remaining);

        if (errorMessage || remaining.length > 0) {
          setStagedProofFlushError(
            errorMessage ??
              "Some staged proof notes could not be saved. Remaining notes stay staged on this device."
          );
          return false;
        }
      }

      if (isUpdatingExistingCase && sessionChangeLines.length > 0) {
        writePreviewChatUpdateSummary(sessionChangeLines);
      } else {
        clearPreviewChatUpdateSummary();
      }

      const caseIdAfterCommit =
        commitResult.caseId?.trim() ||
        (typeof window !== "undefined" ? sessionStorage.getItem(STORAGE_CASE_ID)?.trim() ?? "" : "");

      if (
        shouldRouteToChatAiAfterIntakeCommit({
          commitResult: { caseId: caseIdAfterCommit, serverPersisted: commitResult.serverPersisted },
          isLoaded,
          isSignedIn: Boolean(isSignedIn),
          isUpdatingExistingCase,
        })
      ) {
        if (!isUpdatingExistingCase) {
          sessionBaselinePartsRef.current = cloneBuildJusticeIntakeParts(parts);
          setIsUpdatingExistingCase(true);
        }
        return true;
      }

      return false;
    } finally {
      setSubmitting(false);
    }
  }

  const activeCaseBannerCls =
    "rounded-2xl border border-blue-200/90 bg-white p-4 shadow-md shadow-neutral-900/5 ring-1 ring-blue-950/[0.06] dark:border-blue-900/50 dark:bg-neutral-900 dark:ring-blue-500/10 sm:p-5";

  const cardCls =
    "rounded-2xl border border-neutral-200/90 bg-white p-5 shadow-lg shadow-neutral-900/5 ring-1 ring-neutral-950/[0.04] dark:border-neutral-700 dark:bg-neutral-900 dark:shadow-black/40 dark:ring-white/[0.06] sm:p-6";
  const inputCls =
    "mt-1 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-neutral-900 shadow-sm ring-1 ring-neutral-950/[0.03] focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:ring-white/[0.04]";
  const labelCls = "block text-sm font-medium text-neutral-700 dark:text-neutral-300";

  const basicsMissing = getPreviewBasicsMissing(parts);
  const stillNeededHint =
    basicsMissing.length > 0 ? stillNeededBeforePreviewMessage(basicsMissing) : null;
  const recapStory = recapStoryDisplay(parts.story);
  const contactProofCheck = validateContactProofForIntake({
    already_contacted: parts.already_contacted,
    contact_proof_type: parts.contact_proof_type,
    contact_proof_text: parts.contact_proof_text,
  });
  const hasValidLocalIntake = Boolean(readValidLocalJusticeIntake());
  const isStagedFlushRetry =
    stagedProofNotes.length > 0 && hasValidLocalIntake && Boolean(activeUuidCaseId);
  const showContinueHandoff = basicsMissing.length === 0 && contactProofCheck.ok;
  const showSessionChangesPanel =
    sessionChangeLines.length > 0 && !showContinueHandoff;
  const continueHandoffSteps = showContinueHandoff
    ? getContinueHandoffSteps({
        isUpdatingExistingCase,
        stagedCount: stagedProofNotes.length,
        isStagedFlushRetry,
        savedEvidenceCount: savedEvidenceCount ?? 0,
        sessionChangeLines: isUpdatingExistingCase ? sessionChangeLines : [],
        chatFirstContinuity: Boolean(isSignedIn),
      })
    : [];

  const activeCaseSessionCaseId =
    typeof window !== "undefined" ? sessionStorage.getItem(STORAGE_CASE_ID)?.trim() ?? "" : "";
  const activeCaseDraftReviewed = activeCaseSessionCaseId
    ? submissionDraftReviewOverride ||
      readSessionSubmissionDraftReviewed(activeCaseSessionCaseId) ||
      submissionDraftReviewedInTimeline(activeCaseSessionCaseId)
    : false;
  const showInlineSubmissionDraftReview =
    isUpdatingExistingCase &&
    isLoaded &&
    Boolean(isSignedIn) &&
    Boolean(activeUuidCaseId) &&
    !activeCaseDraftReviewed;
  const showInlinePreparedPacketApproval =
    isUpdatingExistingCase &&
    isLoaded &&
    Boolean(isSignedIn) &&
    Boolean(activeUuidCaseId) &&
    activeCaseDraftReviewed &&
    !preparedPacketApproved;

  // Issues (or re-issues, on retry) the price request for an exact case. Tags every attempt with
  // a per-case request id so a stale response — an earlier attempt resolving after a retry
  // superseded it, or after the consumer switched to a different case — can never overwrite
  // state for a request that is no longer the one in flight. Never call this when the case is
  // already known paid (see the effect below and the checkout-return effect) — pricing is
  // irrelevant once paid, and this endpoint must never be hit merely to reconfirm that.
  const fetchCheckoutPrice = useCallback((caseId: string) => {
    const requestId = nextCheckoutPriceRequestId(checkoutPriceRequestRef.current, caseId);
    checkoutPriceRequestRef.current = { caseId, requestId };
    checkoutPriceFetchedForCaseRef.current = caseId;
    setCheckoutPriceState({ status: "loading" });

    const isStale = () => isCheckoutPriceResponseStale(checkoutPriceRequestRef.current, caseId, requestId);
    const failClosed = () => {
      if (isStale()) return;
      // Clear the fetched-for guard (not the request id) so a later retry — either this same
      // case re-entering the approval step, or the explicit Retry pricing action — can always
      // issue a fresh request rather than being permanently skipped by the "already fetched" guard.
      if (shouldClearFetchedGuardOnFailure(checkoutPriceFetchedForCaseRef.current, caseId)) {
        checkoutPriceFetchedForCaseRef.current = null;
      }
      setCheckoutPriceState({ status: "unavailable" });
    };

    void (async () => {
      try {
        const res = await fetch(`/api/justice/cases/${encodeURIComponent(caseId)}/checkout`);
        const payload = (await res.json().catch(() => null)) as {
          unitAmount?: number;
          currency?: string;
          alreadyPaid?: boolean;
        } | null;
        if (isStale()) return;
        if (!res.ok || !payload) {
          failClosed();
          return;
        }
        if (payload.alreadyPaid) {
          setCheckoutPriceState({ status: "not_needed" });
          return;
        }
        if (typeof payload.unitAmount === "number" && typeof payload.currency === "string") {
          setCheckoutPriceState({
            status: "ready",
            unitAmount: payload.unitAmount,
            currency: payload.currency,
          });
        } else {
          failClosed();
        }
      } catch (e) {
        console.warn("justice chat-ai: checkout price fetch error", e);
        failClosed();
      }
    })();
  }, []);

  // Resolves the price disclosure BEFORE checkout can ever be triggered — never after the
  // consumer clicks Approve, and never by creating a Checkout Session merely to reveal a price
  // (the endpoint is a read-only Stripe Price lookup). An already-paid case (casePaidAtRef
  // already populated from the server's own paid_at) never issues a pricing/Stripe request at
  // all — pricing is irrelevant once paid, and re-confirming it would be a pointless real
  // network call (and, for the Playwright mock pipeline specifically, one this read-only price
  // endpoint has no mock awareness for, so it would incorrectly report "unavailable").
  useEffect(() => {
    if (!showInlinePreparedPacketApproval || !activeUuidCaseId) return;
    if (shouldSkipCheckoutPriceFetchForPaidCase(Boolean(casePaidAtRef.current))) {
      checkoutPriceFetchedForCaseRef.current = activeUuidCaseId;
      setCheckoutPriceState((prev) => (prev.status === "not_needed" ? prev : { status: "not_needed" }));
      return;
    }
    if (checkoutPriceFetchedForCaseRef.current === activeUuidCaseId) return;
    fetchCheckoutPrice(activeUuidCaseId);
  }, [showInlinePreparedPacketApproval, activeUuidCaseId, fetchCheckoutPrice]);

  const chatInlineApprovedPrepContent = useMemo(() => {
    if (!preparedPacketApproved || !approvedNextAction) return null;
    return getChatInlineApprovedPrepContent(
      approvedNextAction.href,
      buildJusticeIntakeFromParts(parts),
      approvedNextAction.label
    );
  }, [preparedPacketApproved, approvedNextAction, parts]);
  const isActiveUuidCaseChat =
    isUpdatingExistingCase && isLoaded && Boolean(isSignedIn) && Boolean(activeUuidCaseId);
  const showInlineApprovedPrep =
    Boolean(approvedNextAction) &&
    shouldShowChatInlineReadOnlyApprovedPrep({
      isActiveUuidCase: isActiveUuidCaseChat,
      preparedPacketApproved,
      status: approvedNextAction?.status,
      hasPrepContent: Boolean(chatInlineApprovedPrepContent),
    });
  const suppressSurrenderlessOwnedManualUiEarly =
    Boolean(approvedNextAction) &&
    shouldSuppressChatManualActionForSurrenderlessOwnedStep({
      approvedAction: approvedNextAction!,
      caseId: activeUuidCaseId ?? "",
      tasks: savedTasks,
      filings: savedFilings,
    });
  const showInlineRealBbbComplaintPrep =
    !suppressSurrenderlessOwnedManualUiEarly &&
    shouldShowChatInlineRealBbbComplaintPrep({
      isUpdatingExistingCase,
      caseId: activeUuidCaseId,
      isLoaded,
      isSignedIn: Boolean(isSignedIn),
      preparedPacketApproved,
      approvedNextAction,
    });
  const showMarkStepOpenedVisible = false;
  const chatCapturedMerchantContactInput = useMemo(
    () => buildMerchantContactDocumentationInputFromIntakeParts(parts),
    [parts]
  );
  /** Whether approving right now would queue Surrenderless-owned merchant contact (which Surrenderless
   *  sends itself and therefore needs a recipient email for). Mirrors the target the approve handler
   *  computes, so the card gate and the handler gate agree. */
  // The action approving right now would queue. Merchant contact AND demand letter both auto-send to
  // the case's company_contact_email, so both require a recipient (or the operator-fallback choice)
  // before approval. Mirrors the target the approve handler computes so the card and handler agree.
  const approvePreparedTarget = useMemo(() => {
    const intake = buildJusticeIntakeFromParts(parts);
    const manualFtc =
      typeof window !== "undefined" && sessionStorage.getItem(STORAGE_FTC_MANUAL_UNLOCK) === "1";
    const useCompanyContactLabels =
      cfpbLikelyRelevant(intake) || fccLikelyRelevant(intake) || dotLikelyRelevant(intake);
    const destinations = computeJusticeDestinations(intake, {
      manualFtc,
      useCompanyContactLabels,
      hasUploadedEvidenceFile: savedEvidenceRows.some(justiceEvidenceRowHasUploadedFile),
    });
    const prepared = pickPreparedNextAction({
      contacted: intake.already_contacted === "yes",
      useCompanyContactLabels,
      destinations,
    });
    return buildApprovedNextActionTarget(prepared);
  }, [parts, savedEvidenceRows]);
  const approvePreparedTargetNeedsCompanyEmail =
    isApprovedMerchantContactFilingAction(approvePreparedTarget) ||
    isApprovedDemandLetterFilingAction(approvePreparedTarget);
  const merchantContactRecipientOnFileValid = useMemo(
    () => hasValidMerchantContactRecipient(buildJusticeIntakeFromParts(parts)),
    [parts]
  );
  const merchantContactDocumentedInTimeline = useMemo(() => {
    if (!activeUuidCaseId) return false;
    return isMerchantContactDocumentedInTimeline(readTimeline(activeUuidCaseId));
  }, [activeUuidCaseId, parts, savingMerchantContactDocumentation]);
  const needsMerchantContactDocumentation =
    Boolean(isUpdatingExistingCase) &&
    isLoaded &&
    Boolean(isSignedIn) &&
    Boolean(activeUuidCaseId) &&
    preparedPacketApproved &&
    !merchantContactDocumentedInTimeline &&
    !approvedNextAction?.handling_requested_at?.trim();
  const showStateAgFilingQueuedNotice =
    Boolean(activeUuidCaseId) &&
    isApprovedStateAgFilingAction(approvedNextAction) &&
    approvedNextAction.status === "approved" &&
    isChatPendingHumanFulfillmentEscalation({
      approvedAction: approvedNextAction,
      caseId: activeUuidCaseId ?? "",
      tasks: savedTasks,
      filings: savedFilings,
    });
  const showDemandLetterQueuedNotice =
    Boolean(activeUuidCaseId) &&
    isApprovedDemandLetterFilingAction(approvedNextAction) &&
    approvedNextAction.status === "approved" &&
    isChatPendingHumanFulfillmentEscalation({
      approvedAction: approvedNextAction,
      caseId: activeUuidCaseId ?? "",
      tasks: savedTasks,
      filings: savedFilings,
    });
  const openDemandLetterTask = activeUuidCaseId
    ? findOpenDemandLetterFilingTask(savedTasks, activeUuidCaseId)
    : undefined;
  const showDemandLetterSendingNotice =
    showDemandLetterQueuedNotice && isDemandLetterEmailSending(openDemandLetterTask);
  const showDemandLetterSendFailedNotice =
    showDemandLetterQueuedNotice && isDemandLetterEmailFailed(openDemandLetterTask);
  const showCfpbFilingQueuedNotice =
    Boolean(activeUuidCaseId) &&
    isApprovedCfpbFilingAction(approvedNextAction) &&
    approvedNextAction.status === "approved" &&
    isChatPendingHumanFulfillmentEscalation({
      approvedAction: approvedNextAction,
      caseId: activeUuidCaseId ?? "",
      tasks: savedTasks,
      filings: savedFilings,
    });
  const showPaymentDisputeFilingQueuedNotice =
    Boolean(activeUuidCaseId) &&
    isApprovedPaymentDisputeFilingAction(approvedNextAction) &&
    approvedNextAction.status === "approved" &&
    isChatPendingHumanFulfillmentEscalation({
      approvedAction: approvedNextAction,
      caseId: activeUuidCaseId ?? "",
      tasks: savedTasks,
      filings: savedFilings,
    });
  const showFccFilingQueuedNotice =
    Boolean(activeUuidCaseId) &&
    isApprovedFccFilingAction(approvedNextAction) &&
    approvedNextAction.status === "approved" &&
    isChatPendingHumanFulfillmentEscalation({
      approvedAction: approvedNextAction,
      caseId: activeUuidCaseId ?? "",
      tasks: savedTasks,
      filings: savedFilings,
    });
  const showDotFilingQueuedNotice =
    Boolean(activeUuidCaseId) &&
    isApprovedDotFilingAction(approvedNextAction) &&
    approvedNextAction.status === "approved" &&
    isChatPendingHumanFulfillmentEscalation({
      approvedAction: approvedNextAction,
      caseId: activeUuidCaseId ?? "",
      tasks: savedTasks,
      filings: savedFilings,
    });
  const showMerchantContactQueuedNotice =
    Boolean(activeUuidCaseId) &&
    isApprovedMerchantContactFilingAction(approvedNextAction) &&
    approvedNextAction.status === "approved" &&
    isChatPendingHumanFulfillmentEscalation({
      approvedAction: approvedNextAction,
      caseId: activeUuidCaseId ?? "",
      tasks: savedTasks,
      filings: savedFilings,
    });
  const openMerchantContactTask = activeUuidCaseId
    ? findOpenMerchantContactFilingTask(savedTasks, activeUuidCaseId)
    : undefined;
  const showMerchantContactSendingNotice =
    showMerchantContactQueuedNotice && isMerchantContactEmailSending(openMerchantContactTask);
  const showMerchantContactSendFailedNotice =
    showMerchantContactQueuedNotice && isMerchantContactEmailFailed(openMerchantContactTask);
  // Never show merchant contact as "queued" when there is no recipient to send to — automated
  // delivery skips (no recipient) and would otherwise leave the action stuck as queued forever.
  // Surface a recipient prompt instead so the consumer can supply the company's email and send.
  //
  // Visibility is driven by the recipient PERSISTED on the case (the session baseline captured at
  // hydration), not the live editable field — otherwise typing a valid address would flip
  // merchantContactRecipientOnFileValid true and unmount this prompt (and its submit button) before
  // the consumer could send it. The submit button's enabled state below still uses the live value.
  const persistedMerchantContactRecipientMissing = !hasValidMerchantContactRecipient(
    buildJusticeIntakeFromParts(sessionBaselinePartsRef.current ?? parts)
  );
  // Consumer opted for operator fallback (no email): outreach is handled manually, so show honest
  // "operators will handle it" status rather than the automated "queued" copy or a recipient prompt.
  const showMerchantContactOperatorHandlingNotice =
    showMerchantContactQueuedNotice &&
    merchantContactOperatorFallbackChosen &&
    persistedMerchantContactRecipientMissing &&
    !showMerchantContactSendingNotice &&
    !showMerchantContactSendFailedNotice;
  const showMerchantContactNeedsRecipientNotice =
    showMerchantContactQueuedNotice &&
    persistedMerchantContactRecipientMissing &&
    !merchantContactOperatorFallbackChosen &&
    !showMerchantContactSendingNotice &&
    !showMerchantContactSendFailedNotice;
  // Demand letters auto-send to the same company_contact_email as merchant contact, so they reuse the
  // same persisted-recipient-missing signal and operator-fallback choice for honest status/recovery.
  const showDemandLetterOperatorHandlingNotice =
    showDemandLetterQueuedNotice &&
    merchantContactOperatorFallbackChosen &&
    persistedMerchantContactRecipientMissing &&
    !showDemandLetterSendingNotice &&
    !showDemandLetterSendFailedNotice;
  const showDemandLetterNeedsRecipientNotice =
    showDemandLetterQueuedNotice &&
    persistedMerchantContactRecipientMissing &&
    !merchantContactOperatorFallbackChosen &&
    !showDemandLetterSendingNotice &&
    !showDemandLetterSendFailedNotice;
  const openPaymentDisputeTask = activeUuidCaseId
    ? findOpenPaymentDisputeFilingTask(savedTasks, activeUuidCaseId)
    : undefined;
  const showPaymentDisputeSendingNotice =
    showPaymentDisputeFilingQueuedNotice && isPaymentDisputeEmailSending(openPaymentDisputeTask);
  const showPaymentDisputeSendFailedNotice =
    showPaymentDisputeFilingQueuedNotice && isPaymentDisputeEmailFailed(openPaymentDisputeTask);
  // Payment-dispute auto-send needs a card-issuer dispute email that consumers almost never have, so
  // delivery skips and operators handle it. When there's no recipient on file and nothing is
  // sending/failed, tell the truth ("operators are preparing your dispute") instead of "queued".
  const paymentDisputeRecipientMissingOnFile = !hasValidPaymentDisputeRecipient(
    buildJusticeIntakeFromParts(sessionBaselinePartsRef.current ?? parts)
  );
  const showPaymentDisputeOperatorHandlingNotice =
    showPaymentDisputeFilingQueuedNotice &&
    paymentDisputeRecipientMissingOnFile &&
    !showPaymentDisputeSendingNotice &&
    !showPaymentDisputeSendFailedNotice;
  const showFtcFilingQueuedNotice =
    Boolean(activeUuidCaseId) &&
    isApprovedFtcFilingAction(approvedNextAction) &&
    approvedNextAction.status === "approved" &&
    isChatPendingHumanFulfillmentEscalation({
      approvedAction: approvedNextAction,
      caseId: activeUuidCaseId ?? "",
      tasks: savedTasks,
      filings: savedFilings,
    });
  const openFtcFilingTask = activeUuidCaseId
    ? findOpenFtcFilingTask(savedTasks, activeUuidCaseId)
    : undefined;
  const showFtcFilingSubmittingNotice =
    showFtcFilingQueuedNotice && isFtcOwnedFilingSubmitting(openFtcFilingTask);
  const showFtcFilingSubmitFailedNotice =
    showFtcFilingQueuedNotice && isFtcOwnedFilingFailed(openFtcFilingTask);
  const showBbbFilingQueuedNotice =
    Boolean(activeUuidCaseId) &&
    isApprovedBbbFilingAction(approvedNextAction) &&
    approvedNextAction.status === "approved" &&
    isChatPendingHumanFulfillmentEscalation({
      approvedAction: approvedNextAction,
      caseId: activeUuidCaseId ?? "",
      tasks: savedTasks,
      filings: savedFilings,
    });
  const openBbbFilingTask = activeUuidCaseId
    ? findOpenBbbFilingTask(savedTasks, activeUuidCaseId)
    : undefined;
  const showBbbFilingSubmittingNotice =
    showBbbFilingQueuedNotice && isBbbOwnedFilingSubmitting(openBbbFilingTask);
  const showBbbFilingSubmitFailedNotice =
    showBbbFilingQueuedNotice && isBbbOwnedFilingFailed(openBbbFilingTask);
  const demandLetterBounceState = demandLetterEmailBounceState(
    findLatestDemandLetterFiling(savedFilings)
  );
  const showDemandLetterSentNotice =
    Boolean(activeUuidCaseId) &&
    isApprovedDemandLetterFilingAction(approvedNextAction) &&
    !findOpenDemandLetterFilingTask(savedTasks, activeUuidCaseId ?? "") &&
    hasDemandLetterFilingWithConfirmation(savedFilings) &&
    !demandLetterBounceState;
  // Independent of approved_next_action.href so it stays visible after the ladder advances past
  // this step, and reads the latest filing so it clears once remediation lands a fresh one.
  const showDemandLetterBouncedNotice = Boolean(activeUuidCaseId) && Boolean(demandLetterBounceState);
  const showStateAgFilingFiledNotice =
    Boolean(activeUuidCaseId) &&
    isApprovedStateAgFilingAction(approvedNextAction) &&
    !findOpenStateAgFilingTask(savedTasks, activeUuidCaseId ?? "") &&
    hasStateAgFilingWithConfirmation(savedFilings);
  const showCfpbFilingFiledNotice =
    Boolean(activeUuidCaseId) &&
    isApprovedCfpbFilingAction(approvedNextAction) &&
    !findOpenCfpbFilingTask(savedTasks, activeUuidCaseId ?? "") &&
    hasCfpbFilingWithConfirmation(savedFilings);
  const paymentDisputeBounceState = paymentDisputeEmailBounceState(
    findLatestPaymentDisputeFiling(savedFilings)
  );
  const showPaymentDisputeFilingFiledNotice =
    Boolean(activeUuidCaseId) &&
    isApprovedPaymentDisputeFilingAction(approvedNextAction) &&
    !findOpenPaymentDisputeFilingTask(savedTasks, activeUuidCaseId ?? "") &&
    hasPaymentDisputeFilingWithConfirmation(savedFilings) &&
    !paymentDisputeBounceState;
  // Independent of approved_next_action.href so it stays visible after the ladder advances past
  // this step, and reads the latest filing so it clears once remediation lands a fresh one.
  const showPaymentDisputeBouncedNotice =
    Boolean(activeUuidCaseId) && Boolean(paymentDisputeBounceState);
  const showFccFilingFiledNotice =
    Boolean(activeUuidCaseId) &&
    isApprovedFccFilingAction(approvedNextAction) &&
    !findOpenFccFilingTask(savedTasks, activeUuidCaseId ?? "") &&
    hasFccFilingWithConfirmation(savedFilings);
  const showDotFilingFiledNotice =
    Boolean(activeUuidCaseId) &&
    isApprovedDotFilingAction(approvedNextAction) &&
    !findOpenDotFilingTask(savedTasks, activeUuidCaseId ?? "") &&
    hasDotFilingWithConfirmation(savedFilings);
  const merchantContactBounceState = merchantContactEmailBounceState(
    findLatestMerchantContactFiling(savedFilings)
  );
  const showMerchantContactFiledNotice =
    Boolean(activeUuidCaseId) &&
    isApprovedMerchantContactFilingAction(approvedNextAction) &&
    !findOpenMerchantContactFilingTask(savedTasks, activeUuidCaseId ?? "") &&
    hasMerchantContactFilingWithConfirmation(savedFilings) &&
    !merchantContactBounceState;
  // Independent of approved_next_action.href so it stays visible after the ladder advances past
  // this step, and reads the latest filing so it clears once remediation lands a fresh one.
  const showMerchantContactBouncedNotice =
    Boolean(activeUuidCaseId) && Boolean(merchantContactBounceState);
  const showFtcFilingFiledNotice =
    Boolean(activeUuidCaseId) &&
    isApprovedFtcFilingAction(approvedNextAction) &&
    !findOpenFtcFilingTask(savedTasks, activeUuidCaseId ?? "") &&
    hasFtcFilingWithConfirmation(savedFilings);
  const showBbbFilingFiledNotice =
    Boolean(activeUuidCaseId) &&
    isApprovedBbbFilingAction(approvedNextAction) &&
    !findOpenBbbFilingTask(savedTasks, activeUuidCaseId ?? "") &&
    hasBbbFilingWithConfirmation(savedFilings);
  const suppressSurrenderlessOwnedManualUi = suppressSurrenderlessOwnedManualUiEarly;
  const showInlineApprovedPrepVisible =
    showInlineApprovedPrep &&
    !showInlineRealBbbComplaintPrep &&
    !suppressSurrenderlessOwnedManualUi;
  const showInlineMerchantContactConfirmation = shouldShowChatMerchantContactConfirmationControls({
    suppressOwnedManualUi: suppressSurrenderlessOwnedManualUi,
    needsMerchantContactDocumentation,
    hasChatCapturedMerchantContactInput: Boolean(chatCapturedMerchantContactInput),
  });
  const showInlineMerchantContactDocumentation =
    showInlineApprovedPrepVisible &&
    chatInlineApprovedPrepContent?.kind === "merchant_message" &&
    needsMerchantContactDocumentation &&
    !chatCapturedMerchantContactInput;
  const showInlinePaymentDisputePrep =
    isUpdatingExistingCase &&
    isLoaded &&
    Boolean(isSignedIn) &&
    Boolean(activeUuidCaseId) &&
    preparedPacketApproved &&
    Boolean(approvedNextAction) &&
    approvedNextAction?.href?.trim() === CHAT_INLINE_PAYMENT_DISPUTE_PREP_HREF &&
    !approvedNextAction?.handling_requested_at?.trim() &&
    (approvedNextAction?.status === "approved" || approvedNextAction?.status === "started") &&
    !suppressSurrenderlessOwnedManualUi;
  const showInlineFtcPracticePrep =
    !suppressSurrenderlessOwnedManualUi &&
    shouldShowChatInlineFtcMockPracticePrep({
      isUpdatingExistingCase,
      caseId: activeUuidCaseId,
      isLoaded,
      isSignedIn: Boolean(isSignedIn),
      preparedPacketApproved,
      approvedNextAction,
    });
  const showInlineBbbPracticePrep = shouldShowChatInlineBbbMockPracticePrep({
    isUpdatingExistingCase,
    caseId: activeUuidCaseId,
    isLoaded,
    isSignedIn: Boolean(isSignedIn),
    preparedPacketApproved,
    approvedNextAction,
  });
  const showInlinePacketFallbackPrep =
    Boolean(approvedNextAction) &&
    shouldShowChatInlinePacketFallbackReadOnlyPrep({
      isActiveUuidCase: isActiveUuidCaseChat,
      preparedPacketApproved,
      status: approvedNextAction?.status,
      href: approvedNextAction?.href,
    });
  const handlingRequestedForApprovedPrep = Boolean(approvedNextAction?.handling_requested_at?.trim());
  const showInlinePaymentDisputeReadOnlyPrep =
    Boolean(approvedNextAction) &&
    !suppressSurrenderlessOwnedManualUi &&
    shouldShowChatInlinePaymentDisputeReadOnlyPrep({
      isActiveUuidCase: isActiveUuidCaseChat,
      preparedPacketApproved,
      status: approvedNextAction?.status,
      href: approvedNextAction?.href,
      handlingRequested: handlingRequestedForApprovedPrep,
    });
  const showInlineFtcReadOnlyPrep =
    Boolean(approvedNextAction) &&
    !suppressSurrenderlessOwnedManualUi &&
    shouldShowChatInlineFtcMockReadOnlyPrep({
      isActiveUuidCase: isActiveUuidCaseChat,
      preparedPacketApproved,
      status: approvedNextAction?.status,
      href: approvedNextAction?.href,
      handlingRequested: handlingRequestedForApprovedPrep,
    });
  const showInlineBbbReadOnlyPrep =
    Boolean(approvedNextAction) &&
    !suppressSurrenderlessOwnedManualUi &&
    shouldShowChatInlineBbbMockReadOnlyPrep({
      isActiveUuidCase: isActiveUuidCaseChat,
      preparedPacketApproved,
      status: approvedNextAction?.status,
      href: approvedNextAction?.href,
      handlingRequested: handlingRequestedForApprovedPrep,
    });
  const showInlineRealBbbReadOnlyPrep =
    Boolean(approvedNextAction) &&
    !suppressSurrenderlessOwnedManualUi &&
    shouldShowChatInlineRealBbbComplaintReadOnlyPrep({
      isActiveUuidCase: isActiveUuidCaseChat,
      preparedPacketApproved,
      status: approvedNextAction?.status,
      href: approvedNextAction?.href,
      handlingRequested: handlingRequestedForApprovedPrep,
    });
  const prepInlineInChat =
    showInlineApprovedPrepVisible ||
    showInlinePaymentDisputePrep ||
    showInlinePaymentDisputeReadOnlyPrep ||
    showInlineFtcPracticePrep ||
    showInlineBbbPracticePrep ||
    showInlineRealBbbComplaintPrep ||
    showInlineFtcReadOnlyPrep ||
    showInlineBbbReadOnlyPrep ||
    showInlineRealBbbReadOnlyPrep ||
    showInlinePacketFallbackPrep;
  const ftcPracticeSummaryLines = useMemo(() => {
    if (
      !showInlineFtcPracticePrep &&
      !showInlineFtcReadOnlyPrep &&
      !showInlineBbbPracticePrep &&
      !showInlineBbbReadOnlyPrep &&
      !showInlineRealBbbComplaintPrep &&
      !showInlineRealBbbReadOnlyPrep
    ) {
      return [];
    }
    return buildChatInlineAssistedPracticeSummaryLines(
      buildJusticeIntakeFromParts(parts),
      approvedNextAction?.href
    );
  }, [
    showInlineFtcPracticePrep,
    showInlineFtcReadOnlyPrep,
    showInlineBbbPracticePrep,
    showInlineBbbReadOnlyPrep,
    showInlineRealBbbComplaintPrep,
    showInlineRealBbbReadOnlyPrep,
    approvedNextAction?.href,
    parts,
  ]);
  const paymentDisputeReadOnlyLetterText = useMemo(() => {
    if (!showInlinePaymentDisputeReadOnlyPrep || !activeUuidCaseId) return "";
    const intake = buildJusticeIntakeFromParts(parts);
    const fields = resolvePaymentDisputeFormFields(activeUuidCaseId, intake);
    const draft = buildPaymentDisputeDraftFromFields(activeUuidCaseId, fields);
    return buildBankLetter(draft, intake);
  }, [showInlinePaymentDisputeReadOnlyPrep, activeUuidCaseId, parts]);
  const paymentDisputeLetterText = useMemo(() => {
    if (!showInlinePaymentDisputePrep || !activeUuidCaseId) return "";
    const intake = buildJusticeIntakeFromParts(parts);
    const draft = buildPaymentDisputeDraftFromFields(activeUuidCaseId, {
      paymentMethod: paymentDisputePaymentMethod,
      chargeDate: paymentDisputeChargeDate,
      chargeAmount: paymentDisputeChargeAmount,
      merchantName: paymentDisputeMerchantName,
      disputeReason: paymentDisputeReason,
      disputeReasonOther: paymentDisputeReasonOther,
      priorContact: paymentDisputePriorContact,
      proofType: paymentDisputeProofType,
    });
    return buildBankLetter(draft, intake);
  }, [
    showInlinePaymentDisputePrep,
    activeUuidCaseId,
    parts,
    paymentDisputePaymentMethod,
    paymentDisputeChargeDate,
    paymentDisputeChargeAmount,
    paymentDisputeMerchantName,
    paymentDisputeReason,
    paymentDisputeReasonOther,
    paymentDisputePriorContact,
    paymentDisputeProofType,
  ]);
  const merchantDocUseCompanyContactLabels =
    cfpbLikelyRelevant(buildJusticeIntakeFromParts(parts)) ||
    fccLikelyRelevant(buildJusticeIntakeFromParts(parts));
  const activeCaseProductLine = truncateActiveCaseProduct(parts.purchase_or_signup);
  const activeCaseSubline = [categoryLabel(parts.problem_category), activeCaseProductLine]
    .filter(Boolean)
    .join(" · ");
  const activeCaseBasicsReady = isBasicCaseInfoReadyForEscalation(buildJusticeIntakeFromParts(parts));
  const chatCanCaptureFilingInline =
    Boolean(activeUuidCaseId) && isLoaded && Boolean(isSignedIn);
  const chatHandlingTrackingContextLoading =
    chatHandlingReadinessLoading ||
    (Boolean(activeUuidCaseId) && savedEvidenceCount === null);
  const chatManualActionNextStep =
    approvedNextAction && !chatHandlingReadinessLoading
      ? deriveChatHandlingTrackingLine({
          basicsReady: activeCaseBasicsReady,
          draftReviewed: activeCaseDraftReviewed,
          preparedPacketApproved,
          evidenceCount: savedEvidenceCount ?? 0,
          filings: savedFilings,
          next: approvedNextAction,
          canCaptureFilingInline: chatCanCaptureFilingInline,
          caseId: activeUuidCaseId ?? "",
          tasks: savedTasks,
        })
      : null;
  const chatResolutionFlowExposed =
    Boolean(activeUuidCaseId) &&
    Boolean(approvedNextAction) &&
    shouldExposeCaseResolutionFlow({
      approvedAction: approvedNextAction,
      caseId: activeUuidCaseId ?? "",
      tasks: savedTasks,
      filings: savedFilings,
    });
  const showChatAcknowledgment = approvedNextAction
    ? handlingClosureAcknowledgmentVisible({
        manualActionNextStep: chatManualActionNextStep,
        handlingAcknowledgedAt: approvedNextAction.handling_acknowledged_at,
      })
    : false;
  const activeCaseEvidenceReady = showSavedEvidenceCount && (savedEvidenceCount ?? 0) >= 1;
  const chatAiKeepInChatLadder = shouldKeepSignedInChatAiActiveCaseInChat({
    isSignedIn: Boolean(isSignedIn),
    caseId: activeUuidCaseId,
    isUpdatingExistingCase,
  });
  const activeCaseFocusLine =
    basicsMissing.length > 0
      ? stillNeededBeforePreviewMessage(basicsMissing)
      : showInlineSubmissionDraftReview
        ? "Review your submission draft below in this chat."
        : showInlinePreparedPacketApproval
          ? "Approve your prepared packet below in this chat."
          : activeCaseBasicsReady && activeCaseEvidenceReady && !activeCaseDraftReviewed
            ? chatAiKeepInChatLadder
              ? "Review your submission draft below in this chat."
              : "Review your submission draft before continuing."
            : "Describe what to add or change, then save in chat.";
  const chatAiChecklistDraftReviewAction = resolveChatAiChecklistDraftReviewAction({
    draftReviewed: activeCaseDraftReviewed,
    keepInChat: chatAiKeepInChatLadder,
    showInlineBlock: showInlineSubmissionDraftReview,
    activeUuidCaseId,
  });
  const chatAiChecklistPacketApprovalAction = resolveChatAiChecklistPacketApprovalAction({
    draftReviewed: activeCaseDraftReviewed,
    packetApproved: preparedPacketApproved,
    keepInChat: chatAiKeepInChatLadder,
    showInlineBlock: showInlinePreparedPacketApproval,
    activeUuidCaseId,
  });
  const activeCaseWorkHref = resolveChatAiActiveCaseWorkHref({
    keepInChat: chatAiKeepInChatLadder,
    draftReviewed: activeCaseDraftReviewed,
    packetApproved: preparedPacketApproved,
  });
  const activeCaseWorkLabel = resolveChatAiActiveCaseWorkLabel({
    keepInChat: chatAiKeepInChatLadder,
    draftReviewed: activeCaseDraftReviewed,
    packetApproved: preparedPacketApproved,
  });
  const activeCaseSecondaryWorkLink =
    chatAiKeepInChatLadder || !(activeCaseDraftReviewed && preparedPacketApproved)
      ? null
      : { href: "/justice/preview", label: "Submission preview" };
  const chatFirstWorkLinkContinuity = Boolean(isSignedIn) && isUpdatingExistingCase;
  const suppressInlineMainLadderHubLinks = shouldSuppressChatInlineMainLadderHubEscapeLinks({
    // Signed-in consumers never see parallel DIY/prep hub escapes from chat.
    keepInChat: chatAiKeepInChatLadder || Boolean(isSignedIn),
  });
  const suppressInlineOptionalHubEscapeLinks = suppressInlineMainLadderHubLinks;
  const chatFirstBreadcrumbContinuity = Boolean(isSignedIn);
  const chatFirstActiveCaseBreadcrumbContinuity =
    isUpdatingExistingCase && Boolean(activeUuidCaseId);
  const breadcrumbWorkHref =
    chatFirstBreadcrumbContinuity || !isUpdatingExistingCase
      ? "/justice"
      : activeCaseWorkHref;
  const breadcrumbWorkLabel =
    chatFirstBreadcrumbContinuity || !isUpdatingExistingCase
      ? "Justice workspace"
      : activeCaseWorkLabel;

  if (!isLoaded) {
    return (
      <>
        <Header />
        <main className="min-h-[calc(100vh-4rem)] bg-gradient-to-b from-neutral-50 to-neutral-100/80 p-6 text-neutral-500 dark:from-neutral-950 dark:to-neutral-900 dark:text-neutral-400">
          Loading…
        </main>
      </>
    );
  }

  if (!isSignedIn) {
    return <JusticeActionResumeSignInPrompt hasActiveCase={Boolean(activeUuidCaseId)} />;
  }

  return (
    <>
      <Header />
      <main className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-2xl flex-col bg-gradient-to-b from-neutral-50 to-neutral-100/80 px-4 py-8 pb-16 dark:from-neutral-950 dark:to-neutral-900 sm:px-6">
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          {chatFirstActiveCaseBreadcrumbContinuity ? (
            <>
              Home
              {" · "}
              {breadcrumbWorkLabel}
            </>
          ) : (
            <>
              <Link href="/" className="text-blue-600 hover:underline">
                Home
              </Link>
              {" · "}
              <Link
                href={breadcrumbWorkHref}
                className="text-blue-600 hover:underline"
              >
                {breadcrumbWorkLabel}
              </Link>
            </>
          )}
        </p>

        <h1 className="mt-4 text-2xl font-bold text-neutral-900 dark:text-neutral-100">
          Your consumer case
        </h1>
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
          {isUpdatingExistingCase
            ? "Update your loaded case in a conversation — describe what to add or change, then save in chat."
            : "Tell us what happened in a conversation; we'll ask follow-up questions and track your case details."}
        </p>
        <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
          {CHAT_AI_ENTRY_DISCLAIMER}
        </p>

        {isUpdatingExistingCase ? (
          <div className={`mt-4 ${activeCaseBannerCls}`} role="status" aria-label="Active case">
            <p className="text-xs font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-300">
              Active case
            </p>
            <p className="mt-1 text-sm font-semibold text-neutral-900 dark:text-neutral-100">
              {parts.company_name.trim() || "Active case"}
            </p>
            {activeCaseSubline ? (
              <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">{activeCaseSubline}</p>
            ) : null}
            <ul className="mt-2 space-y-1 text-xs text-neutral-700 dark:text-neutral-300">
              <li>
                Basic case info: <ActiveCaseChecklistStatus done={activeCaseBasicsReady} />
                {!activeCaseBasicsReady ? (
                  <>
                    {" · "}
                    <button
                      type="button"
                      onClick={() => document.getElementById("chat-ai-input")?.focus()}
                      className={activeCaseChecklistLinkCls}
                    >
                      Continue in chat below
                    </button>
                  </>
                ) : null}
              </li>
              <li>
                {!showSavedEvidenceCount ? (
                  "Evidence: loading..."
                ) : (
                  <>
                    Evidence: <ActiveCaseChecklistStatus done={activeCaseEvidenceReady} />
                    {!activeCaseEvidenceReady ? (
                      <>
                        {" · "}
                        <button
                          type="button"
                          onClick={() => {
                            setProofNoteDetailsOpen(true);
                            document
                              .getElementById("chat-ai-proof-evidence-panel")
                              ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
                          }}
                          className={activeCaseChecklistLinkCls}
                        >
                          Add proof below
                        </button>
                      </>
                    ) : null}
                  </>
                )}
              </li>
              <li>
                Submission draft reviewed: <ActiveCaseChecklistStatus done={activeCaseDraftReviewed} />
                {!activeCaseDraftReviewed ? (
                  chatAiChecklistDraftReviewAction.kind === "scroll" ? (
                    <>
                      {" · "}
                      <button
                        type="button"
                        onClick={() =>
                          scrollChatAiInlineElementWithHydrationWait(
                            chatAiChecklistDraftReviewAction.targetElementId
                          )
                        }
                        className={activeCaseChecklistLinkCls}
                      >
                        {chatAiChecklistDraftReviewAction.label}
                      </button>
                    </>
                  ) : chatAiChecklistDraftReviewAction.kind === "wait" ? (
                    <>
                      {" · "}
                      <span className="text-neutral-500 dark:text-neutral-400">
                        {chatAiChecklistDraftReviewAction.label}
                      </span>
                    </>
                  ) : null
                ) : null}
              </li>
              {activeCaseDraftReviewed ? (
                <li>
                  Prepared case packet reviewed: <ActiveCaseChecklistStatus done={preparedPacketApproved} />
                  {!preparedPacketApproved ? (
                    chatAiChecklistPacketApprovalAction.kind === "scroll" ? (
                      <>
                        {" · "}
                        <button
                          type="button"
                          onClick={() =>
                            scrollChatAiInlineElementWithHydrationWait(
                              chatAiChecklistPacketApprovalAction.targetElementId
                            )
                          }
                          className={activeCaseChecklistLinkCls}
                        >
                          {chatAiChecklistPacketApprovalAction.label}
                        </button>
                      </>
                    ) : chatAiChecklistPacketApprovalAction.kind === "wait" ? (
                      <>
                        {" · "}
                        <span className="text-neutral-500 dark:text-neutral-400">
                          {chatAiChecklistPacketApprovalAction.label}
                        </span>
                      </>
                    ) : null
                  ) : null}
                </li>
              ) : null}
            </ul>
            {showInlineSubmissionDraftReview ? (
              <div id="chat-ai-inline-submission-draft-review">
                <ChatInlineSubmissionDraftReviewBlock
                draftText={chatSubmissionDraftText}
                aiDraftText={chatAiDraftText}
                destinationLabel={chatPreviewDestination?.label}
                checked={submissionDraftReviewChecked}
                onCheckedChange={setSubmissionDraftReviewChecked}
                expanded={draftPreviewExpanded}
                onExpandedChange={setDraftPreviewExpanded}
                saving={markingSubmissionDraftReviewed}
                error={submissionDraftReviewError}
                onSubmit={() => void handleMarkSubmissionDraftReviewedFromChat()}
                suppressHubLink={suppressInlineMainLadderHubLinks}
                copyHint={inlineDraftCopyHint}
                onCopyDraft={() => {
                  void (async () => {
                    const text = (chatAiDraftText?.trim() || chatSubmissionDraftText).trim();
                    if (!text) return;
                    try {
                      await navigator.clipboard.writeText(text);
                      setInlineDraftCopyHint("Copied to clipboard.");
                      window.setTimeout(() => setInlineDraftCopyHint(null), 2500);
                    } catch {
                      setInlineDraftCopyHint("Copy failed — select the text and copy manually.");
                    }
                  })();
                }}
                aiLoading={chatAiDraftLoading}
                aiError={chatAiDraftError}
                onGenerateAiDraft={() => void handleGenerateChatAiAssistedDraft()}
                />
              </div>
            ) : null}
            {showInlinePreparedPacketApproval ? (
              <div id="chat-ai-inline-prepared-packet-approval">
                <ChatInlinePreparedPacketApprovalBlock
                packetText={chatPacketPlainText}
                loading={chatHandlingReadinessLoading}
                checked={approvePreparedPacketChecked}
                onCheckedChange={setApprovePreparedPacketChecked}
                expanded={packetPreviewExpanded}
                onExpandedChange={setPacketPreviewExpanded}
                approving={approvingPreparedPacket}
                onSubmit={() => {
                  logPlaywrightApprovePacketDiagnostic(
                    "origin:form-submit",
                    typeof window !== "undefined"
                      ? sessionStorage.getItem(STORAGE_CASE_ID)?.trim() ?? ""
                      : "",
                    {
                      approvePreparedPacketChecked,
                      showInlinePreparedPacketApproval,
                      approvingPreparedPacket,
                    }
                  );
                  void handleApprovePreparedPacketFromChat();
                }}
                suppressHubLink={suppressInlineMainLadderHubLinks}
                copyHint={inlinePacketCopyHint}
                onCopyPacket={() => {
                  void (async () => {
                    const text = chatPacketPlainText;
                    if (!text) return;
                    try {
                      await navigator.clipboard.writeText(text);
                      setInlinePacketCopyHint("Copied to clipboard.");
                      window.setTimeout(() => setInlinePacketCopyHint(null), 2500);
                    } catch {
                      setInlinePacketCopyHint("Copy failed — select the text and copy manually.");
                    }
                  })();
                }}
                checkoutPriceState={checkoutPriceState}
                onRetryPricing={() => {
                  if (activeUuidCaseId) fetchCheckoutPrice(activeUuidCaseId);
                }}
                onRetryPaymentConfirmation={() => {
                  if (activeUuidCaseId) void confirmPaymentWithBackoff(activeUuidCaseId);
                }}
                merchantContactRecipientRequired={approvePreparedTargetNeedsCompanyEmail}
                merchantContactRecipientValid={merchantContactRecipientOnFileValid}
                merchantContactRecipientValue={parts.company_contact_email}
                onMerchantContactRecipientChange={(value) => {
                  if (merchantContactOperatorFallbackChosen) {
                    setMerchantContactOperatorFallbackChosen(false);
                  }
                  setParts((prev) => ({ ...prev, company_contact_email: value }));
                }}
                merchantContactOperatorFallbackChosen={merchantContactOperatorFallbackChosen}
                onChooseMerchantContactOperatorFallback={() =>
                  void handleChooseMerchantContactOperatorFallback()
                }
                />
              </div>
            ) : null}
            {showInlineApprovedPrepVisible && chatInlineApprovedPrepContent ? (
              <ChatInlineApprovedPrepActionBlock
                title={chatInlineApprovedPrepContent.title}
                messageText={chatInlineApprovedPrepContent.messageText}
                helperText={chatInlineApprovedPrepContent.helperText}
                copyButtonLabel={chatInlineApprovedPrepContent.copyButtonLabel}
                optionalPageHref={
                  suppressInlineOptionalHubEscapeLinks
                    ? undefined
                    : chatInlineApprovedPrepContent.optionalPageHref
                }
                optionalPageLabel={
                  suppressInlineOptionalHubEscapeLinks
                    ? undefined
                    : chatInlineApprovedPrepContent.optionalPageLabel
                }
                optionalPageNote={
                  suppressInlineOptionalHubEscapeLinks
                    ? undefined
                    : chatInlineApprovedPrepContent.optionalPageNote
                }
                expanded={prepMessageExpanded}
                onExpandedChange={setPrepMessageExpanded}
                copyHint={prepCopyHint}
                onCopy={() => {
                  void (async () => {
                    const text = chatInlineApprovedPrepContent.messageText;
                    if (!text) return;
                    try {
                      await navigator.clipboard.writeText(text);
                      setPrepCopyHint("Copied to clipboard.");
                      window.setTimeout(() => setPrepCopyHint(null), 2500);
                    } catch {
                      setPrepCopyHint("Copy failed — select the text and copy manually.");
                    }
                  })();
                }}
              />
            ) : null}
            {showInlineMerchantContactConfirmation && chatCapturedMerchantContactInput ? (
              <ChatInlineMerchantContactConfirmationBlock
                useCompanyContactLabels={merchantDocUseCompanyContactLabels}
                summaryLines={buildChatCapturedMerchantContactSummaryLines(
                  chatCapturedMerchantContactInput
                )}
                saving={savingMerchantContactDocumentation}
                onConfirm={() => void handleConfirmMerchantContactFromChat()}
              />
            ) : null}
            {showInlineMerchantContactDocumentation ? (
              <ChatInlineMerchantContactDocumentationBlock
                useCompanyContactLabels={merchantDocUseCompanyContactLabels}
                contactMethod={merchantDocContactMethod}
                onContactMethodChange={setMerchantDocContactMethod}
                contactDate={merchantDocContactDate}
                onContactDateChange={(value) => {
                  setMerchantDocContactDate(value);
                  setMerchantDocContactDateError(null);
                }}
                merchantResponseType={merchantDocMerchantResponseType}
                onMerchantResponseTypeChange={setMerchantDocMerchantResponseType}
                contactProofType={merchantDocContactProofType}
                onContactProofTypeChange={(value) => {
                  setMerchantDocContactProofType(value);
                  setMerchantDocContactProofError(null);
                }}
                contactProofText={merchantDocContactProofText}
                onContactProofTextChange={(value) => {
                  setMerchantDocContactProofText(value);
                  setMerchantDocContactProofError(null);
                }}
                contactDateError={merchantDocContactDateError}
                contactProofError={merchantDocContactProofError}
                saving={savingMerchantContactDocumentation}
                onSubmit={(e) => void handleSaveMerchantContactDocumentationFromChat(e)}
              />
            ) : null}
            {showInlinePaymentDisputeReadOnlyPrep ? (
              <ChatInlineApprovedPrepActionBlock
                title={approvedNextAction?.label?.trim() || "Payment dispute (bank/card)"}
                messageText={paymentDisputeReadOnlyLetterText}
                helperText="Copy the bank letter below for your dispute. After you approve, Surrenderless can send payment-dispute outreach for you. Stay in chat for status — operators finish delivery when automation is unavailable."
                copyButtonLabel="Copy letter"
                optionalPageHref={
                  suppressInlineOptionalHubEscapeLinks
                    ? undefined
                    : CHAT_INLINE_PAYMENT_DISPUTE_PREP_HREF
                }
                optionalPageLabel={
                  suppressInlineOptionalHubEscapeLinks
                    ? undefined
                    : "Continue payment dispute in chat"
                }
                optionalPageNote={
                  suppressInlineOptionalHubEscapeLinks ? undefined : "optional — evidence checklist"
                }
                expanded={paymentDisputeLetterExpanded}
                onExpandedChange={setPaymentDisputeLetterExpanded}
                copyHint={paymentDisputeCopyHint}
                onCopy={() => {
                  void (async () => {
                    const text = paymentDisputeReadOnlyLetterText;
                    if (!text) return;
                    try {
                      await navigator.clipboard.writeText(text);
                      setPaymentDisputeCopyHint("Copied to clipboard.");
                      window.setTimeout(() => setPaymentDisputeCopyHint(null), 2500);
                    } catch {
                      setPaymentDisputeCopyHint("Copy failed — select the text and copy manually.");
                    }
                  })();
                }}
              />
            ) : null}
            {showInlinePaymentDisputePrep ? (
              <ChatInlinePaymentDisputePrepBlock
                letterText={paymentDisputeLetterText}
                letterExpanded={paymentDisputeLetterExpanded}
                onLetterExpandedChange={setPaymentDisputeLetterExpanded}
                copyHint={paymentDisputeCopyHint}
                onCopyLetter={() => {
                  void (async () => {
                    if (!paymentDisputeLetterText) return;
                    try {
                      await navigator.clipboard.writeText(paymentDisputeLetterText);
                      setPaymentDisputeCopyHint("Copied to clipboard.");
                      window.setTimeout(() => setPaymentDisputeCopyHint(null), 2500);
                    } catch {
                      setPaymentDisputeCopyHint("Copy failed — select the text and copy manually.");
                    }
                  })();
                }}
                paymentMethod={paymentDisputePaymentMethod}
                onPaymentMethodChange={setPaymentDisputePaymentMethod}
                chargeDate={paymentDisputeChargeDate}
                onChargeDateChange={setPaymentDisputeChargeDate}
                chargeAmount={paymentDisputeChargeAmount}
                onChargeAmountChange={setPaymentDisputeChargeAmount}
                merchantName={paymentDisputeMerchantName}
                onMerchantNameChange={setPaymentDisputeMerchantName}
                disputeReason={paymentDisputeReason}
                onDisputeReasonChange={setPaymentDisputeReason}
                disputeReasonOther={paymentDisputeReasonOther}
                onDisputeReasonOtherChange={setPaymentDisputeReasonOther}
                priorContact={paymentDisputePriorContact}
                onPriorContactChange={setPaymentDisputePriorContact}
                proofType={paymentDisputeProofType}
                onProofTypeChange={setPaymentDisputeProofType}
                saving={savingPaymentDisputeChecklist}
                saveSuccess={paymentDisputeSaveSuccess}
                onSubmit={(e) => void handleSavePaymentDisputeChecklistFromChat(e)}
                suppressOptionalPageLink={suppressInlineOptionalHubEscapeLinks}
              />
            ) : null}
            {showInlineFtcReadOnlyPrep ? (
              <>
                <ChatInlineApprovedPrepActionBlock
                  title={approvedNextAction?.label?.trim() || "FTC practice complaint"}
                  messageText={ftcPracticeSummaryLines.join("\n")}
                  helperText="Practice complaint summary from your case — copy for reference. This is not a real government submission. Live FTC complaints are fulfilled by Surrenderless after you approve (automation or operators)."
                  copyButtonLabel="Copy summary"
                  optionalPageHref={
                    suppressInlineOptionalHubEscapeLinks
                      ? undefined
                      : CHAT_INLINE_FTC_REVIEW_PREP_HREF
                  }
                  optionalPageLabel={
                    suppressInlineOptionalHubEscapeLinks
                      ? undefined
                      : undefined
                  }
                  optionalPageNote={
                    suppressInlineOptionalHubEscapeLinks ? undefined : "optional — evidence list"
                  }
                  expanded={prepMessageExpanded}
                  onExpandedChange={setPrepMessageExpanded}
                  copyHint={prepCopyHint}
                  onCopy={() => {
                    void (async () => {
                      const text = ftcPracticeSummaryLines.join("\n");
                      if (!text) return;
                      try {
                        await navigator.clipboard.writeText(text);
                        setPrepCopyHint("Copied to clipboard.");
                        window.setTimeout(() => setPrepCopyHint(null), 2500);
                      } catch {
                        setPrepCopyHint("Copy failed — select the text and copy manually.");
                      }
                    })();
                  }}
                />
                {isLastAssistedSubmissionAttemptVisibleForApprovedHref(
                  ftcPracticeLastAssistedSubmissionAttempt,
                  approvedNextAction?.href
                ) ? (
                  <LastAssistedSubmissionAttemptSummaryReadOnly
                    snapshot={ftcPracticeLastAssistedSubmissionAttempt!}
                  />
                ) : null}
              </>
            ) : null}
            {showInlineBbbReadOnlyPrep ? (
              <>
                <ChatInlineApprovedPrepActionBlock
                  title={approvedNextAction?.label?.trim() || "BBB practice complaint"}
                  messageText={ftcPracticeSummaryLines.join("\n")}
                  helperText="Practice complaint summary from your case — copy for reference. This is not a live BBB filing. Live BBB complaints are fulfilled by Surrenderless after you approve (automation or operators)."
                  copyButtonLabel="Copy summary"
                  expanded={prepMessageExpanded}
                  onExpandedChange={setPrepMessageExpanded}
                  copyHint={prepCopyHint}
                  onCopy={() => {
                    void (async () => {
                      const text = ftcPracticeSummaryLines.join("\n");
                      if (!text) return;
                      try {
                        await navigator.clipboard.writeText(text);
                        setPrepCopyHint("Copied to clipboard.");
                        window.setTimeout(() => setPrepCopyHint(null), 2500);
                      } catch {
                        setPrepCopyHint("Copy failed — select the text and copy manually.");
                      }
                    })();
                  }}
                />
                {isLastAssistedSubmissionAttemptVisibleForApprovedHref(
                  ftcPracticeLastAssistedSubmissionAttempt,
                  approvedNextAction?.href
                ) ? (
                  <LastAssistedSubmissionAttemptSummaryReadOnly
                    snapshot={ftcPracticeLastAssistedSubmissionAttempt!}
                  />
                ) : null}
              </>
            ) : null}
            {showInlineRealBbbReadOnlyPrep ? (
              <>
                <ChatInlineApprovedPrepActionBlock
                  title={approvedNextAction?.label?.trim() || "BBB complaint"}
                  messageText={ftcPracticeSummaryLines.join("\n")}
                  helperText="Complaint summary from your case — copy for reference. Verify the correct business profile on BBB.org before submitting."
                  copyButtonLabel="Copy summary"
                  optionalPageHref={
                    suppressInlineOptionalHubEscapeLinks ? undefined : CHAT_INLINE_BBB_PREP_HREF
                  }
                  optionalPageLabel={
                    suppressInlineOptionalHubEscapeLinks ? undefined : undefined
                  }
                  optionalPageNote={
                    suppressInlineOptionalHubEscapeLinks
                      ? undefined
                      : "optional — evidence checklist"
                  }
                  expanded={prepMessageExpanded}
                  onExpandedChange={setPrepMessageExpanded}
                  copyHint={prepCopyHint}
                  onCopy={() => {
                    void (async () => {
                      const text = ftcPracticeSummaryLines.join("\n");
                      if (!text) return;
                      try {
                        await navigator.clipboard.writeText(text);
                        setPrepCopyHint("Copied to clipboard.");
                        window.setTimeout(() => setPrepCopyHint(null), 2500);
                      } catch {
                        setPrepCopyHint("Copy failed — select the text and copy manually.");
                      }
                    })();
                  }}
                />
                {isLastAssistedSubmissionAttemptVisibleForApprovedHref(
                  ftcPracticeLastAssistedSubmissionAttempt,
                  approvedNextAction?.href
                ) ? (
                  <LastAssistedSubmissionAttemptSummaryReadOnly
                    snapshot={ftcPracticeLastAssistedSubmissionAttempt!}
                  />
                ) : null}
              </>
            ) : null}
            {showInlineFtcPracticePrep ? (
              <ChatInlineAssistedPracticeBlock
                laneId={MOCK_FTC_PRACTICE_ASSISTED_SUBMISSION_LANE.id}
                summaryLines={ftcPracticeSummaryLines}
                confirmed={ftcPracticeConfirmed}
                onConfirmedChange={setFtcPracticeConfirmed}
                running={ftcPracticeRunning}
                practiceSuccess={ftcPracticeSuccess}
                storageSkipped={ftcPracticeStorageSkipped}
                error={ftcPracticeError}
                lastAssistedSubmissionAttempt={
                  isLastAssistedSubmissionAttemptVisibleForApprovedHref(
                    ftcPracticeLastAssistedSubmissionAttempt,
                    approvedNextAction?.href
                  )
                    ? ftcPracticeLastAssistedSubmissionAttempt
                    : null
                }
                approvedHref={approvedNextAction?.href}
                onRunPractice={() => void handleRunFtcPracticeFromChat()}
                suppressOptionalPageLink={suppressInlineOptionalHubEscapeLinks}
              />
            ) : null}
            {showInlineBbbPracticePrep ? (
              <ChatInlineAssistedPracticeBlock
                laneId={MOCK_BBB_PRACTICE_ASSISTED_SUBMISSION_LANE.id}
                summaryLines={ftcPracticeSummaryLines}
                confirmed={ftcPracticeConfirmed}
                onConfirmedChange={setFtcPracticeConfirmed}
                running={ftcPracticeRunning}
                practiceSuccess={ftcPracticeSuccess}
                storageSkipped={ftcPracticeStorageSkipped}
                error={ftcPracticeError}
                lastAssistedSubmissionAttempt={
                  isLastAssistedSubmissionAttemptVisibleForApprovedHref(
                    ftcPracticeLastAssistedSubmissionAttempt,
                    approvedNextAction?.href
                  )
                    ? ftcPracticeLastAssistedSubmissionAttempt
                    : null
                }
                approvedHref={approvedNextAction?.href}
                onRunPractice={() => void handleRunFtcPracticeFromChat()}
                suppressOptionalPageLink={suppressInlineOptionalHubEscapeLinks}
              />
            ) : null}
            {showInlineRealBbbComplaintPrep ? (
              <ChatInlineRealBbbComplaintBlock
                summaryLines={ftcPracticeSummaryLines}
                confirmed={ftcPracticeConfirmed}
                onConfirmedChange={setFtcPracticeConfirmed}
                running={ftcPracticeRunning}
                complaintSuccess={ftcPracticeSuccess}
                storageSkipped={ftcPracticeStorageSkipped}
                error={ftcPracticeError}
                lastAssistedSubmissionAttempt={
                  isLastAssistedSubmissionAttemptVisibleForApprovedHref(
                    ftcPracticeLastAssistedSubmissionAttempt,
                    approvedNextAction?.href
                  )
                    ? ftcPracticeLastAssistedSubmissionAttempt
                    : null
                }
                approvedHref={approvedNextAction?.href}
                onRunComplaint={() => void handleRunFtcPracticeFromChat()}
                suppressOptionalPageLink={suppressInlineOptionalHubEscapeLinks}
              />
            ) : null}
            {ftcPracticeLastAssistedSubmissionAttempt &&
            !isLastAssistedSubmissionAttemptVisibleForApprovedHref(
              ftcPracticeLastAssistedSubmissionAttempt,
              approvedNextAction?.href
            ) ? (
              <>
                {!isLastAssistedSubmissionAttemptFailed(ftcPracticeLastAssistedSubmissionAttempt) ? (
                  <p className="mt-3 text-[11px] font-medium text-emerald-800 dark:text-emerald-300">
                    Practice autofill completed.
                  </p>
                ) : null}
                <LastAssistedSubmissionAttemptSummaryReadOnly
                  snapshot={ftcPracticeLastAssistedSubmissionAttempt}
                />
              </>
            ) : null}
            {showInlinePacketFallbackPrep ? (
              chatHandlingReadinessLoading ? (
                <div className="mt-3 space-y-2 rounded-lg border border-emerald-300/80 bg-emerald-50/60 px-3 py-2.5 dark:border-emerald-700/60 dark:bg-emerald-950/30">
                  <p className="text-xs font-medium text-emerald-950 dark:text-emerald-100">
                    {approvedNextAction?.label?.trim() || "Prepared case review"}
                  </p>
                  <p className="text-[11px] text-emerald-900/90 dark:text-emerald-100/90">
                    Loading packet preview…
                  </p>
                </div>
              ) : (
                <ChatInlineApprovedPrepActionBlock
                  title={approvedNextAction?.label?.trim() || "Prepared case review"}
                  messageText={chatPacketPlainText}
                  helperText="Review your prepared case packet below. Mark step opened when ready — after approval, Surrenderless can fulfill owned outreach and filings in chat (automation or operators)."
                  copyButtonLabel="Copy packet"
                  optionalPageHref={
                    suppressInlineMainLadderHubLinks
                      ? undefined
                      : CHAT_INLINE_PACKET_FALLBACK_PREP_HREF
                  }
                  optionalPageLabel={
                    suppressInlineMainLadderHubLinks ? undefined : undefined
                  }
                  optionalPageNote={
                    suppressInlineMainLadderHubLinks ? undefined : "optional — print and copy tools"
                  }
                  expanded={packetPreviewExpanded}
                  onExpandedChange={setPacketPreviewExpanded}
                  copyHint={prepCopyHint}
                  onCopy={() => {
                    void (async () => {
                      const text = chatPacketPlainText;
                      if (!text) return;
                      try {
                        await navigator.clipboard.writeText(text);
                        setPrepCopyHint("Copied to clipboard.");
                        window.setTimeout(() => setPrepCopyHint(null), 2500);
                      } catch {
                        setPrepCopyHint("Copy failed — select the text and copy manually.");
                      }
                    })();
                  }}
                />
              )
            ) : null}
            {approvedNextAction ? (
              <>
                {approvedNextAction.label?.trim() ? (
                  <p className="mt-2 text-xs text-neutral-700 dark:text-neutral-300">
                    Next step:{" "}
                    <strong className="text-neutral-800 dark:text-neutral-200">
                      {approvedNextAction.label.trim()}
                    </strong>
                  </p>
                ) : null}
                {approvedNextActionStatusLabel(approvedNextAction.status) ? (
                  <p className="mt-1 text-xs text-neutral-700 dark:text-neutral-300">
                    <span className="font-medium text-neutral-700 dark:text-neutral-300">
                      Approved next action:
                    </span>{" "}
                    {approvedNextActionStatusLabel(approvedNextAction.status)}
                  </p>
                ) : null}
                {chatResolutionFlowExposed && approvedNextAction.outcome_note?.trim() ? (
                  <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-neutral-600 dark:text-neutral-400">
                    {truncateAttentionNote(approvedNextAction.outcome_note.trim(), 200)}
                  </p>
                ) : null}
                {chatResolutionFlowExposed && approvedNextAction.follow_up_needed === true ? (
                  <p className="mt-1 text-xs font-medium text-amber-800 dark:text-amber-200">
                    Follow-up needed
                  </p>
                ) : null}
                {chatResolutionFlowExposed && approvedNextAction.follow_up_at?.trim() ? (
                  <ApprovedNextActionFollowUpTimingLine
                    followUpAt={approvedNextAction.follow_up_at}
                    className="mt-0.5 text-xs text-neutral-600 dark:text-neutral-400"
                  />
                ) : null}
              </>
            ) : null}
            <p className="mt-2 text-xs text-neutral-700 dark:text-neutral-300">{activeCaseFocusLine}</p>
            {!chatFirstWorkLinkContinuity ? (
              <p className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                <Link
                  href={activeCaseWorkHref}
                  className="font-medium text-blue-600 underline underline-offset-2 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                >
                  {activeCaseWorkLabel}
                </Link>
                {activeCaseSecondaryWorkLink ? (
                  <>
                    <span className="text-neutral-400 dark:text-neutral-500">·</span>
                    <Link
                      href={activeCaseSecondaryWorkLink.href}
                      className="font-medium text-blue-600 underline underline-offset-2 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                    >
                      {activeCaseSecondaryWorkLink.label}
                    </Link>
                  </>
                ) : null}
              </p>
            ) : null}
          </div>
        ) : null}

        <div className={`mt-6 flex min-h-[280px] flex-1 flex-col ${cardCls}`}>
          <div ref={scrollRef} className="flex-1 space-y-3 pr-1">
            {messages.map((m) => (
              <div
                key={m.id}
                className={
                  m.role === "assistant"
                    ? "rounded-xl bg-neutral-100 px-3 py-2 text-sm text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100"
                    : "ml-6 rounded-xl bg-blue-600 px-3 py-2 text-sm text-white"
                }
              >
                <p className="whitespace-pre-wrap">{m.text}</p>
              </div>
            ))}
            {loading ? (
              <p className="text-xs text-neutral-500 dark:text-neutral-400">Thinking…</p>
            ) : null}
          </div>

          <div className="mt-4 border-t border-neutral-100 pt-4 dark:border-neutral-700/80">
            <label className={labelCls} htmlFor="chat-ai-input">
              Your message
            </label>
            <textarea
              id="chat-ai-input"
              className={`${inputCls} min-h-[88px] resize-y`}
              value={inputValue}
              onChange={(e) => {
                setInputValue(e.target.value);
                setApiError(null);
              }}
              disabled={loading}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !loading && !sendInFlightRef.current) {
                  e.preventDefault();
                  void handleSend();
                }
              }}
            />
            {apiError ? (
              <p className="mt-2 text-sm text-red-600 dark:text-red-400" role="alert">
                {apiError}
              </p>
            ) : null}
            <button
              type="button"
              disabled={loading || !inputValue.trim()}
              onClick={() => void handleSend()}
              className="mt-4 w-full rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-blue-900/20 transition hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? "Sending…" : "Send"}
            </button>
          </div>

          <div className="mt-4 border-t border-neutral-100 pt-4 dark:border-neutral-700/80">
            <p className="text-xs font-semibold uppercase text-neutral-500 dark:text-neutral-400">Recap</p>
            <ul className="mt-2 space-y-1 text-xs text-neutral-700 dark:text-neutral-300">
              {parts.company_name.trim() ? (
                <li>
                  <span className="font-medium">Company:</span> {parts.company_name.trim()}
                </li>
              ) : null}
              {parts.problem_category ? (
                <li>
                  <span className="font-medium">Category:</span> {categoryLabel(parts.problem_category)}
                </li>
              ) : null}
              {parts.purchase_or_signup.trim() ? (
                <li>
                  <span className="font-medium">Product / service:</span> {parts.purchase_or_signup.trim()}
                </li>
              ) : null}
              {recapStory ? (
                <li>
                  <span className="font-medium">What happened:</span> {recapStory}
                </li>
              ) : null}
              {[parts.money_amount, parts.desired_resolution].some((v) => v.trim()) ? (
                <li>
                  <span className="font-medium">Money / outcome:</span>{" "}
                  {[parts.money_amount, parts.desired_resolution].map((v) => v.trim()).filter(Boolean).join(" — ")}
                </li>
              ) : null}
              {parts.already_contacted === "yes" || parts.already_contacted === "no" ? (
                <li>
                  <span className="font-medium">Contacted company:</span> {parts.already_contacted}
                </li>
              ) : null}
              {parts.reply_email.trim() ? (
                <li>
                  <span className="font-medium">Email:</span> {parts.reply_email.trim()}
                </li>
              ) : null}
              {parts.company_contact_email.trim() ? (
                <li>
                  <span className="font-medium">Company contact email:</span>{" "}
                  {parts.company_contact_email}
                </li>
              ) : null}
              {parts.card_issuer_contact_email.trim() ? (
                <li>
                  <span className="font-medium">Card issuer contact email:</span>{" "}
                  {parts.card_issuer_contact_email}
                </li>
              ) : null}
            </ul>
            {stillNeededHint ? (
              <p className="mt-2 text-sm text-amber-800 dark:text-amber-300">{stillNeededHint}</p>
            ) : null}
            {contactProofError && contactProofError !== stillNeededHint ? (
              <p className="mt-2 text-sm text-red-600 dark:text-red-400">{contactProofError}</p>
            ) : null}

            {isUpdatingExistingCase && approvedNextAction ? (
              <div
                id={CHAT_AI_APPROVED_ACTION_TRACKING_ELEMENT_ID}
                className="mt-4 rounded-xl border border-emerald-300/80 bg-emerald-50/60 px-3 py-2.5 ring-1 ring-emerald-600/15 dark:border-emerald-700/60 dark:bg-emerald-950/30 dark:ring-emerald-400/10"
              >
                <p className="text-xs font-semibold text-emerald-950 dark:text-emerald-100">
                  Current action tracking
                </p>
                {trackingSaveError ? (
                  <p className="mt-2 text-xs text-red-700 dark:text-red-300" role="alert">
                    {trackingSaveError}
                  </p>
                ) : null}
                {approvedNextAction.label ? (
                  <p className="mt-1 text-xs text-emerald-900/95 dark:text-emerald-100/95">
                    Next step: <strong>{approvedNextAction.label}</strong>
                  </p>
                ) : null}
                {approvedNextActionStatusLabel(approvedNextAction.status) ? (
                  <p className="mt-1 text-xs text-emerald-800 dark:text-emerald-200">
                    <span className="font-medium text-neutral-700 dark:text-neutral-300">
                      Approved next action:
                    </span>{" "}
                    {approvedNextActionStatusLabel(approvedNextAction.status)}
                  </p>
                ) : null}
                {showStateAgFilingQueuedNotice ? (
                  <p className="mt-2 text-xs leading-relaxed text-emerald-900 dark:text-emerald-100">
                    <span className="font-medium">State AG filing queued.</span> Surrenderless has
                    queued your State Attorney General complaint for operator filing using your case
                    draft. Nothing has been filed yet.
                    <span className="mt-1 block text-emerald-800/90 dark:text-emerald-200/90">
                      Stay in this chat — operator updates will appear here.
                    </span>
                  </p>
                ) : null}
                {showDemandLetterQueuedNotice ? (
                  showDemandLetterOperatorHandlingNotice ? (
                    <p className="mt-2 text-xs leading-relaxed text-emerald-900 dark:text-emerald-100">
                      <span className="font-medium">Surrenderless operators are sending your demand
                      letter.</span>{" "}
                      You told us you don&apos;t have the company&apos;s email, so our operators will
                      deliver your demand letter for you using your case draft — no automated email is
                      sent.
                      <span className="mt-1 block text-emerald-800/90 dark:text-emerald-200/90">
                        Stay in this chat — status updates will appear here.
                      </span>
                    </p>
                  ) : showDemandLetterNeedsRecipientNotice ? (
                    <div className="mt-2 space-y-1.5 rounded-lg border border-amber-300/80 bg-amber-50/70 px-3 py-2.5 text-xs leading-relaxed text-amber-950 dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-100">
                      <p>
                        <span className="font-medium">We need the company&apos;s email to send your
                        demand letter.</span>{" "}
                        Surrenderless sends it to the company for you, so it can&apos;t go out until you
                        add a valid recipient address. Nothing has been sent yet.
                      </p>
                      <label
                        htmlFor={CHAT_DEMAND_LETTER_RECIPIENT_RETRY_INPUT_ID}
                        className="block font-medium"
                      >
                        Company / merchant contact email
                      </label>
                      <input
                        id={CHAT_DEMAND_LETTER_RECIPIENT_RETRY_INPUT_ID}
                        type="email"
                        inputMode="email"
                        autoComplete="off"
                        value={parts.company_contact_email}
                        onChange={(e) =>
                          setParts((prev) => ({ ...prev, company_contact_email: e.target.value }))
                        }
                        placeholder="support@company.com"
                        className="w-full rounded-md border border-amber-300 bg-white px-2 py-1 text-[12px] text-neutral-900 outline-none focus:border-amber-500 dark:border-amber-800/60 dark:bg-neutral-950 dark:text-neutral-100"
                      />
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          disabled={
                            !merchantContactRecipientOnFileValid || addingMerchantContactRecipient
                          }
                          onClick={() => void handleAddMerchantContactRecipientAndRetry()}
                          className="inline-flex rounded-lg border border-amber-500/80 bg-amber-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-amber-600 dark:hover:bg-amber-500"
                        >
                          {addingMerchantContactRecipient ? "Sending…" : "Save and send demand letter"}
                        </button>
                        <button
                          type="button"
                          disabled={addingMerchantContactRecipient}
                          onClick={() => void handleChooseMerchantContactOperatorFallback()}
                          className="text-[11px] font-medium text-amber-800 underline underline-offset-2 hover:text-amber-950 disabled:opacity-60 dark:text-amber-200 dark:hover:text-amber-100"
                        >
                          I don&apos;t have it — let operators handle sending
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="mt-2 text-xs leading-relaxed text-emerald-900 dark:text-emerald-100">
                      {showDemandLetterSendingNotice ? (
                        <>
                          <span className="font-medium">Demand letter sending.</span> Surrenderless is
                          delivering your demand letter email to the company using your case draft.
                        </>
                      ) : showDemandLetterSendFailedNotice ? (
                        <>
                          <span className="font-medium">Demand letter email failed.</span> Automated
                          delivery did not go through. Operators will complete sending manually —
                          nothing is marked sent until delivery succeeds.
                        </>
                      ) : (
                        <>
                          <span className="font-medium">Demand letter queued with Surrenderless.</span>{" "}
                          Surrenderless has queued your demand letter using your case draft. Nothing has
                          been sent yet.
                        </>
                      )}
                      <span className="mt-1 block text-emerald-800/90 dark:text-emerald-200/90">
                        Stay in this chat — status updates will appear here.
                      </span>
                    </p>
                  )
                ) : null}
                {showCfpbFilingQueuedNotice ? (
                  <p className="mt-2 text-xs leading-relaxed text-emerald-900 dark:text-emerald-100">
                    <span className="font-medium">CFPB filing queued.</span> Surrenderless has queued
                    your CFPB complaint for operator filing using your case draft. Nothing has been
                    filed yet.
                    <span className="mt-1 block text-emerald-800/90 dark:text-emerald-200/90">
                      Stay in this chat — operator updates will appear here.
                    </span>
                  </p>
                ) : null}
                {showPaymentDisputeFilingQueuedNotice ? (
                  <p className="mt-2 text-xs leading-relaxed text-emerald-900 dark:text-emerald-100">
                    {showPaymentDisputeSendingNotice ? (
                      <>
                        <span className="font-medium">Payment dispute sending.</span> Surrenderless is
                        delivering your bank/card dispute email using your prepared dispute packet.
                      </>
                    ) : showPaymentDisputeSendFailedNotice ? (
                      <>
                        <span className="font-medium">Payment dispute email failed.</span> Automated
                        delivery did not go through. Operators will complete the dispute filing
                        manually — nothing is marked filed until delivery succeeds.
                      </>
                    ) : showPaymentDisputeOperatorHandlingNotice ? (
                      <>
                        <span className="font-medium">Surrenderless operators are preparing your
                        payment dispute.</span>{" "}
                        Bank and card disputes are handled for you by our operators using your prepared
                        dispute packet — there&apos;s no automated email to send. If your bank offers a
                        dispute or chargeback option in its app or website, you can also start one there
                        directly.
                      </>
                    ) : (
                      <>
                        <span className="font-medium">Payment dispute filing queued.</span>{" "}
                        Surrenderless has queued your bank/card dispute using your prepared dispute
                        packet. Nothing has been filed yet.
                      </>
                    )}
                    <span className="mt-1 block text-emerald-800/90 dark:text-emerald-200/90">
                      Stay in this chat — status updates will appear here.
                    </span>
                  </p>
                ) : null}
                {showFccFilingQueuedNotice ? (
                  <p className="mt-2 text-xs leading-relaxed text-emerald-900 dark:text-emerald-100">
                    <span className="font-medium">FCC filing queued.</span> Surrenderless has queued
                    your FCC complaint for operator filing using your prepared complaint and evidence.
                    Nothing has been filed yet.
                    <span className="mt-1 block text-emerald-800/90 dark:text-emerald-200/90">
                      Stay in this chat — operator updates will appear here.
                    </span>
                  </p>
                ) : null}
                {showDotFilingQueuedNotice ? (
                  <p className="mt-2 text-xs leading-relaxed text-emerald-900 dark:text-emerald-100">
                    <span className="font-medium">DOT filing queued.</span> Surrenderless has queued
                    your USDOT aviation complaint for operator filing using your prepared complaint and
                    evidence. Nothing has been filed yet.
                    <span className="mt-1 block text-emerald-800/90 dark:text-emerald-200/90">
                      Stay in this chat — operator updates will appear here.
                    </span>
                  </p>
                ) : null}
                {showMerchantContactQueuedNotice ? (
                  showMerchantContactOperatorHandlingNotice ? (
                    <p className="mt-2 text-xs leading-relaxed text-emerald-900 dark:text-emerald-100">
                      <span className="font-medium">Surrenderless operators are handling first
                      contact.</span>{" "}
                      You told us you don&apos;t have the company&apos;s email, so our operators will
                      reach the company for you using your case packet and draft — no automated email
                      is sent.
                      <span className="mt-1 block text-emerald-800/90 dark:text-emerald-200/90">
                        Stay in this chat — status updates will appear here.
                      </span>
                    </p>
                  ) : showMerchantContactNeedsRecipientNotice ? (
                    <div className="mt-2 space-y-1.5 rounded-lg border border-amber-300/80 bg-amber-50/70 px-3 py-2.5 text-xs leading-relaxed text-amber-950 dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-100">
                      <p>
                        <span className="font-medium">We need the company&apos;s email to send your
                        first contact.</span>{" "}
                        Surrenderless sends this message to the company itself, so it can&apos;t go out
                        until you add a valid recipient address. Nothing has been sent yet.
                      </p>
                      <label
                        htmlFor={CHAT_MERCHANT_CONTACT_RECIPIENT_RETRY_INPUT_ID}
                        className="block font-medium"
                      >
                        Company / merchant contact email
                      </label>
                      <input
                        id={CHAT_MERCHANT_CONTACT_RECIPIENT_RETRY_INPUT_ID}
                        type="email"
                        inputMode="email"
                        autoComplete="off"
                        value={parts.company_contact_email}
                        onChange={(e) =>
                          setParts((prev) => ({ ...prev, company_contact_email: e.target.value }))
                        }
                        placeholder="support@company.com"
                        className="w-full rounded-md border border-amber-300 bg-white px-2 py-1 text-[12px] text-neutral-900 outline-none focus:border-amber-500 dark:border-amber-800/60 dark:bg-neutral-950 dark:text-neutral-100"
                      />
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          disabled={
                            !merchantContactRecipientOnFileValid || addingMerchantContactRecipient
                          }
                          onClick={() => void handleAddMerchantContactRecipientAndRetry()}
                          className="inline-flex rounded-lg border border-amber-500/80 bg-amber-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-amber-600 dark:hover:bg-amber-500"
                        >
                          {addingMerchantContactRecipient ? "Sending…" : "Save and send first contact"}
                        </button>
                        <button
                          type="button"
                          disabled={addingMerchantContactRecipient}
                          onClick={() => void handleChooseMerchantContactOperatorFallback()}
                          className="text-[11px] font-medium text-amber-800 underline underline-offset-2 hover:text-amber-950 disabled:opacity-60 dark:text-amber-200 dark:hover:text-amber-100"
                        >
                          I don&apos;t have it — let operators handle outreach
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="mt-2 text-xs leading-relaxed text-emerald-900 dark:text-emerald-100">
                      {showMerchantContactSendingNotice ? (
                        <>
                          <span className="font-medium">Merchant contact sending.</span> Surrenderless
                          is delivering your first-contact email to the company using your case packet
                          and draft.
                        </>
                      ) : showMerchantContactSendFailedNotice ? (
                        <>
                          <span className="font-medium">Merchant contact email failed.</span> Automated
                          delivery did not go through. Operators will complete outreach manually —
                          nothing is marked sent until delivery succeeds.
                        </>
                      ) : (
                        <>
                          <span className="font-medium">Merchant contact queued.</span> Surrenderless
                          has queued merchant or company outreach using your case packet and draft.
                          Nothing has been sent yet.
                        </>
                      )}
                      <span className="mt-1 block text-emerald-800/90 dark:text-emerald-200/90">
                        Stay in this chat — status updates will appear here.
                      </span>
                    </p>
                  )
                ) : null}
                {showFtcFilingQueuedNotice ? (
                  <p className="mt-2 text-xs leading-relaxed text-emerald-900 dark:text-emerald-100">
                    {showFtcFilingSubmittingNotice ? (
                      <>
                        <span className="font-medium">FTC filing submitting.</span> Surrenderless is
                        filing your FTC consumer complaint using your case packet and draft.
                      </>
                    ) : showFtcFilingSubmitFailedNotice ? (
                      <>
                        <span className="font-medium">FTC filing failed.</span> Automated filing did
                        not complete. Operators will finish the FTC complaint manually — nothing is
                        marked filed until confirmation is recorded.
                      </>
                    ) : (
                      <>
                        <span className="font-medium">FTC filing in progress.</span> Surrenderless
                        operators are filing your FTC consumer complaint using your case packet and
                        draft. Nothing has been filed yet.
                      </>
                    )}
                    <span className="mt-1 block text-emerald-800/90 dark:text-emerald-200/90">
                      Stay in this chat — status updates will appear here.
                    </span>
                  </p>
                ) : null}
                {showBbbFilingQueuedNotice ? (
                  <p className="mt-2 text-xs leading-relaxed text-emerald-900 dark:text-emerald-100">
                    {showBbbFilingSubmittingNotice ? (
                      <>
                        <span className="font-medium">BBB filing submitting.</span> Surrenderless is
                        filing your Better Business Bureau complaint using your case packet and draft.
                      </>
                    ) : showBbbFilingSubmitFailedNotice ? (
                      <>
                        <span className="font-medium">BBB filing failed.</span> Automated filing did
                        not complete. Operators will finish the BBB complaint manually — nothing is
                        marked filed until confirmation is recorded.
                      </>
                    ) : (
                      <>
                        <span className="font-medium">BBB filing in progress.</span> Surrenderless
                        operators are filing your Better Business Bureau complaint using your case
                        packet and draft. Nothing has been filed yet.
                      </>
                    )}
                    <span className="mt-1 block text-emerald-800/90 dark:text-emerald-200/90">
                      Stay in this chat — status updates will appear here.
                    </span>
                  </p>
                ) : null}
                {showDemandLetterBouncedNotice ? (
                  <div className="mt-2 rounded-lg border border-amber-300/80 bg-amber-50/80 px-3 py-2 dark:border-amber-700/60 dark:bg-amber-950/30">
                    <p className="text-xs font-medium text-amber-950 dark:text-amber-100">
                      Demand letter did not reach the company.
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-amber-900 dark:text-amber-200">
                      {demandLetterBounceState === "complained"
                        ? "The company's email provider marked it as spam."
                        : "The email bounced and was not delivered."}{" "}
                      Surrenderless operators have been notified and will follow up with the
                      company another way.
                    </p>
                  </div>
                ) : null}
                {showDemandLetterSentNotice ? (
                  <p className="mt-2 text-xs leading-relaxed text-emerald-900 dark:text-emerald-100">
                    <span className="font-medium">Demand letter sent.</span> Surrenderless recorded
                    your demand letter with confirmation on file. Your case will advance to the next
                    approved step when tracking updates.
                  </p>
                ) : null}
                {showStateAgFilingFiledNotice ? (
                  <p className="mt-2 text-xs leading-relaxed text-emerald-900 dark:text-emerald-100">
                    <span className="font-medium">State AG filed.</span> Surrenderless recorded your
                    State Attorney General complaint filing with confirmation on file. Your case will
                    advance to the next approved step when tracking updates.
                  </p>
                ) : null}
                {showCfpbFilingFiledNotice ? (
                  <p className="mt-2 text-xs leading-relaxed text-emerald-900 dark:text-emerald-100">
                    <span className="font-medium">CFPB filed.</span> Surrenderless recorded your CFPB
                    complaint filing with confirmation on file. Your case will advance to the next
                    approved step when tracking updates.
                  </p>
                ) : null}
                {showPaymentDisputeBouncedNotice ? (
                  <div className="mt-2 rounded-lg border border-amber-300/80 bg-amber-50/80 px-3 py-2 dark:border-amber-700/60 dark:bg-amber-950/30">
                    <p className="text-xs font-medium text-amber-950 dark:text-amber-100">
                      Payment dispute did not reach the bank/card issuer.
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-amber-900 dark:text-amber-200">
                      {paymentDisputeBounceState === "complained"
                        ? "The issuer's email provider marked it as spam."
                        : "The email bounced and was not delivered."}{" "}
                      Surrenderless operators have been notified and will follow up another way.
                    </p>
                  </div>
                ) : null}
                {showPaymentDisputeFilingFiledNotice ? (
                  <p className="mt-2 text-xs leading-relaxed text-emerald-900 dark:text-emerald-100">
                    <span className="font-medium">Payment dispute sent.</span> Surrenderless recorded
                    your bank/card dispute filing with provider confirmation on file. Your case will
                    advance to the next approved step when tracking updates.
                  </p>
                ) : null}
                {showFccFilingFiledNotice ? (
                  <p className="mt-2 text-xs leading-relaxed text-emerald-900 dark:text-emerald-100">
                    <span className="font-medium">FCC filed.</span> Surrenderless recorded your FCC
                    complaint filing with confirmation on file. Your case will advance to the next
                    approved step when tracking updates.
                  </p>
                ) : null}
                {showDotFilingFiledNotice ? (
                  <p className="mt-2 text-xs leading-relaxed text-emerald-900 dark:text-emerald-100">
                    <span className="font-medium">DOT filed.</span> Surrenderless recorded your USDOT
                    aviation complaint filing with confirmation on file. Your case will advance to the
                    next approved step when tracking updates.
                  </p>
                ) : null}
                {showMerchantContactBouncedNotice ? (
                  <div className="mt-2 rounded-lg border border-amber-300/80 bg-amber-50/80 px-3 py-2 dark:border-amber-700/60 dark:bg-amber-950/30">
                    <p className="text-xs font-medium text-amber-950 dark:text-amber-100">
                      Merchant outreach did not reach the company.
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-amber-900 dark:text-amber-200">
                      {merchantContactBounceState === "complained"
                        ? "The company's email provider marked it as spam."
                        : "The email bounced and was not delivered."}{" "}
                      Surrenderless operators have been notified and will follow up with the
                      company another way.
                    </p>
                  </div>
                ) : null}
                {showMerchantContactFiledNotice ? (
                  <p className="mt-2 text-xs leading-relaxed text-emerald-900 dark:text-emerald-100">
                    <span className="font-medium">Merchant contact sent.</span> Surrenderless recorded
                    merchant or company outreach with provider confirmation on file. Your case will
                    advance to the next approved step when tracking updates.
                  </p>
                ) : null}
                {showFtcFilingFiledNotice ? (
                  <p className="mt-2 text-xs leading-relaxed text-emerald-900 dark:text-emerald-100">
                    <span className="font-medium">FTC filed.</span> Surrenderless recorded your FTC
                    consumer complaint filing with confirmation on file. Your case will advance to the
                    next approved step when tracking updates.
                  </p>
                ) : null}
                {showBbbFilingFiledNotice ? (
                  <p className="mt-2 text-xs leading-relaxed text-emerald-900 dark:text-emerald-100">
                    <span className="font-medium">BBB filed.</span> Surrenderless recorded your Better
                    Business Bureau complaint filing with confirmation on file. Your case will advance
                    to the next approved step when tracking updates.
                  </p>
                ) : null}
                {showMarkStepOpenedVisible ? (
                  <>
                    <p className="mt-1.5 text-xs leading-relaxed text-emerald-800/90 dark:text-emerald-200/90">
                      Records this step as opened in Surrenderless. It does not submit, file, or
                      contact anyone.
                    </p>
                    <button
                      type="button"
                      disabled={markingActionStarted}
                      onClick={() => void handleApprovedNextActionOpen()}
                      className="mt-2 inline-flex rounded-lg border border-emerald-400/80 bg-white/80 px-3 py-1.5 text-xs font-medium text-emerald-900 shadow-sm transition hover:bg-emerald-50 disabled:opacity-60 dark:border-emerald-600/60 dark:bg-emerald-950/50 dark:text-emerald-100 dark:hover:bg-emerald-900/60"
                    >
                      {markingActionStarted ? "Saving…" : "Mark step opened"}
                    </button>
                    <p className="mt-1.5 text-[11px] text-emerald-800/80 dark:text-emerald-200/80">
                      Tracking only — not automatic filing or submission.
                    </p>
                    {!prepInlineInChat &&
                    resolveAssistedSubmissionLaneForApprovedHref(approvedNextAction.href) ===
                      undefined ? (
                      <p className="mt-1.5 text-xs text-emerald-800 dark:text-emerald-200">
                        <Link
                          href={(approvedNextAction.href ?? "").trim()}
                          className="font-medium underline underline-offset-2 hover:text-emerald-950 dark:text-emerald-300 dark:hover:text-emerald-100"
                        >
                          Open {(approvedNextAction.label ?? "").trim()} (optional)
                        </Link>
                      </p>
                    ) : null}
                  </>
                ) : null}
                {approvedNextAction.status === "started" ? (
                  <>
                    <p className="mt-1.5 text-xs font-medium text-emerald-800 dark:text-emerald-200">
                      Opened for next step.
                    </p>
                    {approvedNextAction.started_at?.trim() ? (
                      <p className="mt-1 text-xs text-emerald-800 dark:text-emerald-200">
                        Opened{" "}
                        {formatApprovedNextActionHandlingTimestamp(
                          approvedNextAction.started_at.trim()
                        )}
                      </p>
                    ) : null}
                    <p className="mt-1.5 text-[11px] text-emerald-800/80 dark:text-emerald-200/80">
                      Stay in chat — Surrenderless carries fulfillment. Consumer DIY “record handled”
                      is not available here.
                    </p>
                  </>
                ) : null}
                {approvedNextAction.status === "completed" ? (
                  <>
                    <p className="mt-1.5 text-xs font-medium text-emerald-800 dark:text-emerald-200">
                      Next action recorded as handled for now
                      {approvedNextAction.label ? (
                        <>
                          {": "}
                          <strong>{approvedNextAction.label}</strong>
                        </>
                      ) : null}
                      .
                    </p>
                    {approvedNextAction.completed_at?.trim() ? (
                      <p className="mt-1 text-xs text-emerald-800 dark:text-emerald-200">
                        Handled for now{" "}
                        {formatApprovedNextActionHandlingTimestamp(
                          approvedNextAction.completed_at.trim()
                        )}
                      </p>
                    ) : null}
                    <p className="mt-1.5 text-[11px] text-emerald-800/80 dark:text-emerald-200/80">
                      Tracking only — not automatic filing or submission.
                    </p>
                    {chatResolutionTrackingFormOpen({
                      action: approvedNextAction,
                      caseId: activeUuidCaseId ?? "",
                      tasks: savedTasks,
                      filings: savedFilings,
                      suppressOwnedManualUi: suppressSurrenderlessOwnedManualUi,
                    }) ? (
                      <ApprovedNextActionOutcomeTrackingForm
                        action={approvedNextAction}
                        onSave={handleSaveApprovedNextActionTracking}
                      />
                    ) : chatResolutionFlowExposed ? (
                      <p className="mt-3 text-[11px] leading-relaxed text-emerald-800/90 dark:text-emerald-200/90">
                        {OWNED_ENDGAME_WAIT_COPY}
                      </p>
                    ) : approvedNextAction.outcome_note?.trim() ? (
                      <p className="mt-3 whitespace-pre-wrap text-xs leading-relaxed text-emerald-900/95 dark:text-emerald-100/95">
                        {approvedNextAction.outcome_note.trim()}
                      </p>
                    ) : null}
                  </>
                ) : null}
                {showChatApprovedPacketActionHandlingTracking({
                  preparedPacketApproved,
                  approvedNextAction,
                }) ? (
                  <>
                    {suppressSurrenderlessOwnedManualUi ? (
                      <p className="mt-2 text-[11px] leading-relaxed text-emerald-800/80 dark:text-emerald-200/80">
                        Surrenderless is carrying this approved step. Queued, in-progress, and
                        completed updates appear above — stay in chat while operator fulfillment
                        runs.
                      </p>
                    ) : (
                      <p className="mt-2 text-[11px] leading-relaxed text-emerald-800/80 dark:text-emerald-200/80">
                        Approved case packet and next in-app step — stay in chat. Surrenderless
                        carries preparation and fulfillment; consumer DIY handling is not available
                        here.
                      </p>
                    )}
                    <ChatHandlingTrackingStatusReadOnly
                      readinessLoading={chatHandlingTrackingContextLoading}
                      approvedNextAction={approvedNextAction}
                      basicsReady={activeCaseBasicsReady}
                      draftReviewed={activeCaseDraftReviewed}
                      preparedPacketApproved={preparedPacketApproved}
                      evidenceCount={savedEvidenceCount ?? 0}
                      filings={savedFilings}
                      tasks={savedTasks}
                      markAcknowledgedOnScreen={false}
                      prepInlineInChat={prepInlineInChat}
                      suppressOwnedStepManualNavigation={suppressSurrenderlessOwnedManualUi}
                      suppressDestinationPrepHubEscapes={suppressInlineOptionalHubEscapeLinks}
                      canCaptureFiling={Boolean(activeUuidCaseId) && isLoaded && Boolean(isSignedIn)}
                      caseId={activeUuidCaseId}
                      onFilingsSaved={handleChatManualFilingsSaved}
                      canArchiveCase={Boolean(activeUuidCaseId) && isLoaded && Boolean(isSignedIn)}
                      onArchiveCase={(id) => void handleArchiveActiveCase(id)}
                      archiving={archivingCase}
                      archiveError={archiveCaseError}
                      savingFollowUpResponseReviewOutcome={savingFollowUpResponseReviewOutcome}
                      followUpResponseReviewError={followUpResponseReviewError}
                      onFollowUpResponseReviewOutcome={(taskId, outcome) =>
                        void handleFollowUpResponseReviewOutcome(taskId, outcome)
                      }
                      savingSupersededLaneReviewTaskId={savingSupersededLaneReviewTaskId}
                      supersededLaneReviewErrorByTaskId={supersededLaneReviewErrorByTaskId}
                      reviewDeepLinkTaskId={reviewDeepLinkTaskId}
                      onSupersededLaneReviewOutcome={(task, outcome) =>
                        void handleSupersededLaneReviewOutcome(task, outcome)
                      }
                    />
                  </>
                ) : null}
                {!shouldShowChatConsumerManualHandlingControls(
                  suppressSurrenderlessOwnedManualUi
                )
                  ? null
                  : approvedNextAction.handling_requested_at?.trim() ? (
                  approvedNextAction.status === "completed" ? (
                    <ApprovedNextActionHandlingRequestedReadOnly
                      requestedAt={approvedNextAction.handling_requested_at.trim()}
                      requestNote={approvedNextAction.handling_request_note}
                      acknowledgedAt={approvedNextAction.handling_acknowledged_at}
                      wrapperClassName="mt-2 rounded-lg border border-emerald-400/50 bg-white/60 px-2.5 py-2 dark:border-emerald-600/40 dark:bg-emerald-950/40"
                      recordedClassName="mt-0.5"
                    />
                  ) : (
                    <ApprovedNextActionHandlingRequestBlock
                      action={approvedNextAction}
                      onRequest={handleRequestSurrenderlessHandling}
                      onUpdateNote={handleUpdateHandlingRequestNote}
                      allowEditNote
                      requesting={requestingHandling}
                      updatingNote={updatingHandlingNote}
                      wrapperClassName="mt-2 rounded-lg border border-emerald-400/50 bg-white/60 px-2.5 py-2 dark:border-emerald-600/40 dark:bg-emerald-950/40"
                      recordedClassName="mt-0.5"
                    />
                  )
                ) : approvedNextAction.status !== "completed" ? (
                  <ApprovedNextActionHandlingRequestBlock
                    action={approvedNextAction}
                    onRequest={handleRequestSurrenderlessHandling}
                    onUpdateNote={handleUpdateHandlingRequestNote}
                    allowEditNote
                    requesting={requestingHandling}
                    updatingNote={updatingHandlingNote}
                    wrapperClassName="mt-2 rounded-lg border border-emerald-400/50 bg-white/60 px-2.5 py-2 dark:border-emerald-600/40 dark:bg-emerald-950/40"
                    recordedClassName="mt-0.5"
                  />
                ) : null}
                {approvedNextAction.handling_requested_at?.trim() ? (
                  <>
                    {shouldShowChatConsumerManualHandlingControls(
                      suppressSurrenderlessOwnedManualUi
                    ) ? (
                      <ApprovedNextActionHandlingQueueStatusReadOnly
                        handlingRequestedAt={approvedNextAction.handling_requested_at.trim()}
                        handlingAcknowledgedAt={approvedNextAction.handling_acknowledged_at}
                        className="mt-1 text-xs text-emerald-800/90 dark:text-emerald-200/90"
                      />
                    ) : null}
                    <ChatHandlingTrackingStatusReadOnly
                      readinessLoading={chatHandlingTrackingContextLoading}
                      approvedNextAction={approvedNextAction}
                      basicsReady={activeCaseBasicsReady}
                      draftReviewed={activeCaseDraftReviewed}
                      preparedPacketApproved={preparedPacketApproved}
                      evidenceCount={savedEvidenceCount ?? 0}
                      filings={savedFilings}
                      tasks={savedTasks}
                      markAcknowledgedOnScreen={
                        shouldShowChatConsumerManualHandlingControls(
                          suppressSurrenderlessOwnedManualUi
                        ) && showChatAcknowledgment
                      }
                      prepInlineInChat={prepInlineInChat}
                      suppressOwnedStepManualNavigation={suppressSurrenderlessOwnedManualUi}
                      suppressDestinationPrepHubEscapes={suppressInlineOptionalHubEscapeLinks}
                      canCaptureFiling={Boolean(activeUuidCaseId) && isLoaded && Boolean(isSignedIn)}
                      caseId={activeUuidCaseId}
                      onFilingsSaved={handleChatManualFilingsSaved}
                      canArchiveCase={Boolean(activeUuidCaseId) && isLoaded && Boolean(isSignedIn)}
                      onArchiveCase={(id) => void handleArchiveActiveCase(id)}
                      archiving={archivingCase}
                      archiveError={archiveCaseError}
                      savingFollowUpResponseReviewOutcome={savingFollowUpResponseReviewOutcome}
                      followUpResponseReviewError={followUpResponseReviewError}
                      onFollowUpResponseReviewOutcome={(taskId, outcome) =>
                        void handleFollowUpResponseReviewOutcome(taskId, outcome)
                      }
                      savingSupersededLaneReviewTaskId={savingSupersededLaneReviewTaskId}
                      supersededLaneReviewErrorByTaskId={supersededLaneReviewErrorByTaskId}
                      reviewDeepLinkTaskId={reviewDeepLinkTaskId}
                      onSupersededLaneReviewOutcome={(task, outcome) =>
                        void handleSupersededLaneReviewOutcome(task, outcome)
                      }
                    />
                    {approvedNextAction.status !== "completed" &&
                    chatResolutionTrackingFormOpen({
                      action: approvedNextAction,
                      caseId: activeUuidCaseId ?? "",
                      tasks: savedTasks,
                      filings: savedFilings,
                      suppressOwnedManualUi: suppressSurrenderlessOwnedManualUi,
                    }) ? (
                      <ApprovedNextActionOutcomeTrackingForm
                        action={approvedNextAction}
                        onSave={handleSaveApprovedNextActionTracking}
                      />
                    ) : approvedNextAction.status !== "completed" &&
                      chatResolutionFlowExposed ? (
                      <p className="mt-3 text-[11px] leading-relaxed text-emerald-800/90 dark:text-emerald-200/90">
                        {OWNED_ENDGAME_WAIT_COPY}
                      </p>
                    ) : approvedNextAction.status !== "completed" &&
                      approvedNextAction.outcome_note?.trim() ? (
                      <p className="mt-3 whitespace-pre-wrap text-xs leading-relaxed text-emerald-900/95 dark:text-emerald-100/95">
                        {approvedNextAction.outcome_note.trim()}
                      </p>
                    ) : null}
                    {shouldShowChatConsumerManualHandlingControls(
                      suppressSurrenderlessOwnedManualUi
                    ) && showChatAcknowledgment ? (
                      <ApprovedNextActionHandlingHandledOpenTriageNote variant="inlineAck" />
                    ) : null}
                    {shouldShowChatConsumerManualHandlingControls(
                      suppressSurrenderlessOwnedManualUi
                    ) && showChatAcknowledgment ? (
                      <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                        <button
                          type="button"
                          disabled={acknowledgingHandling}
                          onClick={() => void handleAcknowledgeHandlingRequest()}
                          className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-800 shadow-sm transition hover:bg-neutral-50 disabled:opacity-60 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800"
                        >
                          {acknowledgingHandling ? "Saving…" : "Mark acknowledged"}
                        </button>
                        <p className="text-[11px] text-emerald-800/80 dark:text-emerald-200/80 sm:max-w-[14rem]">
                          {APPROVED_NEXT_ACTION_HANDLING_ACKNOWLEDGE_HELPER}
                        </p>
                      </div>
                    ) : null}
                  </>
                ) : null}
                {approvedNextAction.status !== "completed" &&
                !approvedNextAction.handling_requested_at?.trim() &&
                chatResolutionFlowExposed ? (
                  <>
                    {approvedNextAction.outcome_note?.trim() ? (
                      <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-emerald-900/95 dark:text-emerald-100/95">
                        {approvedNextAction.outcome_note.trim()}
                      </p>
                    ) : null}
                    {approvedNextAction.follow_up_needed === true ? (
                      <p className="mt-1 text-xs font-medium text-amber-800 dark:text-amber-200">
                        Follow-up needed
                      </p>
                    ) : null}
                    <ApprovedNextActionFollowUpTimingLine
                      followUpAt={approvedNextAction.follow_up_at}
                      className="mt-1 text-emerald-800 dark:text-emerald-200"
                    />
                  </>
                ) : null}
                {approvedNextAction.status !== "completed" &&
                approvedNextAction.handling_requested_at?.trim() &&
                !chatResolutionTrackingFormOpen({
                  action: approvedNextAction,
                  caseId: activeUuidCaseId ?? "",
                  tasks: savedTasks,
                  filings: savedFilings,
                  suppressOwnedManualUi: suppressSurrenderlessOwnedManualUi,
                }) &&
                chatResolutionFlowExposed ? (
                  <>
                    {approvedNextAction.follow_up_needed === true ? (
                      <p className="mt-1 text-xs font-medium text-amber-800 dark:text-amber-200">
                        Follow-up needed
                      </p>
                    ) : null}
                    <ApprovedNextActionFollowUpTimingLine
                      followUpAt={approvedNextAction.follow_up_at}
                      className="mt-1 text-emerald-800 dark:text-emerald-200"
                    />
                  </>
                ) : null}
                {showChatApprovedPacketActionHandlingTracking({
                  preparedPacketApproved,
                  approvedNextAction,
                }) || approvedNextAction.handling_requested_at?.trim() ? (
                  <ChatHandlingWorkbenchInChatNotice />
                ) : null}
                <p className="mt-2 text-[11px] text-emerald-800/80 dark:text-emerald-200/80">
                  {OWNED_STEP_CHAT_STATUS_COPY}
                </p>
                {shouldShowChatConsumerEndgameDiyControls(
                  suppressSurrenderlessOwnedManualUi
                ) &&
                approvedNextAction.follow_up_needed === true &&
                chatResolutionFlowExposed ? (
                  <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                    <button
                      type="button"
                      disabled={clearingFollowUp}
                      onClick={() => void clearApprovedNextActionFollowUp()}
                      className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-800 shadow-sm transition hover:bg-neutral-50 disabled:opacity-60 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800"
                    >
                      {clearingFollowUp ? "Clearing…" : "Mark follow-up handled"}
                    </button>
                    <p className="text-[11px] text-neutral-600 dark:text-neutral-400 sm:max-w-[14rem]">
                      Clears this from Needs attention on Saved cases. Your outcome note and dates stay saved. Not automatic filing or submission.
                    </p>
                  </div>
                ) : null}
                {!chatFirstWorkLinkContinuity ? (
                  <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                    <Link
                      href={activeCaseWorkHref}
                      className="font-medium text-emerald-800 underline underline-offset-2 hover:text-emerald-950 dark:text-emerald-300 dark:hover:text-emerald-100"
                    >
                      {activeCaseWorkLabel}
                    </Link>
                    {activeCaseSecondaryWorkLink ? (
                      <>
                        <span className="text-emerald-700/60 dark:text-emerald-400/60">·</span>
                        <Link
                          href={activeCaseSecondaryWorkLink.href}
                          className="font-medium text-emerald-800 underline underline-offset-2 hover:text-emerald-950 dark:text-emerald-300 dark:hover:text-emerald-100"
                        >
                          {activeCaseSecondaryWorkLink.label}
                        </Link>
                      </>
                    ) : null}
                  </p>
                ) : null}
              </div>
            ) : null}

            <div
              id="chat-ai-proof-evidence-panel"
              className="mt-4 rounded-xl border border-neutral-200/90 bg-neutral-50/80 p-3 ring-1 ring-neutral-950/[0.03] dark:border-neutral-600 dark:bg-neutral-800/50 dark:ring-white/[0.04]"
            >
              <p className="text-xs font-semibold uppercase text-neutral-500 dark:text-neutral-400">
                Proof / evidence
              </p>
              {showSavedEvidenceCount ? (
                <p className="mt-2 text-xs font-medium text-neutral-700 dark:text-neutral-300">
                  {savedEvidenceCount === 0
                    ? "No saved evidence yet."
                    : `Saved evidence: ${savedEvidenceCount} item${savedEvidenceCount === 1 ? "" : "s"}.`}
                </p>
              ) : null}
              {showStagedProofNotes ? (
                <>
                  <p className="mt-2 text-xs font-medium text-neutral-700 dark:text-neutral-300">
                    Pending proof notes: {stagedProofNotes.length} item
                    {stagedProofNotes.length === 1 ? "" : "s"}
                    {canStageProofNoteInChat
                      ? " (on this device until you save your case in chat)."
                      : " (pending upload — Continue to save to your case)."}
                  </p>
                  <ul className="mt-2 space-y-2">
                    {stagedProofNotes.map((note) => {
                      const descPreview = truncateChatEvidenceDescription(
                        note.description ?? null,
                        CHAT_EVIDENCE_DESC_PREVIEW_MAX
                      );
                      return (
                        <li
                          key={note.clientId}
                          className="rounded-lg border border-neutral-200/80 bg-white/60 px-3 py-2 dark:border-neutral-600/80 dark:bg-neutral-900/40"
                        >
                          <p className="text-xs font-medium text-neutral-800 dark:text-neutral-200">
                            {note.title}
                          </p>
                          <p className="mt-0.5 text-[11px] text-neutral-600 dark:text-neutral-400">
                            {chatEvidenceTypeLabel(note.evidence_type)}
                          </p>
                          {note.evidence_date ? (
                            <p className="mt-0.5 text-[11px] text-neutral-600 dark:text-neutral-400">
                              {note.evidence_date}
                            </p>
                          ) : null}
                          {descPreview ? (
                            <p className="mt-0.5 whitespace-pre-wrap text-[11px] leading-relaxed text-neutral-700 dark:text-neutral-300">
                              {descPreview}
                            </p>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                </>
              ) : null}
              {showRecentEvidencePreview ? (
                <details className="mt-2 rounded-lg border border-neutral-200/80 bg-white/60 px-3 py-2 dark:border-neutral-600/80 dark:bg-neutral-900/40">
                  <summary className="cursor-pointer text-xs font-medium text-neutral-800 dark:text-neutral-200">
                    Recent proof notes
                    {savedEvidenceCount > CHAT_RECENT_EVIDENCE_MAX
                      ? ` (${CHAT_RECENT_EVIDENCE_MAX} of ${savedEvidenceCount})`
                      : ` (${recentEvidenceRows.length})`}
                  </summary>
                  <p className="mt-2 text-[11px] leading-relaxed text-neutral-600 dark:text-neutral-400">
                    Recent notes and uploaded files. Descriptions are shortened in the list. Edit or delete recent notes
                    here.
                  </p>
                  {recentEvidenceEditSuccess ? (
                    <p className="mt-2 text-xs font-medium text-emerald-800 dark:text-emerald-300">
                      {recentEvidenceEditSuccess}
                    </p>
                  ) : null}
                  {recentEvidenceDeleteSuccess ? (
                    <p className="mt-2 text-xs font-medium text-emerald-800 dark:text-emerald-300">
                      {recentEvidenceDeleteSuccess}
                    </p>
                  ) : null}
                  {recentEvidenceDeleteError ? (
                    <p className="mt-2 text-xs text-red-600 dark:text-red-400">{recentEvidenceDeleteError}</p>
                  ) : null}
                  <ul className="mt-2 space-y-2">
                    {recentEvidenceRows.map((row) => {
                      const descPreview = truncateChatEvidenceDescription(
                        row.description,
                        CHAT_EVIDENCE_DESC_PREVIEW_MAX
                      );
                      return (
                        <li
                          key={row.id}
                          className="border-t border-neutral-100 pt-2 first:border-t-0 first:pt-0 dark:border-neutral-700/80"
                        >
                          {editingRecentEvidenceId === row.id ? (
                            <form
                              className="space-y-2"
                              onSubmit={(e) => void handleSaveRecentEvidenceEdit(e, row.id)}
                            >
                              <p className="text-[11px] font-medium text-neutral-800 dark:text-neutral-200">
                                Edit proof note
                              </p>
                              <div>
                                <label className={labelCls} htmlFor={`chat-ai-edit-proof-title-${row.id}`}>
                                  Title
                                </label>
                                <input
                                  id={`chat-ai-edit-proof-title-${row.id}`}
                                  className={inputCls}
                                  value={editRecentEvidenceTitle}
                                  onChange={(e) => {
                                    setEditRecentEvidenceTitle(e.target.value);
                                    setRecentEvidenceEditError(null);
                                    setRecentEvidenceEditSuccess(null);
                                  }}
                                  required
                                  maxLength={500}
                                  autoComplete="off"
                                  disabled={savingRecentEvidenceEdit}
                                />
                              </div>
                              <div>
                                <label className={labelCls} htmlFor={`chat-ai-edit-proof-type-${row.id}`}>
                                  Type
                                </label>
                                <select
                                  id={`chat-ai-edit-proof-type-${row.id}`}
                                  className={inputCls}
                                  value={editRecentEvidenceType}
                                  onChange={(e) => {
                                    setEditRecentEvidenceType(e.target.value as JusticeEvidenceType);
                                    setRecentEvidenceEditSuccess(null);
                                  }}
                                  disabled={savingRecentEvidenceEdit}
                                >
                                  {JUSTICE_EVIDENCE_TYPES.map((t) => (
                                    <option key={t} value={t}>
                                      {JUSTICE_EVIDENCE_TYPE_LABELS[t]}
                                    </option>
                                  ))}
                                </select>
                              </div>
                              <div>
                                <label className={labelCls} htmlFor={`chat-ai-edit-proof-date-${row.id}`}>
                                  Evidence date{" "}
                                  <span className="font-normal text-neutral-500 dark:text-neutral-400">
                                    (optional)
                                  </span>
                                </label>
                                <input
                                  id={`chat-ai-edit-proof-date-${row.id}`}
                                  className={inputCls}
                                  value={editRecentEvidenceDate}
                                  onChange={(e) => {
                                    setEditRecentEvidenceDate(e.target.value);
                                    setRecentEvidenceEditError(null);
                                    setRecentEvidenceEditSuccess(null);
                                  }}
                                  maxLength={200}
                                  autoComplete="off"
                                  disabled={savingRecentEvidenceEdit}
                                  placeholder="e.g. 2026-01-15 or March phone call"
                                />
                              </div>
                              <div>
                                <label className={labelCls} htmlFor={`chat-ai-edit-proof-desc-${row.id}`}>
                                  Description{" "}
                                  <span className="font-normal text-neutral-500 dark:text-neutral-400">
                                    (optional)
                                  </span>
                                </label>
                                <textarea
                                  id={`chat-ai-edit-proof-desc-${row.id}`}
                                  className={`${inputCls} min-h-[72px] resize-y`}
                                  value={editRecentEvidenceDescription}
                                  onChange={(e) => {
                                    setEditRecentEvidenceDescription(e.target.value);
                                    setRecentEvidenceEditError(null);
                                    setRecentEvidenceEditSuccess(null);
                                  }}
                                  maxLength={8000}
                                  disabled={savingRecentEvidenceEdit}
                                  placeholder="What this shows, ticket numbers, etc."
                                />
                              </div>
                              {recentEvidenceEditError ? (
                                <p className="text-xs text-red-600 dark:text-red-400">
                                  {recentEvidenceEditError}
                                </p>
                              ) : null}
                              <div className="flex flex-wrap gap-2">
                                <button
                                  type="submit"
                                  disabled={savingRecentEvidenceEdit || !editRecentEvidenceTitle.trim()}
                                  className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-800 shadow-sm transition hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800"
                                >
                                  {savingRecentEvidenceEdit ? "Saving…" : "Save"}
                                </button>
                                <button
                                  type="button"
                                  disabled={savingRecentEvidenceEdit}
                                  onClick={cancelEditRecentEvidence}
                                  className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 shadow-sm transition hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
                                >
                                  Cancel
                                </button>
                              </div>
                            </form>
                          ) : (
                            <>
                              <p className="text-xs font-medium text-neutral-800 dark:text-neutral-200">
                                {row.title}
                              </p>
                              <p className="mt-0.5 text-[11px] text-neutral-600 dark:text-neutral-400">
                                {chatEvidenceTypeLabel(row.evidence_type)}
                              </p>
                              {justiceEvidenceRowHasUploadedFile(row) ? (
                                <p className="mt-0.5 text-[11px] text-neutral-600 dark:text-neutral-400">
                                  File: {row.file_name}
                                  {row.mime_type ? ` (${row.mime_type})` : ""}
                                  {buildPrivateEvidenceFileAccessPath(row.id) ? (
                                    <>
                                      {" · "}
                                      <a
                                        href={buildPrivateEvidenceFileAccessPath(row.id)!}
                                        className="font-medium text-neutral-800 underline underline-offset-2 dark:text-neutral-200"
                                      >
                                        Download file
                                      </a>
                                    </>
                                  ) : null}
                                </p>
                              ) : null}
                              {row.evidence_date ? (
                                <p className="mt-0.5 text-[11px] text-neutral-600 dark:text-neutral-400">
                                  {row.evidence_date}
                                </p>
                              ) : null}
                              {descPreview ? (
                                <p className="mt-0.5 whitespace-pre-wrap text-[11px] leading-relaxed text-neutral-700 dark:text-neutral-300">
                                  {descPreview}
                                </p>
                              ) : null}
                              <div className="mt-1.5 flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  disabled={
                                    savingRecentEvidenceEdit ||
                                    deletingRecentEvidenceId !== null ||
                                    Boolean(editingRecentEvidenceId)
                                  }
                                  onClick={() => startEditRecentEvidence(row)}
                                  className="rounded-lg border border-neutral-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-neutral-800 shadow-sm transition hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800"
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  disabled={
                                    savingRecentEvidenceEdit ||
                                    Boolean(editingRecentEvidenceId) ||
                                    deletingRecentEvidenceId !== null
                                  }
                                  onClick={() => void handleDeleteRecentEvidence(row.id)}
                                  className="rounded-lg border border-red-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-red-800 shadow-sm transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-900/50 dark:bg-neutral-900 dark:text-red-200 dark:hover:bg-red-950/40"
                                >
                                  {deletingRecentEvidenceId === row.id ? "Deleting…" : "Delete"}
                                </button>
                              </div>
                            </>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </details>
              ) : null}
              <p className="mt-2 text-xs leading-relaxed text-neutral-700 dark:text-neutral-300">
                As we build your case in this chat, Surrenderless can organize proof that strengthens it — for example
                screenshots, receipts, order confirmations, emails, account pages, tracking pages, call notes, or chat
                transcripts. Attach image or PDF files here, or add short proof notes for what you already have on file.
              </p>
              <p className="mt-2 text-xs leading-relaxed text-neutral-600 dark:text-neutral-400">
                {CHAT_AI_EVIDENCE_ESCALATION_HINT}
              </p>
              {canAddProofNoteInChat ? (
                <div className="mt-3 rounded-lg border border-neutral-200/80 bg-white/60 px-3 py-2 dark:border-neutral-600/80 dark:bg-neutral-900/40">
                  <p className="text-xs font-medium text-neutral-800 dark:text-neutral-200">
                    Attach evidence file
                  </p>
                  <p className="mt-1 text-[11px] leading-relaxed text-neutral-600 dark:text-neutral-400">
                    JPEG, PNG, WebP, GIF, or PDF up to {JUSTICE_EVIDENCE_UPLOAD_MAX_BYTES / (1024 * 1024)} MB.
                    Files stay on this case for packet and later steps.
                  </p>
                  <input
                    ref={evidenceFileInputRef}
                    id="chat-ai-evidence-file"
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif,application/pdf,.jpg,.jpeg,.png,.webp,.gif,.pdf"
                    className="mt-2 block w-full text-xs text-neutral-700 file:mr-3 file:rounded-lg file:border file:border-neutral-300 file:bg-white file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-neutral-800 dark:text-neutral-300 dark:file:border-neutral-600 dark:file:bg-neutral-900 dark:file:text-neutral-200"
                    disabled={uploadingEvidenceFile}
                    onChange={(e) => void handleUploadEvidenceFile(e.target.files)}
                  />
                  {uploadingEvidenceFile ? (
                    <p className="mt-2 text-xs text-neutral-700 dark:text-neutral-300" role="status">
                      Uploading
                      {evidenceUploadFileName ? ` ${evidenceUploadFileName}` : ""}
                      {typeof evidenceUploadProgress === "number"
                        ? `… ${Math.round(evidenceUploadProgress)}%`
                        : "…"}
                    </p>
                  ) : null}
                  {evidenceUploadError ? (
                    <p className="mt-2 text-xs text-red-600 dark:text-red-400">{evidenceUploadError}</p>
                  ) : null}
                  {evidenceUploadSuccess ? (
                    <p className="mt-2 text-xs font-medium text-emerald-800 dark:text-emerald-300">
                      {evidenceUploadSuccess}
                    </p>
                  ) : null}
                </div>
              ) : null}
              {canAddProofNoteInChat && showProofKeywordNudge ? (
                <div className="mt-3 rounded-lg border border-amber-200/90 bg-amber-50/80 px-3 py-2 dark:border-amber-800/60 dark:bg-amber-950/30">
                  <p className="text-[11px] leading-relaxed text-amber-950 dark:text-amber-100">
                    You mentioned records that could support your case. Attach a file above or add a short proof note
                    below.
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowProofKeywordNudge(false)}
                    className="mt-2 rounded-lg border border-amber-300/80 bg-white px-2.5 py-1 text-[11px] font-semibold text-amber-950 shadow-sm transition hover:bg-amber-50 dark:border-amber-700/60 dark:bg-neutral-900 dark:text-amber-100 dark:hover:bg-amber-950/50"
                  >
                    Got it
                  </button>
                </div>
              ) : null}
              {canUseProofNoteForm ? (
                <details
                  open={proofNoteDetailsOpen}
                  onToggle={(e) => setProofNoteDetailsOpen(e.currentTarget.open)}
                  className="mt-3 rounded-lg border border-neutral-200/80 bg-white/60 px-3 py-2 dark:border-neutral-600/80 dark:bg-neutral-900/40"
                >
                  <summary className="cursor-pointer text-xs font-medium text-neutral-800 dark:text-neutral-200">
                    Add a proof note
                  </summary>
                  <form className="mt-2 space-y-2" onSubmit={(e) => void handleAddProofNote(e)}>
                    <p className="text-[11px] leading-relaxed text-neutral-600 dark:text-neutral-400">
                      {canStageProofNoteInChat
                        ? "Stage metadata about what you have on file. Staged on this device until you save your case in chat. After the case is saved, you can also attach image or PDF files above."
                        : "Save metadata about what you have on file, or attach an image/PDF with Attach evidence file above."}
                    </p>
                    <div>
                      <label className={labelCls} htmlFor="chat-ai-proof-title">
                        Title
                      </label>
                      <input
                        id="chat-ai-proof-title"
                        className={inputCls}
                        value={proofNoteTitle}
                        onChange={(e) => {
                          setProofNoteTitle(e.target.value);
                          setProofNoteError(null);
                          setProofNoteSuccess(null);
                        }}
                        required
                        maxLength={500}
                        autoComplete="off"
                        disabled={savingProofNote}
                        placeholder="e.g. Receipt for order #1234"
                      />
                    </div>
                    <div>
                      <label className={labelCls} htmlFor="chat-ai-proof-type">
                        Type
                      </label>
                      <select
                        id="chat-ai-proof-type"
                        className={inputCls}
                        value={proofNoteType}
                        onChange={(e) => {
                          setProofNoteType(e.target.value as JusticeEvidenceType);
                          setProofNoteSuccess(null);
                        }}
                        disabled={savingProofNote}
                      >
                        {JUSTICE_EVIDENCE_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {JUSTICE_EVIDENCE_TYPE_LABELS[t]}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className={labelCls} htmlFor="chat-ai-proof-date">
                        Evidence date{" "}
                        <span className="font-normal text-neutral-500 dark:text-neutral-400">(optional)</span>
                      </label>
                      <input
                        id="chat-ai-proof-date"
                        className={inputCls}
                        value={proofNoteEvidenceDate}
                        onChange={(e) => {
                          setProofNoteEvidenceDate(e.target.value);
                          setProofNoteError(null);
                          setProofNoteSuccess(null);
                        }}
                        maxLength={200}
                        autoComplete="off"
                        disabled={savingProofNote}
                        placeholder="e.g. 2026-01-15 or March phone call"
                      />
                    </div>
                    <div>
                      <label className={labelCls} htmlFor="chat-ai-proof-desc">
                        Description{" "}
                        <span className="font-normal text-neutral-500 dark:text-neutral-400">(optional)</span>
                      </label>
                      <textarea
                        id="chat-ai-proof-desc"
                        className={`${inputCls} min-h-[72px] resize-y`}
                        value={proofNoteDescription}
                        onChange={(e) => {
                          setProofNoteDescription(e.target.value);
                          setProofNoteError(null);
                          setProofNoteSuccess(null);
                        }}
                        maxLength={8000}
                        disabled={savingProofNote}
                        placeholder="What this shows, ticket numbers, etc."
                      />
                    </div>
                    {proofNoteError ? (
                      <p className="text-xs text-red-600 dark:text-red-400">{proofNoteError}</p>
                    ) : null}
                    {proofNoteSuccess ? (
                      <p className="text-xs font-medium text-emerald-800 dark:text-emerald-300">
                        {proofNoteSuccess}
                      </p>
                    ) : null}
                    <button
                      type="submit"
                      disabled={savingProofNote || !proofNoteTitle.trim()}
                      className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-xs font-semibold text-neutral-800 shadow-sm transition hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800"
                    >
                      {savingProofNote
                        ? "Saving…"
                        : canStageProofNoteInChat
                          ? "Stage proof note"
                          : "Save proof note"}
                    </button>
                  </form>
                </details>
              ) : null}
              {stagedProofFlushError ? (
                <p className="mt-3 text-xs text-red-600 dark:text-red-400">{stagedProofFlushError}</p>
              ) : null}
              {canAddProofNoteInChat ? (
                !suppressInlineOptionalHubEscapeLinks ? (
                  <p className="mt-3 text-xs text-neutral-700 dark:text-neutral-300">
                    <Link
                      href="/justice/evidence"
                      className="font-medium underline underline-offset-2 hover:text-neutral-900 dark:text-neutral-200 dark:hover:text-neutral-100"
                    >
                      Organize evidence
                    </Link>
                    <span className="text-[11px] text-neutral-500 dark:text-neutral-400">
                      {" "}
                      (optional — full list and links)
                    </span>
                  </p>
                ) : null
              ) : !suppressInlineOptionalHubEscapeLinks ? (
                <Link
                  href="/justice/evidence"
                  className="mt-3 inline-flex w-full items-center justify-center rounded-xl border border-blue-600 bg-white px-4 py-2 text-sm font-semibold text-blue-600 shadow-sm transition hover:bg-blue-50 dark:border-blue-500 dark:bg-neutral-900 dark:text-blue-400 dark:hover:bg-neutral-800"
                >
                  Organize evidence
                </Link>
              ) : null}
            </div>

            {basicsMissing.length === 0 && !contactProofCheck.ok ? (
              <p className="mt-4 text-sm text-amber-800 dark:text-amber-300">
                {contactProofCheck.message}
              </p>
            ) : null}
            {showSessionChangesPanel ? (
              <div
                className="mt-4 rounded-xl border border-blue-200/90 bg-blue-50/50 px-3 py-2.5 ring-1 ring-blue-950/[0.04] dark:border-blue-900/50 dark:bg-blue-950/20 dark:ring-blue-500/10"
                role="status"
                aria-label="Updated in this chat"
              >
                <p className="text-xs font-semibold uppercase text-blue-800 dark:text-blue-200">
                  Updated in this chat
                </p>
                <ul className="mt-2 list-disc space-y-1 pl-4 text-xs leading-relaxed text-neutral-700 dark:text-neutral-300">
                  {sessionChangeLines.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-neutral-600 dark:text-neutral-400">
                  Review these updates, then save in chat when ready.
                </p>
              </div>
            ) : null}
            {showContinueHandoff ? (
              <div className="mt-4 rounded-xl border border-neutral-200/90 bg-neutral-50/80 px-3 py-2.5 ring-1 ring-neutral-950/[0.03] dark:border-neutral-600 dark:bg-neutral-800/50 dark:ring-white/[0.04]">
                <p className="text-xs font-semibold uppercase text-neutral-500 dark:text-neutral-400">
                  What happens next
                </p>
                <ul className="mt-2 list-disc space-y-1 pl-4 text-xs leading-relaxed text-neutral-700 dark:text-neutral-300">
                  {continueHandoffSteps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <button
              type="button"
              disabled={submitting || loading || basicsMissing.length > 0}
              onClick={() => void handleContinueToPreview()}
              className="mt-4 w-full rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-blue-900/20 transition hover:bg-blue-700 disabled:opacity-50"
            >
              {submitting ? "Saving…" : "Save and continue in chat"}
            </button>
          </div>
        </div>
      </main>
    </>
  );
}

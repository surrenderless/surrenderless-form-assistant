export const CHAT_AI_INLINE_SUBMISSION_DRAFT_REVIEW_ELEMENT_ID =
  "chat-ai-inline-submission-draft-review";
export const CHAT_AI_INLINE_PREPARED_PACKET_APPROVAL_ELEMENT_ID =
  "chat-ai-inline-prepared-packet-approval";
export const CHAT_AI_APPROVED_ACTION_TRACKING_ELEMENT_ID = "chat-ai-approved-action-tracking";
export const CHAT_AI_INLINE_FILING_CAPTURE_ELEMENT_ID = "chat-ai-inline-filing-capture";

export const CHAT_AI_MAIN_LADDER_OFF_CHAT_HREFS = [
  "/justice/preview",
  "/justice/packet",
  "/justice/handling",
] as const;

export type ChatAiMainLadderOffChatHref = (typeof CHAT_AI_MAIN_LADDER_OFF_CHAT_HREFS)[number];

export function isChatAiMainLadderOffChatHref(href: string | null | undefined): boolean {
  const trimmed = href?.trim() ?? "";
  return (CHAT_AI_MAIN_LADDER_OFF_CHAT_HREFS as readonly string[]).includes(trimmed);
}

/** Signed-in chat-ai consumers updating an existing case stay on the in-chat ladder. */
export function shouldKeepSignedInChatAiActiveCaseInChat(input: {
  isSignedIn: boolean;
  isUpdatingExistingCase: boolean;
}): boolean {
  return input.isSignedIn && input.isUpdatingExistingCase;
}

export type ChatAiChecklistStepAction =
  | { kind: "hidden" }
  | { kind: "scroll"; targetElementId: string; label: string }
  | { kind: "wait"; label: string };

export function resolveChatAiChecklistDraftReviewAction(input: {
  draftReviewed: boolean;
  keepInChat: boolean;
  showInlineBlock: boolean;
  activeUuidCaseId: string;
}): ChatAiChecklistStepAction {
  if (input.draftReviewed) return { kind: "hidden" };
  if (!input.keepInChat) {
    return {
      kind: "scroll",
      targetElementId: CHAT_AI_INLINE_SUBMISSION_DRAFT_REVIEW_ELEMENT_ID,
      label: "Review below",
    };
  }
  if (input.showInlineBlock || input.activeUuidCaseId) {
    return {
      kind: "scroll",
      targetElementId: CHAT_AI_INLINE_SUBMISSION_DRAFT_REVIEW_ELEMENT_ID,
      label: "Review below",
    };
  }
  return { kind: "wait", label: "Loading draft review…" };
}

export function resolveChatAiChecklistPacketApprovalAction(input: {
  draftReviewed: boolean;
  packetApproved: boolean;
  keepInChat: boolean;
  showInlineBlock: boolean;
  activeUuidCaseId: string;
}): ChatAiChecklistStepAction {
  if (!input.draftReviewed || input.packetApproved) return { kind: "hidden" };
  if (!input.keepInChat) {
    return {
      kind: "scroll",
      targetElementId: CHAT_AI_INLINE_PREPARED_PACKET_APPROVAL_ELEMENT_ID,
      label: "Approve below",
    };
  }
  if (input.showInlineBlock || input.activeUuidCaseId) {
    return {
      kind: "scroll",
      targetElementId: CHAT_AI_INLINE_PREPARED_PACKET_APPROVAL_ELEMENT_ID,
      label: "Approve below",
    };
  }
  return { kind: "wait", label: "Loading packet approval…" };
}

export function resolveChatAiActiveCaseWorkHref(input: {
  keepInChat: boolean;
  draftReviewed: boolean;
  packetApproved: boolean;
}): string {
  if (input.keepInChat) return "/justice/chat-ai";
  if (!input.draftReviewed) return "/justice/preview";
  if (!input.packetApproved) return "/justice/packet";
  return "/justice/chat-ai";
}

export function resolveChatAiActiveCaseWorkLabel(input: {
  keepInChat: boolean;
  draftReviewed: boolean;
  packetApproved: boolean;
}): string {
  if (input.keepInChat) {
    if (!input.draftReviewed) return "Review submission draft in chat";
    if (!input.packetApproved) return "Approve prepared packet in chat";
    return "Continue in chat";
  }
  if (!input.draftReviewed) return "Submission preview";
  if (!input.packetApproved) return "Review prepared case packet";
  return "Continue in chat";
}

export function shouldBlockChatAiOffChatNavigation(input: {
  isSignedIn: boolean;
  isUpdatingExistingCase: boolean;
  isLoaded: boolean;
  caseId: string;
  targetHref: string;
}): boolean {
  if (!isChatAiMainLadderOffChatHref(input.targetHref)) return false;
  if (!input.isLoaded || !input.isSignedIn || !input.isUpdatingExistingCase) return false;
  return Boolean(input.caseId.trim());
}

export function scrollChatAiInlineElement(targetElementId: string): boolean {
  if (typeof document === "undefined") return false;
  const el = document.getElementById(targetElementId);
  if (!el) return false;
  el.scrollIntoView({ behavior: "smooth", block: "nearest" });
  return true;
}

const DEFAULT_HYDRATION_SCROLL_MAX_ATTEMPTS = 12;
const DEFAULT_HYDRATION_SCROLL_INTERVAL_MS = 200;

/** Scroll to an inline ladder block; retry briefly while hydration completes. */
export function scrollChatAiInlineElementWithHydrationWait(
  targetElementId: string,
  options?: { maxAttempts?: number; intervalMs?: number }
): void {
  if (scrollChatAiInlineElement(targetElementId)) return;

  const maxAttempts = options?.maxAttempts ?? DEFAULT_HYDRATION_SCROLL_MAX_ATTEMPTS;
  const intervalMs = options?.intervalMs ?? DEFAULT_HYDRATION_SCROLL_INTERVAL_MS;
  let attempts = 0;

  const timerId = window.setInterval(() => {
    attempts += 1;
    if (scrollChatAiInlineElement(targetElementId) || attempts >= maxAttempts) {
      window.clearInterval(timerId);
    }
  }, intervalMs);
}

export type ChatAiFilingStepInChatAction =
  | { kind: "hidden" }
  | { kind: "wait"; label: string }
  | { kind: "scroll"; targetElementId: string; label: string };

/** In-chat filing guidance when packet/handling detours are suppressed on chat-ai. */
export const CONSUMER_ACTIVE_CASE_RESUME_CHAT_AI_HREF = "/justice/chat-ai";

/** Hub and saved-cases re-entry: resume the in-chat ladder instead of legacy detour pages. */
export function resolveConsumerActiveCaseResumeChatAiHref(
  focusElementId?: string | null
): string {
  const id = focusElementId?.trim();
  if (!id) return CONSUMER_ACTIVE_CASE_RESUME_CHAT_AI_HREF;
  return `${CONSUMER_ACTIVE_CASE_RESUME_CHAT_AI_HREF}#${id}`;
}

export function redirectConsumerActiveCaseOffChatHref(targetHref: string): string {
  const trimmed = targetHref.trim();
  return isChatAiMainLadderOffChatHref(trimmed)
    ? CONSUMER_ACTIVE_CASE_RESUME_CHAT_AI_HREF
    : trimmed;
}

export type ConsumerLegacyLadderPageHref = "/justice/preview" | "/justice/handling";

/** Direct URL entry guard for legacy consumer ladder detour pages. */
export function shouldRedirectConsumerActiveCaseOffLegacyLadderPage(input: {
  legacyPageHref: ConsumerLegacyLadderPageHref;
  isSignedIn: boolean;
  isLoaded: boolean;
  caseId: string;
  hasResumableCase: boolean;
  /** When true, operator/admin roles may remain on `/justice/handling`. */
  allowOperatorAccess?: boolean;
  isOperator?: boolean;
}): boolean {
  if (input.allowOperatorAccess && input.isOperator) return false;
  return shouldBlockChatAiOffChatNavigation({
    isSignedIn: input.isSignedIn,
    isUpdatingExistingCase: input.hasResumableCase,
    isLoaded: input.isLoaded,
    caseId: input.caseId,
    targetHref: input.legacyPageHref,
  });
}

export function resolveConsumerActiveCaseLegacyLadderRedirectHref(
  legacyPageHref: ConsumerLegacyLadderPageHref
): string {
  if (legacyPageHref === "/justice/preview") {
    return resolveConsumerActiveCaseResumeChatAiHref(
      CHAT_AI_INLINE_SUBMISSION_DRAFT_REVIEW_ELEMENT_ID
    );
  }
  return CONSUMER_ACTIVE_CASE_RESUME_CHAT_AI_HREF;
}

export function resolveConsumerActiveCaseChecklistDraftReviewNavigate(): {
  href: string;
  label: string;
} {
  return {
    href: resolveConsumerActiveCaseResumeChatAiHref(
      CHAT_AI_INLINE_SUBMISSION_DRAFT_REVIEW_ELEMENT_ID
    ),
    label: "Review in chat",
  };
}

export function resolveConsumerActiveCaseChecklistPacketApprovalNavigate(): {
  href: string;
  label: string;
} {
  return {
    href: resolveConsumerActiveCaseResumeChatAiHref(
      CHAT_AI_INLINE_PREPARED_PACKET_APPROVAL_ELEMENT_ID
    ),
    label: "Approve in chat",
  };
}

export function resolveChatAiFilingStepInChatAction(input: {
  isFilingCaptureStep: boolean;
  showInlineFilingCapture: boolean;
  filingCaptureSuppressed: boolean;
  canCaptureFilingInChat: boolean;
  caseId: string;
}): ChatAiFilingStepInChatAction {
  if (!input.isFilingCaptureStep || input.showInlineFilingCapture || input.filingCaptureSuppressed) {
    return { kind: "hidden" };
  }
  if (!input.canCaptureFilingInChat) {
    return { kind: "hidden" };
  }
  if (!input.caseId.trim()) {
    return { kind: "wait", label: "Loading filing form in this chat…" };
  }
  return {
    kind: "scroll",
    targetElementId: CHAT_AI_INLINE_FILING_CAPTURE_ELEMENT_ID,
    label: "Add filing below",
  };
}

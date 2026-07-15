export const CHAT_AI_INLINE_SUBMISSION_DRAFT_REVIEW_ELEMENT_ID =
  "chat-ai-inline-submission-draft-review";
export const CHAT_AI_INLINE_PREPARED_PACKET_APPROVAL_ELEMENT_ID =
  "chat-ai-inline-prepared-packet-approval";
export const CHAT_AI_APPROVED_ACTION_TRACKING_ELEMENT_ID = "chat-ai-approved-action-tracking";
export const CHAT_AI_INLINE_FILING_CAPTURE_ELEMENT_ID = "chat-ai-inline-filing-capture";
export const CHAT_AI_PROOF_EVIDENCE_PANEL_ELEMENT_ID = "chat-ai-proof-evidence-panel";

export const CHAT_AI_MAIN_LADDER_OFF_CHAT_HREFS = [
  "/justice/preview",
  "/justice/packet",
  "/justice/handling",
] as const;

/** Optional evidence + destination-prep hubs kept off the signed-in keep-in-chat path. */
export const CHAT_AI_OPTIONAL_HUB_ESCAPE_HREFS = [
  "/justice/evidence",
  "/justice/merchant",
  "/justice/cfpb",
  "/justice/fcc",
  "/justice/bbb",
  "/justice/state-ag",
  "/justice/dot",
  "/justice/demand-letter",
  "/justice/payment-dispute",
  "/justice/ftc",
  "/justice/ftc-review",
] as const;

export type ChatAiMainLadderOffChatHref = (typeof CHAT_AI_MAIN_LADDER_OFF_CHAT_HREFS)[number];

export function isChatAiMainLadderOffChatHref(href: string | null | undefined): boolean {
  const trimmed = href?.trim() ?? "";
  return (CHAT_AI_MAIN_LADDER_OFF_CHAT_HREFS as readonly string[]).includes(trimmed);
}

export type ChatAiOptionalHubEscapeHref = (typeof CHAT_AI_OPTIONAL_HUB_ESCAPE_HREFS)[number];

export function isChatAiOptionalHubEscapeHref(href: string | null | undefined): boolean {
  const trimmed = href?.trim() ?? "";
  return (CHAT_AI_OPTIONAL_HUB_ESCAPE_HREFS as readonly string[]).includes(trimmed);
}

/** Any consumer-facing parallel DIY/prep workflow href that must not replace chat-ai. */
export function isChatAiConsumerParallelWorkflowHref(href: string | null | undefined): boolean {
  return isChatAiMainLadderOffChatHref(href) || isChatAiOptionalHubEscapeHref(href);
}

function hasConsumerCaseSession(input: {
  caseId?: string | null;
  isUpdatingExistingCase?: boolean;
}): boolean {
  return Boolean(input.caseId?.trim()) || Boolean(input.isUpdatingExistingCase);
}

/**
 * Signed-in chat-ai consumers with a case session stay on the in-chat ladder.
 * Case session = active case id and/or updating-existing-case flag.
 */
export function shouldKeepSignedInChatAiActiveCaseInChat(input: {
  isSignedIn: boolean;
  caseId?: string | null;
  /** Compat: treated as having a case session when caseId is not yet plumbed. */
  isUpdatingExistingCase?: boolean;
}): boolean {
  return Boolean(input.isSignedIn) && hasConsumerCaseSession(input);
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

/**
 * Block signed-in consumers from navigating into parallel DIY/prep workflows.
 * Destination-prep hubs are always blocked when signed in; main ladder detours
 * are blocked whenever a case session exists.
 */
export function shouldBlockChatAiOffChatNavigation(input: {
  isSignedIn: boolean;
  isLoaded: boolean;
  caseId: string;
  targetHref: string;
  /** Compat: contributes to case-session detection for main-ladder blocks. */
  isUpdatingExistingCase?: boolean;
}): boolean {
  const trimmed = input.targetHref.trim();
  if (!isChatAiConsumerParallelWorkflowHref(trimmed)) return false;
  if (!input.isLoaded || !input.isSignedIn) return false;
  if (isChatAiOptionalHubEscapeHref(trimmed)) return true;
  return hasConsumerCaseSession({
    caseId: input.caseId,
    isUpdatingExistingCase: input.isUpdatingExistingCase,
  });
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
  if (isChatAiMainLadderOffChatHref(trimmed) || isChatAiOptionalHubEscapeHref(trimmed)) {
    if (trimmed === "/justice/evidence") {
      return resolveConsumerActiveCaseResumeChatAiHref(CHAT_AI_PROOF_EVIDENCE_PANEL_ELEMENT_ID);
    }
    if (trimmed === "/justice/preview") {
      return resolveConsumerActiveCaseResumeChatAiHref(
        CHAT_AI_INLINE_SUBMISSION_DRAFT_REVIEW_ELEMENT_ID
      );
    }
    if (trimmed === "/justice/packet") {
      return resolveConsumerActiveCaseResumeChatAiHref(
        CHAT_AI_INLINE_PREPARED_PACKET_APPROVAL_ELEMENT_ID
      );
    }
    if (isChatAiOptionalHubEscapeHref(trimmed)) {
      return resolveConsumerActiveCaseResumeChatAiHref(CHAT_AI_APPROVED_ACTION_TRACKING_ELEMENT_ID);
    }
    return CONSUMER_ACTIVE_CASE_RESUME_CHAT_AI_HREF;
  }
  return trimmed;
}

export type ConsumerLegacyLadderPageHref =
  | "/justice/preview"
  | "/justice/packet"
  | "/justice/handling";

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
  if (!input.isLoaded || !input.isSignedIn) return false;
  // All signed-in consumers are redirected off legacy ladder/DIY surfaces.
  void input.caseId;
  void input.hasResumableCase;
  void input.legacyPageHref;
  return true;
}

export function resolveConsumerActiveCaseLegacyLadderRedirectHref(
  legacyPageHref: ConsumerLegacyLadderPageHref
): string {
  if (legacyPageHref === "/justice/preview") {
    return resolveConsumerActiveCaseResumeChatAiHref(
      CHAT_AI_INLINE_SUBMISSION_DRAFT_REVIEW_ELEMENT_ID
    );
  }
  if (legacyPageHref === "/justice/packet") {
    return resolveConsumerActiveCaseResumeChatAiHref(
      CHAT_AI_INLINE_PREPARED_PACKET_APPROVAL_ELEMENT_ID
    );
  }
  return CONSUMER_ACTIVE_CASE_RESUME_CHAT_AI_HREF;
}

/**
 * When the signed-in active-case ladder stays in chat, suppress optional hub escapes
 * (preview/packet, Organize evidence, and destination-prep pages) — work happens inline.
 */
export function shouldSuppressChatInlineMainLadderHubEscapeLinks(input: {
  keepInChat: boolean;
}): boolean {
  return input.keepInChat;
}

export type ChatInlineOptionalHubEscapeLinkProps = {
  optionalPageHref?: string;
  optionalPageLabel?: string;
  optionalPageNote?: string;
};

/** Drop optional hub escape link props when keep-in-chat suppresses destination/evidence hubs. */
export function resolveChatInlineOptionalHubEscapeLinkProps(input: {
  suppress: boolean;
  href: string;
  label: string;
  note?: string;
}): ChatInlineOptionalHubEscapeLinkProps {
  if (input.suppress) return {};
  return {
    optionalPageHref: input.href,
    optionalPageLabel: input.label,
    ...(input.note !== undefined ? { optionalPageNote: input.note } : {}),
  };
}

export type ConsumerOptionalHubEscapePageHref = ChatAiOptionalHubEscapeHref;

/** Direct URL entry guard for evidence + destination-prep hubs. */
export function shouldRedirectConsumerActiveCaseOffOptionalHubEscapePage(input: {
  escapePageHref: ConsumerOptionalHubEscapePageHref;
  isSignedIn: boolean;
  isLoaded: boolean;
  caseId: string;
  hasResumableCase: boolean;
}): boolean {
  if (!isChatAiOptionalHubEscapeHref(input.escapePageHref)) return false;
  if (!input.isLoaded || !input.isSignedIn) return false;
  // All signed-in consumers leave destination-prep/evidence DIY hubs for chat-ai.
  void input.caseId;
  void input.hasResumableCase;
  return true;
}

export function resolveConsumerActiveCaseOptionalHubEscapeRedirectHref(
  escapePageHref: ConsumerOptionalHubEscapePageHref
): string {
  if (escapePageHref === "/justice/evidence") {
    return resolveConsumerActiveCaseResumeChatAiHref(CHAT_AI_PROOF_EVIDENCE_PANEL_ELEMENT_ID);
  }
  return resolveConsumerActiveCaseResumeChatAiHref(CHAT_AI_APPROVED_ACTION_TRACKING_ELEMENT_ID);
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

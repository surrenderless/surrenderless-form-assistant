export type ChatLegalConsentGate =
  | "submission_draft_review"
  | "prepared_packet_approval"
  | "bbb_complaint_autofill";

export const STORAGE_CHAT_BBB_ACCURACY_CONSENTED_V1 = "justice_chat_bbb_accuracy_consented_v1";

/** Canonical chat phrases for E2E and documentation. */
export const CHAT_LEGAL_CONSENT_SUBMISSION_DRAFT_REVIEW_MESSAGE =
  "I have reviewed the submission draft shown above and confirm it is ready to proceed.";

export const CHAT_LEGAL_CONSENT_PREPARED_PACKET_APPROVAL_MESSAGE =
  "I have reviewed the prepared packet and approve it for submission.";

export const CHAT_LEGAL_CONSENT_BBB_ACCURACY_AND_RUN_MESSAGE =
  "I confirm the BBB complaint information is accurate to the best of my knowledge. Please run BBB autofill.";

export type ChatLegalConsentGateContext = {
  caseId: string;
  submissionDraftReviewed: boolean;
  preparedPacketApproved: boolean;
  bbbComplaintPrepVisible: boolean;
  bbbAutofillCompleted: boolean;
  chatBbbAccuracyConsented: boolean;
};

export type ChatLegalConsentParseResult =
  | { kind: "none" }
  | { kind: "ambiguous"; gate: ChatLegalConsentGate }
  | { kind: "decline"; gate: ChatLegalConsentGate }
  | { kind: "submission_draft_review" }
  | { kind: "prepared_packet_approval" }
  | { kind: "bbb_accuracy_consent" }
  | { kind: "bbb_run_autofill" }
  | { kind: "bbb_accuracy_and_run" };

const NEGATION =
  /\b(?:don't|do\s+not|doesn'?t|didn'?t|won'?t|cannot|can't|never|not\s+yet|not\s+ready|haven'?t|hasn'?t|without)\b/i;

const VAGUE_ONLY =
  /^(?:yes|yep|yeah|ok|okay|sure|fine|good|great|thanks|thank\s+you|sounds?\s+good|looks?\s+good|approve[d]?|approved)\.?$/i;

function normalizedMessage(message: string): string {
  return message.trim().replace(/\s+/g, " ");
}

function hasNegation(message: string): boolean {
  return NEGATION.test(message);
}

function isVagueOnly(message: string): boolean {
  return VAGUE_ONLY.test(normalizedMessage(message));
}

function matchesSubmissionDraftReviewConsent(message: string): boolean {
  const text = normalizedMessage(message);
  if (!text || hasNegation(text)) return false;
  return (
    /\bi\s+(?:have\s+)?reviewed\s+(?:the\s+)?submission\s+draft\b/i.test(text) ||
    /\b(?:i\s+)?confirm\s+(?:that\s+)?i\s+(?:have\s+)?reviewed\s+(?:the\s+)?submission\s+draft\b/i.test(text) ||
    /\bmark\s+(?:the\s+)?submission\s+draft\s+(?:as\s+)?reviewed\b/i.test(text)
  );
}

function matchesPreparedPacketApprovalConsent(message: string): boolean {
  const text = normalizedMessage(message);
  if (!text || hasNegation(text)) return false;
  if (!/\b(?:prepared\s+packet|prepared\s+case\s+packet|justice\s+case\s+packet)\b/i.test(text)) {
    return false;
  }
  return (
    /\bi\s+approve\s+(?:the\s+)?(?:prepared\s+)?(?:case\s+)?packet\b/i.test(text) ||
    /\bi\s+(?:have\s+)?reviewed\s+(?:the\s+)?(?:prepared\s+)?(?:case\s+)?packet\b.*\bapprove\b/i.test(text) ||
    /\bapprove\s+(?:the\s+)?(?:prepared\s+)?(?:case\s+)?packet\s+for\s+submission\b/i.test(text)
  );
}

function matchesBbbAccuracyConsent(message: string): boolean {
  const text = normalizedMessage(message);
  if (!text || hasNegation(text)) return false;
  return (
    /\bi\s+confirm\b.*\baccurate\b.*\bbest\s+of\s+my\s+knowledge\b/i.test(text) ||
    /\bi\s+confirm\b.*\b(?:bbb\s+)?(?:complaint\s+)?information\s+is\s+accurate\b/i.test(text) ||
    /\bconfirm\s+(?:the\s+)?bbb\s+complaint\s+information\s+is\s+accurate\b/i.test(text)
  );
}

function matchesBbbRunAutofill(message: string): boolean {
  const text = normalizedMessage(message);
  if (!text || hasNegation(text)) return false;
  return (
    /\brun\s+bbb\s+autofill\b/i.test(text) ||
    /\bstart\s+bbb\s+autofill\b/i.test(text) ||
    /\bsubmit\s+(?:my\s+)?bbb\s+complaint\b/i.test(text) ||
    /\bplease\s+run\s+bbb\b/i.test(text)
  );
}

function matchesDeclineForGate(message: string, gate: ChatLegalConsentGate): boolean {
  const text = normalizedMessage(message);
  if (!text) return false;
  if (!/\b(?:decline|refuse|don't\s+approve|do\s+not\s+approve|not\s+approve|can't\s+approve|cannot\s+approve)\b/i.test(text)) {
    if (!hasNegation(text)) return false;
  }
  switch (gate) {
    case "submission_draft_review":
      return /\b(?:draft|submission)\b/i.test(text);
    case "prepared_packet_approval":
      return /\b(?:packet|approve|approval)\b/i.test(text);
    case "bbb_complaint_autofill":
      return /\b(?:bbb|complaint|autofill|accurate|information)\b/i.test(text);
    default:
      return false;
  }
}

/** Build gate context for the active case from observed chat state. */
export function buildChatLegalConsentGateContext(input: {
  caseId: string;
  submissionDraftReviewed: boolean;
  preparedPacketApproved: boolean;
  bbbComplaintPrepVisible: boolean;
  bbbAutofillCompleted: boolean;
}): ChatLegalConsentGateContext {
  const caseId = input.caseId.trim();
  return {
    caseId,
    submissionDraftReviewed: input.submissionDraftReviewed,
    preparedPacketApproved: input.preparedPacketApproved,
    bbbComplaintPrepVisible: input.bbbComplaintPrepVisible,
    bbbAutofillCompleted: input.bbbAutofillCompleted,
    chatBbbAccuracyConsented: readChatBbbAccuracyConsented(caseId),
  };
}

/** First pending legal consent gate for the active case, in ladder order. */
export function resolvePendingChatLegalConsentGate(
  input: ChatLegalConsentGateContext
): ChatLegalConsentGate | null {
  const caseId = input.caseId.trim();
  if (!caseId) return null;

  if (!input.submissionDraftReviewed) {
    return "submission_draft_review";
  }
  if (!input.preparedPacketApproved) {
    return "prepared_packet_approval";
  }
  if (input.bbbComplaintPrepVisible && !input.bbbAutofillCompleted) {
    return "bbb_complaint_autofill";
  }
  return null;
}

function getProgressConsentStorage(): Storage | null {
  if (typeof window !== "undefined") return window.sessionStorage;
  if (typeof globalThis.sessionStorage !== "undefined") return globalThis.sessionStorage;
  return null;
}

function readBbbConsentMap(): Record<string, boolean> {
  const storage = getProgressConsentStorage();
  if (!storage) return {};
  try {
    const raw = storage.getItem(STORAGE_CHAT_BBB_ACCURACY_CONSENTED_V1);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, boolean>;
  } catch {
    return {};
  }
}

export function readChatBbbAccuracyConsented(caseId: string): boolean {
  const trimmed = caseId.trim();
  if (!trimmed) return false;
  return readBbbConsentMap()[trimmed] === true;
}

export function markChatBbbAccuracyConsented(caseId: string): void {
  const trimmed = caseId.trim();
  if (!trimmed) return;
  const storage = getProgressConsentStorage();
  if (!storage) return;
  const map = readBbbConsentMap();
  map[trimmed] = true;
  storage.setItem(STORAGE_CHAT_BBB_ACCURACY_CONSENTED_V1, JSON.stringify(map));
}

export function clearChatBbbAccuracyConsented(caseId: string): void {
  const trimmed = caseId.trim();
  if (!trimmed) return;
  const storage = getProgressConsentStorage();
  if (!storage) return;
  const map = readBbbConsentMap();
  delete map[trimmed];
  storage.setItem(STORAGE_CHAT_BBB_ACCURACY_CONSENTED_V1, JSON.stringify(map));
}

/** Parse a user message against the currently pending gate only. Never infers across gates. */
export function parseChatLegalConsentMessage(
  message: string,
  gate: ChatLegalConsentGate,
  context: ChatLegalConsentGateContext
): ChatLegalConsentParseResult {
  const text = normalizedMessage(message);
  if (!text) return { kind: "none" };

  if (matchesDeclineForGate(text, gate)) {
    return { kind: "decline", gate };
  }

  switch (gate) {
    case "submission_draft_review":
      if (matchesSubmissionDraftReviewConsent(text)) {
        return { kind: "submission_draft_review" };
      }
      if (isVagueOnly(text) || /\bapprove\b/i.test(text)) {
        return { kind: "ambiguous", gate };
      }
      return { kind: "none" };
    case "prepared_packet_approval":
      if (matchesPreparedPacketApprovalConsent(text)) {
        return { kind: "prepared_packet_approval" };
      }
      if (isVagueOnly(text) || (/\bapprove\b/i.test(text) && !/\bpacket\b/i.test(text))) {
        return { kind: "ambiguous", gate };
      }
      return { kind: "none" };
    case "bbb_complaint_autofill": {
      const hasAccuracy = matchesBbbAccuracyConsent(text);
      const hasRun = matchesBbbRunAutofill(text);
      if (hasAccuracy && hasRun) {
        return { kind: "bbb_accuracy_and_run" };
      }
      if (hasAccuracy) {
        return { kind: "bbb_accuracy_consent" };
      }
      if (hasRun) {
        if (context.chatBbbAccuracyConsented) {
          return { kind: "bbb_run_autofill" };
        }
        return { kind: "ambiguous", gate };
      }
      if (isVagueOnly(text) || /\bapprove\b/i.test(text)) {
        return { kind: "ambiguous", gate };
      }
      return { kind: "none" };
    }
    default: {
      const _exhaustive: never = gate;
      return _exhaustive;
    }
  }
}

export function buildChatLegalConsentAssistantResponse(
  result: Exclude<ChatLegalConsentParseResult, { kind: "none" }>
): string {
  switch (result.kind) {
    case "submission_draft_review":
      return "I've recorded that you reviewed the submission draft. I'll show the prepared packet next for your approval.";
    case "prepared_packet_approval":
      return "I've recorded your approval of the prepared packet. Surrenderless will advance your case to the next step.";
    case "bbb_accuracy_consent":
      return "I've recorded your confirmation that the BBB complaint information is accurate. Say \"Run BBB autofill\" when you're ready to proceed.";
    case "bbb_run_autofill":
      return "Understood — I'll run BBB autofill with your confirmed information now.";
    case "bbb_accuracy_and_run":
      return "I've recorded your accuracy confirmation and I'm running BBB autofill now.";
    case "decline":
      if (result.gate === "submission_draft_review") {
        return "Understood — I won't mark the submission draft reviewed without your explicit confirmation. Review the draft below when you're ready.";
      }
      if (result.gate === "prepared_packet_approval") {
        return "Understood — I won't approve the prepared packet without your explicit approval. Review the packet below when you're ready.";
      }
      return "Understood — I won't run BBB autofill without your explicit accuracy confirmation. Review the BBB summary below when you're ready.";
    case "ambiguous":
      if (result.gate === "submission_draft_review") {
        return "I need a clear statement that you reviewed the submission draft before I can proceed. For example: \"I have reviewed the submission draft shown above and confirm it is ready to proceed.\"";
      }
      if (result.gate === "prepared_packet_approval") {
        return "I need a clear statement that you reviewed and approve the prepared packet. For example: \"I have reviewed the prepared packet and approve it for submission.\"";
      }
      return "I need your explicit BBB accuracy confirmation before running autofill. For example: \"I confirm the BBB complaint information is accurate to the best of my knowledge. Please run BBB autofill.\"";
    default: {
      const _exhaustive: never = result;
      return _exhaustive;
    }
  }
}

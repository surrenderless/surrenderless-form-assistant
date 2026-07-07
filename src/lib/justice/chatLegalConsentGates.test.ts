import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  buildChatLegalConsentAssistantResponse,
  CHAT_LEGAL_CONSENT_BBB_ACCURACY_AND_RUN_MESSAGE,
  CHAT_LEGAL_CONSENT_PREPARED_PACKET_APPROVAL_MESSAGE,
  CHAT_LEGAL_CONSENT_SUBMISSION_DRAFT_REVIEW_MESSAGE,
  clearChatBbbAccuracyConsented,
  markChatBbbAccuracyConsented,
  parseChatLegalConsentMessage,
  readChatBbbAccuracyConsented,
  resolvePendingChatLegalConsentGate,
  STORAGE_CHAT_BBB_ACCURACY_CONSENTED_V1,
  type ChatLegalConsentGateContext,
} from "@/lib/justice/chatLegalConsentGates";

const CASE_A = "550e8400-e29b-41d4-a716-446655440000";
const CASE_B = "550e8400-e29b-41d4-a716-446655440001";

function baseContext(
  overrides: Partial<ChatLegalConsentGateContext> = {}
): ChatLegalConsentGateContext {
  return {
    caseId: CASE_A,
    submissionDraftReviewed: false,
    preparedPacketApproved: false,
    bbbComplaintPrepVisible: false,
    bbbAutofillCompleted: false,
    chatBbbAccuracyConsented: false,
    ...overrides,
  };
}

describe("chatLegalConsentGates", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      clear: () => {
        store.clear();
      },
    });
  });

  it("resolves pending gates in ladder order", () => {
    expect(resolvePendingChatLegalConsentGate(baseContext())).toBe("submission_draft_review");
    expect(
      resolvePendingChatLegalConsentGate(
        baseContext({ submissionDraftReviewed: true })
      )
    ).toBe("prepared_packet_approval");
    expect(
      resolvePendingChatLegalConsentGate(
        baseContext({
          submissionDraftReviewed: true,
          preparedPacketApproved: true,
          bbbComplaintPrepVisible: true,
        })
      )
    ).toBe("bbb_complaint_autofill");
    expect(
      resolvePendingChatLegalConsentGate(
        baseContext({
          submissionDraftReviewed: true,
          preparedPacketApproved: true,
          bbbComplaintPrepVisible: true,
          bbbAutofillCompleted: true,
        })
      )
    ).toBeNull();
  });

  it("accepts explicit submission draft review consent", () => {
    const gate = "submission_draft_review" as const;
    expect(
      parseChatLegalConsentMessage(CHAT_LEGAL_CONSENT_SUBMISSION_DRAFT_REVIEW_MESSAGE, gate, baseContext())
    ).toEqual({ kind: "submission_draft_review" });
  });

  it("accepts explicit prepared packet approval consent", () => {
    const gate = "prepared_packet_approval" as const;
    expect(
      parseChatLegalConsentMessage(
        CHAT_LEGAL_CONSENT_PREPARED_PACKET_APPROVAL_MESSAGE,
        gate,
        baseContext({ submissionDraftReviewed: true })
      )
    ).toEqual({ kind: "prepared_packet_approval" });
  });

  it("accepts combined BBB accuracy and run consent", () => {
    const gate = "bbb_complaint_autofill" as const;
    expect(
      parseChatLegalConsentMessage(
        CHAT_LEGAL_CONSENT_BBB_ACCURACY_AND_RUN_MESSAGE,
        gate,
        baseContext({
          submissionDraftReviewed: true,
          preparedPacketApproved: true,
          bbbComplaintPrepVisible: true,
        })
      )
    ).toEqual({ kind: "bbb_accuracy_and_run" });
  });

  it("treats vague approval as ambiguous for the pending gate", () => {
    expect(
      parseChatLegalConsentMessage("looks good", "submission_draft_review", baseContext())
    ).toEqual({ kind: "ambiguous", gate: "submission_draft_review" });
    expect(
      parseChatLegalConsentMessage("I approve", "prepared_packet_approval", baseContext())
    ).toEqual({ kind: "ambiguous", gate: "prepared_packet_approval" });
  });

  it("does not infer draft consent from unrelated messages", () => {
    expect(
      parseChatLegalConsentMessage(
        "Can you update my email to test@example.com?",
        "submission_draft_review",
        baseContext()
      )
    ).toEqual({ kind: "none" });
  });

  it("recognizes explicit decline for the pending gate", () => {
    expect(
      parseChatLegalConsentMessage(
        "I do not approve the prepared packet yet",
        "prepared_packet_approval",
        baseContext({ submissionDraftReviewed: true })
      )
    ).toEqual({ kind: "decline", gate: "prepared_packet_approval" });
  });

  it("requires BBB accuracy before run-only command", () => {
    const gate = "bbb_complaint_autofill" as const;
    const ctx = baseContext({
      submissionDraftReviewed: true,
      preparedPacketApproved: true,
      bbbComplaintPrepVisible: true,
    });
    expect(parseChatLegalConsentMessage("Please run BBB autofill", gate, ctx)).toEqual({
      kind: "ambiguous",
      gate,
    });
    markChatBbbAccuracyConsented(CASE_A);
    expect(
      parseChatLegalConsentMessage("Please run BBB autofill", gate, {
        ...ctx,
        chatBbbAccuracyConsented: true,
      })
    ).toEqual({ kind: "bbb_run_autofill" });
  });

  it("does not treat stale draft consent as packet approval when packet gate is pending", () => {
    expect(
      parseChatLegalConsentMessage(
        CHAT_LEGAL_CONSENT_SUBMISSION_DRAFT_REVIEW_MESSAGE,
        "prepared_packet_approval",
        baseContext({ submissionDraftReviewed: true })
      )
    ).toEqual({ kind: "none" });
  });

  it("isolates BBB accuracy consent per case", () => {
    markChatBbbAccuracyConsented(CASE_A);
    expect(readChatBbbAccuracyConsented(CASE_A)).toBe(true);
    expect(readChatBbbAccuracyConsented(CASE_B)).toBe(false);
    clearChatBbbAccuracyConsented(CASE_A);
    expect(readChatBbbAccuracyConsented(CASE_A)).toBe(false);
    expect(sessionStorage.getItem(STORAGE_CHAT_BBB_ACCURACY_CONSENTED_V1)).not.toContain(CASE_A);
  });

  it("builds assistant responses for consent outcomes", () => {
    expect(
      buildChatLegalConsentAssistantResponse({ kind: "submission_draft_review" })
    ).toContain("reviewed the submission draft");
    expect(
      buildChatLegalConsentAssistantResponse({
        kind: "ambiguous",
        gate: "bbb_complaint_autofill",
      })
    ).toContain("BBB accuracy confirmation");
  });
});

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

  // A gate is satisfied only when the ENTIRE message matches a fixed consent template. Questions,
  // conditionals, hypotheticals, deferrals, and ANY trailing qualifier fail the anchored match and
  // are rejected — the allowlist needs no evasion-keyword enumeration.
  describe("only an exact whole-message consent template satisfies a gate", () => {
    it("submission_draft_review: non-template messages are not recorded as consent", () => {
      const gate = "submission_draft_review" as const;
      const ctx = baseContext();
      const nonAffirmative = [
        "Have I reviewed the submission draft?", // question
        "If it looks correct, I have reviewed the submission draft and it is ready.", // conditional
        "Later I'll confirm I have reviewed the submission draft.", // deferral
        "Assume I have reviewed the submission draft.", // hypothetical
        "Hypothetically I have reviewed the submission draft.", // hypothetical
        "Suppose I have reviewed the submission draft.", // hypothetical
      ];
      for (const message of nonAffirmative) {
        expect(parseChatLegalConsentMessage(message, gate, ctx).kind).not.toBe(
          "submission_draft_review"
        );
      }
    });

    it("prepared_packet_approval: non-template messages are not recorded as consent", () => {
      const gate = "prepared_packet_approval" as const;
      const ctx = baseContext({ submissionDraftReviewed: true });
      const nonAffirmative = [
        "Should I approve the prepared packet for submission?",
        "If I approve the prepared packet for submission, does my case advance?",
        "I'll approve the prepared packet for submission tomorrow.",
        "I would approve the prepared packet for submission.",
        "Assume I approve the prepared packet for submission.",
        "Hypothetically I approve the prepared packet for submission.",
        "Suppose I approve the prepared packet for submission.",
        "Say I approve the prepared packet for submission.",
        "Let's say I approve the prepared packet for submission.",
      ];
      for (const message of nonAffirmative) {
        expect(parseChatLegalConsentMessage(message, gate, ctx).kind).not.toBe(
          "prepared_packet_approval"
        );
      }
    });

    it("bbb_complaint_autofill: non-template messages are not recorded as consent", () => {
      const gate = "bbb_complaint_autofill" as const;
      const ctx = baseContext({
        submissionDraftReviewed: true,
        preparedPacketApproved: true,
        bbbComplaintPrepVisible: true,
      });
      const nonAffirmative = [
        "Should I confirm the BBB complaint information is accurate and run BBB autofill?",
        "If the info is right, I confirm the BBB complaint information is accurate. Run BBB autofill.",
        "I'll confirm the BBB complaint information is accurate and run BBB autofill later.",
        "Will you run BBB autofill?",
        "Suppose I confirm the BBB complaint information is accurate. Run BBB autofill.",
        "Assume I confirm the BBB complaint information is accurate and run BBB autofill.",
      ];
      for (const message of nonAffirmative) {
        const kind = parseChatLegalConsentMessage(message, gate, ctx).kind;
        expect(kind).not.toBe("bbb_accuracy_and_run");
        expect(kind).not.toBe("bbb_accuracy_consent");
        expect(kind).not.toBe("bbb_run_autofill");
      }
      // Even with prior accuracy consent stored, a run-only QUESTION must not trigger autofill.
      expect(
        parseChatLegalConsentMessage("Should I run BBB autofill?", gate, {
          ...ctx,
          chatBbbAccuracyConsented: true,
        }).kind
      ).not.toBe("bbb_run_autofill");
    });

    it("rejects any question unconditionally — 'Run BBB autofill?' must not execute", () => {
      const gate = "bbb_complaint_autofill" as const;
      const ctx = baseContext({
        submissionDraftReviewed: true,
        preparedPacketApproved: true,
        bbbComplaintPrepVisible: true,
        chatBbbAccuracyConsented: true, // accuracy already consented, so only the '?' stops execution
      });
      // "Run BBB autofill" is a valid template, but the trailing '?' makes it a question.
      expect(parseChatLegalConsentMessage("Run BBB autofill?", gate, ctx).kind).not.toBe(
        "bbb_run_autofill"
      );
      // Sanity: the same command WITHOUT the question mark does execute.
      expect(parseChatLegalConsentMessage("Run BBB autofill.", gate, ctx)).toEqual({
        kind: "bbb_run_autofill",
      });
    });

    it("accepts a friendly affirmation prefixed with yes/confirmed", () => {
      const gate = "prepared_packet_approval" as const;
      const ctx = baseContext({ submissionDraftReviewed: true });
      expect(
        parseChatLegalConsentMessage(
          "Yes, I approve the prepared packet for submission.",
          gate,
          ctx
        )
      ).toEqual({ kind: "prepared_packet_approval" });
      expect(
        parseChatLegalConsentMessage(
          "Confirmed: I approve the prepared packet for submission.",
          gate,
          ctx
        )
      ).toEqual({ kind: "prepared_packet_approval" });
    });

    it("accepts every blessed convenience template", () => {
      const draftCtx = baseContext();
      for (const message of [
        "I reviewed the submission draft.",
        "Mark the submission draft as reviewed.",
        "I confirm that I have reviewed the submission draft.",
      ]) {
        expect(
          parseChatLegalConsentMessage(message, "submission_draft_review", draftCtx)
        ).toEqual({ kind: "submission_draft_review" });
      }

      const packetCtx = baseContext({ submissionDraftReviewed: true });
      for (const message of [
        "I approve the prepared packet for submission.",
        "I approve the prepared case packet.",
      ]) {
        expect(
          parseChatLegalConsentMessage(message, "prepared_packet_approval", packetCtx)
        ).toEqual({ kind: "prepared_packet_approval" });
      }

      const bbbBase = baseContext({
        submissionDraftReviewed: true,
        preparedPacketApproved: true,
        bbbComplaintPrepVisible: true,
      });
      // Accuracy-only (not yet consented) records accuracy but not a run.
      expect(
        parseChatLegalConsentMessage(
          "I confirm the BBB complaint information is accurate to the best of my knowledge.",
          "bbb_complaint_autofill",
          bbbBase
        )
      ).toEqual({ kind: "bbb_accuracy_consent" });
      // Run-only templates, once accuracy is on file.
      for (const message of ["Run BBB autofill.", "Start BBB autofill.", "Submit my BBB complaint."]) {
        expect(
          parseChatLegalConsentMessage(message, "bbb_complaint_autofill", {
            ...bbbBase,
            chatBbbAccuracyConsented: true,
          })
        ).toEqual({ kind: "bbb_run_autofill" });
      }
    });

    it("rejects EVERY trailing qualifier after a valid template, across all gates", () => {
      // The whole-message allowlist rejects any trailing clause structurally — including qualifiers
      // that no blacklist enumerated (pending / except / although / however).
      const qualifiers = [
        "if the case looks strong",
        "later",
        "once you confirm",
        "but only if you waive the fee",
        "subject to your review",
        "contingent on the fee",
        "depending on the outcome",
        "pending your edits",
        "except the fee",
        "although I have concerns",
        "however I want changes",
      ];
      const packetCtx = baseContext({ submissionDraftReviewed: true });
      const draftCtx = baseContext();
      const bbbCtx = baseContext({
        submissionDraftReviewed: true,
        preparedPacketApproved: true,
        bbbComplaintPrepVisible: true,
        chatBbbAccuracyConsented: true,
      });
      for (const q of qualifiers) {
        expect(
          parseChatLegalConsentMessage(
            `I approve the prepared packet for submission ${q}.`,
            "prepared_packet_approval",
            packetCtx
          ).kind
        ).not.toBe("prepared_packet_approval");

        expect(
          parseChatLegalConsentMessage(
            `I have reviewed the submission draft ${q}.`,
            "submission_draft_review",
            draftCtx
          ).kind
        ).not.toBe("submission_draft_review");

        const bbbKind = parseChatLegalConsentMessage(
          `I confirm the BBB complaint information is accurate ${q}. Run BBB autofill.`,
          "bbb_complaint_autofill",
          bbbCtx
        ).kind;
        expect(bbbKind).not.toBe("bbb_accuracy_and_run");
        expect(bbbKind).not.toBe("bbb_accuracy_consent");
        expect(bbbKind).not.toBe("bbb_run_autofill");
      }
    });

    it("requires the WHOLE message to be the consent — benign trailing chatter is rejected (fail-closed)", () => {
      // Stricter than the prior start-rule: an exact affirmative is accepted, but the same phrase
      // with any trailing clause (even innocuous) is rejected and re-prompted.
      expect(
        parseChatLegalConsentMessage(
          "I have reviewed the submission draft.",
          "submission_draft_review",
          baseContext()
        )
      ).toEqual({ kind: "submission_draft_review" });
      expect(
        parseChatLegalConsentMessage(
          "I have reviewed the submission draft; there is nothing more to say.",
          "submission_draft_review",
          baseContext()
        ).kind
      ).not.toBe("submission_draft_review");
    });

    it("still accepts the canonical affirmative phrase for every gate", () => {
      expect(
        parseChatLegalConsentMessage(
          CHAT_LEGAL_CONSENT_SUBMISSION_DRAFT_REVIEW_MESSAGE,
          "submission_draft_review",
          baseContext()
        )
      ).toEqual({ kind: "submission_draft_review" });
      expect(
        parseChatLegalConsentMessage(
          CHAT_LEGAL_CONSENT_PREPARED_PACKET_APPROVAL_MESSAGE,
          "prepared_packet_approval",
          baseContext({ submissionDraftReviewed: true })
        )
      ).toEqual({ kind: "prepared_packet_approval" });
      expect(
        parseChatLegalConsentMessage(
          CHAT_LEGAL_CONSENT_BBB_ACCURACY_AND_RUN_MESSAGE,
          "bbb_complaint_autofill",
          baseContext({
            submissionDraftReviewed: true,
            preparedPacketApproved: true,
            bbbComplaintPrepVisible: true,
          })
        )
      ).toEqual({ kind: "bbb_accuracy_and_run" });
    });
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

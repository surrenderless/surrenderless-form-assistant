import { describe, expect, it } from "vitest";
import { HANDLING_TRACKING_STEP_COMPLETE } from "@/lib/justice/approvedNextActionHandlingDisplay";
import {
  buildChatCaseClosureAssistantResponse,
  canArchiveCaseViaChat,
  canClearFollowUpViaChat,
  CHAT_CASE_CLOSURE_ARCHIVE_CASE_MESSAGE,
  CHAT_CASE_CLOSURE_FOLLOW_UP_HANDLED_MESSAGE,
  CHAT_OPERATOR_OWNED_ARCHIVE_RESPONSE,
  parseChatCaseClosureMessage,
  parseOperatorOwnedArchiveIntent,
  parsePrematureArchiveIntent,
  resolvePendingChatCaseClosureGate,
  type ChatCaseClosureContext,
} from "@/lib/justice/chatCaseClosureGates";
import { REJECT_OPERATOR_OWNED_CASE_ARCHIVE_PATCH_MESSAGE } from "@/lib/justice/rejectPrematureResolutionClientStatePatch";

const CASE_ID = "550e8400-e29b-41d4-a716-446655440000";

function baseContext(overrides: Partial<ChatCaseClosureContext> = {}): ChatCaseClosureContext {
  return {
    caseId: CASE_ID,
    resolutionFlowExposed: true,
    followUpNeeded: true,
    handlingTrackingStep: "Review follow-up timing and mark follow-up handled when complete.",
    readinessLoading: false,
    ...overrides,
  };
}

describe("chatCaseClosureGates", () => {
  it("resolves follow-up before archive in ladder order", () => {
    expect(resolvePendingChatCaseClosureGate(baseContext())).toBe("follow_up_handled");
    expect(
      resolvePendingChatCaseClosureGate(
        baseContext({
          followUpNeeded: false,
          handlingTrackingStep: HANDLING_TRACKING_STEP_COMPLETE,
        })
      )
    ).toBe("archive_case");
    expect(
      resolvePendingChatCaseClosureGate(
        baseContext({
          followUpNeeded: false,
          handlingTrackingStep: HANDLING_TRACKING_STEP_COMPLETE,
          operatorOwnsClosure: true,
        })
      )
    ).toBeNull();
    expect(
      canArchiveCaseViaChat(
        baseContext({
          followUpNeeded: false,
          handlingTrackingStep: HANDLING_TRACKING_STEP_COMPLETE,
          operatorOwnsClosure: true,
        })
      )
    ).toBe(false);
    expect(
      resolvePendingChatCaseClosureGate(
        baseContext({
          followUpNeeded: false,
          handlingTrackingStep: HANDLING_TRACKING_STEP_COMPLETE,
          resolutionFlowExposed: false,
        })
      )
    ).toBeNull();
  });

  it("accepts explicit follow-up handled consent", () => {
    expect(
      parseChatCaseClosureMessage(
        CHAT_CASE_CLOSURE_FOLLOW_UP_HANDLED_MESSAGE,
        "follow_up_handled",
        baseContext()
      )
    ).toEqual({ kind: "follow_up_handled" });
  });

  it("accepts explicit archive consent only when archive gates pass", () => {
    const ctx = baseContext({
      followUpNeeded: false,
      handlingTrackingStep: HANDLING_TRACKING_STEP_COMPLETE,
    });
    expect(
      parseChatCaseClosureMessage(CHAT_CASE_CLOSURE_ARCHIVE_CASE_MESSAGE, "archive_case", ctx)
    ).toEqual({ kind: "archive_case" });
  });

  it("rejects vague closure wording", () => {
    expect(
      parseChatCaseClosureMessage("done", "follow_up_handled", baseContext())
    ).toEqual({ kind: "ambiguous", gate: "follow_up_handled" });
    expect(
      parseChatCaseClosureMessage("ok", "archive_case", baseContext({
        followUpNeeded: false,
        handlingTrackingStep: HANDLING_TRACKING_STEP_COMPLETE,
      }))
    ).toEqual({ kind: "ambiguous", gate: "archive_case" });
  });

  it("does not infer closure from unrelated messages", () => {
    expect(
      parseChatCaseClosureMessage(
        "What happens next with my refund?",
        "follow_up_handled",
        baseContext()
      )
    ).toEqual({ kind: "none" });
  });

  it("recognizes explicit decline", () => {
    expect(
      parseChatCaseClosureMessage(
        "I am not ready to archive this case yet",
        "archive_case",
        baseContext({
          followUpNeeded: false,
          handlingTrackingStep: HANDLING_TRACKING_STEP_COMPLETE,
        })
      )
    ).toEqual({ kind: "decline", gate: "archive_case" });
  });

  it("blocks premature archive while follow-up is still flagged", () => {
    expect(
      parseChatCaseClosureMessage(
        CHAT_CASE_CLOSURE_ARCHIVE_CASE_MESSAGE,
        "follow_up_handled",
        baseContext()
      )
    ).toEqual({ kind: "premature_archive" });
    expect(parsePrematureArchiveIntent(CHAT_CASE_CLOSURE_ARCHIVE_CASE_MESSAGE, baseContext())).toBe(
      true
    );
    expect(canArchiveCaseViaChat(baseContext())).toBe(false);
  });

  it("requires resolution flow before follow-up clear", () => {
    expect(
      canClearFollowUpViaChat(baseContext({ resolutionFlowExposed: false }))
    ).toBe(false);
  });

  it("blocks consumer follow-up clear when operator owns closure", () => {
    expect(
      canClearFollowUpViaChat(baseContext({ operatorOwnsClosure: true }))
    ).toBe(false);
    expect(
      resolvePendingChatCaseClosureGate(baseContext({ operatorOwnsClosure: true }))
    ).toBeNull();
  });

  it("allows archive while readiness refresh is in flight once follow-up is cleared", () => {
    expect(
      canArchiveCaseViaChat(
        baseContext({
          followUpNeeded: false,
          handlingTrackingStep: HANDLING_TRACKING_STEP_COMPLETE,
          readinessLoading: true,
        })
      )
    ).toBe(true);
  });

  it("builds assistant responses for closure outcomes", () => {
    expect(
      buildChatCaseClosureAssistantResponse({ kind: "archive_case" })
    ).toContain("archived");
    expect(
      buildChatCaseClosureAssistantResponse({ kind: "premature_archive" })
    ).toContain("follow-up");
  });

  // Safety gap: matchesArchiveCaseConsent/matchesFollowUpHandledConsent previously had no
  // question/interrogative/assistant-directed guard, so a mere QUESTION could trigger a real,
  // largely irreversible state mutation (the case actually gets archived).
  describe("a question never triggers a real closure state mutation", () => {
    const archiveReadyCtx = baseContext({
      followUpNeeded: false,
      handlingTrackingStep: HANDLING_TRACKING_STEP_COMPLETE,
    });

    it("archive_case: questions and assistant-directed requests stay none, punctuated and not", () => {
      for (const message of [
        "Can you archive this case?",
        "Can you archive this case",
        "Should I archive this case now?",
        "Should I archive this case now",
        "Have you archived my case yet?",
        "Have you archived my case yet",
      ]) {
        expect(
          parseChatCaseClosureMessage(message, "archive_case", archiveReadyCtx)
        ).toEqual({ kind: "none" });
      }
    });

    it("follow_up_handled: questions and assistant-directed requests stay none, punctuated and not", () => {
      for (const message of [
        "Have you handled the follow-up?",
        "Have you handled the follow-up",
        "Can you mark the follow-up as handled?",
        "Can you mark the follow-up as handled",
        "Is the follow-up handled?",
        "Is the follow-up handled",
      ]) {
        expect(
          parseChatCaseClosureMessage(message, "follow_up_handled", baseContext())
        ).toEqual({ kind: "none" });
      }
    });

    it("a question asking to archive early does not trigger premature_archive either", () => {
      // Not a state mutation, but still must not be treated as the user's own request.
      expect(
        parseChatCaseClosureMessage(
          "Can I archive this case now?",
          "follow_up_handled",
          baseContext()
        )
      ).toEqual({ kind: "none" });
      expect(parsePrematureArchiveIntent("Can I archive this case now?", baseContext())).toBe(
        false
      );
    });

    it("a question does not trigger operator-owned archive either", () => {
      const ctx = baseContext({
        followUpNeeded: false,
        handlingTrackingStep: HANDLING_TRACKING_STEP_COMPLETE,
        operatorOwnsClosure: true,
      });
      expect(parseOperatorOwnedArchiveIntent("Can you archive this case?", ctx)).toBe(false);
      expect(
        parseChatCaseClosureMessage("Can you archive this case?", "archive_case", ctx)
      ).toEqual({ kind: "none" });
    });

    it("still accepts the canonical declarative closure phrases", () => {
      expect(
        parseChatCaseClosureMessage(
          CHAT_CASE_CLOSURE_FOLLOW_UP_HANDLED_MESSAGE,
          "follow_up_handled",
          baseContext()
        )
      ).toEqual({ kind: "follow_up_handled" });
      expect(
        parseChatCaseClosureMessage(
          CHAT_CASE_CLOSURE_ARCHIVE_CASE_MESSAGE,
          "archive_case",
          archiveReadyCtx
        )
      ).toEqual({ kind: "archive_case" });
    });
  });

  // Full audit battery: whole-message allowlist must reject every non-exact framing across all
  // four closure mutation paths — archive_case, follow_up_handled, premature-archive, and
  // operator-owned archive. Only an explicit, present, first-person, unconditional statement (or
  // one of the intentionally supported direct commands) may mutate state.
  describe("whole-message allowlist rejects conditional/deferred/hypothetical/historical/third-person wording", () => {
    const archiveReadyCtx = baseContext({
      followUpNeeded: false,
      handlingTrackingStep: HANDLING_TRACKING_STEP_COMPLETE,
    });
    const operatorOwnedCtx = baseContext({
      followUpNeeded: false,
      handlingTrackingStep: HANDLING_TRACKING_STEP_COMPLETE,
      operatorOwnsClosure: true,
    });

    const archiveVariants = [
      // conditional
      "I am ready to archive this case if the refund arrives.",
      "Archive this case if the follow-up is resolved.",
      // deferred
      "I'll archive this case later.",
      "I will archive this case tomorrow.",
      // hypothetical
      "Suppose I archive this case now.",
      "Imagine I am ready to close this case.",
      // historical
      "I archived a case like this last year.",
      "This case was already archived once before.",
      // third-person
      "My lawyer said to archive this case.",
      "She told me to archive this case.",
      // interrogative / assistant-directed
      "Can you archive this case?",
      "Should I archive this case now?",
    ];

    const followUpVariants = [
      // conditional
      "Mark the follow-up as handled if everything checks out.",
      "The follow-up is handled if the merchant confirms.",
      // deferred
      "I will mark the follow-up as handled tomorrow.",
      "I'll handle the follow-up later.",
      // hypothetical
      "Hypothetically, the follow-up is handled.",
      "Suppose the follow-up is handled.",
      // historical
      "The follow-up was handled by my old lawyer months ago.",
      "I handled a similar follow-up last year.",
      // third-person
      "She told me to mark the follow-up as handled.",
      "My lawyer marked the follow-up handled.",
      // interrogative / assistant-directed
      "Have you handled the follow-up?",
      "Can you mark the follow-up as handled?",
    ];

    it("archive_case: rejects every non-exact variant (no state mutation)", () => {
      for (const message of archiveVariants) {
        expect(parseChatCaseClosureMessage(message, "archive_case", archiveReadyCtx)).toEqual({
          kind: "none",
        });
      }
    });

    it("follow_up_handled: rejects every non-exact variant (no state mutation)", () => {
      for (const message of followUpVariants) {
        expect(
          parseChatCaseClosureMessage(message, "follow_up_handled", baseContext())
        ).toEqual({ kind: "none" });
      }
    });

    it("premature-archive intent: rejects every non-exact variant", () => {
      for (const message of archiveVariants) {
        expect(parsePrematureArchiveIntent(message, baseContext())).toBe(false);
      }
    });

    it("operator-owned archive intent: rejects every non-exact variant", () => {
      for (const message of archiveVariants) {
        expect(parseOperatorOwnedArchiveIntent(message, operatorOwnedCtx)).toBe(false);
        expect(
          parseChatCaseClosureMessage(message, "archive_case", operatorOwnedCtx)
        ).toEqual({ kind: "none" });
      }
    });

    it("still accepts the canonical phrases and the intentionally supported direct commands", () => {
      expect(
        parseChatCaseClosureMessage(
          CHAT_CASE_CLOSURE_FOLLOW_UP_HANDLED_MESSAGE,
          "follow_up_handled",
          baseContext()
        )
      ).toEqual({ kind: "follow_up_handled" });
      expect(
        parseChatCaseClosureMessage("Mark the follow-up as handled.", "follow_up_handled", baseContext())
      ).toEqual({ kind: "follow_up_handled" });
      expect(
        parseChatCaseClosureMessage(
          CHAT_CASE_CLOSURE_ARCHIVE_CASE_MESSAGE,
          "archive_case",
          archiveReadyCtx
        )
      ).toEqual({ kind: "archive_case" });
      expect(
        parseChatCaseClosureMessage("Archive this case.", "archive_case", archiveReadyCtx)
      ).toEqual({ kind: "archive_case" });
      expect(
        parseChatCaseClosureMessage("Archive my case.", "archive_case", archiveReadyCtx)
      ).toEqual({ kind: "archive_case" });
      expect(
        parseChatCaseClosureMessage(
          "I am ready to archive this case.",
          "archive_case",
          archiveReadyCtx
        )
      ).toEqual({ kind: "archive_case" });
    });
  });

  it("returns operator-owned archive gate when consumer asks to archive while operator owns closure", () => {
    const ctx = baseContext({
      followUpNeeded: false,
      handlingTrackingStep: HANDLING_TRACKING_STEP_COMPLETE,
      operatorOwnsClosure: true,
    });
    expect(parseOperatorOwnedArchiveIntent(CHAT_CASE_CLOSURE_ARCHIVE_CASE_MESSAGE, ctx)).toBe(true);
    expect(
      parseChatCaseClosureMessage(CHAT_CASE_CLOSURE_ARCHIVE_CASE_MESSAGE, "archive_case", ctx)
    ).toEqual({ kind: "operator_owned_archive" });
    expect(canArchiveCaseViaChat(ctx)).toBe(false);
    expect(buildChatCaseClosureAssistantResponse({ kind: "operator_owned_archive" })).toBe(
      CHAT_OPERATOR_OWNED_ARCHIVE_RESPONSE
    );
    expect(CHAT_OPERATOR_OWNED_ARCHIVE_RESPONSE).toBe(REJECT_OPERATOR_OWNED_CASE_ARCHIVE_PATCH_MESSAGE);
  });
});

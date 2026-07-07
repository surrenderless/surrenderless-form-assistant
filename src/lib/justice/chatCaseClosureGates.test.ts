import { describe, expect, it } from "vitest";
import { HANDLING_TRACKING_STEP_COMPLETE } from "@/lib/justice/approvedNextActionHandlingDisplay";
import {
  buildChatCaseClosureAssistantResponse,
  canArchiveCaseViaChat,
  canClearFollowUpViaChat,
  CHAT_CASE_CLOSURE_ARCHIVE_CASE_MESSAGE,
  CHAT_CASE_CLOSURE_FOLLOW_UP_HANDLED_MESSAGE,
  parseChatCaseClosureMessage,
  parsePrematureArchiveIntent,
  resolvePendingChatCaseClosureGate,
  type ChatCaseClosureContext,
} from "@/lib/justice/chatCaseClosureGates";

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

  it("builds assistant responses for closure outcomes", () => {
    expect(
      buildChatCaseClosureAssistantResponse({ kind: "archive_case" })
    ).toContain("archived");
    expect(
      buildChatCaseClosureAssistantResponse({ kind: "premature_archive" })
    ).toContain("follow-up");
  });
});

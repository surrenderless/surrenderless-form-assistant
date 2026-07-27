import { describe, expect, it } from "vitest";
import {
  OWNED_ENDGAME_HANDLING_TRACKING_STEP,
  OWNED_ENDGAME_WAIT_COPY,
  OWNED_STEP_CHAT_STATUS_COPY,
  OWNED_STEP_HANDLING_TRACKING_COPY,
  OWNED_STEP_HUB_CASES_STATUS_COPY,
  resolveChatOwnedHandlingTrackingStep,
  resolveHubOrCasesHandlingTrackingStep,
  shouldShowChatConsumerArchiveControl,
  shouldShowChatConsumerEndgameDiyControls,
  shouldShowChatConsumerManualHandlingControls,
  shouldShowChatMerchantContactConfirmationControls,
  shouldShowHubOrCasesConsumerManualHandlingControls,
} from "@/lib/justice/surrenderlessOwnedChatManualUi";
import { ESCALATION_AWAITING_OPERATOR_FULFILLMENT_STEP } from "@/lib/justice/escalationLadderResolution";

describe("surrenderlessOwnedChatManualUi", () => {
  it("hides merchant-contact confirm while owned suppress is active", () => {
    expect(
      shouldShowChatMerchantContactConfirmationControls({
        suppressOwnedManualUi: true,
        needsMerchantContactDocumentation: true,
        hasChatCapturedMerchantContactInput: true,
      })
    ).toBe(false);
  });

  it("allows merchant-contact confirm only when not owned and docs are needed", () => {
    expect(
      shouldShowChatMerchantContactConfirmationControls({
        suppressOwnedManualUi: false,
        needsMerchantContactDocumentation: true,
        hasChatCapturedMerchantContactInput: true,
      })
    ).toBe(true);
    expect(
      shouldShowChatMerchantContactConfirmationControls({
        suppressOwnedManualUi: false,
        needsMerchantContactDocumentation: false,
        hasChatCapturedMerchantContactInput: true,
      })
    ).toBe(false);
  });

  it("hides consumer request-handling and mark-opened controls while owned", () => {
    expect(shouldShowChatConsumerManualHandlingControls(true)).toBe(false);
    expect(shouldShowChatConsumerManualHandlingControls(false)).toBe(true);
    expect(shouldShowHubOrCasesConsumerManualHandlingControls(true)).toBe(false);
    expect(shouldShowHubOrCasesConsumerManualHandlingControls(false)).toBe(true);
  });

  it("replaces DIY hub/cases next steps with awaiting-operator copy when owned", () => {
    expect(
      resolveHubOrCasesHandlingTrackingStep({
        suppressOwnedManualUi: true,
        manualDerivedStep: "Open the approved step and prepare the manual action.",
      })
    ).toBe(ESCALATION_AWAITING_OPERATOR_FULFILLMENT_STEP);
    expect(
      resolveHubOrCasesHandlingTrackingStep({
        suppressOwnedManualUi: false,
        manualDerivedStep: "Open the approved step and prepare the manual action.",
      })
    ).toBe("Open the approved step and prepare the manual action.");
  });

  it("provides owned status copy that does not tell the consumer to DIY", () => {
    expect(OWNED_STEP_CHAT_STATUS_COPY.toLowerCase()).toContain("surrenderless is carrying");
    expect(OWNED_STEP_CHAT_STATUS_COPY.toLowerCase()).not.toContain("yourself");
    expect(OWNED_STEP_HANDLING_TRACKING_COPY.toLowerCase()).toContain("no consumer submit");
    expect(OWNED_STEP_HANDLING_TRACKING_COPY.toLowerCase()).not.toContain("you must");
    expect(OWNED_STEP_HUB_CASES_STATUS_COPY.toLowerCase()).toContain("continue in chat");
    expect(OWNED_STEP_HUB_CASES_STATUS_COPY.toLowerCase()).not.toContain(
      "request surrenderless handling"
    );
  });

  it("hides consumer endgame DIY controls while owned", () => {
    expect(shouldShowChatConsumerEndgameDiyControls(true)).toBe(false);
    expect(shouldShowChatConsumerEndgameDiyControls(false)).toBe(true);
  });

  it("hides consumer archive while owned or after operator terminal response-review", () => {
    expect(
      shouldShowChatConsumerArchiveControl({
        suppressOwnedManualUi: true,
        hasOperatorTerminalResponseReviewOutcome: false,
      })
    ).toBe(false);
    expect(
      shouldShowChatConsumerArchiveControl({
        suppressOwnedManualUi: false,
        hasOperatorTerminalResponseReviewOutcome: true,
      })
    ).toBe(false);
    expect(
      shouldShowChatConsumerArchiveControl({
        suppressOwnedManualUi: false,
        hasOperatorTerminalResponseReviewOutcome: false,
      })
    ).toBe(true);
  });

  it("replaces DIY chat handling-tracking with owned endgame / awaiting-operator copy", () => {
    expect(
      resolveChatOwnedHandlingTrackingStep({
        suppressOwnedManualUi: true,
        resolutionFlowExposed: true,
        manualDerivedStep: "Review follow-up timing and mark follow-up handled when complete.",
      })
    ).toBe(OWNED_ENDGAME_HANDLING_TRACKING_STEP);
    expect(
      resolveChatOwnedHandlingTrackingStep({
        suppressOwnedManualUi: true,
        resolutionFlowExposed: false,
        manualDerivedStep: "Open the approved step and prepare the manual action.",
      })
    ).toBe(ESCALATION_AWAITING_OPERATOR_FULFILLMENT_STEP);
    expect(
      resolveChatOwnedHandlingTrackingStep({
        suppressOwnedManualUi: false,
        resolutionFlowExposed: true,
        manualDerivedStep: "Review follow-up timing and mark follow-up handled when complete.",
      })
    ).toBe("Review follow-up timing and mark follow-up handled when complete.");
  });

  it("provides owned endgame wait copy without consumer DIY form CTA", () => {
    expect(OWNED_ENDGAME_WAIT_COPY.toLowerCase()).toContain("stay in chat");
    expect(OWNED_ENDGAME_WAIT_COPY.toLowerCase()).toContain("tracking follow-up");
    expect(OWNED_ENDGAME_WAIT_COPY.toLowerCase()).toContain("do not need to record outcome");
    expect(OWNED_ENDGAME_WAIT_COPY.toLowerCase()).toContain("mark follow-up handled");
  });
});

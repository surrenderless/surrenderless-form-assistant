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
import { HANDLING_TRACKING_STEP_COMPLETE } from "@/lib/justice/approvedNextActionHandlingDisplay";
import {
  MANUAL_ACTION_TRACKING_REAL_BBB_PREP_HREF,
  MERCHANT_RESOLVED_TERMINAL_HREF,
} from "@/lib/justice/handlingTrackingProgress";

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

  it("fail-closes chat and hub/cases DIY handling controls", () => {
    expect(shouldShowChatConsumerManualHandlingControls(true)).toBe(false);
    expect(shouldShowChatConsumerManualHandlingControls(false)).toBe(false);
    expect(shouldShowHubOrCasesConsumerManualHandlingControls(true)).toBe(false);
    expect(shouldShowHubOrCasesConsumerManualHandlingControls(false)).toBe(false);
  });

  it("always uses awaiting-operator copy for hub/cases handling-tracking", () => {
    expect(
      resolveHubOrCasesHandlingTrackingStep({
        suppressOwnedManualUi: true,
        manualDerivedStep: "Open the approved step and prepare the manual action.",
      })
    ).toBe(ESCALATION_AWAITING_OPERATOR_FULFILLMENT_STEP);
    expect(
      resolveHubOrCasesHandlingTrackingStep({
        suppressOwnedManualUi: false,
        manualDerivedStep: "Add filing records from the case packet after external submission.",
      })
    ).toBe(ESCALATION_AWAITING_OPERATOR_FULFILLMENT_STEP);
    expect(
      resolveHubOrCasesHandlingTrackingStep({
        suppressOwnedManualUi: false,
        manualDerivedStep: "Tracking complete for now.",
      })
    ).toBe(ESCALATION_AWAITING_OPERATOR_FULFILLMENT_STEP);
  });

  it("shows the real completed state for the merchant-resolved terminal action instead of awaiting-operator copy", () => {
    expect(
      resolveHubOrCasesHandlingTrackingStep({
        suppressOwnedManualUi: false,
        manualDerivedStep: "Continue in chat to finish packet review and saved proof.",
        next: { href: MERCHANT_RESOLVED_TERMINAL_HREF, status: "completed" },
      })
    ).toBe(HANDLING_TRACKING_STEP_COMPLETE);
    // suppressOwnedManualUi must not matter for this terminal state either way.
    expect(
      resolveHubOrCasesHandlingTrackingStep({
        suppressOwnedManualUi: true,
        manualDerivedStep: "Continue in chat to finish packet review and saved proof.",
        next: { href: MERCHANT_RESOLVED_TERMINAL_HREF, status: "completed" },
      })
    ).toBe(HANDLING_TRACKING_STEP_COMPLETE);
  });

  it("keeps awaiting-operator copy for a real destination even when completed", () => {
    expect(
      resolveHubOrCasesHandlingTrackingStep({
        suppressOwnedManualUi: false,
        manualDerivedStep: "Tracking complete for now.",
        next: { href: MANUAL_ACTION_TRACKING_REAL_BBB_PREP_HREF, status: "completed" },
      })
    ).toBe(ESCALATION_AWAITING_OPERATOR_FULFILLMENT_STEP);
  });

  it("keeps awaiting-operator copy when next is omitted (existing callers unaffected)", () => {
    expect(
      resolveHubOrCasesHandlingTrackingStep({
        suppressOwnedManualUi: false,
        manualDerivedStep: "Tracking complete for now.",
      })
    ).toBe(ESCALATION_AWAITING_OPERATOR_FULFILLMENT_STEP);
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

  it("fail-closes consumer endgame DIY controls on chat", () => {
    expect(shouldShowChatConsumerEndgameDiyControls(true)).toBe(false);
    expect(shouldShowChatConsumerEndgameDiyControls(false)).toBe(false);
  });

  it("fail-closes consumer archive on chat", () => {
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
    ).toBe(false);
  });

  it("always uses owned endgame / awaiting-operator copy for chat handling-tracking", () => {
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
    ).toBe(OWNED_ENDGAME_HANDLING_TRACKING_STEP);
    expect(
      resolveChatOwnedHandlingTrackingStep({
        suppressOwnedManualUi: false,
        resolutionFlowExposed: false,
        manualDerivedStep: "Open the approved step and prepare the manual action.",
      })
    ).toBe(ESCALATION_AWAITING_OPERATOR_FULFILLMENT_STEP);
  });

  it("shows the real completed state for the merchant-resolved terminal action instead of 'tracking follow-up and will close'", () => {
    // resolutionFlowExposed is true for this terminal action in real use, which is exactly the
    // case that previously mapped to OWNED_ENDGAME_HANDLING_TRACKING_STEP ("Surrenderless is
    // tracking follow-up and will close this case when resolved") — wrong here, since there is
    // no Surrenderless follow-up and nothing left for Surrenderless to close.
    expect(
      resolveChatOwnedHandlingTrackingStep({
        suppressOwnedManualUi: false,
        resolutionFlowExposed: true,
        manualDerivedStep: HANDLING_TRACKING_STEP_COMPLETE,
        next: { href: MERCHANT_RESOLVED_TERMINAL_HREF, status: "completed" },
      })
    ).toBe(HANDLING_TRACKING_STEP_COMPLETE);
    expect(
      resolveChatOwnedHandlingTrackingStep({
        suppressOwnedManualUi: false,
        resolutionFlowExposed: true,
        manualDerivedStep: HANDLING_TRACKING_STEP_COMPLETE,
        next: { href: MERCHANT_RESOLVED_TERMINAL_HREF, status: "completed" },
      })
    ).not.toBe(OWNED_ENDGAME_HANDLING_TRACKING_STEP);
  });

  it("keeps owned endgame copy for a real destination's resolution flow even when completed", () => {
    expect(
      resolveChatOwnedHandlingTrackingStep({
        suppressOwnedManualUi: false,
        resolutionFlowExposed: true,
        manualDerivedStep: "Tracking complete for now.",
        next: { href: MANUAL_ACTION_TRACKING_REAL_BBB_PREP_HREF, status: "completed" },
      })
    ).toBe(OWNED_ENDGAME_HANDLING_TRACKING_STEP);
  });

  it("provides owned endgame wait copy without consumer DIY form CTA", () => {
    expect(OWNED_ENDGAME_WAIT_COPY.toLowerCase()).toContain("stay in chat");
    expect(OWNED_ENDGAME_WAIT_COPY.toLowerCase()).toContain("tracking follow-up");
    expect(OWNED_ENDGAME_WAIT_COPY.toLowerCase()).toContain("do not need to record outcome");
    expect(OWNED_ENDGAME_WAIT_COPY.toLowerCase()).toContain("mark follow-up handled");
  });
});

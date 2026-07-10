import { describe, expect, it } from "vitest";
import {
  HANDLING_TRACKING_STEP_ADD_CONFIRMATION,
  HANDLING_TRACKING_STEP_ADD_CONFIRMATION_CHAT_INLINE,
  HANDLING_TRACKING_STEP_ADD_FILING,
  HANDLING_TRACKING_STEP_ADD_FILING_CHAT_INLINE,
  HANDLING_TRACKING_STEP_MARK_ACKNOWLEDGED,
  HANDLING_TRACKING_STEP_OPEN_APPROVED,
  HANDLING_TRACKING_STEP_RECORD_OUTCOME,
  HANDLING_TRACKING_STEP_REVIEW_FOLLOW_UP,
  HANDLING_TRACKING_STEP_REVIEW_PACKET,
  resolveHandlingTrackingContextualLink,
} from "@/lib/justice/approvedNextActionHandlingDisplay";
import {
  ASSISTED_SUBMISSION_BBB_MOCK_PRACTICE_PREP_HREF,
  ASSISTED_SUBMISSION_FTC_MOCK_PRACTICE_PREP_HREF,
} from "@/lib/justice/assistedSubmissionLane";
import {
  CHAT_INLINE_BBB_PREP_HREF,
  CHAT_INLINE_DEMAND_LETTER_PREP_HREF,
  CHAT_INLINE_DOT_PREP_HREF,
  CHAT_INLINE_MERCHANT_PREP_HREF,
  CHAT_INLINE_PACKET_FALLBACK_PREP_HREF,
  CHAT_INLINE_PAYMENT_DISPUTE_PREP_HREF,
  CHAT_INLINE_FTC_REVIEW_PREP_HREF,
  CHAT_INLINE_STATE_AG_PREP_HREF,
} from "@/lib/justice/chatInlineApprovedPrep";

describe("resolveHandlingTrackingContextualLink", () => {
  it("suppresses open-step link on chat-ai when prep is inline", () => {
    expect(
      resolveHandlingTrackingContextualLink({
        derivedStep: HANDLING_TRACKING_STEP_OPEN_APPROVED,
        approvedNextAction: { href: CHAT_INLINE_MERCHANT_PREP_HREF },
        surface: "chat-ai",
        prepInlineInChat: true,
      })
    ).toBeNull();
  });

  it("still offers open-step link on chat-ai when prep is not inline", () => {
    expect(
      resolveHandlingTrackingContextualLink({
        derivedStep: HANDLING_TRACKING_STEP_OPEN_APPROVED,
        approvedNextAction: { href: "/justice/state-ag" },
        surface: "chat-ai",
        prepInlineInChat: false,
      })
    ).toEqual({
      href: "/justice/state-ag",
      label: "Open approved step (optional)",
    });
  });

  it("suppresses main-ladder off-chat open-step links on chat-ai", () => {
    expect(
      resolveHandlingTrackingContextualLink({
        derivedStep: HANDLING_TRACKING_STEP_OPEN_APPROVED,
        approvedNextAction: { href: "/justice/packet" },
        surface: "chat-ai",
        prepInlineInChat: false,
      })
    ).toBeNull();
  });

  it("suppresses review-packet link on chat-ai so consumers stay in chat", () => {
    expect(
      resolveHandlingTrackingContextualLink({
        derivedStep: HANDLING_TRACKING_STEP_REVIEW_PACKET,
        surface: "chat-ai",
        prepInlineInChat: false,
        basicsReady: true,
        evidenceCount: 1,
      })
    ).toBeNull();
  });

  it("keeps non-chat-ai contextual labels unchanged", () => {
    expect(
      resolveHandlingTrackingContextualLink({
        derivedStep: HANDLING_TRACKING_STEP_OPEN_APPROVED,
        approvedNextAction: { href: "/justice/state-ag" },
        surface: "cases",
      })
    ).toEqual({
      href: "/justice/state-ag",
      label: "Open approved step",
    });
    expect(
      resolveHandlingTrackingContextualLink({
        derivedStep: HANDLING_TRACKING_STEP_REVIEW_PACKET,
        surface: "cases",
        basicsReady: true,
        evidenceCount: 1,
      })
    ).toEqual({
      href: "/justice/packet",
      label: "Review case packet",
    });
  });

  it("suppresses open-step link on chat-ai when BBB prep is inline", () => {
    expect(
      resolveHandlingTrackingContextualLink({
        derivedStep: HANDLING_TRACKING_STEP_OPEN_APPROVED,
        approvedNextAction: { href: CHAT_INLINE_BBB_PREP_HREF },
        surface: "chat-ai",
        prepInlineInChat: true,
      })
    ).toBeNull();
  });

  it("suppresses open-step link on chat-ai when State AG prep is inline", () => {
    expect(
      resolveHandlingTrackingContextualLink({
        derivedStep: HANDLING_TRACKING_STEP_OPEN_APPROVED,
        approvedNextAction: { href: CHAT_INLINE_STATE_AG_PREP_HREF },
        surface: "chat-ai",
        prepInlineInChat: true,
      })
    ).toBeNull();
  });

  it("suppresses open-step link on chat-ai when DOT prep is inline", () => {
    expect(
      resolveHandlingTrackingContextualLink({
        derivedStep: HANDLING_TRACKING_STEP_OPEN_APPROVED,
        approvedNextAction: { href: CHAT_INLINE_DOT_PREP_HREF },
        surface: "chat-ai",
        prepInlineInChat: true,
      })
    ).toBeNull();
  });

  it("suppresses open-step link on chat-ai when demand letter prep is inline", () => {
    expect(
      resolveHandlingTrackingContextualLink({
        derivedStep: HANDLING_TRACKING_STEP_OPEN_APPROVED,
        approvedNextAction: { href: CHAT_INLINE_DEMAND_LETTER_PREP_HREF },
        surface: "chat-ai",
        prepInlineInChat: true,
      })
    ).toBeNull();
  });

  it("suppresses open-step link on chat-ai when packet fallback prep is inline", () => {
    expect(
      resolveHandlingTrackingContextualLink({
        derivedStep: HANDLING_TRACKING_STEP_OPEN_APPROVED,
        approvedNextAction: { href: CHAT_INLINE_PACKET_FALLBACK_PREP_HREF },
        surface: "chat-ai",
        prepInlineInChat: true,
      })
    ).toBeNull();
  });

  it("suppresses open-step link on chat-ai when payment dispute read-only prep is inline", () => {
    expect(
      resolveHandlingTrackingContextualLink({
        derivedStep: HANDLING_TRACKING_STEP_OPEN_APPROVED,
        approvedNextAction: { href: CHAT_INLINE_PAYMENT_DISPUTE_PREP_HREF },
        surface: "chat-ai",
        prepInlineInChat: true,
      })
    ).toBeNull();
  });

  it("suppresses open-step link on chat-ai when FTC read-only prep is inline", () => {
    expect(
      resolveHandlingTrackingContextualLink({
        derivedStep: HANDLING_TRACKING_STEP_OPEN_APPROVED,
        approvedNextAction: { href: CHAT_INLINE_FTC_REVIEW_PREP_HREF },
        surface: "chat-ai",
        prepInlineInChat: true,
      })
    ).toBeNull();
  });

  it("suppresses open-step link on chat-ai when FTC assisted mock-practice prep is inline", () => {
    expect(
      resolveHandlingTrackingContextualLink({
        derivedStep: HANDLING_TRACKING_STEP_OPEN_APPROVED,
        approvedNextAction: { href: ASSISTED_SUBMISSION_FTC_MOCK_PRACTICE_PREP_HREF },
        surface: "chat-ai",
        prepInlineInChat: true,
      })
    ).toBeNull();
  });

  it("suppresses open-step link on chat-ai when BBB assisted mock-practice prep is inline", () => {
    expect(
      resolveHandlingTrackingContextualLink({
        derivedStep: HANDLING_TRACKING_STEP_OPEN_APPROVED,
        approvedNextAction: { href: ASSISTED_SUBMISSION_BBB_MOCK_PRACTICE_PREP_HREF },
        surface: "chat-ai",
        prepInlineInChat: true,
      })
    ).toBeNull();
  });

  it("suppresses open-step link on chat-ai for BBB assisted mock-practice href when prep is not inline", () => {
    expect(
      resolveHandlingTrackingContextualLink({
        derivedStep: HANDLING_TRACKING_STEP_OPEN_APPROVED,
        approvedNextAction: { href: ASSISTED_SUBMISSION_BBB_MOCK_PRACTICE_PREP_HREF },
        surface: "chat-ai",
        prepInlineInChat: false,
      })
    ).toBeNull();
  });

  it("suppresses open-step link on chat-ai for FTC assisted mock-practice href when prep is not inline", () => {
    expect(
      resolveHandlingTrackingContextualLink({
        derivedStep: HANDLING_TRACKING_STEP_OPEN_APPROVED,
        approvedNextAction: { href: ASSISTED_SUBMISSION_FTC_MOCK_PRACTICE_PREP_HREF },
        surface: "chat-ai",
        prepInlineInChat: false,
      })
    ).toBeNull();
  });

  it("suppresses review-packet link on chat-ai when prepInlineInChat is true", () => {
    expect(
      resolveHandlingTrackingContextualLink({
        derivedStep: HANDLING_TRACKING_STEP_REVIEW_PACKET,
        approvedNextAction: { href: CHAT_INLINE_MERCHANT_PREP_HREF },
        surface: "chat-ai",
        prepInlineInChat: true,
        basicsReady: true,
        evidenceCount: 1,
      })
    ).toBeNull();
  });

  it("suppresses packet filing link on chat-ai when filing capture is inline", () => {
    expect(
      resolveHandlingTrackingContextualLink({
        derivedStep: HANDLING_TRACKING_STEP_ADD_FILING_CHAT_INLINE,
        surface: "chat-ai",
        inlineFilingCaptureInChat: true,
      })
    ).toBeNull();
    expect(
      resolveHandlingTrackingContextualLink({
        derivedStep: HANDLING_TRACKING_STEP_ADD_CONFIRMATION_CHAT_INLINE,
        surface: "chat-ai",
        inlineFilingCaptureInChat: true,
      })
    ).toBeNull();
  });

  it("suppresses packet filing link on chat-ai even when inline capture is not shown", () => {
    expect(
      resolveHandlingTrackingContextualLink({
        derivedStep: HANDLING_TRACKING_STEP_ADD_FILING_CHAT_INLINE,
        surface: "chat-ai",
        inlineFilingCaptureInChat: false,
      })
    ).toBeNull();
  });

  it("suppresses record-outcome link on packet when outcome capture is inline", () => {
    expect(
      resolveHandlingTrackingContextualLink({
        derivedStep: HANDLING_TRACKING_STEP_RECORD_OUTCOME,
        surface: "packet",
      })
    ).toBeNull();
  });

  it("keeps chat-ai record-outcome contextual link suppressed", () => {
    expect(
      resolveHandlingTrackingContextualLink({
        derivedStep: HANDLING_TRACKING_STEP_RECORD_OUTCOME,
        surface: "chat-ai",
      })
    ).toBeNull();
  });

  it("still offers record-outcome link on non-packet surfaces", () => {
    expect(
      resolveHandlingTrackingContextualLink({
        derivedStep: HANDLING_TRACKING_STEP_RECORD_OUTCOME,
        surface: "cases",
      })
    ).toEqual({
      href: "/justice/chat-ai",
      label: "Record outcome in chat",
    });
  });

  it("suppresses filing-step links on packet because filings are on-page", () => {
    expect(
      resolveHandlingTrackingContextualLink({
        derivedStep: HANDLING_TRACKING_STEP_ADD_FILING,
        surface: "packet",
      })
    ).toBeNull();
    expect(
      resolveHandlingTrackingContextualLink({
        derivedStep: HANDLING_TRACKING_STEP_ADD_CONFIRMATION,
        surface: "packet",
      })
    ).toBeNull();
  });

  it("keeps filing-step links on non-packet surfaces", () => {
    expect(
      resolveHandlingTrackingContextualLink({
        derivedStep: HANDLING_TRACKING_STEP_ADD_FILING,
        surface: "cases",
      })
    ).toEqual({
      href: "/justice/packet#packet-filings",
      label: "Open filing records",
    });
    expect(
      resolveHandlingTrackingContextualLink({
        derivedStep: HANDLING_TRACKING_STEP_ADD_CONFIRMATION,
        surface: "hub",
      })
    ).toEqual({
      href: "/justice/packet#packet-filings",
      label: "Open filing records",
    });
  });

  it("suppresses follow-up link on packet because follow-up is on-page", () => {
    expect(
      resolveHandlingTrackingContextualLink({
        derivedStep: HANDLING_TRACKING_STEP_REVIEW_FOLLOW_UP,
        surface: "packet",
      })
    ).toBeNull();
  });

  it("keeps follow-up link on non-packet surfaces", () => {
    expect(
      resolveHandlingTrackingContextualLink({
        derivedStep: HANDLING_TRACKING_STEP_REVIEW_FOLLOW_UP,
        surface: "cases",
      })
    ).toEqual({
      href: "/justice/chat-ai",
      label: "Review follow-up in chat",
    });
    expect(
      resolveHandlingTrackingContextualLink({
        derivedStep: HANDLING_TRACKING_STEP_REVIEW_FOLLOW_UP,
        surface: "hub",
      })
    ).toEqual({
      href: "/justice/chat-ai",
      label: "Review follow-up in chat",
    });
  });

  it("keeps other packet tracking contextual links unchanged", () => {
    expect(
      resolveHandlingTrackingContextualLink({
        derivedStep: HANDLING_TRACKING_STEP_MARK_ACKNOWLEDGED,
        surface: "packet",
        markAcknowledgedOnScreen: false,
      })
    ).toEqual({
      href: "/justice/chat-ai",
      label: "Mark acknowledged in chat",
    });
  });

  it("suppresses mark-acknowledged link when acknowledgment is on screen", () => {
    expect(
      resolveHandlingTrackingContextualLink({
        derivedStep: HANDLING_TRACKING_STEP_MARK_ACKNOWLEDGED,
        surface: "cases",
        markAcknowledgedOnScreen: true,
      })
    ).toBeNull();
    expect(
      resolveHandlingTrackingContextualLink({
        derivedStep: HANDLING_TRACKING_STEP_MARK_ACKNOWLEDGED,
        surface: "hub",
        markAcknowledgedOnScreen: true,
      })
    ).toBeNull();
  });
});

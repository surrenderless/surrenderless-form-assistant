import { describe, expect, it } from "vitest";
import {
  HANDLING_TRACKING_STEP_ADD_CONFIRMATION_CHAT_INLINE,
  HANDLING_TRACKING_STEP_ADD_FILING_CHAT_INLINE,
  HANDLING_TRACKING_STEP_OPEN_APPROVED,
  HANDLING_TRACKING_STEP_REVIEW_PACKET,
  resolveHandlingTrackingContextualLink,
} from "@/lib/justice/approvedNextActionHandlingDisplay";
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
      label: "Open approved step",
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

  it("offers packet filing link when inline capture is not shown", () => {
    expect(
      resolveHandlingTrackingContextualLink({
        derivedStep: HANDLING_TRACKING_STEP_ADD_FILING_CHAT_INLINE,
        surface: "chat-ai",
        inlineFilingCaptureInChat: false,
      })
    ).toEqual({
      href: "/justice/packet#packet-filings",
      label: "Open filing records",
    });
  });
});

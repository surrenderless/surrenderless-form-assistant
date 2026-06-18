import { describe, expect, it } from "vitest";
import {
  HANDLING_TRACKING_STEP_ADD_CONFIRMATION_CHAT_INLINE,
  HANDLING_TRACKING_STEP_ADD_FILING_CHAT_INLINE,
  HANDLING_TRACKING_STEP_OPEN_APPROVED,
  resolveHandlingTrackingContextualLink,
} from "@/lib/justice/approvedNextActionHandlingDisplay";
import { CHAT_INLINE_MERCHANT_PREP_HREF } from "@/lib/justice/chatInlineApprovedPrep";

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
        approvedNextAction: { href: "/justice/bbb" },
        surface: "chat-ai",
        prepInlineInChat: false,
      })
    ).toEqual({
      href: "/justice/bbb",
      label: "Open approved step",
    });
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

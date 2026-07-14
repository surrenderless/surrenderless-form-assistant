import { describe, expect, it } from "vitest";
import {
  OWNED_STEP_CHAT_STATUS_COPY,
  OWNED_STEP_HANDLING_TRACKING_COPY,
  shouldShowChatConsumerManualHandlingControls,
  shouldShowChatMerchantContactConfirmationControls,
} from "@/lib/justice/surrenderlessOwnedChatManualUi";

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
  });

  it("provides owned status copy that does not tell the consumer to DIY", () => {
    expect(OWNED_STEP_CHAT_STATUS_COPY.toLowerCase()).toContain("surrenderless is carrying");
    expect(OWNED_STEP_CHAT_STATUS_COPY.toLowerCase()).not.toContain("yourself");
    expect(OWNED_STEP_HANDLING_TRACKING_COPY.toLowerCase()).toContain("no consumer submit");
    expect(OWNED_STEP_HANDLING_TRACKING_COPY.toLowerCase()).not.toContain("you must");
  });
});

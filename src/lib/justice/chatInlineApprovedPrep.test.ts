import { describe, expect, it } from "vitest";
import {
  CHAT_INLINE_CFPB_PREP_HREF,
  CHAT_INLINE_FCC_PREP_HREF,
  CHAT_INLINE_FTC_REVIEW_PREP_HREF,
  CHAT_INLINE_MERCHANT_PREP_HREF,
  CHAT_INLINE_PAYMENT_DISPUTE_PREP_HREF,
  isChatInlinePrepHref,
} from "@/lib/justice/chatInlineApprovedPrep";

describe("isChatInlinePrepHref", () => {
  const inlineHrefs = [
    CHAT_INLINE_MERCHANT_PREP_HREF,
    CHAT_INLINE_CFPB_PREP_HREF,
    CHAT_INLINE_FCC_PREP_HREF,
    CHAT_INLINE_PAYMENT_DISPUTE_PREP_HREF,
    CHAT_INLINE_FTC_REVIEW_PREP_HREF,
  ];

  it.each(inlineHrefs)("returns true for inline prep route %s", (href) => {
    expect(isChatInlinePrepHref(href)).toBe(true);
    expect(isChatInlinePrepHref(`  ${href}  `)).toBe(true);
  });

  it("returns false for non-inline justice routes", () => {
    expect(isChatInlinePrepHref("/justice/packet")).toBe(false);
    expect(isChatInlinePrepHref("/justice/bbb")).toBe(false);
    expect(isChatInlinePrepHref("/justice/handling")).toBe(false);
    expect(isChatInlinePrepHref(undefined)).toBe(false);
    expect(isChatInlinePrepHref("")).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import {
  CHAT_INLINE_BBB_PREP_HREF,
  CHAT_INLINE_CFPB_PREP_HREF,
  CHAT_INLINE_FCC_PREP_HREF,
  CHAT_INLINE_FTC_REVIEW_PREP_HREF,
  CHAT_INLINE_MERCHANT_PREP_HREF,
  CHAT_INLINE_PAYMENT_DISPUTE_PREP_HREF,
  getChatInlineApprovedPrepContent,
  isChatInlinePrepHref,
} from "@/lib/justice/chatInlineApprovedPrep";
import type { JusticeIntake } from "@/lib/justice/types";

function baseIntake(overrides: Partial<JusticeIntake> = {}): JusticeIntake {
  return {
    problem_category: "online_purchase",
    company_name: "Example Retail Co",
    company_website: "https://example.com",
    purchase_or_signup: "Wireless earbuds",
    story: "Item never arrived after payment.",
    money_involved: "$89",
    pay_or_order_date: "2024-05-10",
    order_confirmation_details: "Order #ABC-123",
    user_display_name: "Test User",
    reply_email: "user@example.com",
    already_contacted: "no",
    ...overrides,
  };
}

describe("isChatInlinePrepHref", () => {
  const inlineHrefs = [
    CHAT_INLINE_MERCHANT_PREP_HREF,
    CHAT_INLINE_CFPB_PREP_HREF,
    CHAT_INLINE_FCC_PREP_HREF,
    CHAT_INLINE_BBB_PREP_HREF,
    CHAT_INLINE_PAYMENT_DISPUTE_PREP_HREF,
    CHAT_INLINE_FTC_REVIEW_PREP_HREF,
  ];

  it.each(inlineHrefs)("returns true for inline prep route %s", (href) => {
    expect(isChatInlinePrepHref(href)).toBe(true);
    expect(isChatInlinePrepHref(`  ${href}  `)).toBe(true);
  });

  it("returns false for non-inline justice routes", () => {
    expect(isChatInlinePrepHref("/justice/packet")).toBe(false);
    expect(isChatInlinePrepHref("/justice/handling")).toBe(false);
    expect(isChatInlinePrepHref(undefined)).toBe(false);
    expect(isChatInlinePrepHref("")).toBe(false);
  });
});

describe("getChatInlineApprovedPrepContent", () => {
  it("returns BBB complaint draft content with optional full-page link", () => {
    const intake = baseIntake();
    const content = getChatInlineApprovedPrepContent(CHAT_INLINE_BBB_PREP_HREF, intake, "BBB complaint");

    expect(content).not.toBeNull();
    expect(content?.kind).toBe("bbb_complaint");
    expect(content?.title).toBe("BBB complaint");
    expect(content?.messageText).toContain("DRAFT FOR BBB COMPLAINT");
    expect(content?.messageText).toContain("Example Retail Co");
    expect(content?.messageText).toContain("Item never arrived after payment.");
    expect(content?.helperText).toContain("BBB.org");
    expect(content?.copyButtonLabel).toBe("Copy draft");
    expect(content?.optionalPageHref).toBe(CHAT_INLINE_BBB_PREP_HREF);
    expect(content?.optionalPageLabel).toBe("Open full bbb complaint page");
    expect(content?.optionalPageNote).toContain("optional");
  });

  it("returns null for routes without inline prep content", () => {
    expect(getChatInlineApprovedPrepContent("/justice/state-ag", baseIntake())).toBeNull();
  });
});

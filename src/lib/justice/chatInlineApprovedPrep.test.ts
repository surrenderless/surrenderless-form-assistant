import { describe, expect, it } from "vitest";
import {
  CHAT_INLINE_BBB_PREP_HREF,
  CHAT_INLINE_CFPB_PREP_HREF,
  CHAT_INLINE_DEMAND_LETTER_PREP_HREF,
  CHAT_INLINE_DOT_PREP_HREF,
  CHAT_INLINE_FCC_PREP_HREF,
  CHAT_INLINE_FTC_REVIEW_PREP_HREF,
  CHAT_INLINE_MERCHANT_PREP_HREF,
  CHAT_INLINE_PACKET_FALLBACK_PREP_HREF,
  CHAT_INLINE_PAYMENT_DISPUTE_PREP_HREF,
  CHAT_INLINE_STATE_AG_PREP_HREF,
  getChatInlineApprovedPrepContent,
  isChatInlinePacketFallbackPrepHref,
  isChatInlinePrepHref,
  shouldShowChatInlineFtcPracticePrep,
  shouldShowChatInlineFtcReadOnlyPrep,
  shouldShowChatInlinePacketFallbackReadOnlyPrep,
  shouldShowChatInlinePaymentDisputeReadOnlyPrep,
  shouldShowChatInlineReadOnlyApprovedPrep,
} from "@/lib/justice/chatInlineApprovedPrep";
import type { JusticeApprovedNextAction, JusticeIntake } from "@/lib/justice/types";

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
    CHAT_INLINE_STATE_AG_PREP_HREF,
    CHAT_INLINE_DOT_PREP_HREF,
    CHAT_INLINE_DEMAND_LETTER_PREP_HREF,
    CHAT_INLINE_PAYMENT_DISPUTE_PREP_HREF,
    CHAT_INLINE_FTC_REVIEW_PREP_HREF,
    CHAT_INLINE_PACKET_FALLBACK_PREP_HREF,
  ];

  it.each(inlineHrefs)("returns true for inline prep route %s", (href) => {
    expect(isChatInlinePrepHref(href)).toBe(true);
    expect(isChatInlinePrepHref(`  ${href}  `)).toBe(true);
  });

  it("returns false for non-inline justice routes", () => {
    expect(isChatInlinePrepHref("/justice/handling")).toBe(false);
    expect(isChatInlinePrepHref(undefined)).toBe(false);
    expect(isChatInlinePrepHref("")).toBe(false);
  });
});

describe("isChatInlinePacketFallbackPrepHref", () => {
  it("returns true only for the packet fallback approved-action href", () => {
    expect(isChatInlinePacketFallbackPrepHref(CHAT_INLINE_PACKET_FALLBACK_PREP_HREF)).toBe(true);
    expect(isChatInlinePacketFallbackPrepHref(`  ${CHAT_INLINE_PACKET_FALLBACK_PREP_HREF}  `)).toBe(
      true
    );
    expect(isChatInlinePacketFallbackPrepHref("/justice/merchant")).toBe(false);
    expect(isChatInlinePacketFallbackPrepHref(undefined)).toBe(false);
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

  it("returns State AG complaint draft content with optional full-page link", () => {
    const intake = baseIntake({ consumer_us_state: "CA" });
    const content = getChatInlineApprovedPrepContent(
      CHAT_INLINE_STATE_AG_PREP_HREF,
      intake,
      "State AG complaint"
    );

    expect(content).not.toBeNull();
    expect(content?.kind).toBe("state_ag_complaint");
    expect(content?.title).toBe("State AG complaint");
    expect(content?.messageText).toContain("DRAFT FOR STATE ATTORNEY GENERAL");
    expect(content?.messageText).toContain("California (CA)");
    expect(content?.messageText).toContain("Example Retail Co");
    expect(content?.helperText).toContain("Attorney General");
    expect(content?.copyButtonLabel).toBe("Copy draft");
    expect(content?.optionalPageHref).toBe(CHAT_INLINE_STATE_AG_PREP_HREF);
    expect(content?.optionalPageLabel).toBe("Open full state ag complaint page");
    expect(content?.optionalPageNote).toContain("optional");
  });

  it("returns DOT aviation complaint draft content with optional full-page link", () => {
    const intake = baseIntake({
      company_name: "Example Airlines",
      purchase_or_signup: "Round-trip flight ORD–LAX",
      story: "Flight was canceled and I was not rebooked.",
    });
    const content = getChatInlineApprovedPrepContent(
      CHAT_INLINE_DOT_PREP_HREF,
      intake,
      "USDOT aviation complaint"
    );

    expect(content).not.toBeNull();
    expect(content?.kind).toBe("dot_complaint");
    expect(content?.title).toBe("USDOT aviation complaint");
    expect(content?.messageText).toContain("DRAFT FOR USDOT / AVIATION CONSUMER COMPLAINT");
    expect(content?.messageText).toContain("Example Airlines");
    expect(content?.messageText).toContain("Flight was canceled");
    expect(content?.helperText).toContain("Department of Transportation");
    expect(content?.copyButtonLabel).toBe("Copy draft");
    expect(content?.optionalPageHref).toBe(CHAT_INLINE_DOT_PREP_HREF);
    expect(content?.optionalPageLabel).toBe("Open full usdot aviation complaint page");
    expect(content?.optionalPageNote).toContain("optional");
  });

  it("returns demand letter draft content with optional full-page link", () => {
    const intake = baseIntake();
    const content = getChatInlineApprovedPrepContent(
      CHAT_INLINE_DEMAND_LETTER_PREP_HREF,
      intake,
      "Demand letter"
    );

    expect(content).not.toBeNull();
    expect(content?.kind).toBe("demand_letter");
    expect(content?.title).toBe("Demand letter");
    expect(content?.messageText).toContain("DRAFT DEMAND LETTER");
    expect(content?.messageText).toContain("Example Retail Co");
    expect(content?.messageText).toContain("Item never arrived after payment.");
    expect(content?.helperText).toContain("not legal advice");
    expect(content?.copyButtonLabel).toBe("Copy letter");
    expect(content?.optionalPageHref).toBe(CHAT_INLINE_DEMAND_LETTER_PREP_HREF);
    expect(content?.optionalPageLabel).toBe("Open full demand letter page");
    expect(content?.optionalPageNote).toContain("optional");
  });

  it("returns null for routes without inline prep content", () => {
    expect(getChatInlineApprovedPrepContent("/justice/handling", baseIntake())).toBeNull();
    expect(
      getChatInlineApprovedPrepContent(CHAT_INLINE_PACKET_FALLBACK_PREP_HREF, baseIntake())
    ).toBeNull();
  });
});

describe("shouldShowChatInlineReadOnlyApprovedPrep", () => {
  it("shows read-only prep for active UUID case with approved/started/completed status and prep content", () => {
    expect(
      shouldShowChatInlineReadOnlyApprovedPrep({
        isActiveUuidCase: true,
        preparedPacketApproved: true,
        status: "approved",
        hasPrepContent: true,
      })
    ).toBe(true);
    expect(
      shouldShowChatInlineReadOnlyApprovedPrep({
        isActiveUuidCase: true,
        preparedPacketApproved: true,
        status: "started",
        hasPrepContent: true,
      })
    ).toBe(true);
    expect(
      shouldShowChatInlineReadOnlyApprovedPrep({
        isActiveUuidCase: true,
        preparedPacketApproved: true,
        status: "completed",
        hasPrepContent: true,
      })
    ).toBe(true);
  });

  it("does not gate on handling_requested_at (read-only prep stays visible after handling request)", () => {
    expect(
      shouldShowChatInlineReadOnlyApprovedPrep({
        isActiveUuidCase: true,
        preparedPacketApproved: true,
        status: "started",
        hasPrepContent: true,
      })
    ).toBe(true);
  });

  it("returns false without prep content or outside active-case gates", () => {
    expect(
      shouldShowChatInlineReadOnlyApprovedPrep({
        isActiveUuidCase: true,
        preparedPacketApproved: true,
        status: "approved",
        hasPrepContent: false,
      })
    ).toBe(false);
    expect(
      shouldShowChatInlineReadOnlyApprovedPrep({
        isActiveUuidCase: false,
        preparedPacketApproved: true,
        status: "approved",
        hasPrepContent: true,
      })
    ).toBe(false);
  });
});

describe("shouldShowChatInlinePacketFallbackReadOnlyPrep", () => {
  it("shows packet fallback read-only prep for matching href without handling gate", () => {
    expect(
      shouldShowChatInlinePacketFallbackReadOnlyPrep({
        isActiveUuidCase: true,
        preparedPacketApproved: true,
        status: "started",
        href: CHAT_INLINE_PACKET_FALLBACK_PREP_HREF,
      })
    ).toBe(true);
    expect(
      shouldShowChatInlinePacketFallbackReadOnlyPrep({
        isActiveUuidCase: true,
        preparedPacketApproved: true,
        status: "completed",
        href: CHAT_INLINE_PACKET_FALLBACK_PREP_HREF,
      })
    ).toBe(true);
  });

  it("returns false for non-packet href", () => {
    expect(
      shouldShowChatInlinePacketFallbackReadOnlyPrep({
        isActiveUuidCase: true,
        preparedPacketApproved: true,
        status: "started",
        href: CHAT_INLINE_MERCHANT_PREP_HREF,
      })
    ).toBe(false);
  });
});

describe("shouldShowChatInlinePaymentDisputeReadOnlyPrep", () => {
  it("shows read-only payment dispute prep after handling request", () => {
    expect(
      shouldShowChatInlinePaymentDisputeReadOnlyPrep({
        isActiveUuidCase: true,
        preparedPacketApproved: true,
        status: "started",
        href: CHAT_INLINE_PAYMENT_DISPUTE_PREP_HREF,
        handlingRequested: true,
      })
    ).toBe(true);
    expect(
      shouldShowChatInlinePaymentDisputeReadOnlyPrep({
        isActiveUuidCase: true,
        preparedPacketApproved: true,
        status: "completed",
        href: CHAT_INLINE_PAYMENT_DISPUTE_PREP_HREF,
        handlingRequested: true,
      })
    ).toBe(true);
  });

  it("returns false when handling is not requested unless status is completed", () => {
    expect(
      shouldShowChatInlinePaymentDisputeReadOnlyPrep({
        isActiveUuidCase: true,
        preparedPacketApproved: true,
        status: "started",
        href: CHAT_INLINE_PAYMENT_DISPUTE_PREP_HREF,
        handlingRequested: false,
      })
    ).toBe(false);
    expect(
      shouldShowChatInlinePaymentDisputeReadOnlyPrep({
        isActiveUuidCase: true,
        preparedPacketApproved: true,
        status: "completed",
        href: CHAT_INLINE_PAYMENT_DISPUTE_PREP_HREF,
        handlingRequested: false,
      })
    ).toBe(true);
  });

  it("returns false for non-payment-dispute href", () => {
    expect(
      shouldShowChatInlinePaymentDisputeReadOnlyPrep({
        isActiveUuidCase: true,
        preparedPacketApproved: true,
        status: "started",
        href: CHAT_INLINE_MERCHANT_PREP_HREF,
        handlingRequested: true,
      })
    ).toBe(false);
  });
});

describe("shouldShowChatInlineFtcPracticePrep", () => {
  const CASE_ID = "550e8400-e29b-41d4-a716-446655440000";

  function practicePrepInput(
    overrides: Partial<{
      isUpdatingExistingCase: boolean;
      caseId: string;
      isLoaded: boolean;
      isSignedIn: boolean;
      preparedPacketApproved: boolean;
      approvedNextAction: JusticeApprovedNextAction;
    }> = {}
  ) {
    return {
      isUpdatingExistingCase: true,
      caseId: CASE_ID,
      isLoaded: true,
      isSignedIn: true,
      preparedPacketApproved: true,
      approvedNextAction: {
        label: "FTC review",
        href: CHAT_INLINE_FTC_REVIEW_PREP_HREF,
        status: "approved" as const,
      },
      ...overrides,
    };
  }

  it("shows FTC practice prep for /justice/ftc-review when all gates pass", () => {
    expect(shouldShowChatInlineFtcPracticePrep(practicePrepInput())).toBe(true);
    expect(
      shouldShowChatInlineFtcPracticePrep(
        practicePrepInput({
          approvedNextAction: {
            label: "FTC review",
            href: "/justice/ftc-review",
            status: "started",
          },
        })
      )
    ).toBe(true);
  });

  it("returns false when not updating an existing case", () => {
    expect(
      shouldShowChatInlineFtcPracticePrep(
        practicePrepInput({ isUpdatingExistingCase: false })
      )
    ).toBe(false);
  });

  it("returns false without an active UUID case id", () => {
    expect(shouldShowChatInlineFtcPracticePrep(practicePrepInput({ caseId: "" }))).toBe(false);
    expect(
      shouldShowChatInlineFtcPracticePrep(practicePrepInput({ caseId: "case_local_123" }))
    ).toBe(false);
  });

  it("returns false when handling is requested", () => {
    expect(
      shouldShowChatInlineFtcPracticePrep(
        practicePrepInput({
          approvedNextAction: {
            label: "FTC review",
            href: CHAT_INLINE_FTC_REVIEW_PREP_HREF,
            status: "started",
            handling_requested_at: "2026-01-01T00:00:00.000Z",
          },
        })
      )
    ).toBe(false);
  });

  it("returns false when assisted mock submission is not eligible", () => {
    expect(
      shouldShowChatInlineFtcPracticePrep(practicePrepInput({ isSignedIn: false }))
    ).toBe(false);
    expect(
      shouldShowChatInlineFtcPracticePrep(
        practicePrepInput({
          approvedNextAction: {
            label: "CFPB",
            href: CHAT_INLINE_CFPB_PREP_HREF,
            status: "approved",
          },
        })
      )
    ).toBe(false);
  });
});

describe("shouldShowChatInlineFtcReadOnlyPrep", () => {
  it("shows read-only FTC prep for /justice/ftc-review when other gates pass", () => {
    expect(
      shouldShowChatInlineFtcReadOnlyPrep({
        isActiveUuidCase: true,
        preparedPacketApproved: true,
        status: "started",
        href: "/justice/ftc-review",
        handlingRequested: true,
      })
    ).toBe(true);
    expect(
      shouldShowChatInlineFtcReadOnlyPrep({
        isActiveUuidCase: true,
        preparedPacketApproved: true,
        status: "completed",
        href: CHAT_INLINE_FTC_REVIEW_PREP_HREF,
        handlingRequested: false,
      })
    ).toBe(true);
  });

  it("shows read-only FTC prep after handling request", () => {
    expect(
      shouldShowChatInlineFtcReadOnlyPrep({
        isActiveUuidCase: true,
        preparedPacketApproved: true,
        status: "started",
        href: CHAT_INLINE_FTC_REVIEW_PREP_HREF,
        handlingRequested: true,
      })
    ).toBe(true);
    expect(
      shouldShowChatInlineFtcReadOnlyPrep({
        isActiveUuidCase: true,
        preparedPacketApproved: true,
        status: "completed",
        href: CHAT_INLINE_FTC_REVIEW_PREP_HREF,
        handlingRequested: true,
      })
    ).toBe(true);
  });

  it("returns false when handling is not requested unless status is completed", () => {
    expect(
      shouldShowChatInlineFtcReadOnlyPrep({
        isActiveUuidCase: true,
        preparedPacketApproved: true,
        status: "started",
        href: CHAT_INLINE_FTC_REVIEW_PREP_HREF,
        handlingRequested: false,
      })
    ).toBe(false);
    expect(
      shouldShowChatInlineFtcReadOnlyPrep({
        isActiveUuidCase: true,
        preparedPacketApproved: true,
        status: "completed",
        href: CHAT_INLINE_FTC_REVIEW_PREP_HREF,
        handlingRequested: false,
      })
    ).toBe(true);
  });

  it("returns false for unrelated hrefs", () => {
    expect(
      shouldShowChatInlineFtcReadOnlyPrep({
        isActiveUuidCase: true,
        preparedPacketApproved: true,
        status: "started",
        href: CHAT_INLINE_MERCHANT_PREP_HREF,
        handlingRequested: true,
      })
    ).toBe(false);
    expect(
      shouldShowChatInlineFtcReadOnlyPrep({
        isActiveUuidCase: true,
        preparedPacketApproved: true,
        status: "completed",
        href: CHAT_INLINE_CFPB_PREP_HREF,
        handlingRequested: false,
      })
    ).toBe(false);
  });
});

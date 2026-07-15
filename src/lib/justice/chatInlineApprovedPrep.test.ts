import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ASSISTED_SUBMISSION_BBB_MOCK_PRACTICE_PREP_HREF,
  ASSISTED_SUBMISSION_FTC_MOCK_PRACTICE_PREP_HREF,
  ASSISTED_SUBMISSION_REAL_BBB_PREP_HREF,
} from "@/lib/justice/assistedSubmissionLane";
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
  buildChatInlineAssistedPracticeSummaryLines,
  getChatInlineApprovedPrepContent,
  isChatInlinePacketFallbackPrepHref,
  isChatInlinePrepHref,
  resolveAssistedPracticeSubmissionLaneId,
  shouldResetAssistedPracticeRunUiState,
  shouldShowChatInlineBbbMockPracticePrep,
  shouldShowChatInlineBbbMockReadOnlyPrep,
  shouldShowChatInlineFtcMockPracticePrep,
  shouldShowChatInlineFtcMockReadOnlyPrep,
  shouldShowChatInlineFtcPracticePrep,
  shouldShowChatInlineFtcReadOnlyPrep,
  shouldShowChatInlinePacketFallbackReadOnlyPrep,
  shouldShowChatInlinePaymentDisputeReadOnlyPrep,
  shouldShowChatInlineReadOnlyApprovedPrep,
  shouldShowChatInlineRealBbbComplaintPrep,
  shouldShowChatInlineRealBbbComplaintReadOnlyPrep,
  shouldShowMarkStepOpenedForApprovedAction,
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
  it("returns BBB complaint draft content without DIY full-page exit", () => {
    const intake = baseIntake();
    const content = getChatInlineApprovedPrepContent(CHAT_INLINE_BBB_PREP_HREF, intake, "BBB complaint");

    expect(content).not.toBeNull();
    expect(content?.kind).toBe("bbb_complaint");
    expect(content?.title).toBe("BBB complaint");
    expect(content?.messageText).toContain("DRAFT FOR BBB COMPLAINT");
    expect(content?.messageText).toContain("Example Retail Co");
    expect(content?.messageText).toContain("Item never arrived after payment.");
    expect(content?.helperText).toMatch(/BBB complaint|Stay in chat|automation or operators/i);
    expect(content?.copyButtonLabel).toBe("Copy draft");
    expect(content?.optionalPageHref).toBeUndefined();
    expect(content?.optionalPageLabel).toBeUndefined();
    expect(content?.optionalPageNote).toBeUndefined();
  });

  it("returns State AG complaint draft content without DIY full-page exit", () => {
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
    expect(content?.helperText).toMatch(/operator fulfillment|Stay in chat/i);
    expect(content?.copyButtonLabel).toBe("Copy draft");
    expect(content?.optionalPageHref).toBeUndefined();
    expect(content?.optionalPageLabel).toBeUndefined();
    expect(content?.optionalPageNote).toBeUndefined();
  });

  it("returns DOT aviation complaint draft content without DIY full-page exit", () => {
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
    expect(content?.helperText).toMatch(/operator fulfillment|Stay in chat/i);
    expect(content?.copyButtonLabel).toBe("Copy draft");
    expect(content?.optionalPageHref).toBeUndefined();
    expect(content?.optionalPageLabel).toBeUndefined();
    expect(content?.optionalPageNote).toBeUndefined();
  });

  it("returns demand letter draft content without DIY full-page exit", () => {
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
    expect(content?.optionalPageHref).toBeUndefined();
    expect(content?.optionalPageLabel).toBeUndefined();
    expect(content?.optionalPageNote).toBeUndefined();
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

  it("keeps FTC mock practice prep lane-specific while generic gate accepts runnable BBB href", () => {
    expect(
      shouldShowChatInlineFtcPracticePrep(
        practicePrepInput({
          approvedNextAction: {
            label: "BBB practice",
            href: ASSISTED_SUBMISSION_BBB_MOCK_PRACTICE_PREP_HREF,
            status: "approved",
          },
        })
      )
    ).toBe(true);
    expect(
      shouldShowChatInlineFtcMockPracticePrep(
        practicePrepInput({
          approvedNextAction: {
            label: "BBB practice",
            href: ASSISTED_SUBMISSION_BBB_MOCK_PRACTICE_PREP_HREF,
            status: "approved",
          },
        })
      )
    ).toBe(false);
  });
});

describe("assisted mock practice lane prep and summary", () => {
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
        href: ASSISTED_SUBMISSION_FTC_MOCK_PRACTICE_PREP_HREF,
        status: "approved" as const,
      },
      ...overrides,
    };
  }

  it("resolves lane ids from approved-action href", () => {
    expect(resolveAssistedPracticeSubmissionLaneId(ASSISTED_SUBMISSION_FTC_MOCK_PRACTICE_PREP_HREF)).toBe(
      "ftc_practice"
    );
    expect(resolveAssistedPracticeSubmissionLaneId(ASSISTED_SUBMISSION_BBB_MOCK_PRACTICE_PREP_HREF)).toBe(
      "bbb_practice"
    );
    expect(resolveAssistedPracticeSubmissionLaneId(ASSISTED_SUBMISSION_REAL_BBB_PREP_HREF)).toBe(
      "bbb_complaint"
    );
    expect(resolveAssistedPracticeSubmissionLaneId("/justice/cfpb")).toBeUndefined();
  });

  it("shows FTC mock practice prep only for the FTC assisted lane", () => {
    expect(shouldShowChatInlineFtcMockPracticePrep(practicePrepInput())).toBe(true);
    expect(
      shouldShowChatInlineFtcMockPracticePrep(
        practicePrepInput({
          approvedNextAction: {
            label: "BBB practice",
            href: ASSISTED_SUBMISSION_BBB_MOCK_PRACTICE_PREP_HREF,
            status: "approved",
          },
        })
      )
    ).toBe(false);
  });

  it("shows FTC mock read-only prep only for the FTC assisted lane", () => {
    expect(
      shouldShowChatInlineFtcMockReadOnlyPrep({
        isActiveUuidCase: true,
        preparedPacketApproved: true,
        status: "completed",
        href: ASSISTED_SUBMISSION_FTC_MOCK_PRACTICE_PREP_HREF,
        handlingRequested: false,
      })
    ).toBe(true);
    expect(
      shouldShowChatInlineFtcMockReadOnlyPrep({
        isActiveUuidCase: true,
        preparedPacketApproved: true,
        status: "completed",
        href: ASSISTED_SUBMISSION_BBB_MOCK_PRACTICE_PREP_HREF,
        handlingRequested: false,
      })
    ).toBe(false);
  });

  it("shows BBB mock practice prep when all gates pass", () => {
    expect(
      shouldShowChatInlineBbbMockPracticePrep(
        practicePrepInput({
          approvedNextAction: {
            label: "BBB practice",
            href: ASSISTED_SUBMISSION_BBB_MOCK_PRACTICE_PREP_HREF,
            status: "approved",
          },
        })
      )
    ).toBe(true);
    expect(
      shouldShowChatInlineBbbMockReadOnlyPrep({
        isActiveUuidCase: true,
        preparedPacketApproved: true,
        status: "completed",
        href: ASSISTED_SUBMISSION_BBB_MOCK_PRACTICE_PREP_HREF,
        handlingRequested: false,
      })
    ).toBe(true);
  });

  it("keeps BBB mock practice prep hidden when gates fail", () => {
    expect(
      shouldShowChatInlineBbbMockPracticePrep(
        practicePrepInput({
          isSignedIn: false,
          approvedNextAction: {
            label: "BBB practice",
            href: ASSISTED_SUBMISSION_BBB_MOCK_PRACTICE_PREP_HREF,
            status: "approved",
          },
        })
      )
    ).toBe(false);
    expect(
      shouldShowChatInlineBbbMockPracticePrep(
        practicePrepInput({
          approvedNextAction: {
            label: "BBB practice",
            href: ASSISTED_SUBMISSION_BBB_MOCK_PRACTICE_PREP_HREF,
            status: "approved",
            handling_requested_at: "2026-06-16T12:00:00.000Z",
          },
        })
      )
    ).toBe(false);
  });

  it("shows real BBB complaint prep by default when all gates pass", () => {
    expect(
      shouldShowChatInlineRealBbbComplaintPrep(
        practicePrepInput({
          approvedNextAction: {
            label: "Better Business Bureau",
            href: ASSISTED_SUBMISSION_REAL_BBB_PREP_HREF,
            status: "approved",
          },
        })
      )
    ).toBe(true);
  });

  it("hides Mark step opened when inline real BBB autofill prep is available", () => {
    expect(
      shouldShowMarkStepOpenedForApprovedAction({
        status: "approved",
        href: ASSISTED_SUBMISSION_REAL_BBB_PREP_HREF,
        label: "Better Business Bureau",
        showInlineRealBbbComplaintPrep: true,
      })
    ).toBe(false);
  });

  it("shows Mark step opened for approved non-inline-BBB steps", () => {
    expect(
      shouldShowMarkStepOpenedForApprovedAction({
        status: "approved",
        href: CHAT_INLINE_STATE_AG_PREP_HREF,
        label: "State Attorney General (consumer)",
        showInlineRealBbbComplaintPrep: false,
      })
    ).toBe(true);
  });

  it("shows real BBB complaint prep when autofill is enabled and all gates pass", () => {
    vi.stubEnv("NEXT_PUBLIC_JUSTICE_REAL_BBB_AUTOFILL_ENABLED", "true");
    expect(
      shouldShowChatInlineRealBbbComplaintPrep(
        practicePrepInput({
          approvedNextAction: {
            label: "Better Business Bureau",
            href: ASSISTED_SUBMISSION_REAL_BBB_PREP_HREF,
            status: "approved",
          },
        })
      )
    ).toBe(true);
    expect(
      shouldShowChatInlineRealBbbComplaintReadOnlyPrep({
        isActiveUuidCase: true,
        preparedPacketApproved: true,
        status: "completed",
        href: ASSISTED_SUBMISSION_REAL_BBB_PREP_HREF,
        handlingRequested: false,
      })
    ).toBe(true);
  });

  it("keeps real BBB complaint prep hidden when autofill is explicitly disabled and copy-only prep remains available", () => {
    vi.stubEnv("NEXT_PUBLIC_JUSTICE_REAL_BBB_AUTOFILL_ENABLED", "false");
    expect(
      shouldShowChatInlineRealBbbComplaintPrep(
        practicePrepInput({
          approvedNextAction: {
            label: "Better Business Bureau",
            href: ASSISTED_SUBMISSION_REAL_BBB_PREP_HREF,
            status: "approved",
          },
        })
      )
    ).toBe(false);
    expect(
      getChatInlineApprovedPrepContent(ASSISTED_SUBMISSION_REAL_BBB_PREP_HREF, baseIntake())?.kind
    ).toBe("bbb_complaint");
    expect(
      shouldShowChatInlineReadOnlyApprovedPrep({
        isActiveUuidCase: true,
        preparedPacketApproved: true,
        status: "approved",
        hasPrepContent: true,
      })
    ).toBe(true);
  });

  it("keeps real BBB complaint prep hidden for other assisted lanes and failed gates", () => {
    expect(
      shouldShowChatInlineRealBbbComplaintPrep(
        practicePrepInput({
          approvedNextAction: {
            label: "BBB practice",
            href: ASSISTED_SUBMISSION_BBB_MOCK_PRACTICE_PREP_HREF,
            status: "approved",
          },
        })
      )
    ).toBe(false);
    expect(
      shouldShowChatInlineRealBbbComplaintPrep(
        practicePrepInput({
          isSignedIn: false,
          approvedNextAction: {
            label: "Better Business Bureau",
            href: ASSISTED_SUBMISSION_REAL_BBB_PREP_HREF,
            status: "approved",
          },
        })
      )
    ).toBe(false);
    expect(
      shouldShowChatInlineRealBbbComplaintReadOnlyPrep({
        isActiveUuidCase: true,
        preparedPacketApproved: true,
        status: "completed",
        href: ASSISTED_SUBMISSION_BBB_MOCK_PRACTICE_PREP_HREF,
        handlingRequested: false,
      })
    ).toBe(false);
  });

  it("builds lane-specific assisted practice summary lines", () => {
    const intake = baseIntake();
    const ftcSummary = buildChatInlineAssistedPracticeSummaryLines(
      intake,
      ASSISTED_SUBMISSION_FTC_MOCK_PRACTICE_PREP_HREF
    );
    const bbbSummary = buildChatInlineAssistedPracticeSummaryLines(
      intake,
      ASSISTED_SUBMISSION_BBB_MOCK_PRACTICE_PREP_HREF
    );
    const realBbbSummary = buildChatInlineAssistedPracticeSummaryLines(
      intake,
      ASSISTED_SUBMISSION_REAL_BBB_PREP_HREF
    );

    expect(ftcSummary[0]).toContain("Company:");
    expect(bbbSummary[0]).toContain("Company:");
    expect(realBbbSummary).toEqual(bbbSummary);
    expect(ftcSummary).toEqual(bbbSummary);
    expect(buildChatInlineAssistedPracticeSummaryLines(intake, "/justice/cfpb")).toEqual([]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
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

  it("passes generic read-only gate for runnable BBB href; mock FTC gate stays lane-specific", () => {
    expect(
      shouldShowChatInlineFtcReadOnlyPrep({
        isActiveUuidCase: true,
        preparedPacketApproved: true,
        status: "completed",
        href: ASSISTED_SUBMISSION_BBB_MOCK_PRACTICE_PREP_HREF,
        handlingRequested: false,
      })
    ).toBe(true);
    expect(
      shouldShowChatInlineFtcMockReadOnlyPrep({
        isActiveUuidCase: true,
        preparedPacketApproved: true,
        status: "completed",
        href: ASSISTED_SUBMISSION_BBB_MOCK_PRACTICE_PREP_HREF,
        handlingRequested: false,
      })
    ).toBe(false);
  });
});

describe("shouldResetAssistedPracticeRunUiState", () => {
  it("does not reset when remaining on the FTC assisted lane", () => {
    expect(
      shouldResetAssistedPracticeRunUiState(
        ASSISTED_SUBMISSION_FTC_MOCK_PRACTICE_PREP_HREF,
        ASSISTED_SUBMISSION_FTC_MOCK_PRACTICE_PREP_HREF
      )
    ).toBe(false);
  });

  it("does not reset when remaining on the BBB assisted lane", () => {
    expect(
      shouldResetAssistedPracticeRunUiState(
        ASSISTED_SUBMISSION_BBB_MOCK_PRACTICE_PREP_HREF,
        ASSISTED_SUBMISSION_BBB_MOCK_PRACTICE_PREP_HREF
      )
    ).toBe(false);
  });

  it("does not reset when remaining on the real BBB complaint lane", () => {
    expect(
      shouldResetAssistedPracticeRunUiState(
        ASSISTED_SUBMISSION_REAL_BBB_PREP_HREF,
        ASSISTED_SUBMISSION_REAL_BBB_PREP_HREF
      )
    ).toBe(false);
  });

  it("resets when advancing from BBB practice to real BBB complaint", () => {
    expect(
      shouldResetAssistedPracticeRunUiState(
        ASSISTED_SUBMISSION_BBB_MOCK_PRACTICE_PREP_HREF,
        ASSISTED_SUBMISSION_REAL_BBB_PREP_HREF
      )
    ).toBe(true);
  });

  it("resets when advancing from FTC practice to BBB practice", () => {
    expect(
      shouldResetAssistedPracticeRunUiState(
        ASSISTED_SUBMISSION_FTC_MOCK_PRACTICE_PREP_HREF,
        ASSISTED_SUBMISSION_BBB_MOCK_PRACTICE_PREP_HREF
      )
    ).toBe(true);
  });

  it("resets when moving from BBB practice back to FTC practice", () => {
    expect(
      shouldResetAssistedPracticeRunUiState(
        ASSISTED_SUBMISSION_BBB_MOCK_PRACTICE_PREP_HREF,
        ASSISTED_SUBMISSION_FTC_MOCK_PRACTICE_PREP_HREF
      )
    ).toBe(true);
  });

  it("resets when leaving an assisted lane for a non-assisted step", () => {
    expect(
      shouldResetAssistedPracticeRunUiState(
        ASSISTED_SUBMISSION_FTC_MOCK_PRACTICE_PREP_HREF,
        CHAT_INLINE_MERCHANT_PREP_HREF
      )
    ).toBe(true);
    expect(
      shouldResetAssistedPracticeRunUiState(
        ASSISTED_SUBMISSION_BBB_MOCK_PRACTICE_PREP_HREF,
        CHAT_INLINE_CFPB_PREP_HREF
      )
    ).toBe(true);
  });

  it("does not reset when entering an assisted lane from a non-assisted step", () => {
    expect(
      shouldResetAssistedPracticeRunUiState(
        CHAT_INLINE_MERCHANT_PREP_HREF,
        ASSISTED_SUBMISSION_FTC_MOCK_PRACTICE_PREP_HREF
      )
    ).toBe(false);
    expect(
      shouldResetAssistedPracticeRunUiState(
        undefined,
        ASSISTED_SUBMISSION_BBB_MOCK_PRACTICE_PREP_HREF
      )
    ).toBe(false);
    expect(
      shouldResetAssistedPracticeRunUiState(undefined, ASSISTED_SUBMISSION_REAL_BBB_PREP_HREF)
    ).toBe(false);
  });

  it("does not reset when moving between non-assisted prep steps", () => {
    expect(
      shouldResetAssistedPracticeRunUiState(CHAT_INLINE_MERCHANT_PREP_HREF, CHAT_INLINE_CFPB_PREP_HREF)
    ).toBe(false);
  });
});

describe("owned fulfillment prep copy (chat-only consumers)", () => {
  it("uses owned-fulfillment helper text without DIY exit claims", () => {
    const intake = baseIntake();
    const merchant = getChatInlineApprovedPrepContent(CHAT_INLINE_MERCHANT_PREP_HREF, intake);
    const cfpb = getChatInlineApprovedPrepContent(CHAT_INLINE_CFPB_PREP_HREF, intake);
    const demand = getChatInlineApprovedPrepContent(CHAT_INLINE_DEMAND_LETTER_PREP_HREF, intake);
    expect(merchant?.helperText).toMatch(/can send this outreach|Stay in chat/i);
    expect(merchant?.helperText).not.toMatch(/does not contact anyone|send it yourself/i);
    expect(cfpb?.helperText).toMatch(/operator fulfillment|Stay in chat/i);
    expect(cfpb?.helperText).not.toMatch(/does not file for you/i);
    expect(demand?.helperText).toMatch(/can email this demand letter|Stay in chat/i);
    expect(demand?.helperText).not.toMatch(/send it yourself|does not mail/i);
    expect(merchant?.optionalPageHref).toBeUndefined();
    expect(cfpb?.optionalPageHref).toBeUndefined();
    expect(demand?.optionalPageHref).toBeUndefined();
  });
});

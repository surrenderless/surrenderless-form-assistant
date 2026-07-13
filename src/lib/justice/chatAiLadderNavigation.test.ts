import { describe, expect, it } from "vitest";
import {
  CHAT_AI_APPROVED_ACTION_TRACKING_ELEMENT_ID,
  CHAT_AI_INLINE_FILING_CAPTURE_ELEMENT_ID,
  CHAT_AI_INLINE_PREPARED_PACKET_APPROVAL_ELEMENT_ID,
  CHAT_AI_INLINE_SUBMISSION_DRAFT_REVIEW_ELEMENT_ID,
  CHAT_AI_MAIN_LADDER_OFF_CHAT_HREFS,
  CHAT_AI_PROOF_EVIDENCE_PANEL_ELEMENT_ID,
  CONSUMER_ACTIVE_CASE_RESUME_CHAT_AI_HREF,
  isChatAiMainLadderOffChatHref,
  isChatAiOptionalHubEscapeHref,
  redirectConsumerActiveCaseOffChatHref,
  resolveChatInlineOptionalHubEscapeLinkProps,
  resolveConsumerActiveCaseLegacyLadderRedirectHref,
  resolveConsumerActiveCaseOptionalHubEscapeRedirectHref,
  shouldRedirectConsumerActiveCaseOffLegacyLadderPage,
  shouldRedirectConsumerActiveCaseOffOptionalHubEscapePage,
  resolveChatAiActiveCaseWorkHref,
  resolveChatAiChecklistDraftReviewAction,
  resolveChatAiChecklistPacketApprovalAction,
  resolveChatAiFilingStepInChatAction,
  resolveConsumerActiveCaseChecklistDraftReviewNavigate,
  resolveConsumerActiveCaseChecklistPacketApprovalNavigate,
  resolveConsumerActiveCaseResumeChatAiHref,
  shouldBlockChatAiOffChatNavigation,
  shouldKeepSignedInChatAiActiveCaseInChat,
  shouldSuppressChatInlineMainLadderHubEscapeLinks,
} from "@/lib/justice/chatAiLadderNavigation";

describe("chatAiLadderNavigation", () => {
  describe("isChatAiMainLadderOffChatHref", () => {
    it("recognizes main ladder legacy detour hrefs", () => {
      for (const href of CHAT_AI_MAIN_LADDER_OFF_CHAT_HREFS) {
        expect(isChatAiMainLadderOffChatHref(href)).toBe(true);
        expect(isChatAiMainLadderOffChatHref(`  ${href}  `)).toBe(true);
      }
      expect(isChatAiMainLadderOffChatHref("/justice/chat-ai")).toBe(false);
      expect(isChatAiMainLadderOffChatHref("/justice/ftc")).toBe(false);
    });
  });

  describe("shouldKeepSignedInChatAiActiveCaseInChat", () => {
    it("is true only for signed-in active-case updates", () => {
      expect(
        shouldKeepSignedInChatAiActiveCaseInChat({
          isSignedIn: true,
          isUpdatingExistingCase: true,
        })
      ).toBe(true);
      expect(
        shouldKeepSignedInChatAiActiveCaseInChat({
          isSignedIn: false,
          isUpdatingExistingCase: true,
        })
      ).toBe(false);
      expect(
        shouldKeepSignedInChatAiActiveCaseInChat({
          isSignedIn: true,
          isUpdatingExistingCase: false,
        })
      ).toBe(false);
    });
  });

  describe("resolveChatAiChecklistDraftReviewAction", () => {
    const keepInChat = true;

    it("hides when draft is already reviewed", () => {
      expect(
        resolveChatAiChecklistDraftReviewAction({
          draftReviewed: true,
          keepInChat,
          showInlineBlock: false,
          activeUuidCaseId: "",
        })
      ).toEqual({ kind: "hidden" });
    });

    it("scrolls in chat when inline block is visible", () => {
      expect(
        resolveChatAiChecklistDraftReviewAction({
          draftReviewed: false,
          keepInChat,
          showInlineBlock: true,
          activeUuidCaseId: "case-id",
        })
      ).toEqual({
        kind: "scroll",
        targetElementId: CHAT_AI_INLINE_SUBMISSION_DRAFT_REVIEW_ELEMENT_ID,
        label: "Review below",
      });
    });

    it("waits during hydration instead of sending consumer off-chat", () => {
      expect(
        resolveChatAiChecklistDraftReviewAction({
          draftReviewed: false,
          keepInChat,
          showInlineBlock: false,
          activeUuidCaseId: "",
        })
      ).toEqual({ kind: "wait", label: "Loading draft review…" });
    });
  });

  describe("resolveChatAiChecklistPacketApprovalAction", () => {
    const keepInChat = true;

    it("hides when packet is already approved", () => {
      expect(
        resolveChatAiChecklistPacketApprovalAction({
          draftReviewed: true,
          packetApproved: true,
          keepInChat,
          showInlineBlock: false,
          activeUuidCaseId: "case-id",
        })
      ).toEqual({ kind: "hidden" });
    });

    it("scrolls in chat when inline packet approval is visible", () => {
      expect(
        resolveChatAiChecklistPacketApprovalAction({
          draftReviewed: true,
          packetApproved: false,
          keepInChat,
          showInlineBlock: true,
          activeUuidCaseId: "case-id",
        })
      ).toEqual({
        kind: "scroll",
        targetElementId: CHAT_AI_INLINE_PREPARED_PACKET_APPROVAL_ELEMENT_ID,
        label: "Approve below",
      });
    });

    it("waits during hydration instead of sending consumer off-chat", () => {
      expect(
        resolveChatAiChecklistPacketApprovalAction({
          draftReviewed: true,
          packetApproved: false,
          keepInChat,
          showInlineBlock: false,
          activeUuidCaseId: "",
        })
      ).toEqual({ kind: "wait", label: "Loading packet approval…" });
    });
  });

  describe("resolveChatAiActiveCaseWorkHref", () => {
    it("never returns preview or packet for signed-in active-case chat continuity", () => {
      expect(
        resolveChatAiActiveCaseWorkHref({
          keepInChat: true,
          draftReviewed: false,
          packetApproved: false,
        })
      ).toBe("/justice/chat-ai");
      expect(
        resolveChatAiActiveCaseWorkHref({
          keepInChat: true,
          draftReviewed: true,
          packetApproved: false,
        })
      ).toBe("/justice/chat-ai");
    });

    it("preserves legacy hrefs when chat continuity is off", () => {
      expect(
        resolveChatAiActiveCaseWorkHref({
          keepInChat: false,
          draftReviewed: false,
          packetApproved: false,
        })
      ).toBe("/justice/preview");
      expect(
        resolveChatAiActiveCaseWorkHref({
          keepInChat: false,
          draftReviewed: true,
          packetApproved: false,
        })
      ).toBe("/justice/packet");
    });
  });

  describe("resolveChatAiFilingStepInChatAction", () => {
    it("waits during hydration when case id is not ready", () => {
      expect(
        resolveChatAiFilingStepInChatAction({
          isFilingCaptureStep: true,
          showInlineFilingCapture: false,
          filingCaptureSuppressed: false,
          canCaptureFilingInChat: true,
          caseId: "",
        })
      ).toEqual({ kind: "wait", label: "Loading filing form in this chat…" });
    });

    it("scrolls to inline filing capture when form is not mounted yet", () => {
      expect(
        resolveChatAiFilingStepInChatAction({
          isFilingCaptureStep: true,
          showInlineFilingCapture: false,
          filingCaptureSuppressed: false,
          canCaptureFilingInChat: true,
          caseId: "case-id",
        })
      ).toEqual({
        kind: "scroll",
        targetElementId: CHAT_AI_INLINE_FILING_CAPTURE_ELEMENT_ID,
        label: "Add filing below",
      });
    });

    it("hides when inline filing capture is already shown or suppressed", () => {
      expect(
        resolveChatAiFilingStepInChatAction({
          isFilingCaptureStep: true,
          showInlineFilingCapture: true,
          filingCaptureSuppressed: false,
          canCaptureFilingInChat: true,
          caseId: "case-id",
        })
      ).toEqual({ kind: "hidden" });
      expect(
        resolveChatAiFilingStepInChatAction({
          isFilingCaptureStep: true,
          showInlineFilingCapture: false,
          filingCaptureSuppressed: true,
          canCaptureFilingInChat: true,
          caseId: "case-id",
        })
      ).toEqual({ kind: "hidden" });
    });
  });

  describe("shouldBlockChatAiOffChatNavigation", () => {
    it("blocks preview/packet/handling navigation for signed-in active cases", () => {
      for (const href of CHAT_AI_MAIN_LADDER_OFF_CHAT_HREFS) {
        expect(
          shouldBlockChatAiOffChatNavigation({
            isSignedIn: true,
            isUpdatingExistingCase: true,
            isLoaded: true,
            caseId: "550e8400-e29b-41d4-a716-446655440000",
            targetHref: href,
          })
        ).toBe(true);
      }
    });

    it("does not block unrelated hrefs or unsigned flows", () => {
      expect(
        shouldBlockChatAiOffChatNavigation({
          isSignedIn: true,
          isUpdatingExistingCase: true,
          isLoaded: true,
          caseId: "case-id",
          targetHref: "/justice/ftc",
        })
      ).toBe(false);
      expect(
        shouldBlockChatAiOffChatNavigation({
          isSignedIn: false,
          isUpdatingExistingCase: true,
          isLoaded: true,
          caseId: "case-id",
          targetHref: "/justice/preview",
        })
      ).toBe(false);
    });
  });

  describe("consumer active-case resume helpers", () => {
    it("resolves chat-ai href with optional inline focus hash", () => {
      expect(resolveConsumerActiveCaseResumeChatAiHref()).toBe(
        CONSUMER_ACTIVE_CASE_RESUME_CHAT_AI_HREF
      );
      expect(
        resolveConsumerActiveCaseResumeChatAiHref(
          CHAT_AI_INLINE_SUBMISSION_DRAFT_REVIEW_ELEMENT_ID
        )
      ).toBe(
        `${CONSUMER_ACTIVE_CASE_RESUME_CHAT_AI_HREF}#${CHAT_AI_INLINE_SUBMISSION_DRAFT_REVIEW_ELEMENT_ID}`
      );
    });

    it("redirects main-ladder off-chat hrefs to chat-ai", () => {
      for (const href of CHAT_AI_MAIN_LADDER_OFF_CHAT_HREFS) {
        expect(redirectConsumerActiveCaseOffChatHref(href)).toBe(
          CONSUMER_ACTIVE_CASE_RESUME_CHAT_AI_HREF
        );
      }
      expect(redirectConsumerActiveCaseOffChatHref("/justice/ftc")).toBe("/justice/ftc");
    });

    it("exposes checklist navigate labels for hub and saved cases", () => {
      expect(resolveConsumerActiveCaseChecklistDraftReviewNavigate()).toEqual({
        href: `${CONSUMER_ACTIVE_CASE_RESUME_CHAT_AI_HREF}#${CHAT_AI_INLINE_SUBMISSION_DRAFT_REVIEW_ELEMENT_ID}`,
        label: "Review in chat",
      });
      expect(resolveConsumerActiveCaseChecklistPacketApprovalNavigate()).toEqual({
        href: `${CONSUMER_ACTIVE_CASE_RESUME_CHAT_AI_HREF}#${CHAT_AI_INLINE_PREPARED_PACKET_APPROVAL_ELEMENT_ID}`,
        label: "Approve in chat",
      });
    });
  });

  describe("legacy ladder direct-entry guards", () => {
    const activeCaseInput = {
      isSignedIn: true,
      isLoaded: true,
      caseId: "550e8400-e29b-41d4-a716-446655440000",
      hasResumableCase: true,
    } as const;

    it("redirects signed-in resumable consumers off preview, packet, and handling pages", () => {
      expect(
        shouldRedirectConsumerActiveCaseOffLegacyLadderPage({
          ...activeCaseInput,
          legacyPageHref: "/justice/preview",
        })
      ).toBe(true);
      expect(
        shouldRedirectConsumerActiveCaseOffLegacyLadderPage({
          ...activeCaseInput,
          legacyPageHref: "/justice/packet",
        })
      ).toBe(true);
      expect(
        shouldRedirectConsumerActiveCaseOffLegacyLadderPage({
          ...activeCaseInput,
          legacyPageHref: "/justice/handling",
        })
      ).toBe(true);
    });

    it("preserves handling workbench for operator roles with an active session case", () => {
      expect(
        shouldRedirectConsumerActiveCaseOffLegacyLadderPage({
          ...activeCaseInput,
          legacyPageHref: "/justice/handling",
          allowOperatorAccess: true,
          isOperator: true,
        })
      ).toBe(false);
    });

    it("does not redirect unsigned users or users without a resumable case", () => {
      expect(
        shouldRedirectConsumerActiveCaseOffLegacyLadderPage({
          legacyPageHref: "/justice/preview",
          isSignedIn: false,
          isLoaded: true,
          caseId: activeCaseInput.caseId,
          hasResumableCase: true,
        })
      ).toBe(false);
      expect(
        shouldRedirectConsumerActiveCaseOffLegacyLadderPage({
          legacyPageHref: "/justice/handling",
          isSignedIn: true,
          isLoaded: true,
          caseId: "",
          hasResumableCase: false,
        })
      ).toBe(false);
    });

    it("resolves chat-ai resume hrefs for legacy page redirects", () => {
      expect(resolveConsumerActiveCaseLegacyLadderRedirectHref("/justice/preview")).toBe(
        `${CONSUMER_ACTIVE_CASE_RESUME_CHAT_AI_HREF}#${CHAT_AI_INLINE_SUBMISSION_DRAFT_REVIEW_ELEMENT_ID}`
      );
      expect(resolveConsumerActiveCaseLegacyLadderRedirectHref("/justice/packet")).toBe(
        `${CONSUMER_ACTIVE_CASE_RESUME_CHAT_AI_HREF}#${CHAT_AI_INLINE_PREPARED_PACKET_APPROVAL_ELEMENT_ID}`
      );
      expect(resolveConsumerActiveCaseLegacyLadderRedirectHref("/justice/handling")).toBe(
        CONSUMER_ACTIVE_CASE_RESUME_CHAT_AI_HREF
      );
      expect(redirectConsumerActiveCaseOffChatHref("/justice/state-ag")).toBe("/justice/state-ag");
    });
  });

  describe("shouldSuppressChatInlineMainLadderHubEscapeLinks", () => {
    it("suppresses optional preview/packet hub escapes when the ladder stays in chat", () => {
      expect(shouldSuppressChatInlineMainLadderHubEscapeLinks({ keepInChat: true })).toBe(true);
      expect(shouldSuppressChatInlineMainLadderHubEscapeLinks({ keepInChat: false })).toBe(false);
    });
  });

  describe("optional destination-prep and evidence hub escapes", () => {
    it("recognizes evidence and destination-prep optional hub escapes", () => {
      expect(isChatAiOptionalHubEscapeHref("/justice/evidence")).toBe(true);
      expect(isChatAiOptionalHubEscapeHref("/justice/merchant")).toBe(true);
      expect(isChatAiOptionalHubEscapeHref("/justice/bbb")).toBe(true);
      expect(isChatAiOptionalHubEscapeHref("/justice/ftc")).toBe(true);
      expect(isChatAiOptionalHubEscapeHref("/justice/payment-dispute")).toBe(true);
      expect(isChatAiOptionalHubEscapeHref("/justice/ftc-review")).toBe(true);
      expect(isChatAiOptionalHubEscapeHref("/justice/preview")).toBe(false);
      expect(isChatAiOptionalHubEscapeHref("/justice/handling")).toBe(false);
    });

    it("resolves optional hub escape link props only when not suppressed", () => {
      expect(
        resolveChatInlineOptionalHubEscapeLinkProps({
          suppress: true,
          href: "/justice/merchant",
          label: "Open full merchant contact page",
          note: "optional",
        })
      ).toEqual({});
      expect(
        resolveChatInlineOptionalHubEscapeLinkProps({
          suppress: false,
          href: "/justice/merchant",
          label: "Open full merchant contact page",
          note: "optional",
        })
      ).toEqual({
        optionalPageHref: "/justice/merchant",
        optionalPageLabel: "Open full merchant contact page",
        optionalPageNote: "optional",
      });
    });

    it("redirects signed-in resumable consumers off evidence and destination-prep hubs", () => {
      expect(
        shouldRedirectConsumerActiveCaseOffOptionalHubEscapePage({
          escapePageHref: "/justice/evidence",
          isSignedIn: true,
          isLoaded: true,
          caseId: "case-1",
          hasResumableCase: true,
        })
      ).toBe(true);
      expect(
        shouldRedirectConsumerActiveCaseOffOptionalHubEscapePage({
          escapePageHref: "/justice/bbb",
          isSignedIn: true,
          isLoaded: true,
          caseId: "case-1",
          hasResumableCase: true,
        })
      ).toBe(true);
      expect(
        shouldRedirectConsumerActiveCaseOffOptionalHubEscapePage({
          escapePageHref: "/justice/merchant",
          isSignedIn: false,
          isLoaded: true,
          caseId: "case-1",
          hasResumableCase: true,
        })
      ).toBe(false);
      expect(
        shouldRedirectConsumerActiveCaseOffOptionalHubEscapePage({
          escapePageHref: "/justice/merchant",
          isSignedIn: true,
          isLoaded: true,
          caseId: "case-1",
          hasResumableCase: false,
        })
      ).toBe(false);
    });

    it("resolves optional hub escape redirects into chat-ai focus targets", () => {
      expect(resolveConsumerActiveCaseOptionalHubEscapeRedirectHref("/justice/evidence")).toBe(
        `${CONSUMER_ACTIVE_CASE_RESUME_CHAT_AI_HREF}#${CHAT_AI_PROOF_EVIDENCE_PANEL_ELEMENT_ID}`
      );
      expect(resolveConsumerActiveCaseOptionalHubEscapeRedirectHref("/justice/merchant")).toBe(
        `${CONSUMER_ACTIVE_CASE_RESUME_CHAT_AI_HREF}#${CHAT_AI_APPROVED_ACTION_TRACKING_ELEMENT_ID}`
      );
    });
  });
});

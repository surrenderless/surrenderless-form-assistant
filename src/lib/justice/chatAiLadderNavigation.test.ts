import { describe, expect, it } from "vitest";
import {
  CHAT_AI_INLINE_FILING_CAPTURE_ELEMENT_ID,
  CHAT_AI_INLINE_PREPARED_PACKET_APPROVAL_ELEMENT_ID,
  CHAT_AI_INLINE_SUBMISSION_DRAFT_REVIEW_ELEMENT_ID,
  CHAT_AI_MAIN_LADDER_OFF_CHAT_HREFS,
  CONSUMER_ACTIVE_CASE_RESUME_CHAT_AI_HREF,
  isChatAiMainLadderOffChatHref,
  redirectConsumerActiveCaseOffChatHref,
  resolveChatAiActiveCaseWorkHref,
  resolveChatAiChecklistDraftReviewAction,
  resolveChatAiChecklistPacketApprovalAction,
  resolveChatAiFilingStepInChatAction,
  resolveConsumerActiveCaseChecklistDraftReviewNavigate,
  resolveConsumerActiveCaseChecklistPacketApprovalNavigate,
  resolveConsumerActiveCaseResumeChatAiHref,
  shouldBlockChatAiOffChatNavigation,
  shouldKeepSignedInChatAiActiveCaseInChat,
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
});

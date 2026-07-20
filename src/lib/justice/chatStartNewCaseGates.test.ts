import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyChatStartNewCaseLocalSessionReset,
  buildChatStartNewCaseAssistantResponse,
  buildChatStartNewCaseGateContext,
  buildChatStartNewCaseStartedResponse,
  canStartNewCaseViaChat,
  CHAT_START_NEW_CASE_MESSAGE,
  parseChatStartNewCaseMessage,
} from "@/lib/justice/chatStartNewCaseGates";
import { STORAGE_CHAT_BBB_ACCURACY_CONSENTED_V1 } from "@/lib/justice/chatLegalConsentGates";
import { STORAGE_APPROVED_NEXT_ACTION_V1 } from "@/lib/justice/approvedNextActionState";
import { STORAGE_CASE_ID, STORAGE_INTAKE, STORAGE_TIMELINE_V1 } from "@/lib/justice/types";

const STORAGE_PREPARED_PACKET_APPROVED_V1 = "justice_prepared_packet_approved_v1";
const STORAGE_SUBMISSION_DRAFT_REVIEWED_V1 = "justice_submission_draft_reviewed_v1";

const CASE_ID = "550e8400-e29b-41d4-a716-446655440000";

function baseContext(
  overrides: Partial<ReturnType<typeof buildChatStartNewCaseGateContext>> = {}
) {
  return buildChatStartNewCaseGateContext({
    isLoaded: true,
    isSignedIn: true,
    activeCaseId: CASE_ID,
    ...overrides,
  });
}

function stubSessionStorage() {
  const store = new Map<string, string>();
  const sessionStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => store.clear(),
  };
  vi.stubGlobal("sessionStorage", sessionStorage);
  vi.stubGlobal("window", { sessionStorage });
  return store;
}

describe("chatStartNewCaseGates", () => {
  it("requires an active UUID case before offering start-new", () => {
    expect(canStartNewCaseViaChat(baseContext())).toBe(true);
    expect(canStartNewCaseViaChat(baseContext({ activeCaseId: "" }))).toBe(false);
    expect(canStartNewCaseViaChat(baseContext({ activeCaseId: "case_local" }))).toBe(false);
    expect(canStartNewCaseViaChat(baseContext({ isSignedIn: false }))).toBe(false);
    expect(canStartNewCaseViaChat(baseContext({ isLoaded: false }))).toBe(false);
  });

  it("accepts explicit start/create new case phrases", () => {
    expect(parseChatStartNewCaseMessage(CHAT_START_NEW_CASE_MESSAGE, baseContext())).toEqual({
      kind: "start_new_case",
    });
    expect(parseChatStartNewCaseMessage("Please create a new case", baseContext())).toEqual({
      kind: "start_new_case",
    });
    expect(parseChatStartNewCaseMessage("I want a brand new case", baseContext())).toEqual({
      kind: "start_new_case",
    });
    expect(parseChatStartNewCaseMessage("begin a new case in chat", baseContext())).toEqual({
      kind: "start_new_case",
    });
    expect(parseChatStartNewCaseMessage("start over with a new case", baseContext())).toEqual({
      kind: "start_new_case",
    });
  });

  it("does not trigger on ambiguous or unrelated phrases", () => {
    expect(parseChatStartNewCaseMessage("new", baseContext())).toEqual({ kind: "ambiguous" });
    expect(parseChatStartNewCaseMessage("start", baseContext())).toEqual({ kind: "ambiguous" });
    expect(parseChatStartNewCaseMessage("new company", baseContext())).toEqual({
      kind: "ambiguous",
    });
    expect(parseChatStartNewCaseMessage("different company next", baseContext())).toEqual({
      kind: "ambiguous",
    });
    expect(
      parseChatStartNewCaseMessage("My email is test@example.com", baseContext())
    ).toEqual({ kind: "none" });
    expect(parseChatStartNewCaseMessage("Please show my cases", baseContext())).toEqual({
      kind: "none",
    });
  });

  it("recognizes decline without detaching", () => {
    expect(
      parseChatStartNewCaseMessage("Please don't start a new case", baseContext())
    ).toEqual({ kind: "decline" });
  });

  it("reports no_active_case when consent arrives without a session case", () => {
    expect(
      parseChatStartNewCaseMessage(CHAT_START_NEW_CASE_MESSAGE, baseContext({ activeCaseId: "" }))
    ).toEqual({ kind: "no_active_case" });
  });

  it("builds clear assistant copy for non-start outcomes and success", () => {
    expect(buildChatStartNewCaseAssistantResponse({ kind: "ambiguous" })).toContain(
      CHAT_START_NEW_CASE_MESSAGE
    );
    expect(buildChatStartNewCaseAssistantResponse({ kind: "decline" })).toMatch(/current case/i);
    expect(buildChatStartNewCaseAssistantResponse({ kind: "no_active_case" })).toMatch(
      /not on a saved case/i
    );
    expect(buildChatStartNewCaseStartedResponse({ priorCaseId: CASE_ID })).toContain(CASE_ID);
    expect(buildChatStartNewCaseStartedResponse({ priorCaseId: CASE_ID })).toMatch(
      /still saved|not changed/i
    );
  });

  describe("applyChatStartNewCaseLocalSessionReset", () => {
    beforeEach(() => {
      stubSessionStorage();
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("clears case id, intake, and per-case progress maps from session without implying server mutation", () => {
      sessionStorage.setItem(STORAGE_CASE_ID, CASE_ID);
      sessionStorage.setItem(STORAGE_INTAKE, JSON.stringify({ company_name: "Acme Retail" }));
      sessionStorage.setItem(STORAGE_TIMELINE_V1, "{}");
      sessionStorage.setItem(
        STORAGE_PREPARED_PACKET_APPROVED_V1,
        JSON.stringify({ [CASE_ID]: true })
      );
      sessionStorage.setItem(
        STORAGE_SUBMISSION_DRAFT_REVIEWED_V1,
        JSON.stringify({ [CASE_ID]: true })
      );
      sessionStorage.setItem(
        STORAGE_APPROVED_NEXT_ACTION_V1,
        JSON.stringify({ [CASE_ID]: { href: "/justice/ftc", status: "approved" } })
      );
      sessionStorage.setItem(
        STORAGE_CHAT_BBB_ACCURACY_CONSENTED_V1,
        JSON.stringify({ [CASE_ID]: true })
      );

      const result = applyChatStartNewCaseLocalSessionReset();

      expect(result).toEqual({ cleared: true, preserveServerCase: true });
      expect(sessionStorage.getItem(STORAGE_CASE_ID)).toBeNull();
      expect(sessionStorage.getItem(STORAGE_INTAKE)).toBeNull();
      expect(sessionStorage.getItem(STORAGE_TIMELINE_V1)).toBeNull();
      expect(sessionStorage.getItem(STORAGE_PREPARED_PACKET_APPROVED_V1)).toBeNull();
      expect(sessionStorage.getItem(STORAGE_SUBMISSION_DRAFT_REVIEWED_V1)).toBeNull();
      expect(sessionStorage.getItem(STORAGE_APPROVED_NEXT_ACTION_V1)).toBeNull();
      expect(sessionStorage.getItem(STORAGE_CHAT_BBB_ACCURACY_CONSENTED_V1)).toBeNull();
    });
  });
});

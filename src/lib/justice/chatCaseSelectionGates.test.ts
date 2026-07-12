import { describe, expect, it } from "vitest";
import {
  buildChatCaseSelectionAmbiguousMatchResponse,
  buildChatCaseSelectionAssistantResponse,
  buildChatCaseSelectionGateContext,
  buildChatCaseSelectionNotFoundResponse,
  buildChatCaseSelectionOpenedResponse,
  canListCasesViaChat,
  CHAT_CASE_SELECTION_LIST_MESSAGE,
  CHAT_CASE_SELECTION_OPEN_CASE_NUMBER_MESSAGE,
  parseChatCaseSelectionMessage,
} from "@/lib/justice/chatCaseSelectionGates";

function baseContext(
  overrides: Partial<ReturnType<typeof buildChatCaseSelectionGateContext>> = {}
) {
  return buildChatCaseSelectionGateContext({
    isLoaded: true,
    isSignedIn: true,
    hasOfferedList: true,
    ...overrides,
  });
}

describe("chatCaseSelectionGates", () => {
  it("offers list when signed in", () => {
    expect(canListCasesViaChat(baseContext())).toBe(true);
    expect(canListCasesViaChat(baseContext({ isSignedIn: false }))).toBe(false);
  });

  it("parses list and numbered selection consent", () => {
    expect(parseChatCaseSelectionMessage(CHAT_CASE_SELECTION_LIST_MESSAGE, baseContext())).toEqual({
      kind: "list_cases",
    });
    expect(
      parseChatCaseSelectionMessage(CHAT_CASE_SELECTION_OPEN_CASE_NUMBER_MESSAGE, baseContext())
    ).toEqual({ kind: "select_case", query: "2" });
  });

  it("parses company-name selection without stealing most-recent restore phrasing", () => {
    expect(
      parseChatCaseSelectionMessage("Please open my Acme Retail case in chat.", baseContext())
    ).toEqual({ kind: "select_case", query: "Acme Retail" });
    expect(
      parseChatCaseSelectionMessage(
        "Please restore my most recently archived case so I can continue in chat.",
        baseContext()
      )
    ).toEqual({ kind: "none" });
  });

  it("requires an offered list before bare numbered selection", () => {
    expect(parseChatCaseSelectionMessage("2", baseContext({ hasOfferedList: false }))).toEqual({
      kind: "ambiguous",
    });
    expect(parseChatCaseSelectionMessage("2", baseContext({ hasOfferedList: true }))).toEqual({
      kind: "select_case",
      query: "2",
    });
  });

  it("builds assistant responses for selection outcomes", () => {
    expect(buildChatCaseSelectionAssistantResponse({ kind: "decline" })).toContain("won't switch");
    expect(buildChatCaseSelectionOpenedResponse({ companyName: "Acme Retail" })).toContain(
      "Acme Retail"
    );
    expect(
      buildChatCaseSelectionOpenedResponse({
        companyName: "Acme Retail",
        restoredFromArchive: true,
      })
    ).toContain("restored");
    expect(
      buildChatCaseSelectionOpenedResponse({
        companyName: "Acme Retail",
        alreadyActive: true,
      })
    ).toContain("already");
    expect(buildChatCaseSelectionNotFoundResponse()).toContain("couldn't match");
    expect(buildChatCaseSelectionAmbiguousMatchResponse()).toContain("more than one");
  });
});

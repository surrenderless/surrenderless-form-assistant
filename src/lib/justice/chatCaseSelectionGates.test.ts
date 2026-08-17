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

  it("parses quote-delimited name selection without stealing most-recent restore phrasing", () => {
    expect(
      parseChatCaseSelectionMessage('Please open "Acme Retail" case in chat.', baseContext())
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

  // Safety gap: select_case runs immediately with NO confirmation UI — it can restore an
  // archived case on the server AND overwrite the consumer's active chat session with a
  // different case's data. The prior unanchored substring matcher let this fire from a mere
  // question, conditional, deferred, hypothetical, or third-person mention of "case".
  describe("strict command grammar: only an exact, present, first-person command may select or restore a case", () => {
    const ctx = baseContext();

    const nonMutatingVariants = [
      // interrogative / assistant-directed
      "Can you open case 2?",
      "Can you open case 2",
      "Could you switch to the Acme case?",
      "Could you switch to the Acme case",
      // conditional
      "Open the Acme case if it's not too much trouble.",
      "Switch to case 2 if that's okay.",
      // deferred
      "I'll switch to the Acme case later.",
      "I will open case 2 tomorrow.",
      // hypothetical
      "I wonder if I should open the Acme case sometime.",
      "Suppose I open case 2 now.",
      // historical / unrelated narration
      "Last time I opened the Acme case by mistake.",
      // third-person
      "My lawyer said to open the Acme case.",
      "She told me to switch to case 2.",
    ];

    it("never fires select_case for any non-exact variant (no mutation)", () => {
      for (const message of nonMutatingVariants) {
        expect(parseChatCaseSelectionMessage(message, ctx).kind).not.toBe("select_case");
      }
    });

    it("routes rejected but selection-like attempts to an honest, non-mutating ambiguous reply — not general chat", () => {
      for (const message of nonMutatingVariants) {
        expect(parseChatCaseSelectionMessage(message, ctx)).toEqual({ kind: "ambiguous" });
      }
    });

    it("retires unquoted named selection entirely — vague and even clean names stay ambiguous, never select_case", () => {
      // Unquoted free text is never extracted as a name at all, regardless of what it contains —
      // no word list needed, since the quote marks (not English grammar) are the only thing that
      // makes a name's boundary unambiguous. Vague fillers and clean, real names fail identically.
      for (const message of [
        "open a case",
        "open my case",
        "open the case",
        "select a case",
        "switch to my case",
        "continue my case",
        "resume this case",
        "restore that case",
        "open an case", // article variant, same failure shape
        "Open the Acme case", // a clean, real, but unquoted name — still retired
        "Open the Case Company case",
        "Restore the Restore Corp case",
      ]) {
        const result = parseChatCaseSelectionMessage(message, ctx);
        expect(result.kind).not.toBe("select_case");
        expect(result).toEqual({ kind: "ambiguous" });
      }
    });

    it("accepts a quote-delimited name even when it contains a reserved/case-adjacent term", () => {
      // Multi-word names containing "case"/"restore" are real content the quotes bound exactly —
      // the parser never has to judge whether they "look like" a name.
      expect(parseChatCaseSelectionMessage('Open the "Case Company" case', ctx)).toEqual({
        kind: "select_case",
        query: "Case Company",
      });
      expect(parseChatCaseSelectionMessage('Restore the "Restore Corp" case', ctx)).toEqual({
        kind: "select_case",
        query: "Restore Corp",
      });
      expect(parseChatCaseSelectionMessage('Open the "Restore" case', ctx)).toEqual({
        kind: "select_case",
        query: "Restore",
      });
    });

    it("leaves genuinely unrelated messages as none (still reach normal chat)", () => {
      expect(
        parseChatCaseSelectionMessage("What happens next with my refund?", ctx)
      ).toEqual({ kind: "none" });
      expect(
        parseChatCaseSelectionMessage("I have a strong case against them.", ctx)
      ).toEqual({ kind: "none" });
    });

    it("does not steal the separate restore-most-recent-archived phrasing, even as a near-miss", () => {
      expect(
        parseChatCaseSelectionMessage(
          "Please restore my most recently archived case so I can continue in chat.",
          ctx
        )
      ).toEqual({ kind: "none" });
    });

    it("still accepts the canonical phrase and deliberate direct commands, preserving case-name casing", () => {
      expect(
        parseChatCaseSelectionMessage(CHAT_CASE_SELECTION_OPEN_CASE_NUMBER_MESSAGE, ctx)
      ).toEqual({ kind: "select_case", query: "2" });
      expect(parseChatCaseSelectionMessage("Open case 2", ctx)).toEqual({
        kind: "select_case",
        query: "2",
      });
      expect(parseChatCaseSelectionMessage("Switch to case 3", ctx)).toEqual({
        kind: "select_case",
        query: "3",
      });
      expect(parseChatCaseSelectionMessage('Open the "Acme" case', ctx)).toEqual({
        kind: "select_case",
        query: "Acme",
      });
      expect(parseChatCaseSelectionMessage('Restore the "Acme" case', ctx)).toEqual({
        kind: "select_case",
        query: "Acme",
      });
      expect(parseChatCaseSelectionMessage('Continue the "Acme Retail" case', ctx)).toEqual({
        kind: "select_case",
        query: "Acme Retail",
      });
      // The trailing "case" word is optional once the name is quoted — the quotes alone
      // disambiguate the boundary.
      expect(parseChatCaseSelectionMessage('Open "Acme Retail"', ctx)).toEqual({
        kind: "select_case",
        query: "Acme Retail",
      });
    });

    it("rejects empty or whitespace-only quotes — never a mutation", () => {
      for (const message of ['Open "" case', 'Open "   " case', 'Open the "" case']) {
        expect(parseChatCaseSelectionMessage(message, ctx).kind).not.toBe("select_case");
      }
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
    // The unquoted "company name" instruction is retired — replies must teach quoting.
    expect(
      buildChatCaseSelectionAssistantResponse({ kind: "ambiguous" })
    ).toMatch(/exact case name in quotes/i);
    expect(buildChatCaseSelectionNotFoundResponse()).toMatch(/exact case name in quotes/i);
  });
});

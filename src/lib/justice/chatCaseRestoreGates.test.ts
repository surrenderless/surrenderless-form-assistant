import { describe, expect, it } from "vitest";
import {
  buildChatCaseRestoreAssistantResponse,
  buildChatCaseRestoreGateContext,
  canRestoreMostRecentArchivedCaseViaChat,
  CHAT_CASE_RESTORE_MOST_RECENT_ARCHIVED_MESSAGE,
  parseChatCaseRestoreMessage,
} from "@/lib/justice/chatCaseRestoreGates";

const CASE_ID = "550e8400-e29b-41d4-a716-446655440000";

function baseContext(overrides: Partial<ReturnType<typeof buildChatCaseRestoreGateContext>> = {}) {
  return buildChatCaseRestoreGateContext({
    isLoaded: true,
    isSignedIn: true,
    activeCaseId: "",
    ...overrides,
  });
}

describe("chatCaseRestoreGates", () => {
  it("offers restore when signed in with no active case", () => {
    expect(canRestoreMostRecentArchivedCaseViaChat(baseContext())).toBe(true);
    expect(
      canRestoreMostRecentArchivedCaseViaChat(
        baseContext({ isSignedIn: false })
      )
    ).toBe(false);
    expect(
      canRestoreMostRecentArchivedCaseViaChat(
        baseContext({ activeCaseId: CASE_ID })
      )
    ).toBe(false);
  });

  it("accepts explicit restore consent for the most recent archived case", () => {
    expect(
      parseChatCaseRestoreMessage(
        CHAT_CASE_RESTORE_MOST_RECENT_ARCHIVED_MESSAGE,
        baseContext()
      )
    ).toEqual({ kind: "restore_most_recent_archived" });
  });

  it("blocks restore while another case is active", () => {
    expect(
      parseChatCaseRestoreMessage(
        CHAT_CASE_RESTORE_MOST_RECENT_ARCHIVED_MESSAGE,
        baseContext({ activeCaseId: CASE_ID })
      )
    ).toEqual({ kind: "blocked_active_case" });
  });

  it("does not infer restore from unrelated messages", () => {
    expect(
      parseChatCaseRestoreMessage("What happens next with my refund?", baseContext())
    ).toEqual({ kind: "none" });
  });

  it("builds assistant responses for restore outcomes", () => {
    expect(
      buildChatCaseRestoreAssistantResponse(
        { kind: "restore_most_recent_archived" },
        { companyName: "Acme Retail" }
      )
    ).toContain("Acme Retail");
    expect(
      buildChatCaseRestoreAssistantResponse({ kind: "blocked_active_case" })
    ).toContain("active case");
  });

  it("treats repeat restore intent as blocked once a case is active again", () => {
    const afterRestore = baseContext({ activeCaseId: CASE_ID });
    expect(
      parseChatCaseRestoreMessage(
        CHAT_CASE_RESTORE_MOST_RECENT_ARCHIVED_MESSAGE,
        afterRestore
      )
    ).toEqual({ kind: "blocked_active_case" });
  });
});

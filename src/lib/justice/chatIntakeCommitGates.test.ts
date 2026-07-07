import { describe, expect, it } from "vitest";
import {
  buildChatIntakeCommitAssistantResponse,
  canCommitIntakeViaChat,
  CHAT_INTAKE_COMMIT_MESSAGE,
  parseChatIntakeCommitMessage,
  type ChatIntakeCommitContext,
} from "@/lib/justice/chatIntakeCommitGates";

const CASE_A = "550e8400-e29b-41d4-a716-446655440000";
const CASE_B = "550e8400-e29b-41d4-a716-446655440001";

function baseContext(
  overrides: Partial<ChatIntakeCommitContext> = {}
): ChatIntakeCommitContext {
  return {
    caseId: "",
    intakeReady: true,
    isLoaded: true,
    isSignedIn: true,
    isUpdatingExistingCase: false,
    ...overrides,
  };
}

describe("chatIntakeCommitGates", () => {
  it("accepts explicit intake commit consent when intake is ready", () => {
    expect(canCommitIntakeViaChat(baseContext())).toBe(true);
    expect(parseChatIntakeCommitMessage(CHAT_INTAKE_COMMIT_MESSAGE, baseContext())).toEqual({
      kind: "intake_commit",
    });
  });

  it("rejects vague save/continue wording", () => {
    expect(parseChatIntakeCommitMessage("save", baseContext())).toEqual({ kind: "ambiguous" });
    expect(parseChatIntakeCommitMessage("continue", baseContext())).toEqual({ kind: "ambiguous" });
    expect(parseChatIntakeCommitMessage("looks good", baseContext())).toEqual({ kind: "ambiguous" });
  });

  it("recognizes explicit decline without committing", () => {
    expect(
      parseChatIntakeCommitMessage("Please don't save my case yet", baseContext())
    ).toEqual({ kind: "decline" });
  });

  it("does not infer commit from unrelated intake chat", () => {
    expect(
      parseChatIntakeCommitMessage("My email is test@example.com", baseContext())
    ).toEqual({ kind: "none" });
  });

  it("blocks commit when intake is incomplete", () => {
    expect(
      parseChatIntakeCommitMessage(CHAT_INTAKE_COMMIT_MESSAGE, baseContext({ intakeReady: false }))
    ).toEqual({ kind: "ambiguous" });
    expect(canCommitIntakeViaChat(baseContext({ intakeReady: false }))).toBe(false);
  });

  it("returns wrong_stage after case already entered prep phase", () => {
    expect(canCommitIntakeViaChat(baseContext({ isUpdatingExistingCase: true }))).toBe(false);
    expect(
      parseChatIntakeCommitMessage(
        CHAT_INTAKE_COMMIT_MESSAGE,
        baseContext({ isUpdatingExistingCase: true, caseId: CASE_A })
      )
    ).toEqual({ kind: "wrong_stage" });
    expect(
      parseChatIntakeCommitMessage(
        CHAT_INTAKE_COMMIT_MESSAGE,
        baseContext({ isUpdatingExistingCase: true, caseId: CASE_B })
      )
    ).toEqual({ kind: "wrong_stage" });
  });

  it("does not commit when session is not signed in", () => {
    expect(
      parseChatIntakeCommitMessage(CHAT_INTAKE_COMMIT_MESSAGE, baseContext({ isSignedIn: false }))
    ).toEqual({ kind: "none" });
  });

  it("requires signed-in loaded session for chat commit", () => {
    expect(canCommitIntakeViaChat(baseContext({ isSignedIn: false }))).toBe(false);
    expect(canCommitIntakeViaChat(baseContext({ isLoaded: false }))).toBe(false);
  });

  it("builds assistant responses for commit outcomes", () => {
    expect(buildChatIntakeCommitAssistantResponse({ kind: "intake_commit" })).toContain("saved");
    expect(buildChatIntakeCommitAssistantResponse({ kind: "wrong_stage" })).toContain("already saved");
  });
});

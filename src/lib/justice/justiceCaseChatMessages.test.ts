import { describe, expect, it } from "vitest";
import {
  MAX_JUSTICE_CASE_CHAT_MESSAGE_CONTENT,
  parseJusticeCaseChatMessageAppendBatch,
  parseJusticeCaseChatMessageAppendInput,
} from "@/lib/justice/justiceCaseChatMessages";

describe("justiceCaseChatMessages", () => {
  it("parses a valid append input", () => {
    expect(
      parseJusticeCaseChatMessageAppendInput({
        client_turn_id: "turn-1",
        role: "user",
        content: "hello",
        source: "intake_chat",
      })
    ).toEqual({
      client_turn_id: "turn-1",
      role: "user",
      content: "hello",
      source: "intake_chat",
    });
  });

  it("rejects invalid roles and empty content", () => {
    expect(parseJusticeCaseChatMessageAppendInput({ client_turn_id: "x", role: "system", content: "a" })).toBeNull();
    expect(parseJusticeCaseChatMessageAppendInput({ client_turn_id: "x", role: "user", content: "   " })).toBeNull();
  });

  it("clamps oversized content", () => {
    const content = "a".repeat(MAX_JUSTICE_CASE_CHAT_MESSAGE_CONTENT + 10);
    const parsed = parseJusticeCaseChatMessageAppendInput({
      client_turn_id: "turn-1",
      role: "assistant",
      content,
    });
    expect(parsed?.content.length).toBe(MAX_JUSTICE_CASE_CHAT_MESSAGE_CONTENT);
  });

  it("parses append batches with a max size", () => {
    const batch = Array.from({ length: 3 }, (_, index) => ({
      client_turn_id: `turn-${index}`,
      role: "user" as const,
      content: `message ${index}`,
    }));
    expect(parseJusticeCaseChatMessageAppendBatch(batch)?.length).toBe(3);
    expect(parseJusticeCaseChatMessageAppendBatch([])).toBeNull();
  });
});

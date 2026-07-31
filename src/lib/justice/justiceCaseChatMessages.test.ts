import { describe, expect, it } from "vitest";
import {
  MAX_JUSTICE_CASE_CHAT_APPEND_BATCH,
  MAX_JUSTICE_CASE_CHAT_MESSAGE_CONTENT,
  parseJusticeCaseChatMessageAppendBatch,
  parseJusticeCaseChatMessageAppendInput,
} from "@/lib/justice/justiceCaseChatMessages";

function messageBatch(length: number) {
  return Array.from({ length }, (_, index) => ({
    client_turn_id: `turn-${index}`,
    role: "user" as const,
    content: `message ${index}`,
  }));
}

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
    const batch = messageBatch(3);
    expect(parseJusticeCaseChatMessageAppendBatch(batch)?.length).toBe(3);
    expect(parseJusticeCaseChatMessageAppendBatch([])).toBeNull();
  });

  it("accepts exactly MAX_JUSTICE_CASE_CHAT_APPEND_BATCH messages but rejects one more", () => {
    // The chat-ai backfill flow chunks a long pre-commit conversation into batches of exactly
    // this size (see backfillChatTranscriptForCase in chat-ai/page.tsx) so a single oversized
    // request never gets silently rejected in full — this pins the boundary that fix relies on.
    const atLimit = messageBatch(MAX_JUSTICE_CASE_CHAT_APPEND_BATCH);
    expect(parseJusticeCaseChatMessageAppendBatch(atLimit)?.length).toBe(
      MAX_JUSTICE_CASE_CHAT_APPEND_BATCH
    );

    const overLimit = messageBatch(MAX_JUSTICE_CASE_CHAT_APPEND_BATCH + 1);
    expect(parseJusticeCaseChatMessageAppendBatch(overLimit)).toBeNull();
  });
});

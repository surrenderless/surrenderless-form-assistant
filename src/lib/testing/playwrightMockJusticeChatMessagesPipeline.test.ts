import { describe, expect, it, beforeEach } from "vitest";
import {
  buildPlaywrightMockJusticeChatMessagesAppendResponse,
  buildPlaywrightMockJusticeChatMessagesGetResponse,
  resetPlaywrightMockJusticeChatMessagesForTests,
} from "@/lib/testing/playwrightMockJusticeChatMessagesPipeline";
import { PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID } from "@/lib/testing/playwrightMockIntakeCaseCommitPipeline";
import { setPlaywrightMockCaseOwnerUserId } from "@/lib/testing/playwrightMockHumanFulfillmentLadderPipeline";

describe("playwrightMockJusticeChatMessagesPipeline", () => {
  const userId = "user_abc";
  const caseId = PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID;

  beforeEach(() => {
    resetPlaywrightMockJusticeChatMessagesForTests();
    setPlaywrightMockCaseOwnerUserId(caseId, userId);
  });

  it("stores and returns transcript rows for the owning mock user", () => {
    const appended = buildPlaywrightMockJusticeChatMessagesAppendResponse(caseId, userId, [
      {
        client_turn_id: "turn-1",
        role: "user",
        content: "hello",
        source: "intake_chat",
      },
    ]);
    expect(appended).toHaveLength(1);
    const loaded = buildPlaywrightMockJusticeChatMessagesGetResponse(caseId, userId);
    expect(loaded).toHaveLength(1);
    expect(loaded?.[0]?.content).toBe("hello");
  });

  it("denies cross-user reads", () => {
    buildPlaywrightMockJusticeChatMessagesAppendResponse(caseId, userId, [
      {
        client_turn_id: "turn-1",
        role: "user",
        content: "hello",
        source: "intake_chat",
      },
    ]);
    expect(buildPlaywrightMockJusticeChatMessagesGetResponse(caseId, "other-user")).toBeNull();
  });
});

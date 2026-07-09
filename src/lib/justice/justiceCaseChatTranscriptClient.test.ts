import { afterEach, describe, expect, it, vi } from "vitest";
import {
  appendCaseChatTranscriptTurns,
  type JusticeCaseChatPersistTurn,
} from "@/lib/justice/justiceCaseChatTranscriptClient";

const CASE_ID = "550e8400-e29b-41d4-a716-446655440000";

const SAMPLE_TURN: JusticeCaseChatPersistTurn = {
  clientTurnId: "turn-user-1",
  role: "user",
  content: "hello from e2e",
  source: "intake_chat",
};

function mockFetchResponse(ok: boolean, status = ok ? 200 : 500, body: unknown = {}) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => body,
  });
}

/** Mirrors chat-ai caller behavior: mark client turn ids only after append succeeds. */
async function persistTurnIdsAfterAppend(
  persistedTurnIds: Set<string>,
  caseId: string,
  turns: JusticeCaseChatPersistTurn[]
): Promise<void> {
  await appendCaseChatTranscriptTurns(caseId, turns);
  turns.forEach((turn) => persistedTurnIds.add(turn.clientTurnId));
}

describe("appendCaseChatTranscriptTurns", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("throws when POST /api/justice/chat-messages fails", async () => {
    vi.stubGlobal("fetch", mockFetchResponse(false, 500, { error: "server error" }));

    await expect(appendCaseChatTranscriptTurns(CASE_ID, [SAMPLE_TURN])).rejects.toThrow(
      /Failed to persist chat transcript/
    );
  });

  it("resolves when POST succeeds", async () => {
    vi.stubGlobal("fetch", mockFetchResponse(true, 200, { messages: [] }));

    await expect(appendCaseChatTranscriptTurns(CASE_ID, [SAMPLE_TURN])).resolves.toBeUndefined();
  });

  it("leaves turn ids unmarked on failure and allows retry on a later successful POST", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: async () => ({ error: "unavailable" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ messages: [] }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const persistedTurnIds = new Set<string>();

    await expect(
      persistTurnIdsAfterAppend(persistedTurnIds, CASE_ID, [SAMPLE_TURN])
    ).rejects.toThrow(/Failed to persist chat transcript/);
    expect(persistedTurnIds.has(SAMPLE_TURN.clientTurnId)).toBe(false);

    await persistTurnIdsAfterAppend(persistedTurnIds, CASE_ID, [SAMPLE_TURN]);
    expect(persistedTurnIds.has(SAMPLE_TURN.clientTurnId)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

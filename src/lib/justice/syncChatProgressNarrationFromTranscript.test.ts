import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  buildChatCaseProgressNarrationMessage,
  readNarratedChatCaseProgressMilestones,
  STORAGE_CHAT_CASE_PROGRESS_NARRATED_V1,
} from "@/lib/justice/chatCaseProgressNarration";
import { syncChatProgressNarrationFromTranscript } from "@/lib/justice/syncChatProgressNarrationFromTranscript";

describe("syncChatProgressNarrationFromTranscript", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      clear: () => {
        store.clear();
      },
    });
  });

  it("marks milestones already present in restored assistant messages", () => {
    const caseId = "case-123";
    syncChatProgressNarrationFromTranscript(caseId, [
      { role: "assistant", text: buildChatCaseProgressNarrationMessage("bbb_filed") },
      { role: "assistant", text: buildChatCaseProgressNarrationMessage("state_ag_queued") },
    ]);

    const narrated = readNarratedChatCaseProgressMilestones(caseId);
    expect(narrated.has("bbb_filed")).toBe(true);
    expect(narrated.has("state_ag_queued")).toBe(true);
    expect(narrated.has("resolution_ready")).toBe(false);
    expect(sessionStorage.getItem(STORAGE_CHAT_CASE_PROGRESS_NARRATED_V1)).toBeTruthy();
  });

  it("recognizes a restored staleness-escalation message as its own distinct milestone", () => {
    const caseId = "case-456";
    syncChatProgressNarrationFromTranscript(caseId, [
      { role: "assistant", text: buildChatCaseProgressNarrationMessage("bbb_queued") },
      { role: "assistant", text: buildChatCaseProgressNarrationMessage("bbb_queued_stale") },
    ]);

    const narrated = readNarratedChatCaseProgressMilestones(caseId);
    expect(narrated.has("bbb_queued")).toBe(true);
    expect(narrated.has("bbb_queued_stale")).toBe(true);
  });
});

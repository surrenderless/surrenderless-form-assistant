import {
  buildChatCaseProgressNarrationMessage,
  CHAT_CASE_PROGRESS_MILESTONE_ORDER,
  markChatCaseProgressMilestonesNarrated,
  type ChatCaseProgressMilestone,
} from "@/lib/justice/chatCaseProgressNarration";

type TranscriptTurn = {
  role: "user" | "assistant";
  text: string;
};

/** Marks progress milestones already present in a restored transcript so reload does not duplicate narration. */
export function syncChatProgressNarrationFromTranscript(
  caseId: string,
  messages: readonly TranscriptTurn[]
): void {
  const trimmedCaseId = caseId.trim();
  if (!trimmedCaseId || messages.length === 0) return;

  const assistantTexts = new Set(
    messages.filter((message) => message.role === "assistant").map((message) => message.text.trim())
  );
  if (assistantTexts.size === 0) return;

  const narrated: ChatCaseProgressMilestone[] = [];
  for (const milestone of CHAT_CASE_PROGRESS_MILESTONE_ORDER) {
    if (assistantTexts.has(buildChatCaseProgressNarrationMessage(milestone))) {
      narrated.push(milestone);
    }
  }

  if (narrated.length > 0) {
    markChatCaseProgressMilestonesNarrated(trimmedCaseId, narrated);
  }
}

import { describe, expect, it } from "vitest";
import {
  CHAT_AI_ENTRY_DISCLAIMER,
  CHAT_AI_EVIDENCE_ESCALATION_HINT,
  CHAT_CONTINUE_HANDOFF_CHAT_FIRST_DRAFT_STEP,
  CHAT_CONTINUE_HANDOFF_CHAT_FIRST_TRACKING_STEP,
  CHAT_CONTINUE_HANDOFF_POST_PREVIEW_STEP,
  CHAT_CONTINUE_HANDOFF_PREVIEW_STEP,
} from "./chatContinueHandoffCopy";

describe("chatContinueHandoffCopy", () => {
  const outdatedPhrases = [/nothing is filed automatically/i, /nothing is filed or submitted automatically/i];

  it("replaces blanket no-filing language with owned fulfillment wording", () => {
    const copy = [
      CHAT_CONTINUE_HANDOFF_PREVIEW_STEP,
      CHAT_CONTINUE_HANDOFF_POST_PREVIEW_STEP,
      CHAT_CONTINUE_HANDOFF_CHAT_FIRST_DRAFT_STEP,
      CHAT_CONTINUE_HANDOFF_CHAT_FIRST_TRACKING_STEP,
      CHAT_AI_ENTRY_DISCLAIMER,
      CHAT_AI_EVIDENCE_ESCALATION_HINT,
    ];
    for (const text of copy) {
      for (const phrase of outdatedPhrases) {
        expect(text).not.toMatch(phrase);
      }
      expect(text).toMatch(/operators?|automat/i);
    }
  });

  it("points to the Active case checklist as above, not below — the checklist renders at the top of the page while this copy shows in What happens next near the bottom", () => {
    expect(CHAT_CONTINUE_HANDOFF_CHAT_FIRST_DRAFT_STEP).toMatch(/Active case checklist above/);
    expect(CHAT_CONTINUE_HANDOFF_CHAT_FIRST_DRAFT_STEP).not.toMatch(/Active case checklist below/);
  });
});

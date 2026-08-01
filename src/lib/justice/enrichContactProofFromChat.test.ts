import { describe, expect, it } from "vitest";
import { defaultBuildJusticeIntakeParts } from "@/lib/justice/buildJusticeIntake";
import { enrichContactProofPartsAfterChatTurn } from "@/lib/justice/enrichContactProofFromChat";

function partsAlreadyContactedYes() {
  return {
    ...defaultBuildJusticeIntakeParts(),
    already_contacted: "yes" as const,
    contact_method: "email" as const,
    contact_date: "2026-03-05",
    merchant_response_type: "refused_help" as const,
    contact_proof_text: "",
  };
}

describe("enrichContactProofPartsAfterChatTurn", () => {
  it("synthesizes proof text from the latest message on the transition turn (prior !== yes, now yes)", () => {
    const result = enrichContactProofPartsAfterChatTurn(
      partsAlreadyContactedYes(),
      "They told me over email they wouldn't refund it.",
      "no"
    );
    expect(result.contact_proof_text).toBe("They told me over email they wouldn't refund it.");
  });

  it("does NOT synthesize from an arbitrary later message once already_contacted was already yes", () => {
    // This is the regression for the "arbitrary later chat becomes proof" hole: priorAlreadyContacted
    // is already "yes" (not a transition), so an unrelated message sent turns later must not fill in.
    const result = enrichContactProofPartsAfterChatTurn(
      partsAlreadyContactedYes(),
      "ok thanks, what's next?",
      "yes"
    );
    expect(result.contact_proof_text).toBe("");
  });

  it("does nothing when contact_proof_text is already non-blank on the transition turn", () => {
    const parts = { ...partsAlreadyContactedYes(), contact_proof_text: "Already have proof text." };
    const result = enrichContactProofPartsAfterChatTurn(parts, "some other message", "no");
    expect(result.contact_proof_text).toBe("Already have proof text.");
  });

  it("does nothing when already_contacted is not yes even on what would be a transition", () => {
    const parts = { ...partsAlreadyContactedYes(), already_contacted: "no" as const };
    const result = enrichContactProofPartsAfterChatTurn(parts, "some message", "no");
    expect(result.contact_proof_text).toBe("");
  });

  it("falls back to a synthesized summary from contact fields when the latest message is blank", () => {
    const result = enrichContactProofPartsAfterChatTurn(partsAlreadyContactedYes(), "   ", "no");
    expect(result.contact_proof_text).toContain("Contact date: 2026-03-05");
    expect(result.contact_proof_text).toContain("Contact method: email");
    expect(result.contact_proof_text).toContain("Merchant response: refused help");
  });
});

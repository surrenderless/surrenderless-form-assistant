import {
  validateContactProofForIntake,
  type BuildJusticeIntakeParts,
} from "@/lib/justice/buildJusticeIntake";
import type { JusticeIntake } from "@/lib/justice/types";

/** When the model sets contacted=yes but omits proof text, reuse the user's answer for Continue validation. */
export function synthesizeContactProofTextFromChat(
  parts: BuildJusticeIntakeParts,
  latestUserMessage: string
): string {
  const userText = latestUserMessage.trim();
  if (userText) return userText;

  const segments: string[] = [];
  if (parts.contact_date.trim()) {
    segments.push(`Contact date: ${parts.contact_date.trim()}`);
  }
  if (parts.contact_method) {
    segments.push(`Contact method: ${parts.contact_method.replace(/_/g, " ")}`);
  }
  if (parts.merchant_response_type) {
    segments.push(`Merchant response: ${parts.merchant_response_type.replace(/_/g, " ")}`);
  }
  return segments.join(". ");
}

/**
 * Backfills a blank contact_proof_text from the current chat turn — but only on the turn
 * already_contacted actually transitions to "yes" (priorAlreadyContacted !== "yes"). Without this
 * guard, any later message sent while proof text happened to still be blank would silently
 * become "proof" regardless of relevance — an arbitrary chat message ("ok thanks") sent turns
 * after the real contact-attempt conversation must never satisfy the CFPB documented-contact gate.
 */
export function enrichContactProofPartsAfterChatTurn(
  parts: BuildJusticeIntakeParts,
  latestUserMessage: string,
  priorAlreadyContacted: JusticeIntake["already_contacted"]
): BuildJusticeIntakeParts {
  const isTransitionTurn = priorAlreadyContacted !== "yes" && parts.already_contacted === "yes";
  if (!isTransitionTurn || parts.contact_proof_text.trim()) {
    return parts;
  }

  const synthesized = synthesizeContactProofTextFromChat(parts, latestUserMessage).trim();
  if (!synthesized) return parts;

  const candidate: BuildJusticeIntakeParts = {
    ...parts,
    contact_proof_text: synthesized,
  };
  const proofCheck = validateContactProofForIntake({
    already_contacted: candidate.already_contacted,
    contact_proof_type: candidate.contact_proof_type,
    contact_proof_text: candidate.contact_proof_text,
  });
  return proofCheck.ok ? candidate : parts;
}

import type { BuildJusticeIntakeParts } from "@/lib/justice/buildJusticeIntake";
import {
  type MerchantContactDocumentationInput,
  validateMerchantContactDocumentation,
} from "@/lib/justice/documentMerchantContact";
import { isValidDocumentedContactDate } from "@/lib/justice/rules";
import type { TimelineEntry } from "@/lib/justice/types";

/** True when intake parts include merchant contact fields saved from chat (no fabrication). */
export function hasChatCapturedMerchantContactDocumentation(
  parts: BuildJusticeIntakeParts
): boolean {
  return buildMerchantContactDocumentationInputFromIntakeParts(parts) !== null;
}

/**
 * Build merchant-contact documentation input from intake parts when chat already captured
 * sufficient facts. Returns null when data is missing or fails validation.
 */
export function buildMerchantContactDocumentationInputFromIntakeParts(
  parts: BuildJusticeIntakeParts
): MerchantContactDocumentationInput | null {
  if (parts.already_contacted !== "yes") return null;

  const contactDate = parts.contact_date.trim();
  if (!isValidDocumentedContactDate(contactDate)) return null;

  const input: MerchantContactDocumentationInput = {
    contactMethod: parts.contact_method,
    contactDate,
    merchantResponseType: parts.merchant_response_type,
    contactProofType: parts.contact_proof_type,
    contactProofText: parts.contact_proof_text,
  };

  if (!validateMerchantContactDocumentation(input).ok) return null;
  return input;
}

export function isMerchantContactDocumentedInTimeline(
  timeline: readonly TimelineEntry[]
): boolean {
  return timeline.some((entry) => entry.type === "merchant_contact_saved");
}

const CONTACT_METHOD_LABELS: Record<MerchantContactDocumentationInput["contactMethod"], string> = {
  email: "Email",
  chat: "Live chat",
  phone: "Phone",
  form: "Online contact form",
  in_person: "In person",
  other: "Other",
};

const MERCHANT_RESPONSE_LABELS: Record<
  MerchantContactDocumentationInput["merchantResponseType"],
  string
> = {
  no_response: "No response yet",
  refused_help: "Refused a refund or real help",
  promised_but_did_not_fix: "Promised to fix but did not",
  partial_help: "Partial refund or partial help",
  asked_more_info: "Asked for more information",
  other: "Other",
  resolved: "Resolved the issue",
};

/** Read-only summary lines for one-tap merchant contact confirmation in chat. */
export function buildChatCapturedMerchantContactSummaryLines(
  input: MerchantContactDocumentationInput
): string[] {
  const lines = [
    `Contact method: ${CONTACT_METHOD_LABELS[input.contactMethod]}`,
    `Contact date: ${input.contactDate}`,
    `Response: ${MERCHANT_RESPONSE_LABELS[input.merchantResponseType]}`,
  ];
  const proofText = input.contactProofText.trim();
  if (proofText) {
    lines.push(`Proof: ${proofText}`);
  }
  return lines;
}

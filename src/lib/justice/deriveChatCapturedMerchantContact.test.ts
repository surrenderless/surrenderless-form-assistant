import { describe, expect, it } from "vitest";
import { defaultBuildJusticeIntakeParts } from "@/lib/justice/buildJusticeIntake";
import {
  buildChatCapturedMerchantContactSummaryLines,
  buildMerchantContactDocumentationInputFromIntakeParts,
  hasChatCapturedMerchantContactDocumentation,
  isMerchantContactDocumentedInTimeline,
} from "@/lib/justice/deriveChatCapturedMerchantContact";
import type { TimelineEntry } from "@/lib/justice/types";

function capturedParts() {
  return {
    ...defaultBuildJusticeIntakeParts(),
    already_contacted: "yes" as const,
    contact_method: "email" as const,
    contact_date: "2026-01-15",
    merchant_response_type: "refused_help" as const,
    contact_proof_type: "paste" as const,
    contact_proof_text: "Acme Retail refused a refund by email.",
  };
}

describe("deriveChatCapturedMerchantContact", () => {
  it("returns documentation input when chat captured all required fields", () => {
    const input = buildMerchantContactDocumentationInputFromIntakeParts(capturedParts());
    expect(input).toEqual({
      contactMethod: "email",
      contactDate: "2026-01-15",
      merchantResponseType: "refused_help",
      contactProofType: "paste",
      contactProofText: "Acme Retail refused a refund by email.",
    });
    expect(hasChatCapturedMerchantContactDocumentation(capturedParts())).toBe(true);
  });

  it("returns null when already_contacted is no", () => {
    expect(
      buildMerchantContactDocumentationInputFromIntakeParts({
        ...capturedParts(),
        already_contacted: "no",
      })
    ).toBeNull();
  });

  it("returns null when contact date is missing or invalid", () => {
    expect(
      buildMerchantContactDocumentationInputFromIntakeParts({
        ...capturedParts(),
        contact_date: "",
      })
    ).toBeNull();
    expect(
      buildMerchantContactDocumentationInputFromIntakeParts({
        ...capturedParts(),
        contact_date: "01/15/2026",
      })
    ).toBeNull();
  });

  it("returns null when proof text is required but missing", () => {
    expect(
      buildMerchantContactDocumentationInputFromIntakeParts({
        ...capturedParts(),
        contact_proof_type: "none",
        contact_proof_text: "",
      })
    ).toBeNull();
  });

  it("preserves existing user-entered contact values", () => {
    const parts = {
      ...capturedParts(),
      contact_method: "phone" as const,
      merchant_response_type: "no_response" as const,
      contact_proof_type: "ticket" as const,
      contact_proof_text: "Case #ABC123",
    };
    expect(buildMerchantContactDocumentationInputFromIntakeParts(parts)).toEqual({
      contactMethod: "phone",
      contactDate: "2026-01-15",
      merchantResponseType: "no_response",
      contactProofType: "ticket",
      contactProofText: "Case #ABC123",
    });
  });

  it("builds summary lines for confirmation UI", () => {
    const input = buildMerchantContactDocumentationInputFromIntakeParts(capturedParts());
    expect(input).not.toBeNull();
    expect(buildChatCapturedMerchantContactSummaryLines(input!)).toEqual([
      "Contact method: Email",
      "Contact date: 2026-01-15",
      "Response: Refused a refund or real help",
      "Proof: Acme Retail refused a refund by email.",
    ]);
  });

  it("detects merchant_contact_saved timeline entries", () => {
    const timeline: TimelineEntry[] = [
      {
        id: "1",
        case_id: "case",
        type: "case_started",
        label: "Case started",
        ts: "2026-01-01T00:00:00.000Z",
      },
    ];
    expect(isMerchantContactDocumentedInTimeline(timeline)).toBe(false);
    timeline.push({
      id: "2",
      case_id: "case",
      type: "merchant_contact_saved",
      label: "Merchant contact saved",
      ts: "2026-01-02T00:00:00.000Z",
    });
    expect(isMerchantContactDocumentedInTimeline(timeline)).toBe(true);
  });
});

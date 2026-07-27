import { describe, expect, it } from "vitest";
import { buildSubmissionDraftPreview } from "@/lib/justice/buildSubmissionDraftPreview";
import type { JusticeIntake } from "@/lib/justice/types";

const baseIntake: JusticeIntake = {
  problem_category: "online_purchase",
  company_name: "Acme Retail",
  company_website: "https://acme.example",
  purchase_or_signup: "Widget",
  story: "Bought an item; merchant refused refund.",
  money_involved: "$50",
  pay_or_order_date: "2026-01-15",
  order_confirmation_details: "ORD-1",
  user_display_name: "Test User",
  reply_email: "test@example.com",
  already_contacted: "yes",
  contact_method: "email",
  contact_date: "2026-01-20",
  merchant_response_type: "refused_help",
};

describe("buildSubmissionDraftPreview", () => {
  it("frames NEXT STEPS as owned review → packet approval → Surrenderless filing", () => {
    const text = buildSubmissionDraftPreview({
      intake: baseIntake,
      destinationId: "ftc",
      destinationLabel: "FTC (consumer complaint)",
      evidenceLines: [{ title: "Denial screenshot" }],
    });

    expect(text).toContain("DRAFT FOR YOUR REVIEW (NOT FILED)");
    expect(text).toContain("Acme Retail");
    expect(text).toContain("Bought an item; merchant refused refund.");
    expect(text).toContain("1. Denial screenshot");
    expect(text).toContain("NEXT STEPS");
    expect(text).toMatch(/approve your prepared packet/i);
    expect(text).toMatch(/Surrenderless carries the next owned outreach and filings/i);
    expect(text).toMatch(/stay in chat/i);
    expect(text).not.toMatch(/file outside Surrenderless/i);
    expect(text).not.toMatch(/official sites/i);
  });

  it("keeps empty evidence guidance in chat instead of the Evidence page", () => {
    const text = buildSubmissionDraftPreview({
      intake: baseIntake,
      destinationId: "bbb",
      destinationLabel: "BBB complaint",
      evidenceLines: [],
    });

    expect(text).toMatch(/add or upload evidence in chat/i);
    expect(text).not.toMatch(/Evidence page/i);
    expect(text).not.toMatch(/\/justice\/evidence/i);
    expect(text).not.toMatch(/file outside Surrenderless/i);
  });
});

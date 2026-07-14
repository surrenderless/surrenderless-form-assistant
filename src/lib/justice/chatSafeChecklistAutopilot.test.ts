import { describe, expect, it } from "vitest";
import { shouldAutopilotMerchantContactDocumentation } from "@/lib/justice/chatSafeChecklistAutopilot";
import type { BuildJusticeIntakeParts } from "@/lib/justice/buildJusticeIntake";

const baseParts: BuildJusticeIntakeParts = {
  problem_category: "online_purchase",
  company_name: "Acme Retail",
  company_website: "",
  purchase_or_signup: "widget order",
  story: "Double charge",
  money_amount: "$49.99",
  desired_resolution: "refund",
  pay_or_order_date: "",
  order_confirmation_details: "",
  user_display_name: "Jordan Lee",
  reply_email: "e2e@example.com",
  already_contacted: "yes",
  contact_method: "email",
  contact_date: "2026-01-15",
  merchant_response_type: "refused_help",
  contact_proof_type: "paste",
  contact_proof_text: "E2E proof",
  consumer_us_state: "CA",
  company_contact_email: "",
  card_issuer_contact_email: "",
};

describe("chatSafeChecklistAutopilot", () => {
  it("autopilots merchant contact when packet is approved and intake already captured contact proof", () => {
    expect(
      shouldAutopilotMerchantContactDocumentation({
        preparedPacketApproved: true,
        handlingRequested: false,
        timeline: [],
        parts: baseParts,
      })
    ).toBe(true);
  });

  it("does not autopilot when merchant contact is already documented", () => {
    expect(
      shouldAutopilotMerchantContactDocumentation({
        preparedPacketApproved: true,
        handlingRequested: false,
        timeline: [
          {
            id: "m1",
            case_id: "case",
            ts: "2026-01-01T00:00:00.000Z",
            type: "merchant_contact_saved",
            label: "Saved",
            detail: "ok",
          },
        ],
        parts: baseParts,
      })
    ).toBe(false);
  });

  it("does not autopilot when intake lacks valid merchant contact capture", () => {
    expect(
      shouldAutopilotMerchantContactDocumentation({
        preparedPacketApproved: true,
        handlingRequested: false,
        timeline: [],
        parts: { ...baseParts, already_contacted: "no" },
      })
    ).toBe(false);
  });
});

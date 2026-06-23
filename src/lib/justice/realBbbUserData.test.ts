import { describe, expect, it } from "vitest";
import { bbbDesiredResolutionPhrase } from "@/lib/justice/buildBbbComplaintDraft";
import { intakeToRealBbbUserData } from "@/lib/justice/realBbbUserData";
import type { JusticeIntake } from "@/lib/justice/types";

const baseIntake: JusticeIntake = {
  company_name: "Acme",
  company_website: "",
  problem_category: "charge_dispute",
  story: "Charged twice",
  money_involved: "$50",
  pay_or_order_date: "2026-01-01",
  order_confirmation_details: "",
  user_display_name: "User",
  reply_email: "user@example.com",
  purchase_or_signup: "Widget",
  already_contacted: "no",
};

describe("intakeToRealBbbUserData", () => {
  it("maps required BBB semantic fields for minimal intake", () => {
    expect(intakeToRealBbbUserData(baseIntake)).toEqual({
      business_name: "Acme",
      issue_type: "charge dispute",
      product_or_service: "Widget",
      what_happened: "Charged twice",
      complaint_narrative: expect.stringContaining("Charged twice"),
      desired_resolution: bbbDesiredResolutionPhrase("charge_dispute"),
      amount_involved: "$50",
      order_or_payment_date: "2026-01-01",
      contact_full_name: "User",
      contact_email: "user@example.com",
      email: "user@example.com",
    });
  });

  it("includes optional business website and order confirmation details when present", () => {
    const intake: JusticeIntake = {
      ...baseIntake,
      company_website: "https://acme.example",
      order_confirmation_details: "Order #12345",
    };

    const result = intakeToRealBbbUserData(intake);
    expect(result.business_website).toBe("https://acme.example");
    expect(result.order_confirmation_details).toBe("Order #12345");
    expect(result.complaint_narrative).toContain("Order/confirmation details: Order #12345");
  });

  it("omits empty optional values", () => {
    const result = intakeToRealBbbUserData(baseIntake);
    expect(result).not.toHaveProperty("business_website");
    expect(result).not.toHaveProperty("order_confirmation_details");
    expect(result).not.toHaveProperty("prior_contact_method");
    expect(result).not.toHaveProperty("prior_contact_summary");
  });

  it("includes prior-contact fields when the consumer already contacted the business", () => {
    const intake: JusticeIntake = {
      ...baseIntake,
      already_contacted: "yes",
      contact_method: "email",
      contact_date: "2026-01-05",
      merchant_response_type: "no_response",
      contact_proof_text: "Screenshot of email thread",
    };

    const result = intakeToRealBbbUserData(intake);
    expect(result.prior_contact_method).toBe("email");
    expect(result.prior_contact_date).toBe("2026-01-05");
    expect(result.prior_contact_response).toBe("no response");
    expect(result.prior_contact_proof_notes).toBe("Screenshot of email thread");
    expect(result.prior_contact_summary).toContain("Prior contact with business");
    expect(result.complaint_narrative).toContain("Prior contact with business");
  });

  it("uses proof type when proof text is absent", () => {
    const intake: JusticeIntake = {
      ...baseIntake,
      already_contacted: "yes",
      contact_method: "phone",
      contact_proof_type: "screenshot",
    };

    const result = intakeToRealBbbUserData(intake);
    expect(result.prior_contact_proof_type).toBe("screenshot");
    expect(result).not.toHaveProperty("prior_contact_proof_notes");
    expect(result.prior_contact_summary).toContain("Proof type: screenshot");
  });

  it("uses category-specific desired resolution phrasing", () => {
    const subscription = intakeToRealBbbUserData({
      ...baseIntake,
      problem_category: "subscription",
    });
    expect(subscription.desired_resolution).toBe(bbbDesiredResolutionPhrase("subscription"));
    expect(subscription.issue_type).toBe("subscription");
  });
});

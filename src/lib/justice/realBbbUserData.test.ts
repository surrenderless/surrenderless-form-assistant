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

  it("includes optional business website, contact email, and postal identity when present", () => {
    const intake: JusticeIntake = {
      ...baseIntake,
      company_website: "https://acme.example",
      company_contact_email: "help@acme.example",
      order_confirmation_details: "Order #12345",
      company_street_address: "1 Example Way",
      company_city: "Austin",
      company_state: "TX",
      company_country: "USA",
      company_postal_code: "78701",
      consumer_us_state: "CA",
    };

    const result = intakeToRealBbbUserData(intake);
    expect(result.business_website).toBe("https://acme.example");
    expect(result.business_email).toBe("help@acme.example");
    expect(result.order_confirmation_details).toBe("Order #12345");
    expect(result.complaint_narrative).toContain("Order/confirmation details: Order #12345");
    expect(result.business_address).toBe("1 Example Way");
    expect(result.business_city).toBe("Austin");
    expect(result.business_state).toBe("TX");
    expect(result.business_country).toBe("United States");
    expect(result.business_postal_code).toBe("78701");
    // Consumer state must never become merchant postal identity.
    expect(result).not.toHaveProperty("consumer_us_state");
  });

  it("omits empty optional values", () => {
    const result = intakeToRealBbbUserData(baseIntake);
    expect(result).not.toHaveProperty("business_website");
    expect(result).not.toHaveProperty("business_email");
    expect(result).not.toHaveProperty("business_address");
    expect(result).not.toHaveProperty("business_city");
    expect(result).not.toHaveProperty("business_state");
    expect(result).not.toHaveProperty("business_country");
    expect(result).not.toHaveProperty("business_postal_code");
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

  it("sets amount_involved to just the dollar amount, not the combined money_involved string", () => {
    // money_involved is "$899.00 — Desired outcome: full refund" when built from separate
    // money_amount/desired_resolution parts. amount_involved feeds the automated BBB.org
    // form-fill (realBbbUserData -> bbbOwnedFilingExecute) with no operator review, so a
    // corrupted value here reaches the real BBB portal directly.
    const intake: JusticeIntake = {
      ...baseIntake,
      money_involved: "$899.00 — Desired outcome: full refund",
    };
    const result = intakeToRealBbbUserData(intake);
    expect(result.amount_involved).toBe("$899.00");
    expect(result.amount_involved).not.toContain("Desired outcome");
  });

  it("still sets amount_involved correctly when there is no desired_resolution to split", () => {
    const result = intakeToRealBbbUserData(baseIntake);
    expect(result.amount_involved).toBe("$50");
  });
});

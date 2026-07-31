import { describe, expect, it } from "vitest";
import { intakeToRealFtcUserData } from "@/lib/justice/realFtcUserData";
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

describe("intakeToRealFtcUserData", () => {
  it("maps required FTC semantic fields for minimal intake", () => {
    const result = intakeToRealFtcUserData(baseIntake);
    expect(result.company_name).toBe("Acme");
    expect(result.business_name).toBe("Acme");
    expect(result.issue_type).toBe("charge dispute");
    expect(result.product_or_service).toBe("Widget");
    expect(result.what_happened).toBe("Charged twice");
    expect(result.complaint_description).toContain("Charged twice");
    expect(result.amount_involved).toBe("$50");
    expect(result.incident_date).toBe("2026-01-01");
    expect(result.order_or_payment_date).toBe("2026-01-01");
    expect(result.contact_full_name).toBe("User");
    expect(result.contact_email).toBe("user@example.com");
    expect(result.email).toBe("user@example.com");
  });

  it("omits empty optional values", () => {
    const result = intakeToRealFtcUserData(baseIntake);
    expect(result).not.toHaveProperty("company_website");
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

    const result = intakeToRealFtcUserData(intake);
    expect(result.prior_contact_method).toBe("email");
    expect(result.prior_contact_date).toBe("2026-01-05");
    expect(result.prior_contact_response).toBe("no response");
    expect(result.prior_contact_proof_notes).toBe("Screenshot of email thread");
    expect(result.prior_contact_summary).toContain("Prior contact with business");
    expect(result.complaint_description).toContain("Prior contact with business");
  });

  it("sets amount_involved to just the dollar amount, not the combined money_involved string", () => {
    // money_involved is "$899.00 — Desired outcome: full refund" when built from separate
    // money_amount/desired_resolution parts. amount_involved feeds the automated FTC
    // ReportFraud.gov form-fill (realFtcUserData -> ftcOwnedFilingExecute) with no operator
    // review, and also drives a real yes/no "was there monetary loss" decision
    // (ownedFilingFtcFormMainDecision.ts), so a corrupted value here reaches the real
    // federal complaint form directly.
    const intake: JusticeIntake = {
      ...baseIntake,
      money_involved: "$899.00 — Desired outcome: full refund",
    };
    const result = intakeToRealFtcUserData(intake);
    expect(result.amount_involved).toBe("$899.00");
    expect(result.amount_involved).not.toContain("Desired outcome");
  });

  it("still sets amount_involved correctly when there is no desired_resolution to split", () => {
    const result = intakeToRealFtcUserData(baseIntake);
    expect(result.amount_involved).toBe("$50");
  });
});

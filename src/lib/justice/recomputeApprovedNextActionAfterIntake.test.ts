import { describe, expect, it } from "vitest";
import { ASSISTED_SUBMISSION_BBB_MOCK_PRACTICE_PREP_HREF } from "@/lib/justice/assistedSubmissionLane";
import {
  advanceApprovedNextActionAfterCompleted,
  recomputeApprovedNextActionAfterIntake,
} from "@/lib/justice/recomputeApprovedNextActionAfterIntake";
import { computeJusticeDestinations } from "@/lib/justice/rules";
import type { JusticeIntake } from "@/lib/justice/types";

function baseIntake(overrides: Partial<JusticeIntake> = {}): JusticeIntake {
  return {
    problem_category: "charge_dispute",
    company_name: "Acme Bank",
    company_website: "",
    purchase_or_signup: "credit card account",
    story: "Unauthorized charge on my credit card billing statement",
    money_involved: "$250",
    pay_or_order_date: "2024-06-01",
    order_confirmation_details: "",
    user_display_name: "Test User",
    reply_email: "user@example.com",
    already_contacted: "no",
    ...overrides,
  };
}

describe("recomputeApprovedNextActionAfterIntake", () => {
  it("recommends merchant contact when user has not contacted the company", () => {
    const action = recomputeApprovedNextActionAfterIntake(baseIntake());
    expect(action.href).toBe("/justice/merchant");
    expect(action.status).toBe("approved");
  });

  it("preserves handling request tracking from the existing approved action", () => {
    const action = recomputeApprovedNextActionAfterIntake(baseIntake(), {
      existing: {
        href: "/justice/merchant",
        handling_requested_at: "2024-01-02T00:00:00.000Z",
      },
    });
    expect(action.handling_requested_at).toBe("2024-01-02T00:00:00.000Z");
    expect(action.href).toBe("/justice/merchant");
  });
});

describe("advanceApprovedNextActionAfterCompleted", () => {
  const contactedIntake = baseIntake({
    already_contacted: "yes",
    contact_method: "email",
    contact_date: "2024-05-15",
    merchant_response_type: "no_response",
    contact_proof_type: "paste",
    contact_proof_text: "No reply after two emails",
  });

  it("advances queue from merchant to payment dispute after merchant is handled", () => {
    const next = advanceApprovedNextActionAfterCompleted(
      contactedIntake,
      "/justice/merchant"
    );
    expect(next?.href).toBe("/justice/payment-dispute");
    expect(next?.status).toBe("approved");
  });

  it("returns null when completed href is empty", () => {
    expect(advanceApprovedNextActionAfterCompleted(contactedIntake, "  ")).toBeNull();
  });

  it("advances from merchant to owned FTC after merchant is handled for failed-contact retail intake", () => {
    const practiceIntake = baseIntake({
      problem_category: "online_purchase",
      company_name: "Acme Retail",
      story: "Item never arrived",
      purchase_or_signup: "web order",
      money_involved: "",
      pay_or_order_date: "",
      already_contacted: "yes",
      contact_method: "email",
      contact_date: "2024-05-15",
      merchant_response_type: "refused_help",
      contact_proof_type: "paste",
      contact_proof_text: "Refund denied",
    });

    expect(
      advanceApprovedNextActionAfterCompleted(practiceIntake, "/justice/merchant")?.href
    ).toBe("/justice/ftc");

    expect(
      advanceApprovedNextActionAfterCompleted(practiceIntake, "/justice/ftc-review")?.href
    ).toBe("/justice/bbb");

    expect(
      advanceApprovedNextActionAfterCompleted(practiceIntake, "/justice/ftc")?.href
    ).toBe("/justice/bbb");
  });
});

describe("recomputeApprovedNextActionAfterIntake CFPB sticky selection", () => {
  const cfpbIntakeNoEvidence = baseIntake({
    problem_category: "financial_account_issue",
    company_name: "North Bank",
    story: "Unauthorized charge on my checking account, bank won't reverse it",
    purchase_or_signup: "checking account",
    already_contacted: "yes",
    contact_method: "email",
    contact_date: "2024-05-15",
    merchant_response_type: "refused_help",
    contact_proof_type: "upload",
    // no contact_proof_text, no evidence — nothing verifies this "upload" claim
  });

  const existingCfpbApproved = {
    label: "CFPB",
    href: "/justice/cfpb",
    status: "approved" as const,
    approved_at: "2024-06-01T00:00:00.000Z",
  };

  it("keeps an already-approved CFPB action selected (not reassigned) when evidence is missing", () => {
    const action = recomputeApprovedNextActionAfterIntake(cfpbIntakeNoEvidence, {
      existing: existingCfpbApproved,
      hasUploadedEvidenceFile: false,
    });
    expect(action.href).toBe("/justice/cfpb");
    expect(action.proof_required).toBe(true);
    expect(action.approved_at).toBe("2024-06-01T00:00:00.000Z");
  });

  it("unblocks the same CFPB selection once real evidence exists, without jumping to a different destination", () => {
    const action = recomputeApprovedNextActionAfterIntake(cfpbIntakeNoEvidence, {
      existing: existingCfpbApproved,
      hasUploadedEvidenceFile: true,
    });
    expect(action.href).toBe("/justice/cfpb");
    expect(action.proof_required).toBe(false);
  });

  it("re-blocks a previously-unblocked CFPB action when evidence is later deleted", () => {
    const unblocked = {
      ...existingCfpbApproved,
      proof_required: false,
    };
    const action = recomputeApprovedNextActionAfterIntake(cfpbIntakeNoEvidence, {
      existing: unblocked,
      hasUploadedEvidenceFile: false,
    });
    expect(action.href).toBe("/justice/cfpb");
    expect(action.proof_required).toBe(true);
  });

  it("does not apply the sticky/grandfather branch once the CFPB action is completed", () => {
    const completed = { ...existingCfpbApproved, status: "completed" as const };
    const action = recomputeApprovedNextActionAfterIntake(cfpbIntakeNoEvidence, {
      existing: completed,
      hasUploadedEvidenceFile: false,
    });
    // Normal fresh-pick path resumes; CFPB is not force-kept once completed.
    expect(action.href).not.toBe("/justice/cfpb");
  });

  it("does not grandfather a CFPB destination that was only offered, never approved", () => {
    const action = recomputeApprovedNextActionAfterIntake(cfpbIntakeNoEvidence, {
      existing: { href: "/justice/merchant", status: "completed" as const },
      hasUploadedEvidenceFile: false,
    });
    expect(action.href).not.toBe("/justice/cfpb");
  });
});

describe("computeJusticeDestinations bbb_practice routing", () => {
  const failedContactIntake = baseIntake({
    already_contacted: "yes",
    contact_method: "email",
    contact_date: "2024-05-15",
    merchant_response_type: "no_response",
    contact_proof_type: "paste",
    contact_proof_text: "No reply after two emails",
  });

  it("includes BBB mock practice when failed-contact unlock matches FTC practice", () => {
    const destinations = computeJusticeDestinations(failedContactIntake, { manualFtc: false });
    const bbbPractice = destinations.find((d) => d.id === "bbb_practice");

    expect(bbbPractice).toMatchObject({
      status: "available",
      priority: 31,
      internalRoute: ASSISTED_SUBMISSION_BBB_MOCK_PRACTICE_PREP_HREF,
    });
  });

  it("keeps BBB mock practice locked until failed contact is documented", () => {
    const destinations = computeJusticeDestinations(baseIntake(), { manualFtc: false });
    const bbbPractice = destinations.find((d) => d.id === "bbb_practice");

    expect(bbbPractice).toMatchObject({
      status: "later",
      internalRoute: undefined,
    });
  });

  it("leaves the real BBB complaint destination on /justice/bbb", () => {
    const destinations = computeJusticeDestinations(failedContactIntake, { manualFtc: false });
    const bbb = destinations.find((d) => d.id === "bbb");

    expect(bbb).toMatchObject({
      status: "manual",
      internalRoute: "/justice/bbb",
    });
  });
});

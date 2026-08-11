import { describe, expect, it } from "vitest";
import type { JusticeIntake } from "@/lib/justice/types";
import {
  rejectMerchantContactApprovalWithoutRecipient,
  REJECT_MERCHANT_CONTACT_APPROVAL_NO_RECIPIENT_MESSAGE,
} from "@/lib/justice/rejectMerchantContactApprovalWithoutRecipient";

const NOT_APPROVED = { prepared_packet_approved: false };

const MERCHANT_APPROVED = {
  prepared_packet_approved: true,
  approved_next_action: {
    label: "Merchant contact",
    href: "/justice/merchant",
    status: "approved",
  },
};

const MERCHANT_APPROVED_OPERATOR_FALLBACK = {
  ...MERCHANT_APPROVED,
  merchant_contact_operator_fallback: true,
};

const FTC_APPROVED = {
  prepared_packet_approved: true,
  approved_next_action: {
    label: "FTC (consumer complaint)",
    href: "/justice/ftc",
    status: "approved",
  },
};

function intakeWithEmail(email: string | null): JusticeIntake {
  return { company_contact_email: email } as unknown as JusticeIntake;
}

describe("rejectMerchantContactApprovalWithoutRecipient", () => {
  it("rejects the first merchant-contact approval when no recipient email exists", () => {
    expect(
      rejectMerchantContactApprovalWithoutRecipient({
        existingClientState: NOT_APPROVED,
        incomingClientState: MERCHANT_APPROVED,
        intake: intakeWithEmail(null),
      })
    ).toBe(REJECT_MERCHANT_CONTACT_APPROVAL_NO_RECIPIENT_MESSAGE);
  });

  it("rejects when the intake is entirely missing", () => {
    expect(
      rejectMerchantContactApprovalWithoutRecipient({
        existingClientState: NOT_APPROVED,
        incomingClientState: MERCHANT_APPROVED,
        intake: null,
      })
    ).toBe(REJECT_MERCHANT_CONTACT_APPROVAL_NO_RECIPIENT_MESSAGE);
  });

  it("allows the approval when a valid recipient email exists", () => {
    expect(
      rejectMerchantContactApprovalWithoutRecipient({
        existingClientState: NOT_APPROVED,
        incomingClientState: MERCHANT_APPROVED,
        intake: intakeWithEmail("support@company.com"),
      })
    ).toBeNull();
  });

  it("never re-blocks an already-approved case (not a first transition), even without a recipient", () => {
    expect(
      rejectMerchantContactApprovalWithoutRecipient({
        existingClientState: MERCHANT_APPROVED,
        incomingClientState: MERCHANT_APPROVED,
        intake: intakeWithEmail(null),
      })
    ).toBeNull();
  });

  it("ignores approvals for non-merchant-contact actions (e.g. FTC)", () => {
    expect(
      rejectMerchantContactApprovalWithoutRecipient({
        existingClientState: NOT_APPROVED,
        incomingClientState: FTC_APPROVED,
        intake: intakeWithEmail(null),
      })
    ).toBeNull();
  });

  it("ignores writes that are not a prepared-packet approval at all", () => {
    expect(
      rejectMerchantContactApprovalWithoutRecipient({
        existingClientState: NOT_APPROVED,
        incomingClientState: NOT_APPROVED,
        intake: intakeWithEmail(null),
      })
    ).toBeNull();
  });

  it("treats a skip-sentinel email (\"none\") as no recipient and rejects", () => {
    expect(
      rejectMerchantContactApprovalWithoutRecipient({
        existingClientState: NOT_APPROVED,
        incomingClientState: MERCHANT_APPROVED,
        intake: intakeWithEmail("none"),
      })
    ).toBe(REJECT_MERCHANT_CONTACT_APPROVAL_NO_RECIPIENT_MESSAGE);
  });

  it("allows approval with no recipient when the consumer chose the operator fallback", () => {
    expect(
      rejectMerchantContactApprovalWithoutRecipient({
        existingClientState: NOT_APPROVED,
        incomingClientState: MERCHANT_APPROVED_OPERATOR_FALLBACK,
        intake: intakeWithEmail(null),
      })
    ).toBeNull();
  });

  it("still allows a valid-email approval even when the fallback flag is not set (automated path preserved)", () => {
    expect(
      rejectMerchantContactApprovalWithoutRecipient({
        existingClientState: NOT_APPROVED,
        incomingClientState: MERCHANT_APPROVED,
        intake: intakeWithEmail("support@company.com"),
      })
    ).toBeNull();
  });
});

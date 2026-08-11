import { describe, expect, it } from "vitest";
import type { JusticeIntake } from "@/lib/justice/types";
import {
  rejectDemandLetterApprovalWithoutRecipient,
  REJECT_DEMAND_LETTER_APPROVAL_NO_RECIPIENT_MESSAGE,
} from "@/lib/justice/rejectDemandLetterApprovalWithoutRecipient";

const NOT_APPROVED = { prepared_packet_approved: false };

const DEMAND_LETTER_APPROVED = {
  prepared_packet_approved: true,
  approved_next_action: {
    label: "Small claims / demand letter",
    href: "/justice/demand-letter",
    status: "approved",
  },
};

const DEMAND_LETTER_APPROVED_OPERATOR_FALLBACK = {
  ...DEMAND_LETTER_APPROVED,
  merchant_contact_operator_fallback: true,
};

const MERCHANT_APPROVED = {
  prepared_packet_approved: true,
  approved_next_action: {
    label: "Merchant contact",
    href: "/justice/merchant",
    status: "approved",
  },
};

function intakeWithEmail(email: string | null): JusticeIntake {
  return { company_contact_email: email } as unknown as JusticeIntake;
}

describe("rejectDemandLetterApprovalWithoutRecipient", () => {
  it("rejects the first demand-letter approval when no company email exists", () => {
    expect(
      rejectDemandLetterApprovalWithoutRecipient({
        existingClientState: NOT_APPROVED,
        incomingClientState: DEMAND_LETTER_APPROVED,
        intake: intakeWithEmail(null),
      })
    ).toBe(REJECT_DEMAND_LETTER_APPROVAL_NO_RECIPIENT_MESSAGE);
  });

  it("allows the approval when a valid company email exists (automated send preserved)", () => {
    expect(
      rejectDemandLetterApprovalWithoutRecipient({
        existingClientState: NOT_APPROVED,
        incomingClientState: DEMAND_LETTER_APPROVED,
        intake: intakeWithEmail("support@company.com"),
      })
    ).toBeNull();
  });

  it("allows the approval with no email when the operator fallback was chosen", () => {
    expect(
      rejectDemandLetterApprovalWithoutRecipient({
        existingClientState: NOT_APPROVED,
        incomingClientState: DEMAND_LETTER_APPROVED_OPERATOR_FALLBACK,
        intake: intakeWithEmail(null),
      })
    ).toBeNull();
  });

  it("never re-blocks an already-approved case (not a first transition)", () => {
    expect(
      rejectDemandLetterApprovalWithoutRecipient({
        existingClientState: DEMAND_LETTER_APPROVED,
        incomingClientState: DEMAND_LETTER_APPROVED,
        intake: intakeWithEmail(null),
      })
    ).toBeNull();
  });

  it("ignores approvals for non-demand-letter actions (e.g. merchant contact)", () => {
    expect(
      rejectDemandLetterApprovalWithoutRecipient({
        existingClientState: NOT_APPROVED,
        incomingClientState: MERCHANT_APPROVED,
        intake: intakeWithEmail(null),
      })
    ).toBeNull();
  });

  it("ignores writes that are not a prepared-packet approval", () => {
    expect(
      rejectDemandLetterApprovalWithoutRecipient({
        existingClientState: NOT_APPROVED,
        incomingClientState: NOT_APPROVED,
        intake: intakeWithEmail(null),
      })
    ).toBeNull();
  });
});

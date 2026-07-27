import { describe, expect, it } from "vitest";
import { buildCfpbComplaintDraft } from "@/lib/justice/buildCfpbComplaintDraft";
import { buildDemandLetterDraft } from "@/lib/justice/buildDemandLetterDraft";
import { buildDotAviationComplaintDraft } from "@/lib/justice/buildDotAviationComplaintDraft";
import { buildFccComplaintDraft } from "@/lib/justice/buildFccComplaintDraft";
import {
  buildBankLetter,
  buildDefaultPaymentDisputeDraft,
} from "@/lib/justice/buildPaymentDisputeBankLetter";
import { buildStateAgComplaintDraft } from "@/lib/justice/buildStateAgComplaintDraft";
import { buildJusticeIntakeFromParts, defaultBuildJusticeIntakeParts } from "@/lib/justice/buildJusticeIntake";

const intake = buildJusticeIntakeFromParts({
  ...defaultBuildJusticeIntakeParts(),
  company_name: "Acme Retail",
  purchase_or_signup: "widget",
  story: "Never arrived; refund refused.",
  money_amount: "$89",
  pay_or_order_date: "2026-01-10",
  reply_email: "user@example.com",
  problem_category: "online_purchase",
  already_contacted: "yes",
  user_display_name: "Jordan Lee",
  consumer_us_state: "CA",
});

describe("owned destination draft framing", () => {
  const diyPatterns = [
    /does not submit for you/i,
    /does not send or file/i,
    /copy into your bank/i,
    /FOR YOUR REVIEW AND EDITING ONLY/i,
    /full State AG prep page/i,
  ];

  it("frames CFPB/FCC/DOT/State AG drafts as operator filing packets", () => {
    const drafts = [
      buildCfpbComplaintDraft(intake),
      buildFccComplaintDraft(intake),
      buildDotAviationComplaintDraft(intake),
      buildStateAgComplaintDraft(intake),
    ];
    for (const draft of drafts) {
      expect(draft).toMatch(/operator filing packet/i);
      for (const re of diyPatterns) {
        expect(draft).not.toMatch(re);
      }
    }
  });

  it("frames demand letter as Surrenderless-owned send packet", () => {
    const draft = buildDemandLetterDraft(intake);
    expect(draft).toMatch(/operator filing packet/i);
    expect(draft).toMatch(/Surrenderless sends/i);
    expect(draft).not.toMatch(/does not send or file/i);
    expect(draft).not.toMatch(/FOR YOUR REVIEW AND EDITING ONLY/i);
  });

  it("frames payment dispute letter as operator filing packet", () => {
    const letter = buildBankLetter(buildDefaultPaymentDisputeDraft("case-1", intake), intake);
    expect(letter).toMatch(/operator filing packet/i);
    expect(letter).not.toMatch(/copy into your bank/i);
  });

  it("asks for missing State AG state in chat, not on a prep page", () => {
    const draft = buildStateAgComplaintDraft({ ...intake, consumer_us_state: "" });
    expect(draft).toMatch(/choose your state in chat/i);
    expect(draft).not.toMatch(/prep page/i);
  });
});

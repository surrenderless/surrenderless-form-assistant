import type { JusticeIntake } from "@/lib/justice/types";
import { cfpbLikelyRelevant, fccLikelyRelevant } from "@/lib/justice/rules";

function desiredResolutionPhrase(category: JusticeIntake["problem_category"]): string {
  switch (category) {
    case "online_purchase":
      return "a full refund or a correct replacement, whichever fairly applies";
    case "subscription":
      return "cancellation of unwanted recurring charges and any refund owed for improper renewals";
    case "service_failed":
      return "a remedy that matches what was promised (refund, redo, or credit)";
    case "charge_dispute":
      return "reversal of the charge or a clear written justification";
    case "something_else":
      return "a fair resolution that puts me back to where I should have been";
    default:
      return "a fair resolution that puts me back to where I should have been";
  }
}

/** Merchant-facing line for CFPB-style cases (not raw intake problem_category). */
export function cfpbFinancialProductSummary(intake: JusticeIntake): string {
  const s = intake.purchase_or_signup.trim();
  return s || "financial product, account, or billing issue";
}

function isOrderPurchaseIntake(intake: JusticeIntake): boolean {
  return intake.problem_category === "online_purchase";
}

const CFPB_MERCHANT_RESOLUTION_ASK =
  "review the issue, correct any account error, refund or credit any improper charge, and provide written confirmation";

/** Deterministic contact letter from saved intake (same output as /justice/merchant composer). */
export function buildMerchantMessage(intake: JusticeIntake): string {
  const issueLabel = intake.problem_category.replace(/_/g, " ");
  const ask = desiredResolutionPhrase(intake.problem_category);
  const serviceLine = intake.purchase_or_signup.trim() || "communications service";

  if (fccLikelyRelevant(intake)) {
    const aboutLine = intake.purchase_or_signup.trim() || serviceLine;
    return `Dear ${intake.company_name} Support,

I am writing about the following: ${aboutLine}.
Service or product involved: ${serviceLine}.

What happened:
${intake.story.trim()}

Approximate amount involved: ${intake.money_involved}. Problem date / start date: ${intake.pay_or_order_date}.

I am requesting ${ask}.

Please send a substantive reply by a specific date you propose, or within 10 business days of this message. I am keeping a dated copy of this contact and your response as proof.

Sincerely,
${intake.user_display_name}
${intake.reply_email}`.trim();
  }

  if (cfpbLikelyRelevant(intake)) {
    const financialLine = cfpbFinancialProductSummary(intake);
    const aboutLine = intake.purchase_or_signup.trim() || financialLine;
    const introBlock = isOrderPurchaseIntake(intake)
      ? `I am writing about the following: ${aboutLine}.
Financial product or service involved: ${financialLine}.`
      : `I am writing about a problem involving this financial product or service: ${financialLine}.`;
    const amountLine = isOrderPurchaseIntake(intake)
      ? `Approximate amount involved: ${intake.money_involved}. Problem date / start date: ${intake.pay_or_order_date}.`
      : `Approximate amount involved (if any): ${intake.money_involved}. Problem date / start date: ${intake.pay_or_order_date}.`;
    return `Dear ${intake.company_name} Support,

${introBlock}

What happened:
${intake.story.trim()}

${amountLine}

I am requesting that you ${CFPB_MERCHANT_RESOLUTION_ASK}.

Please send a substantive reply by a specific date you propose, or within 10 business days of this message. I am keeping a dated copy of this contact and your response as proof.

Sincerely,
${intake.user_display_name}
${intake.reply_email}`.trim();
  }

  return `Dear ${intake.company_name} Support,

I am writing about the following: ${intake.purchase_or_signup}.
Issue type: ${issueLabel}.

What happened:
${intake.story.trim()}

Approximate amount involved: ${intake.money_involved}. Order or payment date: ${intake.pay_or_order_date}.

I am requesting ${ask}.

Please send a substantive reply by a specific date you propose, or within 10 business days of this message. I am keeping a dated copy of this contact and your response as proof.

Sincerely,
${intake.user_display_name}
${intake.reply_email}`.trim();
}

import { buildBbbComplaintDraft } from "@/lib/justice/buildBbbComplaintDraft";
import { buildCfpbComplaintDraft } from "@/lib/justice/buildCfpbComplaintDraft";
import { buildDemandLetterDraft } from "@/lib/justice/buildDemandLetterDraft";
import { buildDotAviationComplaintDraft } from "@/lib/justice/buildDotAviationComplaintDraft";
import { buildFccComplaintDraft } from "@/lib/justice/buildFccComplaintDraft";
import { buildStateAgComplaintDraft } from "@/lib/justice/buildStateAgComplaintDraft";
import { buildMerchantMessage } from "@/lib/justice/buildMerchantContactMessage";
import type { JusticeIntake } from "@/lib/justice/types";

export const CHAT_INLINE_MERCHANT_PREP_HREF = "/justice/merchant";
export const CHAT_INLINE_CFPB_PREP_HREF = "/justice/cfpb";
export const CHAT_INLINE_FCC_PREP_HREF = "/justice/fcc";
export const CHAT_INLINE_BBB_PREP_HREF = "/justice/bbb";
export const CHAT_INLINE_STATE_AG_PREP_HREF = "/justice/state-ag";
export const CHAT_INLINE_DOT_PREP_HREF = "/justice/dot";
export const CHAT_INLINE_DEMAND_LETTER_PREP_HREF = "/justice/demand-letter";
export const CHAT_INLINE_PAYMENT_DISPUTE_PREP_HREF = "/justice/payment-dispute";
export const CHAT_INLINE_FTC_REVIEW_PREP_HREF = "/justice/ftc-review";

const CHAT_INLINE_PREP_HREFS = new Set([
  CHAT_INLINE_MERCHANT_PREP_HREF,
  CHAT_INLINE_CFPB_PREP_HREF,
  CHAT_INLINE_FCC_PREP_HREF,
  CHAT_INLINE_BBB_PREP_HREF,
  CHAT_INLINE_STATE_AG_PREP_HREF,
  CHAT_INLINE_DOT_PREP_HREF,
  CHAT_INLINE_DEMAND_LETTER_PREP_HREF,
  CHAT_INLINE_PAYMENT_DISPUTE_PREP_HREF,
  CHAT_INLINE_FTC_REVIEW_PREP_HREF,
]);

export type ChatInlineApprovedPrepContent = {
  kind:
    | "merchant_message"
    | "cfpb_complaint"
    | "fcc_complaint"
    | "bbb_complaint"
    | "state_ag_complaint"
    | "dot_complaint"
    | "demand_letter";
  title: string;
  messageText: string;
  helperText: string;
  copyButtonLabel: string;
  optionalPageHref: string;
  optionalPageLabel: string;
  optionalPageNote: string;
};

export function isChatInlinePrepHref(href: string | undefined): boolean {
  const trimmed = href?.trim();
  return Boolean(trimmed && CHAT_INLINE_PREP_HREFS.has(trimmed));
}

/** @deprecated Use {@link isChatInlinePrepHref}. */
export function isChatInlineMerchantPrepHref(href: string | undefined): boolean {
  return href?.trim() === CHAT_INLINE_MERCHANT_PREP_HREF;
}

/** Inline prep content for approved next actions shown inside `/justice/chat-ai`. */
export function getChatInlineApprovedPrepContent(
  href: string | undefined,
  intake: JusticeIntake,
  stepLabel?: string
): ChatInlineApprovedPrepContent | null {
  const trimmedHref = href?.trim();
  if (!trimmedHref) return null;

  const label = stepLabel?.trim();

  if (trimmedHref === CHAT_INLINE_MERCHANT_PREP_HREF) {
    const title = label || "Merchant contact";
    return {
      kind: "merchant_message",
      title,
      messageText: buildMerchantMessage(intake),
      helperText:
        "Copy the message below and send it yourself. Surrenderless does not contact anyone on your behalf.",
      copyButtonLabel: "Copy message",
      optionalPageHref: CHAT_INLINE_MERCHANT_PREP_HREF,
      optionalPageLabel: label
        ? `Open full ${label.toLowerCase()} page`
        : "Open full merchant contact page",
      optionalPageNote: "optional — document contact after outreach",
    };
  }

  if (trimmedHref === CHAT_INLINE_CFPB_PREP_HREF) {
    const title = label || "CFPB complaint prep";
    return {
      kind: "cfpb_complaint",
      title,
      messageText: buildCfpbComplaintDraft(intake),
      helperText:
        "Copy the draft below and paste it into the official CFPB complaint flow. Surrenderless does not file for you.",
      copyButtonLabel: "Copy draft",
      optionalPageHref: CHAT_INLINE_CFPB_PREP_HREF,
      optionalPageLabel: label
        ? `Open full ${label.toLowerCase()} page`
        : "Open full CFPB prep page",
      optionalPageNote: "optional — evidence checklist and mark filed",
    };
  }

  if (trimmedHref === CHAT_INLINE_FCC_PREP_HREF) {
    const title = label || "FCC complaint prep";
    return {
      kind: "fcc_complaint",
      title,
      messageText: buildFccComplaintDraft(intake),
      helperText:
        "Copy the draft below and paste it into the official FCC consumer complaint flow. Surrenderless does not file for you.",
      copyButtonLabel: "Copy draft",
      optionalPageHref: CHAT_INLINE_FCC_PREP_HREF,
      optionalPageLabel: label
        ? `Open full ${label.toLowerCase()} page`
        : "Open full FCC prep page",
      optionalPageNote: "optional — evidence checklist and mark filed",
    };
  }

  if (trimmedHref === CHAT_INLINE_BBB_PREP_HREF) {
    const title = label || "BBB complaint prep";
    return {
      kind: "bbb_complaint",
      title,
      messageText: buildBbbComplaintDraft(intake),
      helperText:
        "Copy the draft below and paste it into the official BBB.org complaint flow. Verify the correct business profile before submitting. Surrenderless does not file for you.",
      copyButtonLabel: "Copy draft",
      optionalPageHref: CHAT_INLINE_BBB_PREP_HREF,
      optionalPageLabel: label
        ? `Open full ${label.toLowerCase()} page`
        : "Open full BBB prep page",
      optionalPageNote: "optional — evidence checklist and mark filed",
    };
  }

  if (trimmedHref === CHAT_INLINE_STATE_AG_PREP_HREF) {
    const title = label || "State AG complaint prep";
    return {
      kind: "state_ag_complaint",
      title,
      messageText: buildStateAgComplaintDraft(intake),
      helperText:
        "Copy the draft below and paste it into your state Attorney General or consumer protection office’s official complaint portal. Verify the correct state site before submitting. Surrenderless does not file for you.",
      copyButtonLabel: "Copy draft",
      optionalPageHref: CHAT_INLINE_STATE_AG_PREP_HREF,
      optionalPageLabel: label
        ? `Open full ${label.toLowerCase()} page`
        : "Open full State AG prep page",
      optionalPageNote: "optional — choose state, evidence checklist, and mark filed",
    };
  }

  if (trimmedHref === CHAT_INLINE_DOT_PREP_HREF) {
    const title = label || "USDOT aviation complaint prep";
    return {
      kind: "dot_complaint",
      title,
      messageText: buildDotAviationComplaintDraft(intake),
      helperText:
        "Copy the draft below and paste it into the official U.S. Department of Transportation aviation consumer complaint process. Verify categories, company matching, and attachments on the official site. Surrenderless does not file for you.",
      copyButtonLabel: "Copy draft",
      optionalPageHref: CHAT_INLINE_DOT_PREP_HREF,
      optionalPageLabel: label
        ? `Open full ${label.toLowerCase()} page`
        : "Open full DOT prep page",
      optionalPageNote: "optional — evidence checklist and filing records",
    };
  }

  if (trimmedHref === CHAT_INLINE_DEMAND_LETTER_PREP_HREF) {
    const title = label || "Demand letter prep";
    return {
      kind: "demand_letter",
      title,
      messageText: buildDemandLetterDraft(intake),
      helperText:
        "Copy the letter below, edit as needed, and send it yourself. This is not legal advice. Surrenderless does not mail, file, or submit for you.",
      copyButtonLabel: "Copy letter",
      optionalPageHref: CHAT_INLINE_DEMAND_LETTER_PREP_HREF,
      optionalPageLabel: label
        ? `Open full ${label.toLowerCase()} page`
        : "Open full demand letter page",
      optionalPageNote: "optional — evidence checklist and not-legal-advice reminder",
    };
  }

  return null;
}

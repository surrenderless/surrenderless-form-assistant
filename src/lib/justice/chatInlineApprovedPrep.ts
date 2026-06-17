import { buildCfpbComplaintDraft } from "@/lib/justice/buildCfpbComplaintDraft";
import { buildFccComplaintDraft } from "@/lib/justice/buildFccComplaintDraft";
import { buildMerchantMessage } from "@/lib/justice/buildMerchantContactMessage";
import type { JusticeIntake } from "@/lib/justice/types";

export const CHAT_INLINE_MERCHANT_PREP_HREF = "/justice/merchant";
export const CHAT_INLINE_CFPB_PREP_HREF = "/justice/cfpb";
export const CHAT_INLINE_FCC_PREP_HREF = "/justice/fcc";

const CHAT_INLINE_PREP_HREFS = new Set([
  CHAT_INLINE_MERCHANT_PREP_HREF,
  CHAT_INLINE_CFPB_PREP_HREF,
  CHAT_INLINE_FCC_PREP_HREF,
]);

export type ChatInlineApprovedPrepContent = {
  kind: "merchant_message" | "cfpb_complaint" | "fcc_complaint";
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

  return null;
}

import { buildMerchantMessage } from "@/lib/justice/buildMerchantContactMessage";
import type { JusticeIntake } from "@/lib/justice/types";

export const CHAT_INLINE_MERCHANT_PREP_HREF = "/justice/merchant";

export type ChatInlineApprovedPrepContent = {
  kind: "merchant_message";
  title: string;
  messageText: string;
  optionalPageHref: string;
  optionalPageLabel: string;
};

export function isChatInlineMerchantPrepHref(href: string | undefined): boolean {
  return href?.trim() === CHAT_INLINE_MERCHANT_PREP_HREF;
}

/** Inline prep content for approved next actions shown inside `/justice/chat-ai`. */
export function getChatInlineApprovedPrepContent(
  href: string | undefined,
  intake: JusticeIntake,
  stepLabel?: string
): ChatInlineApprovedPrepContent | null {
  if (!isChatInlineMerchantPrepHref(href)) return null;
  const label = stepLabel?.trim();
  const title = label || "Merchant contact";
  return {
    kind: "merchant_message",
    title,
    messageText: buildMerchantMessage(intake),
    optionalPageHref: CHAT_INLINE_MERCHANT_PREP_HREF,
    optionalPageLabel: label
      ? `Open full ${label.toLowerCase()} page`
      : "Open full merchant contact page",
  };
}

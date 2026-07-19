import { isValidMerchantOutreachEmailAddress } from "@/lib/email/merchantOutreachEmailEnv";

/**
 * Minimal shape of the signed-in Clerk user that we rely on for seeding the consumer's
 * `reply_email`. Kept structural (not `@clerk/nextjs`'s `UserResource`) so the resolver is
 * unit-testable without React/Clerk and tolerant of Clerk type drift.
 */
export type ClerkUserEmailSource = {
  primaryEmailAddressId?: string | null;
  primaryEmailAddress?: ClerkEmailAddressLike | null;
  emailAddresses?: ClerkEmailAddressLike[] | null;
};

export type ClerkEmailAddressLike = {
  id?: string | null;
  emailAddress?: string | null;
  verification?: { status?: string | null } | null;
};

function verifiedAddress(entry: ClerkEmailAddressLike | null | undefined): string | null {
  if (!entry) return null;
  if (entry.verification?.status !== "verified") return null;
  const value = entry.emailAddress?.trim() ?? "";
  if (!isValidMerchantOutreachEmailAddress(value)) return null;
  return value.toLowerCase();
}

/**
 * Resolve the signed-in user's verified primary email so `/justice/chat-ai` can seed the
 * consumer's `reply_email` without asking. Returns a normalized (lowercased) address, or
 * `null` when no verified, valid email is available — in which case chat must ask the user.
 *
 * Only VERIFIED addresses qualify. Prefers `primaryEmailAddress`, then the entry matching
 * `primaryEmailAddressId`, then the first verified address.
 */
export function resolveSignedInConsumerReplyEmail(
  user: ClerkUserEmailSource | null | undefined
): string | null {
  if (!user) return null;

  const fromPrimary = verifiedAddress(user.primaryEmailAddress);
  if (fromPrimary) return fromPrimary;

  const addresses = Array.isArray(user.emailAddresses) ? user.emailAddresses : [];

  const primaryId = user.primaryEmailAddressId?.trim() ?? "";
  if (primaryId) {
    const matched = addresses.find((entry) => entry?.id === primaryId);
    const fromMatched = verifiedAddress(matched);
    if (fromMatched) return fromMatched;
  }

  for (const entry of addresses) {
    const verified = verifiedAddress(entry);
    if (verified) return verified;
  }

  return null;
}

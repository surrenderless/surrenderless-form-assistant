/** True when NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY looks like a real Clerk key (not CI placeholder). */
export function getClerkPublishableKey(): string | null {
  const key = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim();
  if (!key) return null;
  if (!/^pk_(test|live)_/.test(key)) return null;
  if (/placeholder/i.test(key)) return null;

  const payload = key.replace(/^pk_(test|live)_/, "");
  if (payload.length < 20) return null;

  return key;
}

export function isClerkConfigured(): boolean {
  return getClerkPublishableKey() !== null;
}

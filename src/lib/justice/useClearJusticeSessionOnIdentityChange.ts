"use client";

import { useEffect } from "react";
import { useAuth } from "@clerk/nextjs";
import { clearLocalJusticeSession } from "@/lib/justice/clearLocalJusticeSession";

/**
 * Justice session keys (STORAGE_CASE_ID/STORAGE_INTAKE/case_version/approved_next_action/etc.)
 * live in sessionStorage, which is scoped to the browser TAB, not to the signed-in Clerk identity
 * — they survive a hard reload and even a sign-out followed by a different account signing in,
 * in the same tab. Without this, a Justice consumer page would render whichever account's case
 * was last cached in this tab, regardless of who is actually signed in now (a real cross-account
 * data disclosure, since every server route itself is correctly scoped by user_id and would 404 —
 * only the client's stale cache leaked anything).
 *
 * Call the hook once, as early as possible (before any other effect that reads STORAGE_CASE_ID/
 * STORAGE_INTAKE), in every Justice consumer page: chat-ai, the cases hub, handling, packet, and
 * preview.
 */
export const STORAGE_LAST_KNOWN_CLERK_USER_ID = "justice_last_known_clerk_user_id";

/**
 * The React-free core of the safeguard — directly testable without jsdom/React, matching this
 * codebase's established pattern (reconciliationController.ts) of extracting every
 * session-mutating decision into a plain function. Compares `currentUserId` (null when signed
 * out) against the last-known id recorded for this tab and, if they differ, wipes the ENTIRE
 * local Justice session. A null/empty `lastKnown` (a fresh tab that has never recorded an
 * identity yet) is never treated as a change — there is nothing to clear, and a just-written
 * legitimate hydration must not be wiped out from under itself on first load.
 */
export function syncJusticeSessionIdentity(currentUserId: string | null): void {
  if (typeof window === "undefined") return;

  const current = currentUserId?.trim() ?? "";
  const lastKnown = sessionStorage.getItem(STORAGE_LAST_KNOWN_CLERK_USER_ID) ?? "";

  if (lastKnown && lastKnown !== current) {
    clearLocalJusticeSession();
  }

  if (current) {
    sessionStorage.setItem(STORAGE_LAST_KNOWN_CLERK_USER_ID, current);
  } else {
    sessionStorage.removeItem(STORAGE_LAST_KNOWN_CLERK_USER_ID);
  }
}

export function useClearJusticeSessionOnIdentityChange(): void {
  const { isLoaded, isSignedIn, userId } = useAuth();

  useEffect(() => {
    if (!isLoaded) return;
    syncJusticeSessionIdentity(isSignedIn ? userId ?? null : null);
  }, [isLoaded, isSignedIn, userId]);
}

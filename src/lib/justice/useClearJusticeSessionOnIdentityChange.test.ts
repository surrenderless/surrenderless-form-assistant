import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  STORAGE_LAST_KNOWN_CLERK_USER_ID,
  syncJusticeSessionIdentity,
} from "@/lib/justice/useClearJusticeSessionOnIdentityChange";
import { STORAGE_CASE_ID, STORAGE_INTAKE } from "@/lib/justice/types";

/**
 * Direct, executable tests against syncJusticeSessionIdentity — the real, React-free function the
 * useClearJusticeSessionOnIdentityChange hook calls from its effect. This is the regression
 * coverage for the stale cross-account Justice case disclosure: sessionStorage keys are scoped to
 * the browser tab, not to the signed-in Clerk identity, and this function is the ONLY thing that
 * reconciles the two.
 */

const USER_A = "user_30RBS2s2APtDvXyRe6Pw8MLEtYs";
const USER_B = "user_3GYWnSv8nd3Tkw0JakOgF5FmjTC";

function stubSessionStorage() {
  const store: Record<string, string> = {};
  const sessionStorage = {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      for (const key of Object.keys(store)) delete store[key];
    },
  };
  vi.stubGlobal("sessionStorage", sessionStorage);
  vi.stubGlobal("window", { sessionStorage });
  return sessionStorage;
}

/** Seeds sessionStorage exactly as a real hydrated active case would — the account's cached
 * company name/intake plus the case id pointer, the precise shape the stale-cache disclosure
 * bug rendered to a different signed-in account. */
function seedCachedCase(sessionStorage: ReturnType<typeof stubSessionStorage>, caseId: string) {
  sessionStorage.setItem(STORAGE_CASE_ID, caseId);
  sessionStorage.setItem(
    STORAGE_INTAKE,
    JSON.stringify({
      company_name: "Example Retail",
      company_website: "",
      problem_category: "online_purchase",
      story: "Charged twice",
      money_involved: "$1,200",
      pay_or_order_date: "2026-01-01",
      order_confirmation_details: "",
      user_display_name: "Account A",
      reply_email: "a@example.com",
      purchase_or_signup: "Widget",
      already_contacted: "no",
    })
  );
}

describe("syncJusticeSessionIdentity", () => {
  let sessionStorage: ReturnType<typeof stubSessionStorage>;

  beforeEach(() => {
    sessionStorage = stubSessionStorage();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("REGRESSION: Account B never sees Account A's cached case after an identity change — a different signed-in user id wipes the entire local Justice session", () => {
    // Account A used this tab: its case is cached in sessionStorage, and the last-known identity
    // for this tab is recorded as A.
    seedCachedCase(sessionStorage, "a702aea5-4037-4884-8a96-9b052e81cb51");
    sessionStorage.setItem(STORAGE_LAST_KNOWN_CLERK_USER_ID, USER_A);

    // Account B signs in, in the SAME tab (no close/reopen — sessionStorage survives).
    syncJusticeSessionIdentity(USER_B);

    expect(sessionStorage.getItem(STORAGE_CASE_ID)).toBeNull();
    expect(sessionStorage.getItem(STORAGE_INTAKE)).toBeNull();
    // The tab's recorded identity now reflects B, not A.
    expect(sessionStorage.getItem(STORAGE_LAST_KNOWN_CLERK_USER_ID)).toBe(USER_B);
  });

  it("the SAME account reloading (identity unchanged) keeps its cached case intact — a transient-looking identity match is not a reason to erase recoverable local work", () => {
    seedCachedCase(sessionStorage, "a702aea5-4037-4884-8a96-9b052e81cb51");
    sessionStorage.setItem(STORAGE_LAST_KNOWN_CLERK_USER_ID, USER_A);

    syncJusticeSessionIdentity(USER_A);

    expect(sessionStorage.getItem(STORAGE_CASE_ID)).toBe("a702aea5-4037-4884-8a96-9b052e81cb51");
    expect(sessionStorage.getItem(STORAGE_INTAKE)).not.toBeNull();
    expect(sessionStorage.getItem(STORAGE_LAST_KNOWN_CLERK_USER_ID)).toBe(USER_A);
  });

  it("a brand-new tab with no recorded identity yet does not clear anything on first sign-in — there is nothing to clear, and a just-written hydration must survive", () => {
    // No STORAGE_LAST_KNOWN_CLERK_USER_ID recorded at all — this is the very first check in a
    // fresh tab. Real case data may already be present (e.g. just hydrated this same render).
    seedCachedCase(sessionStorage, "a702aea5-4037-4884-8a96-9b052e81cb51");

    syncJusticeSessionIdentity(USER_A);

    expect(sessionStorage.getItem(STORAGE_CASE_ID)).toBe("a702aea5-4037-4884-8a96-9b052e81cb51");
    expect(sessionStorage.getItem(STORAGE_INTAKE)).not.toBeNull();
    expect(sessionStorage.getItem(STORAGE_LAST_KNOWN_CLERK_USER_ID)).toBe(USER_A);
  });

  it("signing out (a known identity to signed-out) clears the local Justice session", () => {
    seedCachedCase(sessionStorage, "a702aea5-4037-4884-8a96-9b052e81cb51");
    sessionStorage.setItem(STORAGE_LAST_KNOWN_CLERK_USER_ID, USER_A);

    syncJusticeSessionIdentity(null);

    expect(sessionStorage.getItem(STORAGE_CASE_ID)).toBeNull();
    expect(sessionStorage.getItem(STORAGE_INTAKE)).toBeNull();
    expect(sessionStorage.getItem(STORAGE_LAST_KNOWN_CLERK_USER_ID)).toBeNull();
  });

  it("an anonymous tab staying anonymous (no identity, still no identity) is a safe no-op", () => {
    syncJusticeSessionIdentity(null);
    expect(sessionStorage.getItem(STORAGE_CASE_ID)).toBeNull();
    expect(sessionStorage.getItem(STORAGE_LAST_KNOWN_CLERK_USER_ID)).toBeNull();
  });
});

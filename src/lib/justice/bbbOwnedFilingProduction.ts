import { timingSafeEqual } from "crypto";
import type { NextRequest } from "next/server";
import { isPlaywrightMockRealBbbBoundedSubmitLoopEnabled } from "@/lib/testing/playwrightMockRealBbbBoundedSubmitLoop";
import { resolveAutomatedBbbFilingBase } from "@/lib/justice/bbbOwnedFilingSubmitContext";
import { OWNED_FILING_SESSION_BUDGET_MS } from "@/lib/justice/ownedFilingPlaywrightSession";

/** Vercel Pro-compatible timeout for owned BBB autofill + bounded-submit callers. */
export const BBB_OWNED_AUTOFILL_ROUTE_MAX_DURATION_SECONDS = 300;

/** Shared-secret header for server→server decide-action during owned BBB autofill. */
export const BBB_DECIDE_ACTION_INTERNAL_SECRET_HEADER = "x-surrenderless-bbb-decide-secret";

/** Case-owner user id accompanying the internal decide-action secret. */
export const BBB_DECIDE_ACTION_USER_ID_HEADER = "x-surrenderless-bbb-user-id";

export function isVercelProductionEnv(): boolean {
  return process.env.VERCEL_ENV === "production";
}

export function getBbbDecideActionInternalSecret(): string | null {
  const secret = process.env.BBB_DECIDE_ACTION_INTERNAL_SECRET?.trim();
  return secret || null;
}

function secretsEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * Authenticates server-side decide-action calls via shared secret + user id headers.
 * Does not rely on browser Clerk cookies.
 */
export function resolveBbbDecideActionInternalUserId(req: NextRequest): string | null {
  const expected = getBbbDecideActionInternalSecret();
  if (!expected) return null;
  const provided = req.headers.get(BBB_DECIDE_ACTION_INTERNAL_SECRET_HEADER)?.trim() ?? "";
  if (!provided || !secretsEqual(provided, expected)) return null;
  const userId = req.headers.get(BBB_DECIDE_ACTION_USER_ID_HEADER)?.trim() ?? "";
  return userId || null;
}

export type ChromiumConnectionForRealBbbSubmit =
  | { mode: "browserless"; url: string }
  | { mode: "local" }
  | { mode: "unavailable"; error: string };

/**
 * Owned-filing Browserless session `timeout` query value in milliseconds.
 * Forced to the Node session budget (60s) so provider kill is the hard backstop when
 * setTimeout+Promise.race fails to win under wedged CDP. Must not raise caps.
 */
export const OWNED_FILING_BROWSERLESS_SESSION_TIMEOUT_MS = OWNED_FILING_SESSION_BUDGET_MS;

/**
 * Upgraded Browserless plan maximum for the `timeout` query parameter (milliseconds).
 * Used only as an upper sanity bound; owned-filing always forces the session budget.
 */
export const BROWSERLESS_TIMEOUT_MAX_MS = 900_000;

/**
 * Ensures a Browserless CDP WebSocket URL has a single session `timeout` equal to the
 * owned-filing Node session budget. Always overwrites (including stale 120s/300s) so
 * wedged CDP cannot outlive withOwnedFilingSessionBudget. Preserves token and other params.
 */
export function ensureBrowserlessOwnedFilingSessionTimeout(browserlessUrl: string): string {
  const trimmed = browserlessUrl.trim();
  if (!trimmed) return trimmed;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return trimmed;
  }

  parsed.searchParams.delete("timeout");
  parsed.searchParams.set("timeout", String(OWNED_FILING_BROWSERLESS_SESSION_TIMEOUT_MS));
  return parsed.toString();
}

/**
 * Production (VERCEL_ENV=production) requires Browserless — never silently launch local Chromium.
 * Non-production and Playwright mock loops may use local Chromium.
 */
export function resolveChromiumConnectionForRealBbbSubmit(): ChromiumConnectionForRealBbbSubmit {
  const browserlessUrl = process.env.BROWSERLESS_URL?.trim() ?? "";
  if (browserlessUrl) {
    return {
      mode: "browserless",
      url: ensureBrowserlessOwnedFilingSessionTimeout(browserlessUrl),
    };
  }

  if (isPlaywrightMockRealBbbBoundedSubmitLoopEnabled()) {
    return { mode: "local" };
  }

  if (isVercelProductionEnv()) {
    return {
      mode: "unavailable",
      error:
        "BROWSERLESS_URL is required in Vercel production for real BBB bounded submit — operator/manual fallback",
    };
  }

  return { mode: "local" };
}

export type OwnedBbbAutofillExecutionReadiness =
  | {
      ok: true;
      base: string;
      forwardedHeaders: Record<string, string>;
    }
  | { ok: false; reason: string };

/**
 * Preconditions for owned BBB autofill on the server.
 * Fail closed (skip, leave task open) when Browserless/auth/base cannot support a reliable run.
 */
export function evaluateOwnedBbbAutofillExecutionReadiness(
  userId: string
): OwnedBbbAutofillExecutionReadiness {
  const trimmedUserId = userId.trim();
  if (!trimmedUserId) {
    return { ok: false, reason: "user id unavailable for BBB autofill — operator/manual fallback" };
  }

  const base = resolveAutomatedBbbFilingBase();
  if (!base) {
    return {
      ok: false,
      reason: "app base URL unavailable for BBB autofill — operator/manual fallback",
    };
  }

  const chromium = resolveChromiumConnectionForRealBbbSubmit();
  if (chromium.mode === "unavailable") {
    return { ok: false, reason: chromium.error };
  }

  const secret = getBbbDecideActionInternalSecret();
  if (!secret) {
    return {
      ok: false,
      reason:
        "BBB_DECIDE_ACTION_INTERNAL_SECRET unavailable for decide-action — operator/manual fallback",
    };
  }

  const deployPassword = process.env.DEPLOY_PASSWORD;
  const basicAuth = deployPassword
    ? `Basic ${Buffer.from(`admin:${deployPassword}`).toString("base64")}`
    : undefined;

  const forwardedHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    [BBB_DECIDE_ACTION_INTERNAL_SECRET_HEADER]: secret,
    [BBB_DECIDE_ACTION_USER_ID_HEADER]: trimmedUserId,
  };
  if (basicAuth) forwardedHeaders.authorization = basicAuth;

  return { ok: true, base, forwardedHeaders };
}

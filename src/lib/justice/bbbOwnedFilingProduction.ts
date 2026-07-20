import { timingSafeEqual } from "crypto";
import type { NextRequest } from "next/server";
import { isPlaywrightMockRealBbbBoundedSubmitLoopEnabled } from "@/lib/testing/playwrightMockRealBbbBoundedSubmitLoop";
import { resolveAutomatedBbbFilingBase } from "@/lib/justice/bbbOwnedFilingSubmitContext";

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
 * Owned-filing Browserless session budget in seconds (Browserless `timeout` query param unit).
 * Same value as the route maxDuration constant — do not multiply by 1000.
 */
export const OWNED_FILING_BROWSERLESS_SESSION_TIMEOUT_SECONDS =
  BBB_OWNED_AUTOFILL_ROUTE_MAX_DURATION_SECONDS;

/** Browserless API maximum for the `timeout` query parameter (seconds). */
export const BROWSERLESS_TIMEOUT_MAX_SECONDS = 60_000;

function isValidBrowserlessOwnedFilingTimeoutSeconds(value: number): boolean {
  return (
    Number.isInteger(value) &&
    value >= BBB_OWNED_AUTOFILL_ROUTE_MAX_DURATION_SECONDS &&
    value <= BROWSERLESS_TIMEOUT_MAX_SECONDS
  );
}

/**
 * Ensures a Browserless CDP WebSocket URL has a single valid session `timeout` (seconds) in
 * [route budget, 60000]. Preserves token and all other query params. Always normalizes via
 * URLSearchParams and returns parsed.toString() when the URL is parseable.
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

  const candidates = parsed.searchParams.getAll("timeout");
  let chosen: number | null = null;
  for (const raw of candidates) {
    const candidate = raw.trim();
    if (!/^\d+$/.test(candidate)) continue;
    const seconds = Number.parseInt(candidate, 10);
    if (isValidBrowserlessOwnedFilingTimeoutSeconds(seconds)) {
      chosen = seconds;
      break;
    }
  }

  parsed.searchParams.set(
    "timeout",
    String(chosen ?? BBB_OWNED_AUTOFILL_ROUTE_MAX_DURATION_SECONDS)
  );
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

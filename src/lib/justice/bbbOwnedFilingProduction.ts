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

/** Owned-filing Browserless session budget (ms), derived from the route maxDuration constant. */
export const OWNED_FILING_BROWSERLESS_SESSION_TIMEOUT_MS =
  BBB_OWNED_AUTOFILL_ROUTE_MAX_DURATION_SECONDS * 1000;

/**
 * Ensures a Browserless CDP WebSocket URL requests a session `timeout` at least as long as
 * the owned-filing route budget. Preserves token and all other query params; leaves an
 * already-adequate timeout unchanged. Returns the original string if the URL cannot be parsed.
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

  const existingRaw = parsed.searchParams.get("timeout");
  if (existingRaw != null) {
    const existingMs = Number.parseInt(existingRaw, 10);
    if (Number.isFinite(existingMs) && existingMs >= OWNED_FILING_BROWSERLESS_SESSION_TIMEOUT_MS) {
      return trimmed;
    }
  }

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

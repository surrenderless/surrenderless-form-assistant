import { AsyncLocalStorage } from "async_hooks";
import type { NextRequest } from "next/server";

/** Request-scoped auth/base for decide-action during owned BBB autofill. */
export type BbbOwnedFilingSubmitContext = {
  base: string;
  forwardedHeaders: Record<string, string>;
};

const storage = new AsyncLocalStorage<BbbOwnedFilingSubmitContext>();

export function getBbbOwnedFilingSubmitContext(): BbbOwnedFilingSubmitContext | undefined {
  return storage.getStore();
}

export function runWithBbbOwnedFilingSubmitContext<T>(
  context: BbbOwnedFilingSubmitContext,
  fn: () => T
): T {
  return storage.run(context, fn);
}

export function resolveAutomatedBbbFilingBase(
  overrideBase?: string | null
): string | null {
  const explicit = overrideBase?.trim();
  if (explicit) return explicit.replace(/\/$/, "");

  const fromStore = storage.getStore()?.base?.trim();
  if (fromStore) return fromStore.replace(/\/$/, "");

  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (appUrl) return appUrl.replace(/\/$/, "");

  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) {
    const host = vercel.replace(/^https?:\/\//i, "").replace(/\/$/, "");
    return host ? `https://${host}` : null;
  }

  return null;
}

/** Build decide-action forward headers from an incoming API request (cookie + optional Basic). */
export function buildBbbOwnedFilingSubmitContextFromRequest(
  req: NextRequest
): BbbOwnedFilingSubmitContext {
  const base = new URL(req.url).origin;
  const cookie = req.headers.get("cookie");
  const deployPassword = process.env.DEPLOY_PASSWORD;
  const basicAuth = deployPassword
    ? `Basic ${Buffer.from(`admin:${deployPassword}`).toString("base64")}`
    : undefined;
  const forwardedHeaders: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (cookie) forwardedHeaders.cookie = cookie;
  if (basicAuth) forwardedHeaders.authorization = basicAuth;
  return { base, forwardedHeaders };
}

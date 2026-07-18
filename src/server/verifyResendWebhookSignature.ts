import { createHmac, timingSafeEqual } from "crypto";

/**
 * Resend signs webhooks with the Svix scheme:
 *   signedContent = `${svix-id}.${svix-timestamp}.${rawBody}`
 *   signature     = base64(HMAC_SHA256(secretBytes, signedContent))
 * The `svix-signature` header is a space-delimited list of `v<version>,<sig>` entries.
 * Verification is done against the RAW request body — never the re-serialized JSON.
 */

const DEFAULT_TOLERANCE_SECONDS = 5 * 60;
const WHSEC_PREFIX = "whsec_";

export type ResendWebhookHeaders = {
  id: string | null;
  timestamp: string | null;
  signature: string | null;
};

/** Reads Svix headers (Resend forwards these) from a request, tolerating the `webhook-*` aliases. */
export function readSvixHeaders(headers: Headers): ResendWebhookHeaders {
  return {
    id: headers.get("svix-id") ?? headers.get("webhook-id"),
    timestamp: headers.get("svix-timestamp") ?? headers.get("webhook-timestamp"),
    signature: headers.get("svix-signature") ?? headers.get("webhook-signature"),
  };
}

function decodeSecret(secret: string): Buffer | null {
  const trimmed = secret.trim();
  const base64 = trimmed.startsWith(WHSEC_PREFIX) ? trimmed.slice(WHSEC_PREFIX.length) : trimmed;
  if (!base64) return null;
  const buf = Buffer.from(base64, "base64");
  return buf.length > 0 ? buf : null;
}

function safeEqualBase64(expectedB64: string, providedB64: string): boolean {
  const expected = Buffer.from(expectedB64, "base64");
  const provided = Buffer.from(providedB64.trim(), "base64");
  if (expected.length === 0 || expected.length !== provided.length) return false;
  return timingSafeEqual(expected, provided);
}

/**
 * Verifies a Resend/Svix webhook signature. Fails closed on any missing input,
 * stale timestamp (replay window), malformed secret, or signature mismatch.
 */
export function verifyResendWebhookSignature(params: {
  payload: string;
  headers: ResendWebhookHeaders;
  secret: string;
  toleranceSeconds?: number;
  nowMs?: number;
}): boolean {
  const { payload, headers, secret } = params;
  const tolerance = params.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  const nowMs = params.nowMs ?? Date.now();

  if (!secret?.trim()) return false;
  const { id, timestamp, signature } = headers;
  if (!id?.trim() || !timestamp?.trim() || !signature?.trim()) return false;

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(nowMs / 1000 - ts) > tolerance) return false;

  const key = decodeSecret(secret);
  if (!key) return false;

  const signedContent = `${id}.${timestamp}.${payload}`;
  const expected = createHmac("sha256", key).update(signedContent).digest("base64");

  for (const part of signature.split(" ")) {
    const entry = part.trim();
    if (!entry) continue;
    const comma = entry.indexOf(",");
    const sig = comma >= 0 ? entry.slice(comma + 1) : entry;
    if (sig && safeEqualBase64(expected, sig)) return true;
  }
  return false;
}

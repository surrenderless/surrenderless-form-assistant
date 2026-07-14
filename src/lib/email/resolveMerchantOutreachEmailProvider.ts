import type { EmailProvider, EmailSendRequest, EmailSendResult } from "@/lib/email/emailProvider";
import {
  isPlaywrightMockMerchantOutreachEmailEnabled,
  resolveMerchantOutreachEmailEnv,
} from "@/lib/email/merchantOutreachEmailEnv";
import { createResendEmailProvider } from "@/lib/email/resendEmailProvider";

export type ResolvedMerchantOutreachEmailProvider =
  | { ok: true; provider: EmailProvider; from: string }
  | { ok: false; reason: string };

/** Deterministic mock provider for authenticated Playwright E2E. */
export function createMockMerchantOutreachEmailProvider(): EmailProvider {
  return {
    name: "mock_resend",
    async send(request: EmailSendRequest): Promise<EmailSendResult> {
      const to = request.to.trim().toLowerCase();
      if (to.includes("fail-delivery@")) {
        return { ok: false, error: "Mock provider forced failure", retryable: false };
      }
      const safeKey = request.idempotencyKey.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);
      return { ok: true, messageId: `mock_resend_${safeKey}` };
    },
  };
}

export function resolveMerchantOutreachEmailProvider(): ResolvedMerchantOutreachEmailProvider {
  if (isPlaywrightMockMerchantOutreachEmailEnabled()) {
    const from =
      process.env.MERCHANT_OUTREACH_FROM_EMAIL?.trim() || "outreach@surrenderless.test";
    return { ok: true, provider: createMockMerchantOutreachEmailProvider(), from };
  }

  const env = resolveMerchantOutreachEmailEnv();
  if (!env.enabled) {
    return { ok: false, reason: env.reason };
  }
  return {
    ok: true,
    provider: createResendEmailProvider(env.apiKey),
    from: env.from,
  };
}

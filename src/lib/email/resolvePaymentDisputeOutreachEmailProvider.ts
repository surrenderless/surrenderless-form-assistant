import type { EmailProvider, EmailSendRequest, EmailSendResult } from "@/lib/email/emailProvider";
import {
  isPlaywrightMockPaymentDisputeOutreachEmailEnabled,
  resolvePaymentDisputeOutreachEmailEnv,
} from "@/lib/email/paymentDisputeOutreachEmailEnv";
import { createResendEmailProvider } from "@/lib/email/resendEmailProvider";

export type ResolvedPaymentDisputeOutreachEmailProvider =
  | { ok: true; provider: EmailProvider; from: string }
  | { ok: false; reason: string };

/** Deterministic mock provider for authenticated Playwright E2E. */
export function createMockPaymentDisputeOutreachEmailProvider(): EmailProvider {
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

export function resolvePaymentDisputeOutreachEmailProvider(): ResolvedPaymentDisputeOutreachEmailProvider {
  if (isPlaywrightMockPaymentDisputeOutreachEmailEnabled()) {
    const from =
      process.env.PAYMENT_DISPUTE_OUTREACH_FROM_EMAIL?.trim() ||
      process.env.MERCHANT_OUTREACH_FROM_EMAIL?.trim() ||
      "outreach@surrenderless.test";
    return { ok: true, provider: createMockPaymentDisputeOutreachEmailProvider(), from };
  }

  const env = resolvePaymentDisputeOutreachEmailEnv();
  if (!env.enabled) {
    return { ok: false, reason: env.reason };
  }
  return {
    ok: true,
    provider: createResendEmailProvider(env.apiKey),
    from: env.from,
  };
}

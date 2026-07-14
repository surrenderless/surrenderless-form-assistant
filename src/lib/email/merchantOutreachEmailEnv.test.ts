import { describe, expect, it } from "vitest";
import {
  isValidMerchantOutreachEmailAddress,
  resolveMerchantOutreachEmailEnv,
} from "@/lib/email/merchantOutreachEmailEnv";
import { createResendEmailProvider } from "@/lib/email/resendEmailProvider";

describe("createResendEmailProvider", () => {
  it("implements EmailProvider name", () => {
    const provider = createResendEmailProvider("re_test_key");
    expect(provider.name).toBe("resend");
  });
});

describe("resolveMerchantOutreachEmailEnv", () => {
  it("enables when API key and from email are present", () => {
    const prevKey = process.env.RESEND_API_KEY;
    const prevFrom = process.env.MERCHANT_OUTREACH_FROM_EMAIL;
    const prevEnabled = process.env.MERCHANT_OUTREACH_EMAIL_ENABLED;
    process.env.RESEND_API_KEY = "re_test";
    process.env.MERCHANT_OUTREACH_FROM_EMAIL = "outreach@surrenderless.test";
    delete process.env.MERCHANT_OUTREACH_EMAIL_ENABLED;
    const env = resolveMerchantOutreachEmailEnv();
    expect(env.enabled).toBe(true);
    if (env.enabled) {
      expect(env.apiKey).toBe("re_test");
      expect(env.from).toBe("outreach@surrenderless.test");
    }
    expect(isValidMerchantOutreachEmailAddress(env.enabled ? env.from : "")).toBe(true);
    process.env.RESEND_API_KEY = prevKey;
    process.env.MERCHANT_OUTREACH_FROM_EMAIL = prevFrom;
    process.env.MERCHANT_OUTREACH_EMAIL_ENABLED = prevEnabled;
  });
});

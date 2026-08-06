import { describe, expect, it } from "vitest";
import { formatStripeAmount } from "@/lib/stripe/formatStripeAmount";

describe("formatStripeAmount", () => {
  it("formats a standard two-decimal USD amount", () => {
    expect(formatStripeAmount(4900, "usd")).toBe("$49.00");
  });

  it("formats a non-round USD amount", () => {
    expect(formatStripeAmount(1999, "usd")).toBe("$19.99");
  });

  it("is case-insensitive on currency code", () => {
    expect(formatStripeAmount(4900, "USD")).toBe("$49.00");
  });

  it("formats a zero-decimal currency (JPY) without dividing by 100", () => {
    expect(formatStripeAmount(4900, "jpy")).toBe("¥4,900");
  });

  it("falls back to a plain string when Intl rejects a malformed currency code", () => {
    expect(formatStripeAmount(4900, "not-a-currency")).toBe("49 NOT-A-CURRENCY");
  });
});

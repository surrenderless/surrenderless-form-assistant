import { describe, expect, it } from "vitest";
import {
  buildCheckoutPriceHeadline,
  CHECKOUT_CONFIRMATION_TIMEOUT_MESSAGE,
  CHECKOUT_CONFIRMING_PAYMENT_MESSAGE,
  CHECKOUT_DISCLOSURE_PARAGRAPHS,
  CHECKOUT_PRICE_LOADING_MESSAGE,
  CHECKOUT_PRICE_UNAVAILABLE_MESSAGE,
  isCheckoutApprovalBlockedByPricing,
  isCheckoutAwaitingPaymentConfirmation,
} from "@/lib/stripe/checkoutDisclosureCopy";

describe("buildCheckoutPriceHeadline", () => {
  it("shows the exact price and currency retrieved server-side, not a hardcoded amount", () => {
    expect(buildCheckoutPriceHeadline(4900, "usd")).toBe("One-time fee: $49.00");
  });

  it("reflects a different amount/currency exactly", () => {
    expect(buildCheckoutPriceHeadline(1999, "eur")).toBe("One-time fee: €19.99");
  });
});

describe("CHECKOUT_DISCLOSURE_PARAGRAPHS", () => {
  it("states that payment opens Stripe Checkout", () => {
    expect(CHECKOUT_DISCLOSURE_PARAGRAPHS.join(" ")).toMatch(/opens stripe checkout/i);
  });

  it("states payment is per case", () => {
    expect(CHECKOUT_DISCLOSURE_PARAGRAPHS.join(" ")).toMatch(/for this case/i);
  });

  it("states payment does not guarantee a successful outcome", () => {
    expect(CHECKOUT_DISCLOSURE_PARAGRAPHS.join(" ")).toMatch(
      /does not guarantee a successful outcome/i
    );
  });

  it("states payment is final once completed", () => {
    expect(CHECKOUT_DISCLOSURE_PARAGRAPHS.join(" ")).toMatch(/is final once completed/i);
  });

  it("states that changing your mind/withdrawing/asking to stop after payment does not qualify for a refund", () => {
    expect(CHECKOUT_DISCLOSURE_PARAGRAPHS.join(" ")).toMatch(
      /changing your mind, withdrawing, or asking to stop after payment does not qualify for a refund/i
    );
  });

  it("states future actions may be stopped but submitted/queued actions may be irreversible", () => {
    expect(CHECKOUT_DISCLOSURE_PARAGRAPHS.join(" ")).toMatch(
      /stop future actions.*submitted or queued.*may not be reversible/i
    );
  });

  it("limits refunds to exactly: duplicate charges, an uncorrectable verified technical failure, or as required by law", () => {
    const text = CHECKOUT_DISCLOSURE_PARAGRAPHS.join(" ");
    expect(text).toMatch(/refunds are limited to/i);
    expect(text).toMatch(/duplicate charges/i);
    expect(text).toMatch(
      /verified surrenderless technical failure that prevents completion and can't be fixed or completed through a supported alternative/i
    );
    expect(text).toMatch(/as required by law/i);
  });
});

describe("isCheckoutApprovalBlockedByPricing", () => {
  it("blocks checkout while pricing is loading", () => {
    expect(isCheckoutApprovalBlockedByPricing({ status: "loading" })).toBe(true);
  });

  it("blocks checkout when pricing is unavailable", () => {
    expect(isCheckoutApprovalBlockedByPricing({ status: "unavailable" })).toBe(true);
  });

  it("never blocks checkout once the exact price has loaded", () => {
    expect(
      isCheckoutApprovalBlockedByPricing({ status: "ready", unitAmount: 4900, currency: "usd" })
    ).toBe(false);
  });

  it("never blocks an already-paid case on pricing — no checkout is needed for it at all", () => {
    expect(isCheckoutApprovalBlockedByPricing({ status: "not_needed" })).toBe(false);
  });

  it("blocks approval while a completed payment is being confirmed — must never start a 2nd checkout", () => {
    expect(isCheckoutApprovalBlockedByPricing({ status: "confirming" })).toBe(true);
  });

  it("blocks approval when confirmation timed out — the consumer already paid; no re-checkout", () => {
    expect(isCheckoutApprovalBlockedByPricing({ status: "confirm_timeout" })).toBe(true);
  });
});

describe("isCheckoutAwaitingPaymentConfirmation", () => {
  it("is true while confirming and after a confirmation timeout", () => {
    expect(isCheckoutAwaitingPaymentConfirmation({ status: "confirming" })).toBe(true);
    expect(isCheckoutAwaitingPaymentConfirmation({ status: "confirm_timeout" })).toBe(true);
  });

  it("is false for pre-payment and paid states", () => {
    expect(isCheckoutAwaitingPaymentConfirmation({ status: "loading" })).toBe(false);
    expect(isCheckoutAwaitingPaymentConfirmation({ status: "unavailable" })).toBe(false);
    expect(
      isCheckoutAwaitingPaymentConfirmation({ status: "ready", unitAmount: 4900, currency: "usd" })
    ).toBe(false);
    expect(isCheckoutAwaitingPaymentConfirmation({ status: "not_needed" })).toBe(false);
  });
});

describe("payment confirmation messages", () => {
  it("confirming message reassures the consumer they don't need to pay again", () => {
    expect(CHECKOUT_CONFIRMING_PAYMENT_MESSAGE.toLowerCase()).toContain("confirming your payment");
    expect(CHECKOUT_CONFIRMING_PAYMENT_MESSAGE.toLowerCase()).toContain("pay again");
  });

  it("timeout message is truthful (payment went through) and recoverable, not a hard failure", () => {
    expect(CHECKOUT_CONFIRMATION_TIMEOUT_MESSAGE.toLowerCase()).toContain("longer than usual");
    expect(CHECKOUT_CONFIRMATION_TIMEOUT_MESSAGE.toLowerCase()).toMatch(/keep checking|resume/);
    expect(CHECKOUT_CONFIRMATION_TIMEOUT_MESSAGE.toLowerCase()).not.toContain("could not");
  });
});

describe("loading/unavailable messages", () => {
  it("has a distinct loading message", () => {
    expect(CHECKOUT_PRICE_LOADING_MESSAGE).toBe("Loading pricing…");
  });

  it("has a distinct unavailable message explaining approval is disabled", () => {
    expect(CHECKOUT_PRICE_UNAVAILABLE_MESSAGE).toMatch(/unavailable/i);
    expect(CHECKOUT_PRICE_UNAVAILABLE_MESSAGE).toMatch(/disabled/i);
  });
});

import { describe, expect, it } from "vitest";
import {
  buildCheckoutPriceHeadline,
  CHECKOUT_DISCLOSURE_PARAGRAPHS,
  CHECKOUT_PRICE_LOADING_MESSAGE,
  CHECKOUT_PRICE_UNAVAILABLE_MESSAGE,
  isCheckoutApprovalBlockedByPricing,
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

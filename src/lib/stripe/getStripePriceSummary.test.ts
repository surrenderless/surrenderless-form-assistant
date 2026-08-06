import { describe, expect, it, vi } from "vitest";
import { fetchStripePriceSummary } from "@/lib/stripe/getStripePriceSummary";

describe("fetchStripePriceSummary", () => {
  it("returns the exact unit amount and currency for a valid price", async () => {
    const stripe = { prices: { retrieve: vi.fn().mockResolvedValue({ unit_amount: 4900, currency: "usd" }) } };

    const result = await fetchStripePriceSummary(stripe, "price_123");

    expect(result).toEqual({ unitAmount: 4900, currency: "usd" });
    expect(stripe.prices.retrieve).toHaveBeenCalledWith("price_123");
  });

  it("returns null when unit_amount is missing (e.g. a metered/custom price)", async () => {
    const stripe = { prices: { retrieve: vi.fn().mockResolvedValue({ unit_amount: null, currency: "usd" }) } };

    expect(await fetchStripePriceSummary(stripe, "price_123")).toBeNull();
  });

  it("returns null when currency is missing", async () => {
    const stripe = { prices: { retrieve: vi.fn().mockResolvedValue({ unit_amount: 4900, currency: "" }) } };

    expect(await fetchStripePriceSummary(stripe, "price_123")).toBeNull();
  });

  it("returns null (fails closed) when the Stripe API call throws", async () => {
    const stripe = { prices: { retrieve: vi.fn().mockRejectedValue(new Error("stripe down")) } };

    expect(await fetchStripePriceSummary(stripe, "price_123")).toBeNull();
  });

  it("never creates a checkout session or any other object — only retrieves the price", async () => {
    const retrieve = vi.fn().mockResolvedValue({ unit_amount: 4900, currency: "usd" });
    const stripe = { prices: { retrieve } };

    await fetchStripePriceSummary(stripe, "price_123");

    expect(retrieve).toHaveBeenCalledTimes(1);
  });
});

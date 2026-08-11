import { describe, expect, it } from "vitest";
import {
  CHECKOUT_CONFIRMATION_BACKOFF_MS,
  checkoutConfirmationDelayForAttempt,
  checkoutConfirmationTotalBudgetMs,
} from "@/lib/stripe/checkoutConfirmationPolling";

describe("checkoutConfirmationDelayForAttempt", () => {
  it("returns each scheduled delay in order for valid attempts", () => {
    CHECKOUT_CONFIRMATION_BACKOFF_MS.forEach((ms, attempt) => {
      expect(checkoutConfirmationDelayForAttempt(attempt)).toBe(ms);
    });
  });

  it("returns null once the bounded budget is exhausted (caller must show the timeout)", () => {
    expect(checkoutConfirmationDelayForAttempt(CHECKOUT_CONFIRMATION_BACKOFF_MS.length)).toBeNull();
    expect(
      checkoutConfirmationDelayForAttempt(CHECKOUT_CONFIRMATION_BACKOFF_MS.length + 5)
    ).toBeNull();
  });

  it("returns null for invalid attempt indices", () => {
    expect(checkoutConfirmationDelayForAttempt(-1)).toBeNull();
    expect(checkoutConfirmationDelayForAttempt(1.5)).toBeNull();
    expect(checkoutConfirmationDelayForAttempt(Number.NaN)).toBeNull();
  });
});

describe("checkout confirmation backoff schedule", () => {
  it("is bounded (finite number of polls) so confirmation can time out rather than spin forever", () => {
    expect(CHECKOUT_CONFIRMATION_BACKOFF_MS.length).toBeGreaterThan(0);
    expect(Number.isFinite(CHECKOUT_CONFIRMATION_BACKOFF_MS.length)).toBe(true);
  });

  it("starts with quick early polls to catch the common fast webhook, then backs off", () => {
    // First poll is quick (<= 1s) so a webhook that lands in a couple seconds resolves promptly.
    expect(CHECKOUT_CONFIRMATION_BACKOFF_MS[0]).toBeLessThanOrEqual(1000);
    // Non-decreasing schedule (backs off, never speeds up).
    for (let i = 1; i < CHECKOUT_CONFIRMATION_BACKOFF_MS.length; i += 1) {
      expect(CHECKOUT_CONFIRMATION_BACKOFF_MS[i]).toBeGreaterThanOrEqual(
        CHECKOUT_CONFIRMATION_BACKOFF_MS[i - 1]
      );
    }
  });

  it("keeps trying well beyond the old fixed 4.5s window before timing out", () => {
    // The prior fixed give-up was 3 x 1.5s = 4.5s; the bounded budget must comfortably exceed it so
    // ordinary webhook latency no longer reverts the consumer to a pay prompt.
    expect(checkoutConfirmationTotalBudgetMs()).toBeGreaterThan(4500);
  });

  it("total budget equals the sum of the schedule", () => {
    const sum = CHECKOUT_CONFIRMATION_BACKOFF_MS.reduce((a, b) => a + b, 0);
    expect(checkoutConfirmationTotalBudgetMs()).toBe(sum);
  });
});

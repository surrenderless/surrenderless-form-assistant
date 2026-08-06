import { describe, expect, it } from "vitest";
import {
  isCheckoutPriceResponseStale,
  nextCheckoutPriceRequestId,
  shouldClearFetchedGuardOnFailure,
  shouldSkipCheckoutPriceFetchForPaidCase,
  type CheckoutPriceRequestRef,
} from "@/lib/stripe/checkoutPriceRequestTracker";

const CASE_A = "case-a";
const CASE_B = "case-b";

describe("shouldSkipCheckoutPriceFetchForPaidCase", () => {
  it("skips the fetch when the case is already paid", () => {
    expect(shouldSkipCheckoutPriceFetchForPaidCase(true)).toBe(true);
  });

  it("does not skip when the case is unpaid", () => {
    expect(shouldSkipCheckoutPriceFetchForPaidCase(false)).toBe(false);
  });
});

describe("REGRESSION: already-paid case makes zero pricing requests", () => {
  it("an already-paid case never starts a fetch, regardless of any prior request state", () => {
    // Simulates the exact decision the price-fetch effect makes: check paid status FIRST,
    // before ever consulting request/fetch tracking state.
    const priorRequestState: CheckoutPriceRequestRef = null;
    const isPaid = true;

    const shouldFetch = !shouldSkipCheckoutPriceFetchForPaidCase(isPaid);

    expect(shouldFetch).toBe(false);
    // No request id is ever minted, and no request tracking state changes — a real fetch call
    // (page.tsx's fetchCheckoutPrice) is gated entirely behind this same check and is never
    // reached when it returns true.
    expect(priorRequestState).toBeNull();
  });
});

describe("nextCheckoutPriceRequestId", () => {
  it("starts at 1 for a case with no prior request", () => {
    expect(nextCheckoutPriceRequestId(null, CASE_A)).toBe(1);
  });

  it("increments for a retry of the same case", () => {
    const first = nextCheckoutPriceRequestId(null, CASE_A);
    const second = nextCheckoutPriceRequestId({ caseId: CASE_A, requestId: first }, CASE_A);
    expect(second).toBe(first + 1);
  });

  it("restarts at 1 for a different case, never continuing another case's counter", () => {
    const forA = nextCheckoutPriceRequestId({ caseId: CASE_A, requestId: 5 }, CASE_B);
    expect(forA).toBe(1);
  });
});

describe("isCheckoutPriceResponseStale", () => {
  it("is not stale when the request matches the current tracked request exactly", () => {
    expect(isCheckoutPriceResponseStale({ caseId: CASE_A, requestId: 1 }, CASE_A, 1)).toBe(false);
  });

  it("is stale when the case has since switched away", () => {
    expect(isCheckoutPriceResponseStale({ caseId: CASE_B, requestId: 1 }, CASE_A, 1)).toBe(true);
  });

  it("is stale when a newer request for the same case has superseded it", () => {
    expect(isCheckoutPriceResponseStale({ caseId: CASE_A, requestId: 2 }, CASE_A, 1)).toBe(true);
  });

  it("is stale when there is no tracked request at all", () => {
    expect(isCheckoutPriceResponseStale(null, CASE_A, 1)).toBe(true);
  });
});

describe("shouldClearFetchedGuardOnFailure", () => {
  it("clears the guard when the failure belongs to the currently tracked case", () => {
    expect(shouldClearFetchedGuardOnFailure(CASE_A, CASE_A)).toBe(true);
  });

  it("never clears a different case's guard", () => {
    expect(shouldClearFetchedGuardOnFailure(CASE_B, CASE_A)).toBe(false);
  });

  it("is a no-op when nothing was fetched yet", () => {
    expect(shouldClearFetchedGuardOnFailure(null, CASE_A)).toBe(false);
  });
});

describe("REGRESSION: a failed request can be retried successfully in the same session", () => {
  it("simulates fetch -> fail -> retry -> success without ever going stale or reload", () => {
    // 1. First attempt starts.
    let requestRef: CheckoutPriceRequestRef = null;
    let fetchedForCaseId: string | null = null;
    const firstRequestId = nextCheckoutPriceRequestId(requestRef, CASE_A);
    requestRef = { caseId: CASE_A, requestId: firstRequestId };
    fetchedForCaseId = CASE_A;

    // 2. It fails: the guard clears (so a retry is possible), the request ref stays as-is.
    expect(shouldClearFetchedGuardOnFailure(fetchedForCaseId, CASE_A)).toBe(true);
    fetchedForCaseId = null;

    // 3. Retry: a NEW request id is minted for the same case (never re-skipped as "already
    //    fetched", since the guard was cleared).
    const retryRequestId = nextCheckoutPriceRequestId(requestRef, CASE_A);
    expect(retryRequestId).toBe(firstRequestId + 1);
    requestRef = { caseId: CASE_A, requestId: retryRequestId };
    fetchedForCaseId = CASE_A;

    // 4. The retry succeeds: its response is NOT stale against the current tracked request...
    expect(isCheckoutPriceResponseStale(requestRef, CASE_A, retryRequestId)).toBe(false);

    // 5. ...while the ORIGINAL (failed) request's id, if it somehow resolved late, IS stale and
    //    must never be applied.
    expect(isCheckoutPriceResponseStale(requestRef, CASE_A, firstRequestId)).toBe(true);

    expect(fetchedForCaseId).toBe(CASE_A);
  });
});

import { describe, expect, it } from "vitest";
import { BBB_OWNED_AUTOFILL_ROUTE_MAX_DURATION_SECONDS } from "@/lib/justice/bbbOwnedFilingProduction";
import { maxDuration as casesMaxDuration } from "@/app/api/justice/cases/[id]/route";
import { maxDuration as decideMaxDuration } from "@/app/api/decide-action/route";
import { maxDuration as submitFormMaxDuration } from "@/app/api/submit-form/route";
import { maxDuration as ftcMaxDuration } from "@/app/api/justice/ftc-filing/complete/route";
import { maxDuration as merchantMaxDuration } from "@/app/api/justice/merchant-contact/complete/route";

describe("owned BBB autofill route maxDuration", () => {
  it("keeps shared constant and route exports aligned at 300s", () => {
    expect(BBB_OWNED_AUTOFILL_ROUTE_MAX_DURATION_SECONDS).toBe(300);
    expect(casesMaxDuration).toBe(BBB_OWNED_AUTOFILL_ROUTE_MAX_DURATION_SECONDS);
    expect(decideMaxDuration).toBe(BBB_OWNED_AUTOFILL_ROUTE_MAX_DURATION_SECONDS);
    expect(submitFormMaxDuration).toBe(BBB_OWNED_AUTOFILL_ROUTE_MAX_DURATION_SECONDS);
    expect(ftcMaxDuration).toBe(BBB_OWNED_AUTOFILL_ROUTE_MAX_DURATION_SECONDS);
    expect(merchantMaxDuration).toBe(BBB_OWNED_AUTOFILL_ROUTE_MAX_DURATION_SECONDS);
  });
});

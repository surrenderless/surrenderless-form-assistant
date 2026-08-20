import { describe, expect, it } from "vitest";
import { applyAnalyticsUrlPolicy, isExcludedFromAnalytics } from "./urlPolicy";

describe("isExcludedFromAnalytics", () => {
  it.each([
    "/mock",
    "/mock/bbb-complaint",
    "/debug",
    "/debug/me",
    "/admin",
    "/admin/users",
    "/operator",
    "/operator/fulfillment",
    "/sign-in",
    "/sign-in/factor-one",
  ])("excludes %s", (pathname) => {
    expect(isExcludedFromAnalytics(pathname)).toBe(true);
  });

  it.each([
    "/",
    "/justice",
    "/justice/cases",
    "/dashboard",
    "/admin-notices",
    "/operators-guide",
    "/sign-in-help",
  ])("does not exclude look-alike prefix %s", (pathname) => {
    expect(isExcludedFromAnalytics(pathname)).toBe(false);
  });
});

describe("applyAnalyticsUrlPolicy", () => {
  it("drops events for excluded paths", () => {
    expect(applyAnalyticsUrlPolicy("/admin/users?email=someone@example.com")).toBeNull();
    expect(applyAnalyticsUrlPolicy("https://www.surrenderless.ai/operator/fulfillment")).toBeNull();
    expect(applyAnalyticsUrlPolicy("/sign-in?__clerk_ticket=secret-ticket")).toBeNull();
  });

  it("strips all query parameters from tracked paths", () => {
    expect(applyAnalyticsUrlPolicy("/justice/cases?case_id=abc-123&email=a@b.com")).toBe(
      "/justice/cases"
    );
  });

  it("strips query parameters and hash from absolute tracked URLs, preserving origin", () => {
    expect(
      applyAnalyticsUrlPolicy("https://www.surrenderless.ai/justice/handling?token=abc#section")
    ).toBe("https://www.surrenderless.ai/justice/handling");
  });

  it("passes through tracked paths with no query string unchanged", () => {
    expect(applyAnalyticsUrlPolicy("/justice")).toBe("/justice");
  });

  it("strips redirect and auth handshake parameters even on non-excluded paths", () => {
    expect(
      applyAnalyticsUrlPolicy("/dashboard?redirect_url=%2Fadmin&__clerk_status=signed_in")
    ).toBe("/dashboard");
  });
});

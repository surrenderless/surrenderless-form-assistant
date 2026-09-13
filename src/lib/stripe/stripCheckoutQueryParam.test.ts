import { describe, expect, it } from "vitest";
import { stripCheckoutQueryParam } from "@/lib/stripe/stripCheckoutQueryParam";

describe("stripCheckoutQueryParam", () => {
  it("removes checkout while preserving the case id and other params", () => {
    expect(
      stripCheckoutQueryParam(
        "/justice/chat-ai",
        "?case=00000000-0000-4000-8000-000000000748&checkout=cancelled&foo=bar",
        ""
      )
    ).toBe("/justice/chat-ai?case=00000000-0000-4000-8000-000000000748&foo=bar");
  });

  it("removes checkout=success too (param name only, not value-specific)", () => {
    expect(
      stripCheckoutQueryParam("/justice/chat-ai", "?case=abc&checkout=success", "")
    ).toBe("/justice/chat-ai?case=abc");
  });

  it("drops the leading '?' entirely when checkout was the only param", () => {
    expect(stripCheckoutQueryParam("/justice/chat-ai", "?checkout=cancelled", "")).toBe(
      "/justice/chat-ai"
    );
  });

  it("preserves the hash", () => {
    expect(
      stripCheckoutQueryParam("/justice/chat-ai", "?case=abc&checkout=cancelled", "#section")
    ).toBe("/justice/chat-ai?case=abc#section");
  });

  it("is a no-op when there is no checkout param", () => {
    expect(stripCheckoutQueryParam("/justice/chat-ai", "?case=abc", "")).toBe(
      "/justice/chat-ai?case=abc"
    );
  });

  it("is a no-op with no search string at all", () => {
    expect(stripCheckoutQueryParam("/justice/chat-ai", "", "")).toBe("/justice/chat-ai");
  });
});

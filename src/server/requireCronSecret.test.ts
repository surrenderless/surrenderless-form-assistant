import { describe, expect, it } from "vitest";
import {
  isCronAuthorizationValid,
} from "@/server/requireCronSecret";

describe("requireCronSecret / isCronAuthorizationValid", () => {
  it("fails closed when secret is missing", () => {
    expect(isCronAuthorizationValid("Bearer anything", "")).toBe(false);
    expect(isCronAuthorizationValid("Bearer anything", undefined)).toBe(false);
    expect(isCronAuthorizationValid("Bearer anything", null)).toBe(false);
  });

  it("rejects missing or invalid authorization", () => {
    expect(isCronAuthorizationValid(null, "s3cret")).toBe(false);
    expect(isCronAuthorizationValid("", "s3cret")).toBe(false);
    expect(isCronAuthorizationValid("Bearer wrong", "s3cret")).toBe(false);
    expect(isCronAuthorizationValid("s3cret", "s3cret")).toBe(false);
  });

  it("accepts exact Bearer token match", () => {
    expect(isCronAuthorizationValid("Bearer s3cret", "s3cret")).toBe(true);
    expect(isCronAuthorizationValid("  Bearer s3cret  ", "  s3cret  ")).toBe(true);
  });
});

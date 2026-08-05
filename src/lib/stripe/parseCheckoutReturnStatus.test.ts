import { describe, expect, it } from "vitest";
import { parseCheckoutReturnStatus } from "@/lib/stripe/parseCheckoutReturnStatus";

describe("parseCheckoutReturnStatus", () => {
  it("parses success", () => {
    expect(parseCheckoutReturnStatus("?case=abc&checkout=success")).toBe("success");
  });

  it("parses cancelled", () => {
    expect(parseCheckoutReturnStatus("?case=abc&checkout=cancelled")).toBe("cancelled");
  });

  it("returns null when checkout param is absent", () => {
    expect(parseCheckoutReturnStatus("?case=abc")).toBeNull();
  });

  it("returns null for an unrecognized value", () => {
    expect(parseCheckoutReturnStatus("?checkout=whatever")).toBeNull();
  });

  it("returns null for an empty search string", () => {
    expect(parseCheckoutReturnStatus("")).toBeNull();
  });
});

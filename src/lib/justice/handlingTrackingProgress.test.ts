import { describe, expect, it } from "vitest";
import { isApprovedActionOpenedForHandlingTracking } from "@/lib/justice/handlingTrackingProgress";

describe("isApprovedActionOpenedForHandlingTracking", () => {
  it("returns true when status is started or completed", () => {
    expect(isApprovedActionOpenedForHandlingTracking({ status: "started" })).toBe(true);
    expect(isApprovedActionOpenedForHandlingTracking({ status: "completed" })).toBe(true);
  });

  it("returns true when handling was requested even if status is still approved", () => {
    expect(
      isApprovedActionOpenedForHandlingTracking({
        status: "approved",
        handling_requested_at: "2026-06-16T12:00:00.000Z",
      })
    ).toBe(true);
  });

  it("returns false when status is approved and handling was not requested", () => {
    expect(isApprovedActionOpenedForHandlingTracking({ status: "approved" })).toBe(false);
    expect(
      isApprovedActionOpenedForHandlingTracking({
        status: "approved",
        handling_requested_at: "   ",
      })
    ).toBe(false);
  });
});

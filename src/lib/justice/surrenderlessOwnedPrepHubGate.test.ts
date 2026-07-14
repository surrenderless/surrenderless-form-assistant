import { describe, expect, it } from "vitest";
import {
  isDiyAllowedOnSurrenderlessOwnedPrepHub,
  isOptionalHubEscapeSessionReadyForOwnedPrep,
  shouldShowSurrenderlessOwnedPrepHubOwnershipPending,
} from "@/lib/justice/surrenderlessOwnedPrepHubGate";

describe("surrenderlessOwnedPrepHubGate", () => {
  it("allows DIY only for not_owned", () => {
    expect(isDiyAllowedOnSurrenderlessOwnedPrepHub("not_owned")).toBe(true);
    expect(isDiyAllowedOnSurrenderlessOwnedPrepHub("loading")).toBe(false);
    expect(isDiyAllowedOnSurrenderlessOwnedPrepHub("indeterminate")).toBe(false);
    expect(isDiyAllowedOnSurrenderlessOwnedPrepHub("owned")).toBe(false);
  });

  it("treats loading and indeterminate as ownership-pending", () => {
    expect(shouldShowSurrenderlessOwnedPrepHubOwnershipPending("loading")).toBe(true);
    expect(shouldShowSurrenderlessOwnedPrepHubOwnershipPending("indeterminate")).toBe(true);
    expect(shouldShowSurrenderlessOwnedPrepHubOwnershipPending("not_owned")).toBe(false);
    expect(shouldShowSurrenderlessOwnedPrepHubOwnershipPending("owned")).toBe(false);
  });

  it("only blocks optional-hub escape redirects while ownership is still loading", () => {
    expect(isOptionalHubEscapeSessionReadyForOwnedPrep("not_owned")).toBe(true);
    expect(isOptionalHubEscapeSessionReadyForOwnedPrep("owned")).toBe(true);
    expect(isOptionalHubEscapeSessionReadyForOwnedPrep("indeterminate")).toBe(true);
    expect(isOptionalHubEscapeSessionReadyForOwnedPrep("loading")).toBe(false);
  });
});

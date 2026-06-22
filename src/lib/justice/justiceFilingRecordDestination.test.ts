import { describe, expect, it } from "vitest";
import {
  isFilingRecordDestinationLocked,
  resolveFilingRecordSubmitDestination,
} from "@/lib/justice/justiceFilingRecordDestination";

describe("resolveFilingRecordSubmitDestination", () => {
  it("uses the locked destination when present", () => {
    expect(
      resolveFilingRecordSubmitDestination("Better Business Bureau", "BBB typo")
    ).toBe("Better Business Bureau");
  });

  it("uses draft destination when no lock is set", () => {
    expect(resolveFilingRecordSubmitDestination(undefined, "  CFPB  ")).toBe("CFPB");
    expect(resolveFilingRecordSubmitDestination("   ", "State Attorney General")).toBe(
      "State Attorney General"
    );
  });
});

describe("isFilingRecordDestinationLocked", () => {
  it("returns true only for non-empty locked destinations", () => {
    expect(isFilingRecordDestinationLocked("Better Business Bureau")).toBe(true);
    expect(isFilingRecordDestinationLocked(undefined)).toBe(false);
    expect(isFilingRecordDestinationLocked("   ")).toBe(false);
  });
});

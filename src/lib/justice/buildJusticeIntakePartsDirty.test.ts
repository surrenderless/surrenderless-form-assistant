import { describe, expect, it } from "vitest";
import { areBuildJusticeIntakePartsDirty } from "@/lib/justice/buildJusticeIntakePartsDirty";
import { defaultBuildJusticeIntakeParts } from "@/lib/justice/buildJusticeIntake";

describe("areBuildJusticeIntakePartsDirty", () => {
  it("is false when current is byte-for-byte identical to baseline", () => {
    const baseline = defaultBuildJusticeIntakeParts();
    const current = { ...baseline };
    expect(areBuildJusticeIntakePartsDirty(baseline, current)).toBe(false);
  });

  it("is true for a field summarizeBuildJusticeIntakePartsSessionChanges does NOT cover (e.g. pay_or_order_date)", () => {
    const baseline = defaultBuildJusticeIntakeParts();
    const current = { ...baseline, pay_or_order_date: "2026-01-01" };
    expect(areBuildJusticeIntakePartsDirty(baseline, current)).toBe(true);
  });

  it("is true for a curated field (company_name)", () => {
    const baseline = defaultBuildJusticeIntakeParts();
    const current = { ...baseline, company_name: "Acme" };
    expect(areBuildJusticeIntakePartsDirty(baseline, current)).toBe(true);
  });

  it("is true when the baseline is null (never assume safe-to-overwrite without a known baseline)", () => {
    const current = defaultBuildJusticeIntakeParts();
    expect(areBuildJusticeIntakePartsDirty(null, current)).toBe(true);
  });

  it("detects a change in every string field of BuildJusticeIntakeParts individually", () => {
    const baseline = defaultBuildJusticeIntakeParts();
    for (const key of Object.keys(baseline) as (keyof typeof baseline)[]) {
      const original = baseline[key];
      if (typeof original !== "string") continue; // enum-typed fields covered separately below
      const current = { ...baseline, [key]: `${original}__changed__` };
      expect(areBuildJusticeIntakePartsDirty(baseline, current)).toBe(true);
    }
  });

  it("detects a change in an enum-typed field (already_contacted)", () => {
    const baseline = defaultBuildJusticeIntakeParts();
    const current = { ...baseline, already_contacted: "yes" as const };
    expect(areBuildJusticeIntakePartsDirty(baseline, current)).toBe(true);
  });
});

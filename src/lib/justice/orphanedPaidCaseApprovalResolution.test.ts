import { describe, expect, it } from "vitest";
import { buildJusticeIntakeFromParts, defaultBuildJusticeIntakeParts } from "@/lib/justice/buildJusticeIntake";
import {
  computeEligibleOrphanedPaidCaseApprovalActions,
  isKnownDestinationHrefForIntake,
} from "@/lib/justice/orphanedPaidCaseApprovalResolution";

describe("computeEligibleOrphanedPaidCaseApprovalActions", () => {
  it("returns only merchant contact when the consumer has not yet contacted the merchant", () => {
    const intake = buildJusticeIntakeFromParts({
      ...defaultBuildJusticeIntakeParts(),
      problem_category: "online_purchase",
      company_name: "Acme Retail",
      already_contacted: "no",
    });
    const eligible = computeEligibleOrphanedPaidCaseApprovalActions(intake, {
      hasUploadedEvidenceFile: false,
    });
    expect(eligible).toEqual([{ href: "/justice/merchant", label: "Merchant contact" }]);
  });

  it("returns a bounded, non-empty set of real destinations once contacted — never an arbitrary string", () => {
    const intake = buildJusticeIntakeFromParts({
      ...defaultBuildJusticeIntakeParts(),
      problem_category: "online_purchase",
      company_name: "Acme Retail",
      already_contacted: "yes",
    });
    const eligible = computeEligibleOrphanedPaidCaseApprovalActions(intake, {
      hasUploadedEvidenceFile: false,
    });
    expect(eligible.length).toBeGreaterThan(0);
    for (const action of eligible) {
      expect(action.href.startsWith("/justice/")).toBe(true);
      expect(action.label.trim().length).toBeGreaterThan(0);
    }
  });

  it("never includes a mock-practice destination as an operator-selectable option", () => {
    const intake = buildJusticeIntakeFromParts({
      ...defaultBuildJusticeIntakeParts(),
      already_contacted: "yes",
    });
    const eligible = computeEligibleOrphanedPaidCaseApprovalActions(intake, {
      hasUploadedEvidenceFile: false,
    });
    expect(eligible.every((a) => a.href !== "/justice/ftc-review")).toBe(true);
  });

  it("returns no duplicate hrefs", () => {
    const intake = buildJusticeIntakeFromParts({
      ...defaultBuildJusticeIntakeParts(),
      already_contacted: "yes",
    });
    const eligible = computeEligibleOrphanedPaidCaseApprovalActions(intake, {
      hasUploadedEvidenceFile: false,
    });
    const hrefs = eligible.map((a) => a.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("is deterministic for identical inputs", () => {
    const intake = buildJusticeIntakeFromParts({
      ...defaultBuildJusticeIntakeParts(),
      already_contacted: "yes",
    });
    const first = computeEligibleOrphanedPaidCaseApprovalActions(intake, { hasUploadedEvidenceFile: false });
    const second = computeEligibleOrphanedPaidCaseApprovalActions(intake, { hasUploadedEvidenceFile: false });
    expect(first).toEqual(second);
  });
});

describe("isKnownDestinationHrefForIntake", () => {
  it("accepts the uncontacted merchant default even though it is not in computeJusticeDestinations", () => {
    const intake = buildJusticeIntakeFromParts({
      ...defaultBuildJusticeIntakeParts(),
      already_contacted: "no",
    });
    expect(isKnownDestinationHrefForIntake(intake, "/justice/merchant")).toBe(true);
  });

  it("rejects an arbitrary/unknown href outright", () => {
    const intake = buildJusticeIntakeFromParts({
      ...defaultBuildJusticeIntakeParts(),
      already_contacted: "yes",
    });
    expect(isKnownDestinationHrefForIntake(intake, "/justice/not-a-real-route")).toBe(false);
    expect(isKnownDestinationHrefForIntake(intake, "https://evil.example/phish")).toBe(false);
  });

  it("rejects an empty href", () => {
    const intake = buildJusticeIntakeFromParts({ ...defaultBuildJusticeIntakeParts() });
    expect(isKnownDestinationHrefForIntake(intake, "")).toBe(false);
    expect(isKnownDestinationHrefForIntake(intake, "   ")).toBe(false);
  });

  it("accepts a real destination href for this intake even when its current status is not top-priority", () => {
    const intake = buildJusticeIntakeFromParts({
      ...defaultBuildJusticeIntakeParts(),
      already_contacted: "yes",
    });
    expect(isKnownDestinationHrefForIntake(intake, "/justice/state-ag")).toBe(true);
  });
});

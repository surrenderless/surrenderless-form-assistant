import { describe, expect, it } from "vitest";
import {
  buildJusticeIntakeFromParts,
  defaultBuildJusticeIntakeParts,
  justiceIntakeToBuildJusticeIntakeParts,
  resolveIntakeDesiredResolution,
  resolveIntakeMoneyAmount,
  splitMoneyInvolved,
} from "@/lib/justice/buildJusticeIntake";
import type { JusticeIntake } from "@/lib/justice/types";

const REQUIRED_PARTS = {
  ...defaultBuildJusticeIntakeParts(),
  company_name: "Acme Retail",
  purchase_or_signup: "widget",
  story: "Never arrived",
  reply_email: "user@example.com",
};

describe("buildJusticeIntakeFromParts money/resolution split", () => {
  it("stores money_amount and desired_resolution as separate fields, no join/split round trip", () => {
    const intake = buildJusticeIntakeFromParts({
      ...REQUIRED_PARTS,
      money_amount: "$899.00",
      desired_resolution: "full refund",
    });
    expect(intake.money_amount).toBe("$899.00");
    expect(intake.desired_resolution).toBe("full refund");
  });

  it("still populates the legacy combined money_involved string for backward compatibility", () => {
    const intake = buildJusticeIntakeFromParts({
      ...REQUIRED_PARTS,
      money_amount: "$899.00",
      desired_resolution: "full refund",
    });
    expect(intake.money_involved).toBe("$899.00 — Desired outcome: full refund");
  });

  it("handles amount-only and resolution-only cases", () => {
    const amountOnly = buildJusticeIntakeFromParts({
      ...REQUIRED_PARTS,
      money_amount: "$50",
      desired_resolution: "",
    });
    expect(amountOnly.money_amount).toBe("$50");
    expect(amountOnly.desired_resolution).toBe("");
    expect(amountOnly.money_involved).toBe("$50");

    const resolutionOnly = buildJusticeIntakeFromParts({
      ...REQUIRED_PARTS,
      money_amount: "",
      desired_resolution: "an apology",
    });
    expect(resolutionOnly.money_amount).toBe("");
    expect(resolutionOnly.desired_resolution).toBe("an apology");
    expect(resolutionOnly.money_involved).toBe("an apology");
  });

  it("falls back to an em dash placeholder in money_involved when both are empty", () => {
    const intake = buildJusticeIntakeFromParts({
      ...REQUIRED_PARTS,
      money_amount: "",
      desired_resolution: "",
    });
    expect(intake.money_amount).toBe("");
    expect(intake.desired_resolution).toBe("");
    expect(intake.money_involved).toBe("—");
  });
});

describe("resolveIntakeMoneyAmount / resolveIntakeDesiredResolution", () => {
  it("prefers the structured fields when present", () => {
    const intake: JusticeIntake = {
      ...buildJusticeIntakeFromParts(REQUIRED_PARTS),
      money_amount: "$250.00",
      desired_resolution: "replacement",
      money_involved: "$899.00 — Desired outcome: full refund",
    };
    expect(resolveIntakeMoneyAmount(intake)).toBe("$250.00");
    expect(resolveIntakeDesiredResolution(intake)).toBe("replacement");
  });

  it("falls back to splitting money_involved for cases saved before these fields existed", () => {
    const legacyIntake: JusticeIntake = {
      ...buildJusticeIntakeFromParts(REQUIRED_PARTS),
      money_amount: undefined,
      desired_resolution: undefined,
      money_involved: "$899.00 — Desired outcome: full refund",
    };
    expect(resolveIntakeMoneyAmount(legacyIntake)).toBe("$899.00");
    expect(resolveIntakeDesiredResolution(legacyIntake)).toBe("full refund");
  });

  it("falls back correctly when legacy money_involved has no desired-outcome separator", () => {
    const legacyIntake: JusticeIntake = {
      ...buildJusticeIntakeFromParts(REQUIRED_PARTS),
      money_amount: undefined,
      desired_resolution: undefined,
      money_involved: "$50",
    };
    expect(resolveIntakeMoneyAmount(legacyIntake)).toBe("$50");
    expect(resolveIntakeDesiredResolution(legacyIntake)).toBe("");
  });

  it("treats a present-but-whitespace structured field as deliberately blank, not absent", () => {
    // Presence, not truthiness: the field exists (this is a new-shape intake), so a
    // whitespace-only value must trim to "" rather than falling back to a stale/mismatched
    // money_involved — falling back here would reproduce the resolution-only corruption bug.
    const intake: JusticeIntake = {
      ...buildJusticeIntakeFromParts(REQUIRED_PARTS),
      money_amount: "   ",
      money_involved: "$899.00 — Desired outcome: full refund",
    };
    expect(resolveIntakeMoneyAmount(intake)).toBe("");
  });

  it("matches splitMoneyInvolved output on legacy data (no behavior change for old cases)", () => {
    const legacy = "$899.00 — Desired outcome: full refund";
    const intake: JusticeIntake = {
      ...buildJusticeIntakeFromParts(REQUIRED_PARTS),
      money_amount: undefined,
      desired_resolution: undefined,
      money_involved: legacy,
    };
    const split = splitMoneyInvolved(legacy);
    expect(resolveIntakeMoneyAmount(intake)).toBe(split.money_amount);
    expect(resolveIntakeDesiredResolution(intake)).toBe(split.desired_resolution);
  });

  it("resolution-only new-shape intake: money_amount stays blank, not the resolution text", () => {
    // buildJusticeIntakeFromParts falls money_involved back to resPart alone when moneyPart is
    // empty ("a refund", no separator to split on). Before the presence-check fix, the blank
    // money_amount="" failed the old truthiness check and fell through to
    // splitMoneyInvolved("a refund"), whose no-separator branch dumps the whole resolution
    // sentence into money_amount — corrupting every structured/operator-copyable amount field.
    const intake = buildJusticeIntakeFromParts({
      ...REQUIRED_PARTS,
      money_amount: "",
      desired_resolution: "I just want a refund",
    });
    expect(intake.money_involved).toBe("I just want a refund");
    expect(resolveIntakeMoneyAmount(intake)).toBe("");
    expect(resolveIntakeDesiredResolution(intake)).toBe("I just want a refund");
  });

  it("amount-only new-shape intake: desired_resolution stays blank", () => {
    const intake = buildJusticeIntakeFromParts({
      ...REQUIRED_PARTS,
      money_amount: "$50",
      desired_resolution: "",
    });
    expect(resolveIntakeMoneyAmount(intake)).toBe("$50");
    expect(resolveIntakeDesiredResolution(intake)).toBe("");
  });

  it("legacy intake missing both structured fields still falls back to splitting money_involved", () => {
    const legacyIntake: JusticeIntake = {
      ...buildJusticeIntakeFromParts(REQUIRED_PARTS),
      money_amount: undefined,
      desired_resolution: undefined,
      money_involved: "I just want a refund",
    };
    // No separator present, so the legacy splitter's only option is to treat the whole string
    // as the amount — this is the pre-existing, accepted legacy-data limitation this fix does
    // NOT change (it only protects new-shape intakes, which always carry real money_amount).
    expect(resolveIntakeMoneyAmount(legacyIntake)).toBe("I just want a refund");
  });
});

describe("justiceIntakeToBuildJusticeIntakeParts money/resolution hydration", () => {
  it("hydrates directly from structured fields for new-shape cases, ignoring a stale money_involved", () => {
    const intake: JusticeIntake = {
      ...buildJusticeIntakeFromParts(REQUIRED_PARTS),
      money_amount: "$250.00",
      desired_resolution: "replacement",
      money_involved: "$899.00 — Desired outcome: full refund",
    };
    const parts = justiceIntakeToBuildJusticeIntakeParts(intake);
    expect(parts.money_amount).toBe("$250.00");
    expect(parts.desired_resolution).toBe("replacement");
  });

  it("hydrates by splitting money_involved for legacy-shape cases lacking structured fields", () => {
    const legacyIntake: JusticeIntake = {
      ...buildJusticeIntakeFromParts(REQUIRED_PARTS),
      money_amount: undefined,
      desired_resolution: undefined,
      money_involved: "$899.00 — Desired outcome: full refund",
    };
    const parts = justiceIntakeToBuildJusticeIntakeParts(legacyIntake);
    expect(parts.money_amount).toBe("$899.00");
    expect(parts.desired_resolution).toBe("full refund");
  });

  it("round-trips parts -> intake -> parts without loss", () => {
    const original = {
      ...REQUIRED_PARTS,
      money_amount: "$1,299.00",
      desired_resolution: "a correct replacement unit",
    };
    const intake = buildJusticeIntakeFromParts(original);
    const roundTripped = justiceIntakeToBuildJusticeIntakeParts(intake);
    expect(roundTripped.money_amount).toBe(original.money_amount);
    expect(roundTripped.desired_resolution).toBe(original.desired_resolution);
  });
});

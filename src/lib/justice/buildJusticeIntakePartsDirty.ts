import type { BuildJusticeIntakeParts } from "@/lib/justice/buildJusticeIntake";

/**
 * True when `current` differs from `baseline` in ANY field — an exhaustive, exact comparison.
 * Distinct from summarizeBuildJusticeIntakePartsSessionChanges, which only covers a curated
 * subset of fields for a human-readable changelog and must never be used to decide whether it is
 * safe to discard local state: a field it doesn't mention would silently read as "unchanged" here
 * even when it genuinely changed.
 *
 * A null baseline (nothing hydrated yet) is treated as dirty — never assume "safe to overwrite"
 * without a known-good baseline to compare against.
 */
export function areBuildJusticeIntakePartsDirty(
  baseline: BuildJusticeIntakeParts | null,
  current: BuildJusticeIntakeParts
): boolean {
  if (!baseline) return true;
  const keys = new Set<keyof BuildJusticeIntakeParts>([
    ...(Object.keys(baseline) as (keyof BuildJusticeIntakeParts)[]),
    ...(Object.keys(current) as (keyof BuildJusticeIntakeParts)[]),
  ]);
  for (const key of keys) {
    if (baseline[key] !== current[key]) return true;
  }
  return false;
}

import { STORAGE_INTAKE_CASE_VERSION } from "@/lib/justice/types";

/**
 * case_version paired with the intake snapshot this session last saw from the server, or null if
 * none is cached yet (fresh tab, cleared storage, or a flow that has never synced). Only ever set
 * alongside STORAGE_INTAKE by writeLocalIntakeCaseVersion — never read/written independently.
 *
 * Deliberately its own low-level module (not part of patchJusticeCaseIntake.ts, which imports the
 * case-reconciliation store, which in turn needs to write this value on "Keep"/"Use server version"
 * choices) so neither of those two higher-level modules has to import the other.
 */
export function readLocalIntakeCaseVersion(): number | null {
  if (typeof window === "undefined") return null;
  const raw = sessionStorage.getItem(STORAGE_INTAKE_CASE_VERSION);
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

export function writeLocalIntakeCaseVersion(value: number | null): void {
  if (typeof window === "undefined") return;
  if (value === null) sessionStorage.removeItem(STORAGE_INTAKE_CASE_VERSION);
  else sessionStorage.setItem(STORAGE_INTAKE_CASE_VERSION, String(value));
}

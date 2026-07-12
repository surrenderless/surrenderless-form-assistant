import { isJusticeIntakePayload } from "@/lib/justice/caseApiValidation";

export type ArchivedJusticeCaseListRow = {
  id?: string;
  intake?: unknown;
  archived_at?: string | null;
  updated_at?: string | null;
};

/** True when a list row is owned, archived, and has valid intake for chat resume. */
export function isEligibleArchivedCaseListRow(row: ArchivedJusticeCaseListRow): row is ArchivedJusticeCaseListRow & {
  id: string;
  intake: unknown;
  archived_at: string;
} {
  const id = row.id?.trim() ?? "";
  const archivedAt = row.archived_at?.trim() ?? "";
  if (!id || !archivedAt) return false;
  return isJusticeIntakePayload(row.intake);
}

/**
 * Pick the authenticated user's most recently archived eligible case from a list
 * ordered by updated_at DESC (production list API contract).
 */
export function selectMostRecentlyArchivedEligibleCase(
  rows: readonly ArchivedJusticeCaseListRow[]
): (ArchivedJusticeCaseListRow & { id: string; intake: unknown; archived_at: string }) | null {
  const eligible = rows.filter(isEligibleArchivedCaseListRow);
  if (eligible.length === 0) return null;
  return eligible[0] ?? null;
}

/** Idempotent restore target: already-active rows are ignored; archived rows restore safely. */
export function canRestoreArchivedCaseRow(row: {
  archived_at?: string | null;
}): boolean {
  return Boolean(row.archived_at?.trim());
}

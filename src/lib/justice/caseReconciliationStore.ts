import { isJusticeIntakePayload } from "@/lib/justice/caseApiValidation";
import { writeLocalIntakeCaseVersion } from "@/lib/justice/patchJusticeCaseIntake";
import { STORAGE_CASE_RECONCILIATIONS, STORAGE_INTAKE } from "@/lib/justice/types";
import type { JusticeIntake } from "@/lib/justice/types";

/**
 * Per-case durable reconciliation state — replaces a prior single global draft/case-id pair that
 * could not distinguish one case's unresolved conflict from another's. Every record is keyed by
 * case id in one sessionStorage-backed map, so switching cases, or a completely unrelated case
 * successfully saving, can never read or clear a DIFFERENT case's record: each case's entry is a
 * distinct key, never a shared slot.
 *
 * A record exists for a case exactly when that case has content the user has not yet confirmed
 * saved to the server:
 *  - "pending": a 409/missing-version save-time conflict, or a passive reload-detected divergence,
 *    that the user has not yet resolved. The UI must offer "Keep my changes" / "Use server
 *    version" and must not attempt another save while this is the status.
 *  - "kept": the user explicitly chose "Keep my changes" — `localDraft` is the content to treat as
 *    current, `serverCaseVersion` is the CAS token to send on the next save attempt, but nothing
 *    has actually been confirmed saved yet. This status exists specifically so a refresh, or a
 *    completely unrelated server update to a DIFFERENT case, can never cause this case's content
 *    to be silently treated as committed — only an actual successful save (patchJusticeCaseIntake
 *    calling clearCaseReconciliation for THIS case id) clears the record.
 *
 * "Use server version" clears the record immediately (the local draft is explicitly discarded, so
 * there is nothing left to protect).
 */

export type CaseReconciliationReason = "conflict" | "missing_version" | "reload";
export type CaseReconciliationStatus = "pending" | "kept";

export type CaseReconciliationRecord = {
  reason: CaseReconciliationReason;
  status: CaseReconciliationStatus;
  localDraft: JusticeIntake;
  serverIntake: JusticeIntake;
  serverCaseVersion: number;
};

export type CaseReconciliationBanner = {
  caseId: string;
  reason: CaseReconciliationReason;
  serverIntake: JusticeIntake;
  serverCaseVersion: number;
};

function isValidReason(value: unknown): value is CaseReconciliationReason {
  return value === "conflict" || value === "missing_version" || value === "reload";
}

function isValidStatus(value: unknown): value is CaseReconciliationStatus {
  return value === "pending" || value === "kept";
}

function isValidRecord(value: unknown): value is CaseReconciliationRecord {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    isValidReason(v.reason) &&
    isValidStatus(v.status) &&
    isJusticeIntakePayload(v.localDraft) &&
    isJusticeIntakePayload(v.serverIntake) &&
    typeof v.serverCaseVersion === "number"
  );
}

function readAllReconciliations(): Record<string, CaseReconciliationRecord> {
  if (typeof window === "undefined") return {};
  const raw = sessionStorage.getItem(STORAGE_CASE_RECONCILIATIONS);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, CaseReconciliationRecord> = {};
    for (const [caseId, record] of Object.entries(parsed as Record<string, unknown>)) {
      if (isValidRecord(record)) out[caseId] = record;
    }
    return out;
  } catch {
    return {};
  }
}

function writeAllReconciliations(map: Record<string, CaseReconciliationRecord>): void {
  if (typeof window === "undefined") return;
  if (Object.keys(map).length === 0) {
    sessionStorage.removeItem(STORAGE_CASE_RECONCILIATIONS);
    return;
  }
  sessionStorage.setItem(STORAGE_CASE_RECONCILIATIONS, JSON.stringify(map));
}

/** The reconciliation record for exactly this case, or null — never any other case's. */
export function readCaseReconciliation(caseId: string): CaseReconciliationRecord | null {
  return readAllReconciliations()[caseId] ?? null;
}

/** Writes (creating or replacing) the record for exactly this case. Every other case's record in
 * the map is preserved untouched — this can never clear or overwrite a different case's entry. */
export function writeCaseReconciliation(caseId: string, record: CaseReconciliationRecord): void {
  const all = readAllReconciliations();
  all[caseId] = record;
  writeAllReconciliations(all);
}

/** Removes exactly this case's record. Every other case's record is preserved untouched. */
export function clearCaseReconciliation(caseId: string): void {
  const all = readAllReconciliations();
  if (!(caseId in all)) return;
  delete all[caseId];
  writeAllReconciliations(all);
}

/**
 * Durably records a newly-detected divergence for `caseId` — a 409, a missing-version refresh, or
 * a passive reload poll — with BOTH sides of the choice (the local draft that diverged, and the
 * actual server snapshot/version that caused it) persisted together in one write, so a refresh
 * landing before the user chooses can reconstruct the exact same choice from durable storage
 * alone, never from a live-only value or from re-deriving the "server side" out of STORAGE_INTAKE
 * (which a later, unrelated write could have changed).
 */
export function recordCaseConflict(
  caseId: string,
  reason: CaseReconciliationReason,
  localDraft: JusticeIntake,
  serverIntake: JusticeIntake,
  serverCaseVersion: number
): void {
  writeCaseReconciliation(caseId, { reason, status: "pending", localDraft, serverIntake, serverCaseVersion });
}

/**
 * What the UI should show for `caseId` right now — on mount, or whenever this case becomes the
 * active one (a case switch) — derived entirely from the durable per-case record, never from
 * STORAGE_INTAKE (which may hold server content installed by the conflict that created this
 * record) and never from in-memory-only state that a refresh would lose. Returns null when this
 * case has no unresolved/unconfirmed content at all.
 */
export function loadCaseReconciliationBanner(
  caseId: string
): { localDraft: JusticeIntake; banner: CaseReconciliationBanner | null } | null {
  const record = readCaseReconciliation(caseId);
  if (!record) return null;
  return {
    localDraft: record.localDraft,
    banner:
      record.status === "pending"
        ? {
            caseId,
            reason: record.reason,
            serverIntake: record.serverIntake,
            serverCaseVersion: record.serverCaseVersion,
          }
        : null,
  };
}

/**
 * User chose "Keep my changes" for `caseId`. Promotes `currentDraft` into STORAGE_INTAKE (so it
 * durably survives a refresh even before the next save succeeds) and aligns the cached CAS token
 * to the server version that caused the conflict (so the next save attempt can actually succeed).
 * The record is NOT cleared — its status becomes "kept", so this content is never misclassified as
 * committed until an actual successful save (patchJusticeCaseIntake's success path) clears it.
 * Returns null if there was nothing to resolve (defensive — callers should already have checked).
 */
export function commitKeepMyChanges(caseId: string, currentDraft: JusticeIntake): { serverCaseVersion: number } | null {
  const existing = readCaseReconciliation(caseId);
  if (!existing) return null;
  writeLocalIntakeCaseVersion(existing.serverCaseVersion);
  if (typeof window !== "undefined") {
    sessionStorage.setItem(STORAGE_INTAKE, JSON.stringify(currentDraft));
  }
  writeCaseReconciliation(caseId, { ...existing, status: "kept", localDraft: currentDraft });
  return { serverCaseVersion: existing.serverCaseVersion };
}

/**
 * User chose "Use server version" for `caseId`. Restores the ACTUAL server snapshot/version that
 * was recorded at conflict time — never whatever happens to currently be in STORAGE_INTAKE — and
 * clears the record (the local draft is explicitly discarded; nothing left to protect).
 */
export function commitUseServerVersion(
  caseId: string
): { serverIntake: JusticeIntake; serverCaseVersion: number } | null {
  const existing = readCaseReconciliation(caseId);
  if (!existing) return null;
  writeLocalIntakeCaseVersion(existing.serverCaseVersion);
  if (typeof window !== "undefined") {
    sessionStorage.setItem(STORAGE_INTAKE, JSON.stringify(existing.serverIntake));
  }
  clearCaseReconciliation(caseId);
  return { serverIntake: existing.serverIntake, serverCaseVersion: existing.serverCaseVersion };
}

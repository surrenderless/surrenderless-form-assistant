import { isJusticeIntakePayload } from "@/lib/justice/caseApiValidation";
import { recordCaseConflict, clearCaseReconciliation } from "@/lib/justice/caseReconciliationStore";
import { readLocalIntakeCaseVersion, writeLocalIntakeCaseVersion } from "@/lib/justice/intakeCaseVersionStorage";
import { STORAGE_CASE_ID, STORAGE_INTAKE } from "@/lib/justice/types";
import type { JusticeIntake, TimelineEntry } from "@/lib/justice/types";
import { validate as isUuid } from "uuid";

/** True when `id` is still the active case — global session pointers (STORAGE_CASE_ID,
 * STORAGE_INTAKE, the cached case_version) must never be written for a case the user has since
 * navigated away from, even though this PATCH was legitimately in flight for it. */
function isStillActiveCase(id: string): boolean {
  if (typeof window === "undefined") return false;
  return sessionStorage.getItem(STORAGE_CASE_ID)?.trim() === id;
}

export { readLocalIntakeCaseVersion, writeLocalIntakeCaseVersion };

export type PatchJusticeCaseIntakeResult =
  | { ok: true; intake: JusticeIntake; caseVersion: number; timeline?: unknown }
  | {
      ok: false;
      reason: "conflict";
      error: string;
      current: { intake: unknown; caseVersion: number | null };
    }
  | { ok: false; reason: "missing_version"; error: string }
  | { ok: false; reason: "request_failed" | "invalid_response"; error: string };

/**
 * PATCHes justice_cases.intake through real end-to-end optimistic concurrency: always sends
 * expected_case_version from the exact snapshot this session cached alongside the intake content
 * being edited — case_version is a monotonic integer bumped by exactly 1 on every UPDATE by a
 * database trigger, never updated_at (a wall-clock timestamp proven able to repeat across
 * genuinely sequential writes against real Postgres, which silently lost a write in roughly a
 * third to half of racing-writer trials with no sleep involved).
 *
 * If no version is cached yet, this refuses to write (reason: "missing_version") rather than
 * silently fetching one via GET and pairing it with `intake` — that GET's content could already
 * be staler or fresher than `intake` with no way to tell, which is exactly the pairing bug that
 * let a fresh token silently authorize an overwrite of newer server state in a prior incident.
 * Callers must route through reconciliationController.ts's recoverFromMissingVersion (which
 * durably records this exact `intake` as the case's reconciliation draft alongside whatever
 * server snapshot it fetches) before retrying with a freshly-derived edit — never call this again
 * with the same stale `intake` after a missing_version result.
 *
 * On a genuine 409 conflict, this durably records BOTH sides of the reconciliation choice for
 * `caseId` — via recordCaseConflict — BEFORE adopting the fresh server intake/version into
 * STORAGE_INTAKE below. That ordering is load-bearing: a page refresh landing between "conflict
 * detected" and "user chooses" must still be able to reconstruct the exact same choice from the
 * durable per-case record alone, never from re-deriving the server side out of STORAGE_INTAKE
 * (which is not case-scoped and could have moved on for a reason unrelated to this exact
 * conflict). This never retries the stale write itself.
 *
 * Both the 409 and success branches install their fresh content into the GLOBAL STORAGE_INTAKE/
 * cached-case_version pointers only if `caseId` is STILL the active case by the time this PATCH
 * resolves (isStillActiveCase) — an in-flight request for a case the user has since switched
 * away from must never revert those pointers back to it. The per-case reconciliation record
 * (recordCaseConflict/clearCaseReconciliation) is written/cleared unconditionally either way —
 * it is safe regardless of which case is active, since it is scoped by case id, not a shared slot.
 */
export async function patchJusticeCaseIntake(
  caseId: string,
  intake: JusticeIntake,
  options: { timeline?: TimelineEntry[]; signal?: AbortSignal } = {}
): Promise<PatchJusticeCaseIntakeResult> {
  const id = caseId.trim();
  if (!id || !isUuid(id)) {
    return { ok: false, reason: "request_failed", error: "Invalid case id" };
  }

  const expectedCaseVersion = readLocalIntakeCaseVersion();
  if (expectedCaseVersion === null) {
    // No server snapshot known yet, so there is nothing to durably pair this draft with here —
    // the caller's refreshLocalIntakeAndVersionFromServer call records the full reconciliation
    // (this exact `intake` alongside the server snapshot it fetches) once both sides are known.
    return {
      ok: false,
      reason: "missing_version",
      error: "No cached case version — refresh the case before saving.",
    };
  }

  let res: Response;
  try {
    res = await fetch(`/api/justice/cases/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        intake,
        expected_case_version: expectedCaseVersion,
        ...(options.timeline ? { timeline: options.timeline } : {}),
      }),
      signal: options.signal,
    });
  } catch {
    return { ok: false, reason: "request_failed", error: "Could not save intake." };
  }

  if (res.status === 409) {
    const conflictBody = (await res.json().catch(() => null)) as
      | { error?: string; current?: { intake?: unknown; case_version?: number } }
      | null;
    const currentCaseVersion =
      typeof conflictBody?.current?.case_version === "number" ? conflictBody.current.case_version : null;
    // Record both sides of the choice for THIS case BEFORE installing server content below.
    if (currentCaseVersion !== null && isJusticeIntakePayload(conflictBody?.current?.intake)) {
      recordCaseConflict(id, "conflict", intake, conflictBody.current.intake, currentCaseVersion);
    }
    if (isStillActiveCase(id)) {
      if (currentCaseVersion !== null) writeLocalIntakeCaseVersion(currentCaseVersion);
      if (typeof window !== "undefined" && conflictBody?.current?.intake !== undefined) {
        sessionStorage.setItem(STORAGE_INTAKE, JSON.stringify(conflictBody.current.intake));
      }
    }
    return {
      ok: false,
      reason: "conflict",
      error: conflictBody?.error ?? "Case intake was updated concurrently. Reload and retry.",
      current: { intake: conflictBody?.current?.intake, caseVersion: currentCaseVersion },
    };
  }

  if (!res.ok) {
    const errBody = (await res.json().catch(() => null)) as { error?: string } | null;
    return { ok: false, reason: "request_failed", error: errBody?.error ?? "Could not save intake." };
  }

  const data = (await res.json().catch(() => null)) as
    | { intake?: unknown; case_version?: number; timeline?: unknown }
    | null;
  if (!data || !isJusticeIntakePayload(data.intake) || typeof data.case_version !== "number") {
    return { ok: false, reason: "invalid_response", error: "Unexpected response saving intake." };
  }

  if (isStillActiveCase(id)) {
    writeLocalIntakeCaseVersion(data.case_version);
    if (typeof window !== "undefined") {
      sessionStorage.setItem(STORAGE_INTAKE, JSON.stringify(data.intake));
    }
  }
  // This exact case's write just succeeded — clear only ITS reconciliation record (if one
  // existed); every other case's record is untouched, since the store is keyed per case id. Safe
  // regardless of which case is currently active (scoped by id, not a shared slot).
  clearCaseReconciliation(id);
  return { ok: true, intake: data.intake, caseVersion: data.case_version, timeline: data.timeline };
}

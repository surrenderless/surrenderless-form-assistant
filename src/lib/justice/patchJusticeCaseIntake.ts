import { isJusticeIntakePayload } from "@/lib/justice/caseApiValidation";
import { STORAGE_INTAKE, STORAGE_INTAKE_CASE_VERSION } from "@/lib/justice/types";
import type { JusticeIntake, TimelineEntry } from "@/lib/justice/types";
import { validate as isUuid } from "uuid";

/**
 * case_version paired with the intake snapshot this session last saw from the server, or null if
 * none is cached yet (fresh tab, cleared storage, or a flow that has never synced). Only ever set
 * alongside STORAGE_INTAKE by writeLocalIntakeCaseVersion — never read/written independently.
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
 * Callers must refresh BOTH content and version from the server (e.g. via
 * hydrateSessionFromCaseListRow) before retrying with a freshly-derived edit — never call this
 * again with the same stale `intake` after a missing_version result.
 *
 * On a genuine 409 conflict, this adopts the fresh server intake/version into session storage and
 * returns it for the caller to reconcile — it never retries the stale write itself.
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
    if (currentCaseVersion !== null) writeLocalIntakeCaseVersion(currentCaseVersion);
    if (typeof window !== "undefined" && conflictBody?.current?.intake !== undefined) {
      sessionStorage.setItem(STORAGE_INTAKE, JSON.stringify(conflictBody.current.intake));
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

  writeLocalIntakeCaseVersion(data.case_version);
  if (typeof window !== "undefined") {
    sessionStorage.setItem(STORAGE_INTAKE, JSON.stringify(data.intake));
  }
  return { ok: true, intake: data.intake, caseVersion: data.case_version, timeline: data.timeline };
}

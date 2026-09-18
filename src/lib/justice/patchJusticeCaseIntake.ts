import { isJusticeIntakePayload } from "@/lib/justice/caseApiValidation";
import { STORAGE_INTAKE, STORAGE_INTAKE_UPDATED_AT } from "@/lib/justice/types";
import type { JusticeIntake, TimelineEntry } from "@/lib/justice/types";
import { validate as isUuid } from "uuid";

/** Last known version of the active case's intake, or null if none is cached yet. */
export function readLocalIntakeUpdatedAt(): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem(STORAGE_INTAKE_UPDATED_AT);
}

export function writeLocalIntakeUpdatedAt(value: string | null): void {
  if (typeof window === "undefined") return;
  if (value) sessionStorage.setItem(STORAGE_INTAKE_UPDATED_AT, value);
  else sessionStorage.removeItem(STORAGE_INTAKE_UPDATED_AT);
}

export type PatchJusticeCaseIntakeResult =
  | { ok: true; intake: JusticeIntake; updatedAt: string; timeline?: unknown }
  | {
      ok: false;
      reason: "conflict" | "request_failed" | "invalid_response";
      error: string;
      current?: { intake: unknown; updatedAt: string | null };
    };

/**
 * PATCHes justice_cases.intake through real end-to-end optimistic concurrency: always sends
 * expected_updated_at from the last version this session actually saw (never a value read fresh
 * during this same call — if none is cached yet, one GET establishes it first, which can only
 * delay the write, never skip the check), and stores the new version returned on success for the
 * next write. On a genuine 409 conflict, updates the locally cached version/intake to the fresh
 * server state the response includes and returns it for the caller to reconcile — never retries
 * the same stale write itself.
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

  let expectedUpdatedAt = readLocalIntakeUpdatedAt();
  if (!expectedUpdatedAt) {
    // No cached version yet (fresh tab, cleared storage) — establish one before ever attempting
    // an unprotected write. This can only delay the write, never skip the precondition check.
    let getRes: Response;
    try {
      getRes = await fetch(`/api/justice/cases/${encodeURIComponent(id)}`, { signal: options.signal });
    } catch {
      return { ok: false, reason: "request_failed", error: "Could not load the current case." };
    }
    if (!getRes.ok) {
      return { ok: false, reason: "request_failed", error: "Could not load the current case." };
    }
    const fresh = (await getRes.json().catch(() => null)) as { updated_at?: string } | null;
    if (!fresh?.updated_at) {
      return { ok: false, reason: "request_failed", error: "Could not determine the current case version." };
    }
    expectedUpdatedAt = fresh.updated_at;
    writeLocalIntakeUpdatedAt(expectedUpdatedAt);
  }

  let res: Response;
  try {
    res = await fetch(`/api/justice/cases/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        intake,
        expected_updated_at: expectedUpdatedAt,
        ...(options.timeline ? { timeline: options.timeline } : {}),
      }),
      signal: options.signal,
    });
  } catch {
    return { ok: false, reason: "request_failed", error: "Could not save intake." };
  }

  if (res.status === 409) {
    const conflictBody = (await res.json().catch(() => null)) as
      | { error?: string; current?: { intake?: unknown; updated_at?: string } }
      | null;
    const currentUpdatedAt = conflictBody?.current?.updated_at ?? null;
    if (currentUpdatedAt) writeLocalIntakeUpdatedAt(currentUpdatedAt);
    if (typeof window !== "undefined" && conflictBody?.current?.intake !== undefined) {
      sessionStorage.setItem(STORAGE_INTAKE, JSON.stringify(conflictBody.current.intake));
    }
    return {
      ok: false,
      reason: "conflict",
      error: conflictBody?.error ?? "Case intake was updated concurrently. Reload and retry.",
      current: { intake: conflictBody?.current?.intake, updatedAt: currentUpdatedAt },
    };
  }

  if (!res.ok) {
    const errBody = (await res.json().catch(() => null)) as { error?: string } | null;
    return { ok: false, reason: "request_failed", error: errBody?.error ?? "Could not save intake." };
  }

  const data = (await res.json().catch(() => null)) as
    | { intake?: unknown; updated_at?: string; timeline?: unknown }
    | null;
  if (!data || !isJusticeIntakePayload(data.intake) || !data.updated_at) {
    return { ok: false, reason: "invalid_response", error: "Unexpected response saving intake." };
  }

  writeLocalIntakeUpdatedAt(data.updated_at);
  if (typeof window !== "undefined") {
    sessionStorage.setItem(STORAGE_INTAKE, JSON.stringify(data.intake));
  }
  return { ok: true, intake: data.intake, updatedAt: data.updated_at, timeline: data.timeline };
}

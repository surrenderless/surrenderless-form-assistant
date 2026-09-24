import { isJusticeIntakePayload } from "@/lib/justice/caseApiValidation";
import {
  clearCaseReconciliation,
  loadCaseReconciliationBanner,
  readCaseReconciliation,
  recordCaseConflict,
  type CaseReconciliationBanner,
} from "@/lib/justice/caseReconciliationStore";
import { hydrateSessionFromCaseListRow, type JusticeCaseListRow } from "@/lib/justice/hydrateActiveCaseFromServer";
import type { JusticeIntake } from "@/lib/justice/types";

/**
 * The testable reconciliation state machine chat-ai/page.tsx is built on top of. Every function
 * here is pure or takes its side-effecting dependencies (fetch, "what case is active right now")
 * as injected parameters, so the full lifecycle — mount, passive reload, case switch, missing-
 * version recovery — can be exercised directly in tests without React, jsdom, or a hand-rolled
 * page simulation. page.tsx's job is reduced to: hold `parts`/`pendingCaseReconciliation` as React
 * state, and call these functions at the right lifecycle points, applying their results verbatim.
 *
 * Central invariant enforced throughout: an async operation started for case A must never apply
 * ANY effect — global session pointers, React state, a DIFFERENT case's CAS token — once the
 * active case has changed to B by the time that operation resolves. Every function that awaits
 * something here re-verifies the active case AFTER the await, before doing anything with the
 * result.
 */

/** True when `current` differs from `baseline` in ANY field — the JusticeIntake analogue of
 * areBuildJusticeIntakePartsDirty, operating on the same flat, all-primitive-field shape that is
 * actually what gets persisted into a reconciliation record (so the controller never needs to
 * know about BuildJusticeIntakeParts at all). A null baseline is always dirty — never assume it
 * is safe to silently discard local state with nothing known-good to compare against. */
export function areJusticeIntakesDirty(baseline: JusticeIntake | null, current: JusticeIntake): boolean {
  if (!baseline) return true;
  const keys = new Set<keyof JusticeIntake>([
    ...(Object.keys(baseline) as (keyof JusticeIntake)[]),
    ...(Object.keys(current) as (keyof JusticeIntake)[]),
  ]);
  for (const key of keys) {
    if (baseline[key] !== current[key]) return true;
  }
  return false;
}

export type CaseActivationResult = {
  /** The content to display/edit for this case right now. Always defined: either the durable
   * draft from a pending/kept record, or `hydratedFromStorage` unchanged when there is no record. */
  localDraft: JusticeIntake;
  /** The baseline future dirty-checks (the passive reload effect) must compare against — the
   * record's own recorded SERVER snapshot when a record exists, never STORAGE_INTAKE and never
   * the local draft itself. This is what fixes "Keep -> refresh -> server advances again":
   * without this, the baseline would equal the kept draft (since STORAGE_INTAKE now holds it),
   * making every future dirty-check silently report "clean". */
  baseline: JusticeIntake;
  /** The banner to show, or null if nothing is pending (including when status is "kept" — that
   * choice has already been made; no banner, but the draft/baseline above still apply). */
  banner: CaseReconciliationBanner | null;
};

/**
 * Resolves what chat-ai/page.tsx should show for `caseId` becoming (or remaining) the active
 * case — used identically at mount and at every case switch, so there is exactly one code path
 * that can ever decide "is there unresolved/unconfirmed content for this case". `hydratedFromStorage`
 * is whatever was just loaded from STORAGE_INTAKE (mount) or the server (a fresh case-switch
 * hydrate) — used as the baseline/local draft ONLY when no durable record exists.
 */
export function resolveCaseActivation(
  caseId: string,
  hydratedFromStorage: JusticeIntake
): CaseActivationResult {
  const loaded = loadCaseReconciliationBanner(caseId);
  if (!loaded) {
    return { localDraft: hydratedFromStorage, baseline: hydratedFromStorage, banner: null };
  }
  // loadCaseReconciliationBanner only exposes serverIntake via the banner (status "pending"); for
  // a "kept" record (banner null) the baseline still needs the record's serverIntake, so read the
  // record directly rather than widening loadCaseReconciliationBanner's own, deliberately
  // narrower, "what should the UI show" contract.
  const record = readCaseReconciliation(caseId);
  return {
    localDraft: loaded.localDraft,
    baseline: record?.serverIntake ?? hydratedFromStorage,
    banner: loaded.banner,
  };
}

export type ReloadCheckResult =
  | { kind: "no-op" }
  | { kind: "conflict"; banner: CaseReconciliationBanner }
  | { kind: "synced"; freshIntake: JusticeIntake };

/**
 * The passive reload-reconciliation check: fetches the case fresh and, only if its case_version
 * has genuinely moved past what this tab cached, either records+reports a conflict (dirty) or
 * reports it is safe to silently adopt the fresh content (clean). Re-verifies the active case
 * AFTER the fetch resolves — a case switch while this was in flight makes the result a no-op,
 * never touching STORAGE_CASE_ID/STORAGE_INTAKE/case_version or any React state for a case that
 * is no longer on screen. `getCurrentDraft` and `baseline` are read AFTER that re-verification
 * too, for the freshest possible dirty-check (mirrors the partsRef.current pattern, generalized).
 */
export async function checkForServerReconciliation(params: {
  caseId: string;
  cachedVersion: number;
  fetchCaseById: (caseId: string) => Promise<JusticeCaseListRow | null>;
  getActiveCaseId: () => string | null;
  getCurrentDraft: () => JusticeIntake;
  getBaseline: () => JusticeIntake | null;
}): Promise<ReloadCheckResult> {
  const row = await params.fetchCaseById(params.caseId);
  if (!row) return { kind: "no-op" };
  if (row.id !== params.caseId) return { kind: "no-op" };
  if (params.getActiveCaseId() !== params.caseId) return { kind: "no-op" };

  const serverVersion = typeof row.case_version === "number" ? row.case_version : null;
  if (serverVersion === null || serverVersion === params.cachedVersion) return { kind: "no-op" };
  if (!isJusticeIntakePayload(row.intake)) return { kind: "no-op" };

  const currentDraft = params.getCurrentDraft();
  if (areJusticeIntakesDirty(params.getBaseline(), currentDraft)) {
    recordCaseConflict(params.caseId, "reload", currentDraft, row.intake, serverVersion);
    return {
      kind: "conflict",
      banner: { caseId: params.caseId, reason: "reload", serverIntake: row.intake, serverCaseVersion: serverVersion },
    };
  }

  clearCaseReconciliation(params.caseId);
  // Active case already re-verified above — safe to install fresh server content now.
  hydrateSessionFromCaseListRow(row);
  return { kind: "synced", freshIntake: row.intake };
}

export type MissingVersionRecoveryResult =
  | { ok: true; banner: CaseReconciliationBanner }
  | { ok: false; reason: "not_found" | "id_mismatch" | "invalid_response" };

/**
 * THE single, centralized recovery path for patchJusticeCaseIntake's "missing_version" result —
 * every caller (chat-ai/page.tsx's direct save actions, commitIntakeToSessionAndServer.ts,
 * documentMerchantContact.ts) must route through this, never re-fetch-and-hydrate ad hoc. Always
 * returns a ready-to-install banner on success, so no caller can "forget" to surface it — there is
 * no other shape a caller could receive and legitimately ignore.
 *
 * Validates the fetched row's id exactly matches the requested `caseId` (never trusts a server
 * response for the wrong case). Durably records the conflict (localDraft + real server snapshot)
 * unconditionally — that record is safe to write regardless of which case is active by the time
 * this resolves, since it is scoped to `caseId` and will simply surface next time that case
 * becomes active. Installing the fetched content into the GLOBAL STORAGE_CASE_ID/STORAGE_INTAKE/
 * case_version pointers is gated on the active case STILL being `caseId` at that point — this is
 * what stops an in-flight recovery for case A from silently reverting the active-case pointer
 * back to A after the user has already switched to case B.
 */
export async function recoverFromMissingVersion(
  caseId: string,
  localDraft: JusticeIntake,
  deps: {
    fetchCaseById: (caseId: string, signal?: AbortSignal) => Promise<JusticeCaseListRow | null>;
    getActiveCaseId: () => string | null;
    signal?: AbortSignal;
  }
): Promise<MissingVersionRecoveryResult> {
  const row = await deps.fetchCaseById(caseId, deps.signal);
  if (!row) return { ok: false, reason: "not_found" };
  if (row.id !== caseId) return { ok: false, reason: "id_mismatch" };
  if (!isJusticeIntakePayload(row.intake) || typeof row.case_version !== "number") {
    return { ok: false, reason: "invalid_response" };
  }

  recordCaseConflict(caseId, "missing_version", localDraft, row.intake, row.case_version);

  if (deps.getActiveCaseId() === caseId) {
    hydrateSessionFromCaseListRow(row);
  }

  return {
    ok: true,
    banner: { caseId, reason: "missing_version", serverIntake: row.intake, serverCaseVersion: row.case_version },
  };
}

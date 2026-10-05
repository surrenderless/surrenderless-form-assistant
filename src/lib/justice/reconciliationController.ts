import { isJusticeIntakePayload } from "@/lib/justice/caseApiValidation";
import {
  clearCaseReconciliation,
  loadCaseReconciliationBanner,
  readCaseReconciliation,
  recordCaseConflict,
  type CaseReconciliationBanner,
} from "@/lib/justice/caseReconciliationStore";
import {
  hydrateSessionFromCaseListRow,
  type JusticeCaseLookupResult,
} from "@/lib/justice/hydrateActiveCaseFromServer";
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
  | { kind: "not-found" }
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
 *
 * A CONFIRMED not-found/not-owned result (the server's 404, not a transient failure) is reported
 * distinctly as `{ kind: "not-found" }` rather than folded into `"no-op"` — this is what lets a
 * caller tell "the cached case genuinely isn't this account's, clear it" apart from "the request
 * failed, leave recoverable local work alone". Still gated on the active case still being this
 * one, so a stale in-flight lookup for a case the user has already switched away from can never
 * clear the NEW active case's state.
 */
export async function checkForServerReconciliation(params: {
  caseId: string;
  cachedVersion: number;
  lookupCaseById: (caseId: string) => Promise<JusticeCaseLookupResult>;
  getActiveCaseId: () => string | null;
  getCurrentDraft: () => JusticeIntake;
  getBaseline: () => JusticeIntake | null;
}): Promise<ReloadCheckResult> {
  const result = await params.lookupCaseById(params.caseId);
  if (!result.ok) {
    if (result.notFound && params.getActiveCaseId() === params.caseId) {
      return { kind: "not-found" };
    }
    return { kind: "no-op" };
  }
  const row = result.row;
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

export type InitialCaseValidationResult =
  | { kind: "confirmed" }
  | { kind: "not-found" }
  | { kind: "retry" }
  | { kind: "stale" };

/**
 * Authoritatively validates a cached case against the CURRENTLY signed-in user before a caller
 * is allowed to hydrate/render any of its content, on initial page load — the fix for the stale
 * cross-account Justice session disclosure. Unlike checkForServerReconciliation (which only ever
 * runs when a case_version happens to already be cached, to detect server-side drift on an
 * ALREADY-trusted case) and unlike the identity-change marker (a fast, best-effort pre-emptive
 * clear that a broken/older deployment can leave in an incorrect "already matches" state for a
 * tab that predates it), this function must be called for EVERY cached case on initial load,
 * unconditionally — no case_version gate, no identity-marker shortcut. Those two mechanisms are
 * both best-effort optimizations; this is the one authoritative check a caller may rely on.
 *
 * `{ kind: "confirmed" }` — the server confirms the current user owns this exact case id. The
 * caller's ALREADY-cached local intake (never the fetched row's content) is safe to hydrate: the
 * local draft may contain newer edits than the server, and ownership — not content — is all this
 * check establishes.
 * `{ kind: "not-found" }` — a CONFIRMED 404 (not owned / doesn't exist). The caller must clear the
 * entire local Justice session and reset to a clean state. Never render the cached content first.
 * `{ kind: "retry" }` — a transient failure (network error, abort, non-404 non-ok status). The
 * caller must neither hydrate NOR clear: preserve the cache, surface a neutral retry state.
 * `{ kind: "stale" }` — the active case changed while this check was in flight (a case switch, or
 * a fresh intake commit). This specific result no longer applies to anything on screen — the
 * caller must never clear or install anything directly from it — but it must not be treated as
 * "nothing left to do" either: see resolveInitialCaseValidationAction, which turns this into a
 * re-validation of whatever IS active now, so a caller can never get stuck waiting on a result
 * that will never arrive for the case actually on screen.
 */
export async function validateInitialCachedCase(params: {
  caseId: string;
  lookupCaseById: (caseId: string) => Promise<JusticeCaseLookupResult>;
  getActiveCaseId: () => string | null;
}): Promise<InitialCaseValidationResult> {
  const result = await params.lookupCaseById(params.caseId);
  if (params.getActiveCaseId() !== params.caseId) return { kind: "stale" };

  if (result.ok && result.row.id === params.caseId) {
    return { kind: "confirmed" };
  }
  if (!result.ok && result.notFound) {
    return { kind: "not-found" };
  }
  // Covers both a genuinely transient failure (notFound: false) and the defensive case of a 200
  // whose row id doesn't match what was requested — neither is a confirmed result, so neither may
  // be trusted or treated as a confirmed negative.
  return { kind: "retry" };
}

/**
 * Whether a cached case id/intake pair is even something that needs the authoritative check
 * above — pure and parameterized so the caller's `useState` initializer can hold a FIXED value
 * identical on the server and on the client's own hydration pass (the fix for a real server/
 * client hydration mismatch: reading sessionStorage inside a useState initializer returns a
 * different value on the client's hydration render than on the server, since `window` exists
 * synchronously there before any effect runs). This must only ever be called from inside an
 * effect — never from a render-time initializer — so whether there is something to validate is
 * always determined strictly after hydration, never during it.
 */
export function hasValidatableCachedCase(
  caseId: string | null | undefined,
  intake: JusticeIntake | null,
  isUuid: (value: string) => boolean
): boolean {
  const trimmed = caseId?.trim() ?? "";
  return Boolean(intake) && Boolean(trimmed) && isUuid(trimmed);
}

/**
 * Whether initial case validation may even start yet. Starting the authoritative lookup before
 * Clerk's client session is ready risks an unauthenticated request — the server would 401, which
 * collapses into the same "retry" bucket as a genuine transient failure, stranding the user on a
 * manual-retry screen for a problem that isn't real and will resolve itself the moment sign-in
 * finishes. The caller must put both isLoaded and isSignedIn in the effect's dependency array so
 * validation is automatically (re)triggered the moment either becomes true, rather than only ever
 * running once up front.
 */
export function shouldStartInitialCaseValidation(params: {
  isLoaded: boolean;
  isSignedIn: boolean;
}): boolean {
  return params.isLoaded && params.isSignedIn;
}

export type InitialCaseValidationAction =
  | { action: "hydrate" }
  | { action: "clear-and-reset" }
  | { action: "show-retry" }
  | { action: "revalidate" };

/**
 * Turns a validateInitialCachedCase result (plus a freshness re-check performed strictly AFTER
 * the lookup resolves) into exactly what the caller must do next. This is the liveness fix: a
 * caller that treated "stale" as "nothing left to do" would leave its own pending/loading state
 * stuck forever once the originally-requested case stopped being the active one, since nothing
 * else would ever resolve or re-trigger it. Both "stale" (the active case itself changed) and a
 * "confirmed" result that no longer has fresh intake to hydrate, or is no longer for the active
 * case by the time this runs (e.g. a concurrent write, or a switch that raced the re-check inside
 * validateInitialCachedCase itself), resolve to the SAME "revalidate" action — re-running
 * validation from scratch always converges on whatever case is actually active, never leaves the
 * caller waiting on a result that can never arrive for it.
 */
export function resolveInitialCaseValidationAction(
  result: InitialCaseValidationResult,
  freshness: { hasFreshIntake: boolean; stillActive: boolean }
): InitialCaseValidationAction {
  switch (result.kind) {
    case "stale":
      return { action: "revalidate" };
    case "confirmed":
      return freshness.hasFreshIntake && freshness.stillActive
        ? { action: "hydrate" }
        : { action: "revalidate" };
    case "not-found":
      return { action: "clear-and-reset" };
    case "retry":
      return { action: "show-retry" };
  }
}

export type MissingVersionRecoveryResult =
  | { ok: true; banner: CaseReconciliationBanner }
  | { ok: false; reason: "not_found" | "id_mismatch" | "invalid_response" | "transient" };

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
 *
 * `reason: "not_found"` means the server CONFIRMED this case doesn't exist / isn't this account's
 * (a 404) -- distinct from `reason: "transient"` (network error, abort, or any other non-404
 * failure), so a caller can clear cached case state only on the former, never the latter.
 */
export async function recoverFromMissingVersion(
  caseId: string,
  localDraft: JusticeIntake,
  deps: {
    lookupCaseById: (caseId: string, signal?: AbortSignal) => Promise<JusticeCaseLookupResult>;
    getActiveCaseId: () => string | null;
    signal?: AbortSignal;
  }
): Promise<MissingVersionRecoveryResult> {
  const result = await deps.lookupCaseById(caseId, deps.signal);
  if (!result.ok) return { ok: false, reason: result.notFound ? "not_found" : "transient" };
  const row = result.row;
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

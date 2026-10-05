import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { validate as isUuid } from "uuid";
import {
  areJusticeIntakesDirty,
  checkForServerReconciliation,
  hasValidatableCachedCase,
  recoverFromMissingVersion,
  resolveCaseActivation,
  resolveInitialCaseValidationAction,
  shouldStartInitialCaseValidation,
  validateInitialCachedCase,
} from "@/lib/justice/reconciliationController";
import {
  commitKeepMyChanges,
  readCaseReconciliation,
  recordCaseConflict,
} from "@/lib/justice/caseReconciliationStore";
import { hydrateSessionFromCaseListRow, type JusticeCaseListRow } from "@/lib/justice/hydrateActiveCaseFromServer";
import { readLocalIntakeCaseVersion } from "@/lib/justice/intakeCaseVersionStorage";
import { STORAGE_CASE_ID, STORAGE_INTAKE } from "@/lib/justice/types";
import type { JusticeIntake } from "@/lib/justice/types";

/**
 * Direct, executable tests against the real reconciliationController.ts functions — the testable
 * state machine chat-ai/page.tsx is built on top of. No hand-rolled page simulation: every
 * scenario here calls the exact exported function page.tsx calls, with injected fetch/active-case
 * dependencies standing in for the real browser environment.
 */

const CASE_A = "550e8400-e29b-41d4-a716-446655440000";
const CASE_B = "550e8400-e29b-41d4-a716-446655440001";

function intake(overrides: Partial<JusticeIntake> = {}): JusticeIntake {
  return {
    company_name: "Acme",
    company_website: "",
    problem_category: "online_purchase",
    story: "Charged twice",
    money_involved: "$50",
    pay_or_order_date: "2026-01-01",
    order_confirmation_details: "",
    user_display_name: "User",
    reply_email: "user@example.com",
    purchase_or_signup: "Widget",
    already_contacted: "no",
    ...overrides,
  };
}

function stubSessionStorage() {
  const store: Record<string, string> = {};
  const sessionStorage = {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      for (const key of Object.keys(store)) delete store[key];
    },
  };
  vi.stubGlobal("sessionStorage", sessionStorage);
  vi.stubGlobal("window", { sessionStorage });
  return sessionStorage;
}

describe("areJusticeIntakesDirty", () => {
  it("a null baseline is always dirty — never assume it's safe to silently discard local state", () => {
    expect(areJusticeIntakesDirty(null, intake())).toBe(true);
  });

  it("is false when every field matches", () => {
    expect(areJusticeIntakesDirty(intake(), intake())).toBe(false);
  });

  it("is true when any single field differs", () => {
    expect(areJusticeIntakesDirty(intake(), intake({ story: "different" }))).toBe(true);
  });
});

describe("resolveCaseActivation", () => {
  beforeEach(() => {
    stubSessionStorage();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("with no durable record, passes hydratedFromStorage through unchanged as both draft and baseline, with no banner", () => {
    const hydrated = intake({ story: "fresh from server" });
    const result = resolveCaseActivation(CASE_A, hydrated);
    expect(result).toEqual({ localDraft: hydrated, baseline: hydrated, banner: null });
  });

  it("BLOCKING FIX (round 4, item 1): with a PENDING record, the baseline is the record's OWN recorded server snapshot — never hydratedFromStorage/STORAGE_INTAKE — and the banner is installed", () => {
    recordCaseConflict(CASE_A, "conflict", intake({ story: "unresolved local draft" }), intake({ story: "true server snapshot at conflict time" }), 5);
    // hydratedFromStorage here stands in for whatever STORAGE_INTAKE happens to hold right now —
    // deliberately DIFFERENT from both the draft and the recorded server snapshot, to prove neither
    // is silently substituted.
    const hydratedFromStorage = intake({ story: "unrelated stale STORAGE_INTAKE content" });
    const result = resolveCaseActivation(CASE_A, hydratedFromStorage);
    expect(result.localDraft).toEqual(intake({ story: "unresolved local draft" }));
    expect(result.baseline).toEqual(intake({ story: "true server snapshot at conflict time" }));
    expect(result.banner).toEqual({
      caseId: CASE_A,
      reason: "conflict",
      serverIntake: intake({ story: "true server snapshot at conflict time" }),
      serverCaseVersion: 5,
    });
  });

  it("BLOCKING FIX (round 4, item 1): with a KEPT record (banner already resolved), the baseline is STILL the record's recorded server snapshot, not the kept draft — this is what makes a later 'server advances again' correctly detected as dirty instead of misclassified as clean", () => {
    recordCaseConflict(CASE_A, "conflict", intake({ story: "old draft" }), intake({ story: "server snapshot at conflict time" }), 5);
    const kept = commitKeepMyChanges(CASE_A, intake({ story: "kept draft" }));
    expect(kept).toEqual({ serverCaseVersion: 5 });

    const result = resolveCaseActivation(CASE_A, intake({ story: "kept draft" }));
    expect(result.banner).toBeNull();
    expect(result.localDraft).toEqual(intake({ story: "kept draft" }));
    // NOT the kept draft — the ORIGINAL recorded server snapshot from conflict time.
    expect(result.baseline).toEqual(intake({ story: "server snapshot at conflict time" }));
  });
});

describe("checkForServerReconciliation", () => {
  beforeEach(() => {
    stubSessionStorage();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function row(overrides: Partial<JusticeCaseListRow> = {}): JusticeCaseListRow {
    return { id: CASE_A, intake: intake(), case_version: 2, ...overrides };
  }

  function okLookup(r: JusticeCaseListRow) {
    return vi.fn().mockResolvedValue({ ok: true, row: r });
  }

  it("BLOCKING FIX (round 4, item 1): Keep -> refresh -> server advances AGAIN — the second reload check correctly reports a NEW conflict (dirty against the ORIGINAL recorded server snapshot), never silently syncing the kept draft as though it matched", async () => {
    // Case A: an earlier conflict was recorded and then Keep was chosen.
    recordCaseConflict(CASE_A, "conflict", intake({ story: "pre-keep draft" }), intake({ story: "server v2" }), 2);
    commitKeepMyChanges(CASE_A, intake({ story: "kept draft" }));
    sessionStorage.setItem(STORAGE_CASE_ID, CASE_A);

    // Simulate a refresh: page.tsx re-derives baseline/draft via resolveCaseActivation.
    const activation = resolveCaseActivation(CASE_A, intake({ story: "kept draft" }));
    expect(activation.baseline).toEqual(intake({ story: "server v2" })); // NOT the kept draft

    // Now the server has advanced AGAIN, to v3, while the user's kept draft is still just sitting
    // there unsaved.
    const lookupCaseById = okLookup(row({ intake: intake({ story: "server v3" }), case_version: 3 }));
    const result = await checkForServerReconciliation({
      caseId: CASE_A,
      cachedVersion: 2,
      lookupCaseById,
      getActiveCaseId: () => sessionStorage.getItem(STORAGE_CASE_ID),
      getCurrentDraft: () => intake({ story: "kept draft" }),
      getBaseline: () => activation.baseline,
    });

    expect(result).toEqual({
      kind: "conflict",
      banner: { caseId: CASE_A, reason: "reload", serverIntake: intake({ story: "server v3" }), serverCaseVersion: 3 },
    });
    // A NEW conflict record now exists, re-opening the choice rather than silently discarding it.
    const record = readCaseReconciliation(CASE_A);
    expect(record?.status).toBe("pending");
    expect(record?.localDraft).toEqual(intake({ story: "kept draft" }));
    expect(record?.serverCaseVersion).toBe(3);
  });

  it("a CLEAN draft (matches the baseline exactly — no unsaved edits) is safely synced: clears any record and installs the fresh server content", async () => {
    sessionStorage.setItem(STORAGE_CASE_ID, CASE_A);
    const lookupCaseById = okLookup(row({ intake: intake({ story: "server v2" }), case_version: 2 }));
    const result = await checkForServerReconciliation({
      caseId: CASE_A,
      cachedVersion: 1,
      lookupCaseById,
      getActiveCaseId: () => sessionStorage.getItem(STORAGE_CASE_ID),
      getCurrentDraft: () => intake({ story: "baseline" }),
      getBaseline: () => intake({ story: "baseline" }),
    });
    expect(result).toEqual({ kind: "synced", freshIntake: intake({ story: "server v2" }) });
    expect(readCaseReconciliation(CASE_A)).toBeNull();
    expect(JSON.parse(sessionStorage.getItem(STORAGE_INTAKE) ?? "null")).toEqual(intake({ story: "server v2" }));
    expect(readLocalIntakeCaseVersion()).toBe(2);
  });

  it("BLOCKING FIX (round 4, item 8): is a no-op (never applies any effect) when the active case has switched away by the time the fetch resolves — an A request resolving after switching to B must never touch STORAGE_CASE_ID/STORAGE_INTAKE/React state/B's CAS token", async () => {
    sessionStorage.setItem(STORAGE_CASE_ID, CASE_A);
    sessionStorage.setItem(STORAGE_INTAKE, JSON.stringify(intake({ story: "B's own content" })));
    let getActiveCaseIdCalls = 0;
    const lookupCaseById = vi.fn().mockImplementation(async () => {
      // By the time this resolves, the user has switched to case B.
      sessionStorage.setItem(STORAGE_CASE_ID, CASE_B);
      return { ok: true, row: row({ intake: intake({ story: "server v2 for A" }), case_version: 2 }) };
    });
    const result = await checkForServerReconciliation({
      caseId: CASE_A,
      cachedVersion: 1,
      lookupCaseById,
      getActiveCaseId: () => {
        getActiveCaseIdCalls++;
        return sessionStorage.getItem(STORAGE_CASE_ID);
      },
      getCurrentDraft: () => intake(),
      getBaseline: () => intake(),
    });
    expect(result).toEqual({ kind: "no-op" });
    expect(getActiveCaseIdCalls).toBeGreaterThan(0);
    // B's STORAGE_INTAKE (and by extension its CAS token / React state, which page.tsx derives
    // from the same source) is completely untouched by A's late-resolving request.
    expect(JSON.parse(sessionStorage.getItem(STORAGE_INTAKE) ?? "null")).toEqual(intake({ story: "B's own content" }));
    expect(sessionStorage.getItem(STORAGE_CASE_ID)).toBe(CASE_B);
    expect(readCaseReconciliation(CASE_A)).toBeNull();
  });

  it("REGRESSION (stale cross-account case disclosure): reports 'not-found' on a CONFIRMED 404 while this case is still active — this is what a caller uses to clear stale cached case/intake/parts state", async () => {
    sessionStorage.setItem(STORAGE_CASE_ID, CASE_A);
    const result = await checkForServerReconciliation({
      caseId: CASE_A,
      cachedVersion: 1,
      lookupCaseById: vi.fn().mockResolvedValue({ ok: false, notFound: true }),
      getActiveCaseId: () => sessionStorage.getItem(STORAGE_CASE_ID),
      getCurrentDraft: () => intake(),
      getBaseline: () => intake(),
    });
    expect(result).toEqual({ kind: "not-found" });
  });

  it("REGRESSION: a TRANSIENT failure (network/5xx) is reported as 'no-op', never 'not-found' — recoverable local work must never be erased on a failure that proves nothing about ownership", async () => {
    sessionStorage.setItem(STORAGE_CASE_ID, CASE_A);
    const result = await checkForServerReconciliation({
      caseId: CASE_A,
      cachedVersion: 1,
      lookupCaseById: vi.fn().mockResolvedValue({ ok: false, notFound: false }),
      getActiveCaseId: () => sessionStorage.getItem(STORAGE_CASE_ID),
      getCurrentDraft: () => intake(),
      getBaseline: () => intake(),
    });
    expect(result).toEqual({ kind: "no-op" });
  });

  it("a CONFIRMED 404 for a case the user has already switched away from is still a no-op, never 'not-found' — a late-resolving lookup for A must not clear B's state just because A is gone", async () => {
    sessionStorage.setItem(STORAGE_CASE_ID, CASE_B);
    const result = await checkForServerReconciliation({
      caseId: CASE_A,
      cachedVersion: 1,
      lookupCaseById: vi.fn().mockResolvedValue({ ok: false, notFound: true }),
      getActiveCaseId: () => sessionStorage.getItem(STORAGE_CASE_ID),
      getCurrentDraft: () => intake(),
      getBaseline: () => intake(),
    });
    expect(result).toEqual({ kind: "no-op" });
  });

  it("BLOCKING FIX (round 4, item 7): is a no-op when the fetched row's id does not exactly match the requested case — never records or installs anything from a mismatched response", async () => {
    sessionStorage.setItem(STORAGE_CASE_ID, CASE_A);
    const result = await checkForServerReconciliation({
      caseId: CASE_A,
      cachedVersion: 1,
      lookupCaseById: okLookup(row({ id: CASE_B, case_version: 2 })),
      getActiveCaseId: () => sessionStorage.getItem(STORAGE_CASE_ID),
      getCurrentDraft: () => intake(),
      getBaseline: () => intake(),
    });
    expect(result).toEqual({ kind: "no-op" });
    expect(readCaseReconciliation(CASE_A)).toBeNull();
  });

  it("is a no-op when the server's case_version has not actually moved past the cached version", async () => {
    sessionStorage.setItem(STORAGE_CASE_ID, CASE_A);
    const result = await checkForServerReconciliation({
      caseId: CASE_A,
      cachedVersion: 2,
      lookupCaseById: okLookup(row({ case_version: 2 })),
      getActiveCaseId: () => sessionStorage.getItem(STORAGE_CASE_ID),
      getCurrentDraft: () => intake(),
      getBaseline: () => intake(),
    });
    expect(result).toEqual({ kind: "no-op" });
  });
});

describe("recoverFromMissingVersion", () => {
  beforeEach(() => {
    stubSessionStorage();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("BLOCKING FIX (round 4, item 3): centralizes missing_version recovery — records the durable reconciliation and returns an install-ready banner every caller receives identically", async () => {
    sessionStorage.setItem(STORAGE_CASE_ID, CASE_A);
    const localDraft = intake({ story: "draft that hit missing_version" });
    const lookupCaseById = vi
      .fn()
      .mockResolvedValue({ ok: true, row: { id: CASE_A, intake: intake({ story: "server" }), case_version: 6 } });
    const result = await recoverFromMissingVersion(CASE_A, localDraft, {
      lookupCaseById,
      getActiveCaseId: () => sessionStorage.getItem(STORAGE_CASE_ID),
    });
    expect(result).toEqual({
      ok: true,
      banner: { caseId: CASE_A, reason: "missing_version", serverIntake: intake({ story: "server" }), serverCaseVersion: 6 },
    });
    expect(readCaseReconciliation(CASE_A)?.localDraft).toEqual(localDraft);
  });

  it("BLOCKING FIX (round 4, item 7): fails closed as id_mismatch when the fetched row's id does not exactly match the requested case — never installs or records under the wrong assumption", async () => {
    const lookupCaseById = vi.fn().mockResolvedValue({ ok: true, row: { id: CASE_B, intake: intake(), case_version: 3 } });
    const result = await recoverFromMissingVersion(CASE_A, intake(), {
      lookupCaseById,
      getActiveCaseId: () => CASE_A,
    });
    expect(result).toEqual({ ok: false, reason: "id_mismatch" });
    expect(readCaseReconciliation(CASE_A)).toBeNull();
  });

  it("fails closed as not_found on a CONFIRMED 404", async () => {
    const result = await recoverFromMissingVersion(CASE_A, intake(), {
      lookupCaseById: vi.fn().mockResolvedValue({ ok: false, notFound: true }),
      getActiveCaseId: () => CASE_A,
    });
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("REGRESSION: reports 'transient' (never 'not_found') on a transient failure — a server error must never be treated as a confirmed ownership negative", async () => {
    const result = await recoverFromMissingVersion(CASE_A, intake(), {
      lookupCaseById: vi.fn().mockResolvedValue({ ok: false, notFound: false }),
      getActiveCaseId: () => CASE_A,
    });
    expect(result).toEqual({ ok: false, reason: "transient" });
  });

  it("fails closed as invalid_response when the fetched row's intake/case_version don't validate", async () => {
    const lookupCaseById = vi
      .fn()
      .mockResolvedValue({ ok: true, row: { id: CASE_A, intake: { not: "a valid intake" }, case_version: 3 } });
    const result = await recoverFromMissingVersion(CASE_A, intake(), {
      lookupCaseById,
      getActiveCaseId: () => CASE_A,
    });
    expect(result).toEqual({ ok: false, reason: "invalid_response" });
    expect(readCaseReconciliation(CASE_A)).toBeNull();
  });

  it("BLOCKING FIX (round 4, item 8): resolving after the active case has switched to B still durably records A's reconciliation, but never installs the fetched snapshot into the now-B-owned STORAGE_INTAKE/STORAGE_CASE_ID", async () => {
    sessionStorage.setItem(STORAGE_CASE_ID, CASE_A);
    sessionStorage.setItem(STORAGE_INTAKE, JSON.stringify(intake({ story: "A's own content before the switch" })));
    const lookupCaseById = vi.fn().mockImplementation(async () => {
      sessionStorage.setItem(STORAGE_CASE_ID, CASE_B);
      sessionStorage.setItem(STORAGE_INTAKE, JSON.stringify(intake({ story: "B's own content after the switch" })));
      return { ok: true, row: { id: CASE_A, intake: intake({ story: "server content for A" }), case_version: 4 } };
    });
    const result = await recoverFromMissingVersion(CASE_A, intake({ story: "A's draft" }), {
      lookupCaseById,
      getActiveCaseId: () => sessionStorage.getItem(STORAGE_CASE_ID),
    });
    expect(result.ok).toBe(true);
    expect(readCaseReconciliation(CASE_A)?.serverIntake).toEqual(intake({ story: "server content for A" }));
    // B's session pointers are completely untouched by A's late-resolving recovery.
    expect(sessionStorage.getItem(STORAGE_CASE_ID)).toBe(CASE_B);
    expect(JSON.parse(sessionStorage.getItem(STORAGE_INTAKE) ?? "null")).toEqual(
      intake({ story: "B's own content after the switch" })
    );
  });
});

describe("hydrateSessionFromCaseListRow sanity (used internally by checkForServerReconciliation/recoverFromMissingVersion on their clean/active paths)", () => {
  beforeEach(() => {
    stubSessionStorage();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("installs intake and case_version into session storage", () => {
    const result = hydrateSessionFromCaseListRow({ id: CASE_A, intake: intake({ story: "hydrated" }), case_version: 7 });
    expect(result).toEqual(intake({ story: "hydrated" }));
    expect(readLocalIntakeCaseVersion()).toBe(7);
  });
});

describe("validateInitialCachedCase — the fix for the stale cross-account Justice session disclosure", () => {
  beforeEach(() => {
    stubSessionStorage();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("REGRESSION (exact Production failure): a stale cached case with NO cached case_version, whose identity marker was already incorrectly set to the current user by the broken deployment, is still authoritatively checked against the server and cleared on a confirmed 404", async () => {
    // This models the exact reported incident: STORAGE_CASE_ID/STORAGE_INTAKE cached before the
    // identity-change fix ever existed, no case_version ever cached for it, and
    // STORAGE_LAST_KNOWN_CLERK_USER_ID already written to the CURRENT user by the broken
    // deployment's own (buggy) first-write. None of that may ever be consulted by this function —
    // it has no case_version parameter and no identity-marker parameter at all; it exists
    // precisely because those two signals are not trustworthy enough on their own.
    sessionStorage.setItem(STORAGE_CASE_ID, CASE_A);
    const lookupCaseById = vi.fn().mockResolvedValue({ ok: false, notFound: true });

    const result = await validateInitialCachedCase({
      caseId: CASE_A,
      lookupCaseById,
      getActiveCaseId: () => sessionStorage.getItem(STORAGE_CASE_ID),
    });

    expect(result).toEqual({ kind: "not-found" });
    expect(lookupCaseById).toHaveBeenCalledWith(CASE_A);
  });

  it("confirms ownership and returns 'confirmed' on a legitimate 200 for the current user", async () => {
    sessionStorage.setItem(STORAGE_CASE_ID, CASE_A);
    const result = await validateInitialCachedCase({
      caseId: CASE_A,
      lookupCaseById: vi.fn().mockResolvedValue({ ok: true, row: { id: CASE_A, intake: intake(), case_version: 3 } }),
      getActiveCaseId: () => sessionStorage.getItem(STORAGE_CASE_ID),
    });
    expect(result).toEqual({ kind: "confirmed" });
  });

  it("reports 'not-found' on a confirmed 404 while this case is still the active one", async () => {
    sessionStorage.setItem(STORAGE_CASE_ID, CASE_A);
    const result = await validateInitialCachedCase({
      caseId: CASE_A,
      lookupCaseById: vi.fn().mockResolvedValue({ ok: false, notFound: true }),
      getActiveCaseId: () => sessionStorage.getItem(STORAGE_CASE_ID),
    });
    expect(result).toEqual({ kind: "not-found" });
  });

  it("REGRESSION: a transient failure (network/5xx) reports 'retry', never 'not-found' — recoverable local work must never be erased on a failure that proves nothing about ownership", async () => {
    sessionStorage.setItem(STORAGE_CASE_ID, CASE_A);
    const result = await validateInitialCachedCase({
      caseId: CASE_A,
      lookupCaseById: vi.fn().mockResolvedValue({ ok: false, notFound: false }),
      getActiveCaseId: () => sessionStorage.getItem(STORAGE_CASE_ID),
    });
    expect(result).toEqual({ kind: "retry" });
  });

  it("REGRESSION: a defensive id-mismatch on an otherwise-ok response is treated as 'retry' (never trusted, never a confirmed negative) rather than 'confirmed'", async () => {
    sessionStorage.setItem(STORAGE_CASE_ID, CASE_A);
    const result = await validateInitialCachedCase({
      caseId: CASE_A,
      lookupCaseById: vi.fn().mockResolvedValue({ ok: true, row: { id: CASE_B, intake: intake(), case_version: 1 } }),
      getActiveCaseId: () => sessionStorage.getItem(STORAGE_CASE_ID),
    });
    expect(result).toEqual({ kind: "retry" });
  });

  it("REGRESSION (case-switch race): reports 'stale' when the active case has changed by the time the lookup resolves — a late response for A must never clear or install anything once the user has switched to B", async () => {
    sessionStorage.setItem(STORAGE_CASE_ID, CASE_A);
    const lookupCaseById = vi.fn().mockImplementation(async () => {
      // By the time this resolves, the user has switched to case B.
      sessionStorage.setItem(STORAGE_CASE_ID, CASE_B);
      return { ok: false, notFound: true };
    });
    const result = await validateInitialCachedCase({
      caseId: CASE_A,
      lookupCaseById,
      getActiveCaseId: () => sessionStorage.getItem(STORAGE_CASE_ID),
    });
    expect(result).toEqual({ kind: "stale" });
    // B's session pointer is untouched by A's late-resolving validation.
    expect(sessionStorage.getItem(STORAGE_CASE_ID)).toBe(CASE_B);
  });

  it("REGRESSION (case-switch race): a late CONFIRMED-OWNED response for A is still reported 'stale' once B is active — ownership of A proves nothing about what should be on screen now", async () => {
    sessionStorage.setItem(STORAGE_CASE_ID, CASE_A);
    const lookupCaseById = vi.fn().mockImplementation(async () => {
      sessionStorage.setItem(STORAGE_CASE_ID, CASE_B);
      return { ok: true, row: { id: CASE_A, intake: intake(), case_version: 5 } };
    });
    const result = await validateInitialCachedCase({
      caseId: CASE_A,
      lookupCaseById,
      getActiveCaseId: () => sessionStorage.getItem(STORAGE_CASE_ID),
    });
    expect(result).toEqual({ kind: "stale" });
  });
});

describe("hasValidatableCachedCase — SSR/hydration correction: the decision of whether to validate must live in an effect, never a useState initializer", () => {
  it("is true for a valid UUID case id with non-null intake", () => {
    expect(hasValidatableCachedCase(CASE_A, intake(), isUuid)).toBe(true);
  });

  it("is false when there is no intake", () => {
    expect(hasValidatableCachedCase(CASE_A, null, isUuid)).toBe(false);
  });

  it("is false when the case id is not a valid UUID", () => {
    expect(hasValidatableCachedCase("not-a-uuid", intake(), isUuid)).toBe(false);
  });

  it("is false when the case id is null/undefined/empty", () => {
    expect(hasValidatableCachedCase(null, intake(), isUuid)).toBe(false);
    expect(hasValidatableCachedCase(undefined, intake(), isUuid)).toBe(false);
    expect(hasValidatableCachedCase("", intake(), isUuid)).toBe(false);
    expect(hasValidatableCachedCase("   ", intake(), isUuid)).toBe(false);
  });

  it("is deterministic regardless of surrounding whitespace in the case id", () => {
    expect(hasValidatableCachedCase(`  ${CASE_A}  `, intake(), isUuid)).toBe(true);
  });
});

describe("shouldStartInitialCaseValidation — Clerk readiness: never start the authoritative lookup before the client session is actually ready", () => {
  it("is false while Clerk has not finished loading, even if already (optimistically) signed in", () => {
    expect(shouldStartInitialCaseValidation({ isLoaded: false, isSignedIn: true })).toBe(false);
  });

  it("is false once loaded but not signed in", () => {
    expect(shouldStartInitialCaseValidation({ isLoaded: true, isSignedIn: false })).toBe(false);
  });

  it("is false while both are still unresolved", () => {
    expect(shouldStartInitialCaseValidation({ isLoaded: false, isSignedIn: false })).toBe(false);
  });

  it("REGRESSION: is true only once BOTH isLoaded and isSignedIn are true — this is what makes signing in automatically (re)trigger validation instead of leaving an early unauthenticated attempt stuck in manual-retry", () => {
    expect(shouldStartInitialCaseValidation({ isLoaded: true, isSignedIn: true })).toBe(true);
  });
});

describe("resolveInitialCaseValidationAction — liveness: a 'stale' or now-stale-by-the-time-it-resolves 'confirmed' result must never leave the caller permanently waiting", () => {
  it("maps a confirmed result with fresh intake on the still-active case to 'hydrate'", () => {
    const action = resolveInitialCaseValidationAction(
      { kind: "confirmed" },
      { hasFreshIntake: true, stillActive: true }
    );
    expect(action).toEqual({ action: "hydrate" });
  });

  it("maps 'not-found' to 'clear-and-reset' regardless of freshness/active-ness inputs", () => {
    const action = resolveInitialCaseValidationAction(
      { kind: "not-found" },
      { hasFreshIntake: true, stillActive: true }
    );
    expect(action).toEqual({ action: "clear-and-reset" });
  });

  it("maps 'retry' (transient failure) to 'show-retry'", () => {
    const action = resolveInitialCaseValidationAction(
      { kind: "retry" },
      { hasFreshIntake: true, stillActive: true }
    );
    expect(action).toEqual({ action: "show-retry" });
  });

  it("REGRESSION (liveness): maps 'stale' to 'revalidate' — never a dead-end the caller could get stuck on", () => {
    const action = resolveInitialCaseValidationAction(
      { kind: "stale" },
      { hasFreshIntake: false, stillActive: false }
    );
    expect(action).toEqual({ action: "revalidate" });
  });

  it("REGRESSION (liveness): a 'confirmed' result with NO fresh intake by the time the re-check runs maps to 'revalidate', never 'hydrate' with nothing to hydrate", () => {
    const action = resolveInitialCaseValidationAction(
      { kind: "confirmed" },
      { hasFreshIntake: false, stillActive: true }
    );
    expect(action).toEqual({ action: "revalidate" });
  });

  it("REGRESSION (liveness): a 'confirmed' result for a case that is no longer the active one by the time the re-check runs maps to 'revalidate', never installing content for a case no longer on screen", () => {
    const action = resolveInitialCaseValidationAction(
      { kind: "confirmed" },
      { hasFreshIntake: true, stillActive: false }
    );
    expect(action).toEqual({ action: "revalidate" });
  });
});

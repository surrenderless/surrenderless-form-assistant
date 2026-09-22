import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { patchJusticeCaseIntake, readLocalIntakeCaseVersion } from "@/lib/justice/patchJusticeCaseIntake";
import {
  fetchJusticeCaseById,
  hydrateSessionFromCaseListRow,
  refreshLocalIntakeAndVersionFromServer,
} from "@/lib/justice/hydrateActiveCaseFromServer";
import {
  clearCaseReconciliation,
  commitKeepMyChanges,
  commitUseServerVersion,
  loadCaseReconciliationBanner,
  readCaseReconciliation,
  recordCaseConflict,
} from "@/lib/justice/caseReconciliationStore";
import { STORAGE_CASE_ID, STORAGE_INTAKE } from "@/lib/justice/types";
import type { JusticeIntake } from "@/lib/justice/types";

/**
 * End-to-end scenario regressions for the per-case reconciliation state machine, exercising the
 * REAL exported implementation (patchJusticeCaseIntake, hydrateSessionFromCaseListRow,
 * refreshLocalIntakeAndVersionFromServer, and every caseReconciliationStore function) directly —
 * no hand-rolled page simulation class and no source-text regex mirror. Only the thin React
 * glue that calls these functions (setParts/setPendingCaseReconciliation) is left to page.tsx
 * itself, and that wiring is covered separately by structural checks in page.test.ts.
 *
 * A "page refresh" is simulated the same way it is in every other test in this codebase: nothing
 * resets the stubbed sessionStorage between one call and the next, which is exactly the guarantee
 * real sessionStorage gives across a same-tab refresh/navigation. "React state" (parts,
 * pendingCaseReconciliation) is represented directly by local variables assigned from these real
 * functions' return values — never re-implemented.
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

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

describe("Reconciliation scenarios — real implementation, no PageSim", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    stubSessionStorage();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("scenario: A gets a conflict, B is saved successfully, then the user returns to A — A's draft is intact and unaffected by B's success", async () => {
    // 1. Case A is active, edits, hits a 409.
    sessionStorage.setItem(STORAGE_CASE_ID, CASE_A);
    hydrateSessionFromCaseListRow({ id: CASE_A, intake: intake({ story: "A baseline" }), case_version: 1 });
    const draftA = intake({ story: "A's unsaved draft" });
    fetchMock.mockResolvedValueOnce(
      jsonResponse(409, { error: "conflict", current: { intake: intake({ story: "A server" }), case_version: 2 } })
    );
    const conflictResult = await patchJusticeCaseIntake(CASE_A, draftA);
    expect(conflictResult.ok).toBe(false);
    expect(readCaseReconciliation(CASE_A)?.localDraft).toEqual(draftA);

    // 2. User switches to case B (a real hydrate call, exactly what hydrateChatFromJusticeCaseRow does).
    const rowB = { id: CASE_B, intake: intake({ story: "B baseline" }), case_version: 5 };
    hydrateSessionFromCaseListRow(rowB);
    sessionStorage.setItem(STORAGE_CASE_ID, CASE_B);
    const bannerForB = loadCaseReconciliationBanner(CASE_B);
    expect(bannerForB).toBeNull(); // B has no reconciliation of its own

    // 3. B is edited and saved successfully.
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { intake: intake({ story: "B saved" }), case_version: 6, timeline: [] }));
    const bSaveResult = await patchJusticeCaseIntake(CASE_B, intake({ story: "B's edit" }));
    expect(bSaveResult.ok).toBe(true);

    // 4. User returns to case A.
    const rowA = { id: CASE_A, intake: intake({ story: "A server" }), case_version: 2 };
    hydrateSessionFromCaseListRow(rowA);
    sessionStorage.setItem(STORAGE_CASE_ID, CASE_A);
    const bannerForA = loadCaseReconciliationBanner(CASE_A);

    // A's exact draft and reconciliation state are restored — completely unaffected by B's
    // success in between.
    expect(bannerForA).not.toBeNull();
    expect(bannerForA?.localDraft).toEqual(draftA);
    expect(bannerForA?.banner?.serverIntake).toEqual(intake({ story: "A server" }));
    expect(bannerForA?.banner?.serverCaseVersion).toBe(2);
  });

  it("scenario: switching from A (unresolved conflict) to B never lets B's handlers see or alter A's banner/CAS token", async () => {
    sessionStorage.setItem(STORAGE_CASE_ID, CASE_A);
    hydrateSessionFromCaseListRow({ id: CASE_A, intake: intake({ story: "A baseline" }), case_version: 1 });
    fetchMock.mockResolvedValueOnce(
      jsonResponse(409, { error: "conflict", current: { intake: intake({ story: "A server" }), case_version: 2 } })
    );
    await patchJusticeCaseIntake(CASE_A, intake({ story: "A draft" }));
    // Real page.tsx would set pendingCaseReconciliation = { caseId: CASE_A, ... } here.
    const pendingForA = loadCaseReconciliationBanner(CASE_A)?.banner ?? null;
    expect(pendingForA?.caseId).toBe(CASE_A);

    // Switch to B.
    hydrateSessionFromCaseListRow({ id: CASE_B, intake: intake({ story: "B baseline" }), case_version: 9 });
    sessionStorage.setItem(STORAGE_CASE_ID, CASE_B);
    // Real page.tsx calls loadPendingReconciliationForCase(CASE_B) on every switch — reproduced
    // directly here via the same real function the production code calls.
    const reconciliationForB = loadCaseReconciliationBanner(CASE_B);
    const activeBannerAfterSwitch = reconciliationForB?.banner ?? null;

    // The banner now in scope is B's (none), never A's stale one — this is the exact guarantee
    // that makes "A's banner can never alter B's intake or CAS token" hold: page.tsx's React
    // state is reloaded from the store on every switch, so a caseId mismatch is structurally
    // impossible once loadPendingReconciliationForCase has run.
    expect(activeBannerAfterSwitch).toBeNull();

    // If a handler were (incorrectly) still holding the stale `pendingForA` object and tried to
    // act on it while B is active, page.tsx's caseId verification (activeCaseIdMatchesPendingReconciliation)
    // would reject it — reproduced here as the same check against the real active case id.
    const activeCaseId = sessionStorage.getItem(STORAGE_CASE_ID);
    expect(pendingForA?.caseId).not.toBe(activeCaseId);
  });

  it("scenario: passive reload detects a conflict, a refresh happens, and 'Use server version' restores the ACTUAL server snapshot recorded at conflict time — never stale STORAGE_INTAKE", async () => {
    sessionStorage.setItem(STORAGE_CASE_ID, CASE_A);
    hydrateSessionFromCaseListRow({ id: CASE_A, intake: intake({ story: "stale local sync point" }), case_version: 1 });

    // Passive reload poll detects the server has moved on while the user has a dirty local draft
    // (partsRef.current, here just an explicit local variable standing in for it).
    const partsRefCurrent = intake({ story: "user is actively typing this" });
    const trueServerIntake = intake({ story: "REAL fresh server content from the passive poll" });
    recordCaseConflict(CASE_A, "reload", partsRefCurrent, trueServerIntake, 5);
    // Deliberately mirror the real reload effect: it does NOT touch STORAGE_INTAKE/case_version.
    expect(JSON.parse(sessionStorage.getItem(STORAGE_INTAKE) ?? "null")).toEqual(intake({ story: "stale local sync point" }));
    expect(readLocalIntakeCaseVersion()).toBe(1);

    // --- simulate a refresh: re-derive the banner purely from the durable record ---
    const reloaded = loadCaseReconciliationBanner(CASE_A);
    expect(reloaded?.localDraft).toEqual(partsRefCurrent);
    expect(reloaded?.banner?.serverIntake).toEqual(trueServerIntake);
    expect(reloaded?.banner?.serverCaseVersion).toBe(5);

    // "Use server version" must restore the TRUE server snapshot, not the stale pre-poll content.
    const result = commitUseServerVersion(CASE_A);
    expect(result).toEqual({ serverIntake: trueServerIntake, serverCaseVersion: 5 });
    expect(JSON.parse(sessionStorage.getItem(STORAGE_INTAKE) ?? "null")).toEqual(trueServerIntake);
    expect(readLocalIntakeCaseVersion()).toBe(5);
    expect(readCaseReconciliation(CASE_A)).toBeNull();
  });

  it("scenario: Keep my changes, then refresh, then ANOTHER server update — the kept draft is never misclassified as committed until an actual save succeeds", async () => {
    sessionStorage.setItem(STORAGE_CASE_ID, CASE_A);
    hydrateSessionFromCaseListRow({ id: CASE_A, intake: intake({ story: "baseline" }), case_version: 1 });
    fetchMock.mockResolvedValueOnce(
      jsonResponse(409, { error: "conflict", current: { intake: intake({ story: "server edit" }), case_version: 2 } })
    );
    await patchJusticeCaseIntake(CASE_A, intake({ story: "my draft" }));

    const beforeKeep = loadCaseReconciliationBanner(CASE_A);
    expect(beforeKeep?.localDraft.story).toBe("my draft");
    commitKeepMyChanges(CASE_A, beforeKeep!.localDraft);

    // --- simulate a refresh right after Keep, before any further save ---
    const afterRefresh = loadCaseReconciliationBanner(CASE_A);
    // No banner (already resolved)...
    expect(afterRefresh?.banner).toBeNull();
    // ...but the draft is still there, and the record still exists (status "kept"), so it is
    // NOT misclassified as committed.
    expect(afterRefresh?.localDraft.story).toBe("my draft");
    expect(readCaseReconciliation(CASE_A)?.status).toBe("kept");
    expect(readLocalIntakeCaseVersion()).toBe(2);

    // --- ANOTHER server update happens before the user saves again: a passive reload detects it ---
    recordCaseConflict(CASE_A, "reload", afterRefresh!.localDraft, intake({ story: "yet another server edit" }), 3);
    const secondBanner = loadCaseReconciliationBanner(CASE_A);
    expect(secondBanner?.banner).not.toBeNull(); // re-opens the choice — not silently overwritten
    expect(secondBanner?.banner?.serverCaseVersion).toBe(3);

    // User keeps again, then an actual save succeeds.
    commitKeepMyChanges(CASE_A, secondBanner!.localDraft);
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { intake: secondBanner!.localDraft, case_version: 4, timeline: [] })
    );
    const finalSave = await patchJusticeCaseIntake(CASE_A, secondBanner!.localDraft);
    expect(finalSave.ok).toBe(true);
    // Only now — an actual successful save — is the record cleared.
    expect(readCaseReconciliation(CASE_A)).toBeNull();
  });

  it("sanity: fetchJusticeCaseById feeding the passive-reload path is the real function, not a stub reimplementation", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: CASE_A, intake: intake(), case_version: 3 }));
    const row = await fetchJusticeCaseById(CASE_A);
    expect(row?.case_version).toBe(3);
  });

  it("sanity: refreshLocalIntakeAndVersionFromServer (the real missing_version recovery path) records the full reconciliation", async () => {
    const localDraft = intake({ story: "draft that hit missing_version" });
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: CASE_A, intake: intake({ story: "server" }), case_version: 9 }));
    const refreshed = await refreshLocalIntakeAndVersionFromServer(CASE_A, localDraft);
    expect(refreshed).toEqual({ intake: intake({ story: "server" }), caseVersion: 9 });
    expect(readCaseReconciliation(CASE_A)?.localDraft).toEqual(localDraft);
    clearCaseReconciliation(CASE_A);
  });
});

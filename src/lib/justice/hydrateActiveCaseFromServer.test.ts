import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchJusticeCaseById,
  hydrateSessionFromCaseListRow,
  isEditingActiveLocalJusticeCase,
  lookupJusticeCaseById,
} from "@/lib/justice/hydrateActiveCaseFromServer";
import { recoverFromMissingVersion } from "@/lib/justice/reconciliationController";
import { readCaseReconciliation, writeCaseReconciliation } from "@/lib/justice/caseReconciliationStore";
import { STORAGE_CASE_ID, STORAGE_INTAKE } from "@/lib/justice/types";
import type { JusticeIntake } from "@/lib/justice/types";

const UUID = "550e8400-e29b-41d4-a716-446655440000";
const OTHER_UUID = "550e8400-e29b-41d4-a716-446655440099";

const validIntake: JusticeIntake = {
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
};

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

describe("isEditingActiveLocalJusticeCase", () => {
  beforeEach(() => {
    stubSessionStorage();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns false when intake is missing", () => {
    sessionStorage.setItem(STORAGE_CASE_ID, UUID);
    expect(isEditingActiveLocalJusticeCase()).toBe(false);
  });

  it("returns false when case id is not a UUID", () => {
    sessionStorage.setItem(STORAGE_INTAKE, JSON.stringify(validIntake));
    sessionStorage.setItem(STORAGE_CASE_ID, "case_local_123");
    expect(isEditingActiveLocalJusticeCase()).toBe(false);
  });

  it("returns false when intake payload is invalid", () => {
    sessionStorage.setItem(STORAGE_INTAKE, JSON.stringify({ company_name: "Acme" }));
    sessionStorage.setItem(STORAGE_CASE_ID, UUID);
    expect(isEditingActiveLocalJusticeCase()).toBe(false);
  });

  it("returns true when valid intake and UUID case id are in session", () => {
    sessionStorage.setItem(STORAGE_INTAKE, JSON.stringify(validIntake));
    sessionStorage.setItem(STORAGE_CASE_ID, UUID);
    expect(isEditingActiveLocalJusticeCase()).toBe(true);
  });
});

describe("lookupJusticeCaseById — distinguishes CONFIRMED not-found/not-owned (404) from a transient failure", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns ok:true with the row on a 200", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: UUID, intake: validIntake, case_version: 3 }));
    const result = await lookupJusticeCaseById(UUID);
    expect(result).toEqual({ ok: true, row: { id: UUID, intake: validIntake, case_version: 3 } });
  });

  it("returns notFound:true on a 404 — the server's confirmed not-found/not-owned result", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(404, { error: "Not found" }));
    const result = await lookupJusticeCaseById(UUID);
    expect(result).toEqual({ ok: false, notFound: true });
  });

  it("returns notFound:false on a 500 — a transient failure, never conflated with a confirmed 404", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(500, { error: "Internal error" }));
    const result = await lookupJusticeCaseById(UUID);
    expect(result).toEqual({ ok: false, notFound: false });
  });

  it("returns notFound:false when fetch itself throws (network failure/offline)", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    const result = await lookupJusticeCaseById(UUID);
    expect(result).toEqual({ ok: false, notFound: false });
  });

  it("returns notFound:false on an invalid case id, without ever calling fetch", async () => {
    const result = await lookupJusticeCaseById("not-a-uuid");
    expect(result).toEqual({ ok: false, notFound: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetchJusticeCaseById collapses BOTH not-found and transient failures to null (its documented, narrower contract) — not-found/transient distinction is only exposed via lookupJusticeCaseById", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(404, {}));
    expect(await fetchJusticeCaseById(UUID)).toBeNull();
    fetchMock.mockResolvedValueOnce(jsonResponse(500, {}));
    expect(await fetchJusticeCaseById(UUID)).toBeNull();
  });
});

describe("hydrateSessionFromCaseListRow — per-case reconciliation is structurally isolated (no cross-case clearing needed)", () => {
  beforeEach(() => {
    stubSessionStorage();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("BLOCKING FIX (round 3): hydrating a DIFFERENT case (a case switch) never clears the previously-active case's reconciliation record", () => {
    writeCaseReconciliation(OTHER_UUID, {
      reason: "conflict",
      status: "pending",
      localDraft: { ...validIntake, story: "Case A's unresolved draft" },
      serverIntake: validIntake,
      serverCaseVersion: 2,
    });

    // Switch the active case to a DIFFERENT case (UUID) — a real case-switch flow.
    hydrateSessionFromCaseListRow({ id: UUID, intake: validIntake, case_version: 1 });

    // Case A's (OTHER_UUID) record is untouched — no cross-case clearing needed, since the store
    // is a per-case map, not a shared single slot.
    const preserved = readCaseReconciliation(OTHER_UUID);
    expect(preserved).not.toBeNull();
    expect(preserved?.localDraft.story).toBe("Case A's unresolved draft");
  });

  it("hydrating the SAME case whose record was just written (the same conflict flow) leaves that record untouched", () => {
    writeCaseReconciliation(UUID, {
      reason: "conflict",
      status: "pending",
      localDraft: { ...validIntake, story: "Draft just stashed by this same conflict flow" },
      serverIntake: validIntake,
      serverCaseVersion: 2,
    });

    hydrateSessionFromCaseListRow({ id: UUID, intake: validIntake, case_version: 2 });

    expect(readCaseReconciliation(UUID)?.localDraft.story).toBe("Draft just stashed by this same conflict flow");
  });
});

describe("recoverFromMissingVersion — the centralized missing_version recovery path — durably records both sides of the reconciliation", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    stubSessionStorage();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("records localDraft alongside the fetched server snapshot/version, and returns an install-ready banner", async () => {
    const localDraft = { ...validIntake, story: "Local edit that hit missing_version" };
    const serverIntake = { ...validIntake, story: "Real current server content" };
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: UUID, intake: serverIntake, case_version: 7 }));

    sessionStorage.setItem(STORAGE_CASE_ID, UUID);
    const result = await recoverFromMissingVersion(UUID, localDraft, {
      lookupCaseById: lookupJusticeCaseById,
      getActiveCaseId: () => sessionStorage.getItem(STORAGE_CASE_ID),
    });

    expect(result).toEqual({
      ok: true,
      banner: { caseId: UUID, reason: "missing_version", serverIntake, serverCaseVersion: 7 },
    });
    const record = readCaseReconciliation(UUID);
    expect(record).not.toBeNull();
    expect(record?.reason).toBe("missing_version");
    expect(record?.localDraft).toEqual(localDraft);
    expect(record?.serverIntake).toEqual(serverIntake);
    expect(record?.serverCaseVersion).toBe(7);
  });

  it("reports a CONFIRMED not_found (server 404) and does not record anything", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(404, {}));
    const result = await recoverFromMissingVersion(UUID, validIntake, {
      lookupCaseById: lookupJusticeCaseById,
      getActiveCaseId: () => UUID,
    });
    expect(result).toEqual({ ok: false, reason: "not_found" });
    expect(readCaseReconciliation(UUID)).toBeNull();
  });

  it("reports a distinct 'transient' reason (never 'not_found') on a 5xx failure, so a caller never treats a server error as a confirmed ownership negative", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(500, {}));
    const result = await recoverFromMissingVersion(UUID, validIntake, {
      lookupCaseById: lookupJusticeCaseById,
      getActiveCaseId: () => UUID,
    });
    expect(result).toEqual({ ok: false, reason: "transient" });
    expect(readCaseReconciliation(UUID)).toBeNull();
  });

  it("reports a distinct 'transient' reason on a network error (fetch throws), never 'not_found'", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    const result = await recoverFromMissingVersion(UUID, validIntake, {
      lookupCaseById: lookupJusticeCaseById,
      getActiveCaseId: () => UUID,
    });
    expect(result).toEqual({ ok: false, reason: "transient" });
    expect(readCaseReconciliation(UUID)).toBeNull();
  });

  it("BLOCKING FIX (round 4, item 4): resolving after the active case has switched away still records the reconciliation (never lost) but does NOT install server content into the now-inactive-for-this-recovery global session pointers", async () => {
    const serverIntake = { ...validIntake, story: "server content for the case that lost the race" };
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: UUID, intake: serverIntake, case_version: 4 }));

    // By the time this resolves, the user has already switched to OTHER_UUID.
    sessionStorage.setItem(STORAGE_CASE_ID, OTHER_UUID);
    const result = await recoverFromMissingVersion(UUID, validIntake, {
      lookupCaseById: lookupJusticeCaseById,
      getActiveCaseId: () => sessionStorage.getItem(STORAGE_CASE_ID),
    });

    expect(result.ok).toBe(true);
    // The record is still durably stored under UUID's own key — never lost, just not the active view.
    expect(readCaseReconciliation(UUID)?.serverIntake).toEqual(serverIntake);
    // STORAGE_INTAKE was never touched for the now-inactive case.
    expect(sessionStorage.getItem(STORAGE_INTAKE)).toBeNull();
  });
});

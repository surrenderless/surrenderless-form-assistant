import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  hydrateSessionFromCaseListRow,
  isEditingActiveLocalJusticeCase,
  refreshLocalIntakeAndVersionFromServer,
} from "@/lib/justice/hydrateActiveCaseFromServer";
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

describe("refreshLocalIntakeAndVersionFromServer — durably records both sides of a missing_version reconciliation", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    stubSessionStorage();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("records localDraft alongside the fetched server snapshot/version BEFORE installing server content into STORAGE_INTAKE", async () => {
    const localDraft = { ...validIntake, story: "Local edit that hit missing_version" };
    const serverIntake = { ...validIntake, story: "Real current server content" };
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: UUID, intake: serverIntake, case_version: 7 }));

    const result = await refreshLocalIntakeAndVersionFromServer(UUID, localDraft);

    expect(result).toEqual({ intake: serverIntake, caseVersion: 7 });
    const record = readCaseReconciliation(UUID);
    expect(record).not.toBeNull();
    expect(record?.reason).toBe("missing_version");
    expect(record?.localDraft).toEqual(localDraft);
    expect(record?.serverIntake).toEqual(serverIntake);
    expect(record?.serverCaseVersion).toBe(7);
  });

  it("does not record anything when the case cannot be fetched", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(404, {}));
    const result = await refreshLocalIntakeAndVersionFromServer(UUID, validIntake);
    expect(result).toBeNull();
    expect(readCaseReconciliation(UUID)).toBeNull();
  });
});

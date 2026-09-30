import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearCaseReconciliation,
  commitKeepMyChanges,
  commitUseServerVersion,
  loadCaseReconciliationBanner,
  readCaseReconciliation,
  recordCaseConflict,
  syncCaseReconciliationDraft,
  writeCaseReconciliation,
} from "@/lib/justice/caseReconciliationStore";
import { readLocalIntakeCaseVersion } from "@/lib/justice/intakeCaseVersionStorage";
import { STORAGE_INTAKE } from "@/lib/justice/types";
import type { JusticeIntake } from "@/lib/justice/types";

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

describe("caseReconciliationStore — per-case durability and isolation", () => {
  beforeEach(() => {
    stubSessionStorage();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("read/write/clear round-trip for a single case", () => {
    expect(readCaseReconciliation(CASE_A)).toBeNull();
    writeCaseReconciliation(CASE_A, {
      reason: "conflict",
      status: "pending",
      localDraft: intake({ story: "draft" }),
      serverIntake: intake({ story: "server" }),
      serverCaseVersion: 5,
    });
    const record = readCaseReconciliation(CASE_A);
    expect(record?.status).toBe("pending");
    expect(record?.localDraft.story).toBe("draft");
    clearCaseReconciliation(CASE_A);
    expect(readCaseReconciliation(CASE_A)).toBeNull();
  });

  it("BLOCKING FIX (round 3): case A and case B records are fully independent — writing/clearing one never touches the other", () => {
    writeCaseReconciliation(CASE_A, {
      reason: "conflict",
      status: "pending",
      localDraft: intake({ story: "A draft" }),
      serverIntake: intake(),
      serverCaseVersion: 2,
    });
    writeCaseReconciliation(CASE_B, {
      reason: "reload",
      status: "kept",
      localDraft: intake({ story: "B draft" }),
      serverIntake: intake(),
      serverCaseVersion: 8,
    });

    expect(readCaseReconciliation(CASE_A)?.localDraft.story).toBe("A draft");
    expect(readCaseReconciliation(CASE_B)?.localDraft.story).toBe("B draft");

    clearCaseReconciliation(CASE_B);
    expect(readCaseReconciliation(CASE_A)?.localDraft.story).toBe("A draft");
    expect(readCaseReconciliation(CASE_B)).toBeNull();
  });

  it("recordCaseConflict writes both sides atomically with status pending", () => {
    recordCaseConflict(CASE_A, "conflict", intake({ story: "local" }), intake({ story: "server" }), 3);
    const record = readCaseReconciliation(CASE_A);
    expect(record).toEqual({
      reason: "conflict",
      status: "pending",
      localDraft: intake({ story: "local" }),
      serverIntake: intake({ story: "server" }),
      serverCaseVersion: 3,
    });
  });

  describe("loadCaseReconciliationBanner", () => {
    it("returns null when there is no record", () => {
      expect(loadCaseReconciliationBanner(CASE_A)).toBeNull();
    });

    it("returns a banner for a pending record", () => {
      recordCaseConflict(CASE_A, "reload", intake({ story: "local" }), intake({ story: "server" }), 4);
      const loaded = loadCaseReconciliationBanner(CASE_A);
      expect(loaded?.localDraft.story).toBe("local");
      expect(loaded?.banner).toEqual({ caseId: CASE_A, reason: "reload", serverIntake: intake({ story: "server" }), serverCaseVersion: 4 });
    });

    it("returns the draft but a null banner for a 'kept' record — no banner should be shown for an already-resolved choice", () => {
      writeCaseReconciliation(CASE_A, {
        reason: "conflict",
        status: "kept",
        localDraft: intake({ story: "kept draft" }),
        serverIntake: intake(),
        serverCaseVersion: 6,
      });
      const loaded = loadCaseReconciliationBanner(CASE_A);
      expect(loaded?.localDraft.story).toBe("kept draft");
      expect(loaded?.banner).toBeNull();
    });
  });

  describe("commitKeepMyChanges", () => {
    it("promotes the current draft into STORAGE_INTAKE, aligns the CAS token to the server version, and marks the record 'kept' (never clears it)", () => {
      recordCaseConflict(CASE_A, "conflict", intake({ story: "old draft" }), intake({ story: "server" }), 5);
      const updatedDraft = intake({ story: "edited further before clicking Keep" });

      const result = commitKeepMyChanges(CASE_A, updatedDraft);

      expect(result).toEqual({ serverCaseVersion: 5 });
      expect(readLocalIntakeCaseVersion()).toBe(5);
      expect(JSON.parse(sessionStorage.getItem(STORAGE_INTAKE) ?? "null")).toEqual(updatedDraft);
      const record = readCaseReconciliation(CASE_A);
      expect(record?.status).toBe("kept");
      expect(record?.localDraft).toEqual(updatedDraft);
      // The server side is preserved (not discarded) — still useful bookkeeping, and needed if
      // another conflict happens before the next save.
      expect(record?.serverIntake).toEqual(intake({ story: "server" }));
    });

    it("BLOCKING FIX (round 3): the record survives 'Keep' — it is NOT cleared, so it cannot be misclassified as committed until an actual save succeeds", () => {
      recordCaseConflict(CASE_A, "conflict", intake(), intake(), 5);
      commitKeepMyChanges(CASE_A, intake({ story: "kept" }));
      expect(readCaseReconciliation(CASE_A)).not.toBeNull();
    });

    it("returns null and does nothing when there is no record to resolve", () => {
      const result = commitKeepMyChanges(CASE_A, intake());
      expect(result).toBeNull();
      expect(sessionStorage.getItem(STORAGE_INTAKE)).toBeNull();
    });
  });

  describe("commitUseServerVersion", () => {
    it("restores the ACTUAL recorded server snapshot/version — never whatever STORAGE_INTAKE currently holds — and clears the record", () => {
      // STORAGE_INTAKE holds something stale/unrelated at the time of this call.
      sessionStorage.setItem(STORAGE_INTAKE, JSON.stringify(intake({ story: "stale unrelated content" })));
      recordCaseConflict(CASE_A, "conflict", intake({ story: "local" }), intake({ story: "TRUE server snapshot" }), 9);

      const result = commitUseServerVersion(CASE_A);

      expect(result).toEqual({ serverIntake: intake({ story: "TRUE server snapshot" }), serverCaseVersion: 9 });
      expect(JSON.parse(sessionStorage.getItem(STORAGE_INTAKE) ?? "null")).toEqual(intake({ story: "TRUE server snapshot" }));
      expect(readLocalIntakeCaseVersion()).toBe(9);
      expect(readCaseReconciliation(CASE_A)).toBeNull();
    });

    it("returns null and does nothing when there is no record to resolve", () => {
      const result = commitUseServerVersion(CASE_A);
      expect(result).toBeNull();
    });
  });

  describe("syncCaseReconciliationDraft", () => {
    it("is a no-op when there is no record for the case (typing before any conflict/missing_version has ever occurred)", () => {
      syncCaseReconciliationDraft(CASE_A, intake({ story: "typed with no record yet" }));
      expect(readCaseReconciliation(CASE_A)).toBeNull();
    });

    it("BLOCKING FIX (round 4, item 2): keeps localDraft continuously current while a banner is pending — typing AFTER the conflict is recorded is never lost", () => {
      recordCaseConflict(CASE_A, "conflict", intake({ story: "draft at conflict time" }), intake({ story: "server" }), 5);
      syncCaseReconciliationDraft(CASE_A, intake({ story: "typed more after the banner appeared" }));
      const record = readCaseReconciliation(CASE_A);
      expect(record?.localDraft.story).toBe("typed more after the banner appeared");
      // Everything else about the record is untouched by a draft sync.
      expect(record?.status).toBe("pending");
      expect(record?.serverIntake).toEqual(intake({ story: "server" }));
      expect(record?.serverCaseVersion).toBe(5);
    });

    it("BLOCKING FIX (round 4, item 2): keeps localDraft continuously current after 'Keep my changes' too — typing after Keep, before the next save succeeds, is never lost", () => {
      recordCaseConflict(CASE_A, "conflict", intake({ story: "old draft" }), intake({ story: "server" }), 5);
      commitKeepMyChanges(CASE_A, intake({ story: "kept draft" }));
      syncCaseReconciliationDraft(CASE_A, intake({ story: "typed more after clicking Keep" }));
      const record = readCaseReconciliation(CASE_A);
      expect(record?.status).toBe("kept");
      expect(record?.localDraft.story).toBe("typed more after clicking Keep");
    });

    it("never creates a record for a DIFFERENT case, and never touches an unrelated case's own record", () => {
      recordCaseConflict(CASE_B, "reload", intake({ story: "B's draft" }), intake(), 2);
      syncCaseReconciliationDraft(CASE_A, intake({ story: "typed in case A, which has no record" }));
      expect(readCaseReconciliation(CASE_A)).toBeNull();
      expect(readCaseReconciliation(CASE_B)?.localDraft.story).toBe("B's draft");
    });
  });
});

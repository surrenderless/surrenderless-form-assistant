import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  commitIntakeToSessionAndServer,
  shouldRouteToChatAiAfterIntakeCommit,
} from "@/lib/justice/commitIntakeToSessionAndServer";
import { writeLocalIntakeCaseVersion } from "@/lib/justice/patchJusticeCaseIntake";
import { readCaseReconciliation } from "@/lib/justice/caseReconciliationStore";
import { STORAGE_CASE_ID, STORAGE_INTAKE } from "@/lib/justice/types";
import type { JusticeIntake } from "@/lib/justice/types";

const UUID = "550e8400-e29b-41d4-a716-446655440000";

describe("shouldRouteToChatAiAfterIntakeCommit", () => {
  it("returns false when Clerk is not loaded", () => {
    expect(
      shouldRouteToChatAiAfterIntakeCommit({
        commitResult: { caseId: UUID, serverPersisted: true },
        isLoaded: false,
        isSignedIn: true,
      })
    ).toBe(false);
  });

  it("returns false when user is not signed in", () => {
    expect(
      shouldRouteToChatAiAfterIntakeCommit({
        commitResult: { caseId: UUID, serverPersisted: true },
        isLoaded: true,
        isSignedIn: false,
      })
    ).toBe(false);
  });

  it("returns false when case id is missing or not a UUID", () => {
    expect(
      shouldRouteToChatAiAfterIntakeCommit({
        commitResult: { caseId: "", serverPersisted: true },
        isLoaded: true,
        isSignedIn: true,
      })
    ).toBe(false);
    expect(
      shouldRouteToChatAiAfterIntakeCommit({
        commitResult: { caseId: "case_local_123", serverPersisted: true },
        isLoaded: true,
        isSignedIn: true,
      })
    ).toBe(false);
  });

  it("returns true for signed-in UUID updates even when server persist failed", () => {
    expect(
      shouldRouteToChatAiAfterIntakeCommit({
        commitResult: { caseId: UUID, serverPersisted: false },
        isLoaded: true,
        isSignedIn: true,
        isUpdatingExistingCase: true,
      })
    ).toBe(true);
  });

  it("requires serverPersisted for signed-in UUID create commits", () => {
    expect(
      shouldRouteToChatAiAfterIntakeCommit({
        commitResult: { caseId: UUID, serverPersisted: false },
        isLoaded: true,
        isSignedIn: true,
        isUpdatingExistingCase: false,
      })
    ).toBe(false);
    expect(
      shouldRouteToChatAiAfterIntakeCommit({
        commitResult: { caseId: UUID, serverPersisted: true },
        isLoaded: true,
        isSignedIn: true,
        isUpdatingExistingCase: false,
      })
    ).toBe(true);
  });
});

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

describe("commitIntakeToSessionAndServer (mode: update) — missing_version and conflict propagation via the centralized reconciliation controller", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    stubSessionStorage();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("BLOCKING FIX (round 4, item 3): on missing_version, routes through recoverFromMissingVersion and returns an install-ready conflict banner — never silently reports serverPersisted:true", async () => {
    sessionStorage.setItem(STORAGE_CASE_ID, UUID);
    // No cached case_version — patchJusticeCaseIntake refuses to write, forcing the missing_version path.
    const serverIntake = intake({ story: "real current server content" });
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: UUID, intake: serverIntake, case_version: 9 }));

    const result = await commitIntakeToSessionAndServer({
      intake: intake({ story: "unsaved local edit" }),
      isLoaded: true,
      isSignedIn: true,
      commitLogLabel: "test",
      mode: "update",
    });

    expect(result.serverPersisted).toBe(false);
    expect(result.saveError).toBeTruthy();
    expect(result.conflict).toEqual({
      caseId: UUID,
      reason: "missing_version",
      serverIntake,
      serverCaseVersion: 9,
    });
    // The centralized recovery path durably recorded both sides for this case.
    expect(readCaseReconciliation(UUID)?.localDraft.story).toBe("unsaved local edit");
  });

  it("on a genuine 409 conflict, returns an install-ready conflict banner built from the fresh server snapshot — never reports serverPersisted:true", async () => {
    sessionStorage.setItem(STORAGE_CASE_ID, UUID);
    writeLocalIntakeCaseVersion(3);
    const serverIntake = intake({ story: "someone else's concurrent edit" });
    fetchMock.mockResolvedValueOnce(
      jsonResponse(409, { error: "conflict", current: { intake: serverIntake, case_version: 4 } })
    );

    const result = await commitIntakeToSessionAndServer({
      intake: intake({ story: "my unsaved local edit" }),
      isLoaded: true,
      isSignedIn: true,
      commitLogLabel: "test",
      mode: "update",
    });

    expect(result.serverPersisted).toBe(false);
    expect(result.conflict).toEqual({
      caseId: UUID,
      reason: "conflict",
      serverIntake,
      serverCaseVersion: 4,
    });
  });

  it("BLOCKING FIX (round 4, item 4): a missing_version recovery resolving AFTER the user has switched to a different case still records the reconciliation, but never installs the fetched snapshot into the now-inactive-for-this-recovery STORAGE_INTAKE", async () => {
    const OTHER_UUID = "550e8400-e29b-41d4-a716-446655440099";
    sessionStorage.setItem(STORAGE_CASE_ID, UUID);
    const serverIntake = intake({ story: "server content for the case the user left" });

    // Simulate the user switching to a different case while recoverFromMissingVersion's own fetch
    // is in flight: the mock flips the active case id right as it resolves, mirroring what a real
    // navigation racing this request would look like from the recovery function's point of view.
    fetchMock.mockImplementationOnce(async () => {
      sessionStorage.setItem(STORAGE_CASE_ID, OTHER_UUID);
      return jsonResponse(200, { id: UUID, intake: serverIntake, case_version: 2 });
    });

    const result = await commitIntakeToSessionAndServer({
      intake: intake({ story: "draft that hit missing_version right before the switch" }),
      isLoaded: true,
      isSignedIn: true,
      commitLogLabel: "test",
      mode: "update",
    });

    expect(result.conflict).toEqual({
      caseId: UUID,
      reason: "missing_version",
      serverIntake,
      serverCaseVersion: 2,
    });
    // Durably recorded under UUID's own key regardless of which case is active now.
    expect(readCaseReconciliation(UUID)?.serverIntake).toEqual(serverIntake);
    // The recovery never installs the fetched server snapshot into STORAGE_INTAKE once this case
    // is no longer active — STORAGE_INTAKE still holds only the local draft this call itself wrote
    // at the very start (unconditionally, before the PATCH round-trip), never the server content.
    expect(JSON.parse(sessionStorage.getItem(STORAGE_INTAKE) ?? "null")).toEqual(
      intake({ story: "draft that hit missing_version right before the switch" })
    );
  });
});

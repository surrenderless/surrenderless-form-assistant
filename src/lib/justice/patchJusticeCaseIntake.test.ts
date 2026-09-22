import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { patchJusticeCaseIntake, readLocalIntakeCaseVersion, writeLocalIntakeCaseVersion } from "@/lib/justice/patchJusticeCaseIntake";
import { readCaseReconciliation } from "@/lib/justice/caseReconciliationStore";
import { STORAGE_INTAKE } from "@/lib/justice/types";
import type { JusticeIntake } from "@/lib/justice/types";

const CASE_ID = "550e8400-e29b-41d4-a716-446655440000";
const OTHER_CASE_ID = "550e8400-e29b-41d4-a716-446655440099";

const baseIntake: JusticeIntake = {
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
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe("patchJusticeCaseIntake", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    stubSessionStorage();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fails closed (never PATCHes) when the case id is invalid", async () => {
    const result = await patchJusticeCaseIntake("not-a-uuid", baseIntake);
    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("when no version is cached yet, refuses to write rather than fetching a fresh one to pair with this call's (possibly older) content", async () => {
    const result = await patchJusticeCaseIntake(CASE_ID, baseIntake);

    expect(fetchMock).not.toHaveBeenCalled(); // no GET-then-PATCH fallback — never sends an unprotected write
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("missing_version");
  });

  it("sends the CACHED case_version as expected_case_version — never a value read fresh during this same call", async () => {
    writeLocalIntakeCaseVersion(3);
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { intake: baseIntake, case_version: 4, timeline: [] })
    );

    await patchJusticeCaseIntake(CASE_ID, baseIntake);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(body.expected_case_version).toBe(3);
  });

  it("on success, stores the NEW case_version returned by the server for the next write (sequential saves advance the token)", async () => {
    writeLocalIntakeCaseVersion(3);
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { intake: baseIntake, case_version: 4, timeline: [] }))
      .mockResolvedValueOnce(jsonResponse(200, { intake: baseIntake, case_version: 5, timeline: [] }));

    const first = await patchJusticeCaseIntake(CASE_ID, baseIntake);
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.caseVersion).toBe(4);
    expect(readLocalIntakeCaseVersion()).toBe(4);

    await patchJusticeCaseIntake(CASE_ID, baseIntake);
    const secondBody = JSON.parse(fetchMock.mock.calls[1][1]?.body as string);
    expect(secondBody.expected_case_version).toBe(4); // the version from THIS session's last write
    expect(readLocalIntakeCaseVersion()).toBe(5);
  });

  it("on conflict (409), never retries the write itself, and reconciles by adopting the server's fresh state", async () => {
    writeLocalIntakeCaseVersion(1);
    const freshIntake = { ...baseIntake, company_name: "Someone else's edit" };
    fetchMock.mockResolvedValueOnce(
      jsonResponse(409, {
        error: "Case was updated concurrently. Reload and retry.",
        current: { intake: freshIntake, case_version: 2 },
      })
    );

    const result = await patchJusticeCaseIntake(CASE_ID, baseIntake);

    expect(fetchMock).toHaveBeenCalledTimes(1); // exactly one PATCH attempt — no automatic retry
    expect(result.ok).toBe(false);
    if (!result.ok && result.reason === "conflict") {
      expect(result.current.caseVersion).toBe(2);
    } else {
      throw new Error("expected a conflict result");
    }
    // Reconciliation: the locally cached version and intake now reflect the ACTUAL server state,
    // not the stale write that was attempted — so the next call uses the correct token.
    expect(readLocalIntakeCaseVersion()).toBe(2);
    expect(JSON.parse(sessionStorage.getItem(STORAGE_INTAKE) ?? "null")).toEqual(freshIntake);
  });

  it("a missing precondition (server rejects with 400) is never silently treated as success", async () => {
    writeLocalIntakeCaseVersion(1);
    fetchMock.mockResolvedValueOnce(jsonResponse(400, { error: "Invalid expected_case_version" }));

    const result = await patchJusticeCaseIntake(CASE_ID, baseIntake);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("request_failed");
  });
});

describe("patchJusticeCaseIntake — durable per-case reconciliation (Keep my changes must survive a refresh, and never touch a different case)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    stubSessionStorage();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("on a 409, durably records BOTH the local draft and the actual server snapshot/version for this case BEFORE installing server content into STORAGE_INTAKE", async () => {
    writeLocalIntakeCaseVersion(1);
    const localDraft = { ...baseIntake, story: "My in-progress edit" };
    const serverIntake = { ...baseIntake, company_name: "Someone else's edit" };
    fetchMock.mockResolvedValueOnce(
      jsonResponse(409, { error: "conflict", current: { intake: serverIntake, case_version: 2 } })
    );

    await patchJusticeCaseIntake(CASE_ID, localDraft);

    // STORAGE_INTAKE now holds the server's content (existing, intended behavior)...
    expect(JSON.parse(sessionStorage.getItem(STORAGE_INTAKE) ?? "null")).toEqual(serverIntake);
    // ...but the reconciliation record durably preserves BOTH sides of the choice, keyed to this
    // case, exactly as if a page refresh had happened right after the conflict (nothing here
    // resets sessionStorage between the write above and this read, the same guarantee real
    // sessionStorage gives across a same-tab refresh/navigation).
    const record = readCaseReconciliation(CASE_ID);
    expect(record).not.toBeNull();
    expect(record?.status).toBe("pending");
    expect(record?.localDraft).toEqual(localDraft);
    expect(record?.serverIntake).toEqual(serverIntake);
    expect(record?.serverCaseVersion).toBe(2);
  });

  it("a case's reconciliation record is scoped to its case id — does not leak into a lookup for a different case", async () => {
    writeLocalIntakeCaseVersion(1);
    const localDraft = { ...baseIntake, story: "Draft for case A" };
    fetchMock.mockResolvedValueOnce(
      jsonResponse(409, { error: "conflict", current: { intake: baseIntake, case_version: 2 } })
    );
    await patchJusticeCaseIntake(CASE_ID, localDraft);

    expect(readCaseReconciliation(CASE_ID)).not.toBeNull();
    expect(readCaseReconciliation(OTHER_CASE_ID)).toBeNull();
  });

  it("repeated conflicts each overwrite the record with the NEWEST local edit and server snapshot, never a stale earlier one", async () => {
    writeLocalIntakeCaseVersion(1);
    const firstDraft = { ...baseIntake, story: "First attempt" };
    const secondDraft = { ...baseIntake, story: "Second attempt, after seeing the first conflict" };
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(409, { error: "conflict", current: { intake: baseIntake, case_version: 2 } })
      )
      .mockResolvedValueOnce(
        jsonResponse(409, { error: "conflict", current: { intake: baseIntake, case_version: 3 } })
      );

    await patchJusticeCaseIntake(CASE_ID, firstDraft);
    expect(readCaseReconciliation(CASE_ID)?.localDraft).toEqual(firstDraft);
    expect(readCaseReconciliation(CASE_ID)?.serverCaseVersion).toBe(2);

    await patchJusticeCaseIntake(CASE_ID, secondDraft);
    expect(readCaseReconciliation(CASE_ID)?.localDraft).toEqual(secondDraft);
    expect(readCaseReconciliation(CASE_ID)?.serverCaseVersion).toBe(3);
  });

  it("on success, clears only THIS case's reconciliation record — nothing left to misclassify on a later reload", async () => {
    writeLocalIntakeCaseVersion(1);
    // First, produce a record via a conflict...
    fetchMock.mockResolvedValueOnce(
      jsonResponse(409, { error: "conflict", current: { intake: baseIntake, case_version: 2 } })
    );
    await patchJusticeCaseIntake(CASE_ID, { ...baseIntake, story: "Will be superseded by a real save" });
    expect(readCaseReconciliation(CASE_ID)).not.toBeNull();

    // ...then a subsequent save against the now-current version succeeds.
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { intake: baseIntake, case_version: 3, timeline: [] })
    );
    const result = await patchJusticeCaseIntake(CASE_ID, baseIntake);
    expect(result.ok).toBe(true);
    expect(readCaseReconciliation(CASE_ID)).toBeNull();
  });

  it("BLOCKING FIX: a successful save for a COMPLETELY DIFFERENT case must not clear this case's still-unresolved record", async () => {
    // Case A gets a conflict and its record is stashed.
    writeLocalIntakeCaseVersion(1);
    fetchMock.mockResolvedValueOnce(
      jsonResponse(409, { error: "conflict", current: { intake: baseIntake, case_version: 2 } })
    );
    await patchJusticeCaseIntake(CASE_ID, { ...baseIntake, story: "A's unresolved draft" });
    expect(readCaseReconciliation(CASE_ID)).not.toBeNull();

    // A completely unrelated, successful save for a different case (case B).
    writeLocalIntakeCaseVersion(9);
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { intake: { ...baseIntake, story: "B saved" }, case_version: 10, timeline: [] })
    );
    const bResult = await patchJusticeCaseIntake(OTHER_CASE_ID, { ...baseIntake, story: "B's edit" });
    expect(bResult.ok).toBe(true);

    // Case A's record must be untouched.
    expect(readCaseReconciliation(CASE_ID)).not.toBeNull();
    expect(readCaseReconciliation(CASE_ID)?.localDraft.story).toBe("A's unresolved draft");
  });
});

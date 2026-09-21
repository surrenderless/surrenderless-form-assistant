import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearUnsavedIntakeDraft,
  patchJusticeCaseIntake,
  readLocalIntakeCaseVersion,
  readUnsavedIntakeDraft,
  writeLocalIntakeCaseVersion,
} from "@/lib/justice/patchJusticeCaseIntake";
import { STORAGE_INTAKE, STORAGE_INTAKE_UNSAVED_DRAFT, STORAGE_INTAKE_UNSAVED_DRAFT_CASE_ID } from "@/lib/justice/types";
import type { JusticeIntake } from "@/lib/justice/types";

const CASE_ID = "550e8400-e29b-41d4-a716-446655440000";

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

describe("patchJusticeCaseIntake — durable unsaved-draft preservation (Keep my changes must survive a refresh)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    stubSessionStorage();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("on a 409, stashes the local draft that failed to save BEFORE installing server content into STORAGE_INTAKE — recoverable via readUnsavedIntakeDraft even after STORAGE_INTAKE has moved on", async () => {
    writeLocalIntakeCaseVersion(1);
    const localDraft = { ...baseIntake, story: "My in-progress edit" };
    const serverIntake = { ...baseIntake, company_name: "Someone else's edit" };
    fetchMock.mockResolvedValueOnce(
      jsonResponse(409, { error: "conflict", current: { intake: serverIntake, case_version: 2 } })
    );

    await patchJusticeCaseIntake(CASE_ID, localDraft);

    // STORAGE_INTAKE now holds the server's content (existing, intended behavior)...
    expect(JSON.parse(sessionStorage.getItem(STORAGE_INTAKE) ?? "null")).toEqual(serverIntake);
    // ...but the user's actual draft is NOT lost: it survives independently, keyed to this case,
    // exactly as if a page refresh had happened right after the conflict (nothing here resets
    // sessionStorage between the write above and this read, the same guarantee real sessionStorage
    // gives across a same-tab refresh/navigation).
    expect(readUnsavedIntakeDraft(CASE_ID)).toEqual(localDraft);
  });

  it("on missing_version, stashes the local draft before the caller's refresh installs server content", async () => {
    // No cached version — patchJusticeCaseIntake refuses to write.
    const localDraft = { ...baseIntake, story: "Typed before ever syncing a version" };
    const result = await patchJusticeCaseIntake(CASE_ID, localDraft);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("missing_version");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(readUnsavedIntakeDraft(CASE_ID)).toEqual(localDraft);
  });

  it("a stashed draft is scoped to its case id — does not leak into a lookup for a different case", async () => {
    writeLocalIntakeCaseVersion(1);
    const localDraft = { ...baseIntake, story: "Draft for case A" };
    fetchMock.mockResolvedValueOnce(
      jsonResponse(409, { error: "conflict", current: { intake: baseIntake, case_version: 2 } })
    );
    await patchJusticeCaseIntake(CASE_ID, localDraft);

    expect(readUnsavedIntakeDraft(CASE_ID)).toEqual(localDraft);
    expect(readUnsavedIntakeDraft("550e8400-e29b-41d4-a716-446655440099")).toBeNull();
  });

  it("repeated conflicts each overwrite the stashed draft with the NEWEST local edit, never a stale earlier one", async () => {
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
    expect(readUnsavedIntakeDraft(CASE_ID)).toEqual(firstDraft);

    await patchJusticeCaseIntake(CASE_ID, secondDraft);
    expect(readUnsavedIntakeDraft(CASE_ID)).toEqual(secondDraft);
  });

  it("on success, clears any stashed draft marker for this case — nothing left to misclassify on a later reload", async () => {
    writeLocalIntakeCaseVersion(1);
    // First, produce a stashed draft via a conflict...
    fetchMock.mockResolvedValueOnce(
      jsonResponse(409, { error: "conflict", current: { intake: baseIntake, case_version: 2 } })
    );
    await patchJusticeCaseIntake(CASE_ID, { ...baseIntake, story: "Will be superseded by a real save" });
    expect(readUnsavedIntakeDraft(CASE_ID)).not.toBeNull();

    // ...then a subsequent save against the now-current version succeeds.
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { intake: baseIntake, case_version: 3, timeline: [] })
    );
    const result = await patchJusticeCaseIntake(CASE_ID, baseIntake);
    expect(result.ok).toBe(true);
    expect(readUnsavedIntakeDraft(CASE_ID)).toBeNull();
  });

  it("clearUnsavedIntakeDraft removes both the draft and its case-id marker", () => {
    writeLocalIntakeCaseVersion(1);
    sessionStorage.setItem(STORAGE_INTAKE_UNSAVED_DRAFT, JSON.stringify(baseIntake));
    sessionStorage.setItem(STORAGE_INTAKE_UNSAVED_DRAFT_CASE_ID, CASE_ID);
    expect(readUnsavedIntakeDraft(CASE_ID)).toEqual(baseIntake);
    clearUnsavedIntakeDraft();
    expect(readUnsavedIntakeDraft(CASE_ID)).toBeNull();
  });
});

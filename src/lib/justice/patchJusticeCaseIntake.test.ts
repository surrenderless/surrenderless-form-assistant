import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  patchJusticeCaseIntake,
  readLocalIntakeUpdatedAt,
  writeLocalIntakeUpdatedAt,
} from "@/lib/justice/patchJusticeCaseIntake";
import { STORAGE_INTAKE } from "@/lib/justice/types";
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

  it("when no version is cached yet, GETs first to establish one before ever PATCHing — never sends an unprotected write", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { updated_at: "2026-01-01T00:00:00.000Z" })) // GET
      .mockResolvedValueOnce(
        jsonResponse(200, { intake: baseIntake, updated_at: "2026-01-01T00:05:00.000Z", timeline: [] })
      ); // PATCH

    const result = await patchJusticeCaseIntake(CASE_ID, baseIntake);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [getCall, patchCall] = fetchMock.mock.calls;
    expect(getCall[0]).toBe(`/api/justice/cases/${CASE_ID}`);
    expect(patchCall[1]?.method).toBe("PATCH");
    const patchBody = JSON.parse(patchCall[1]?.body as string);
    expect(patchBody.expected_updated_at).toBe("2026-01-01T00:00:00.000Z");
    expect(result.ok).toBe(true);
  });

  it("sends the CACHED version as expected_updated_at — never a value read fresh during this same call", async () => {
    writeLocalIntakeUpdatedAt("2026-03-01T00:00:00.000Z");
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { intake: baseIntake, updated_at: "2026-03-01T00:05:00.000Z", timeline: [] })
    );

    await patchJusticeCaseIntake(CASE_ID, baseIntake);

    expect(fetchMock).toHaveBeenCalledTimes(1); // no GET — a version was already cached
    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(body.expected_updated_at).toBe("2026-03-01T00:00:00.000Z");
  });

  it("on success, stores the NEW version returned by the server for the next write (sequential saves advance the token)", async () => {
    writeLocalIntakeUpdatedAt("2026-03-01T00:00:00.000Z");
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(200, { intake: baseIntake, updated_at: "2026-03-01T00:05:00.000Z", timeline: [] })
      )
      .mockResolvedValueOnce(
        jsonResponse(200, { intake: baseIntake, updated_at: "2026-03-01T00:10:00.000Z", timeline: [] })
      );

    const first = await patchJusticeCaseIntake(CASE_ID, baseIntake);
    expect(first.ok).toBe(true);
    expect(readLocalIntakeUpdatedAt()).toBe("2026-03-01T00:05:00.000Z");

    await patchJusticeCaseIntake(CASE_ID, baseIntake);
    const secondBody = JSON.parse(fetchMock.mock.calls[1][1]?.body as string);
    expect(secondBody.expected_updated_at).toBe("2026-03-01T00:05:00.000Z"); // the version from THIS session's last write
    expect(readLocalIntakeUpdatedAt()).toBe("2026-03-01T00:10:00.000Z");
  });

  it("on conflict (409), never retries the write itself, and reconciles by adopting the server's fresh state", async () => {
    writeLocalIntakeUpdatedAt("2026-01-01T00:00:00.000Z");
    const freshIntake = { ...baseIntake, company_name: "Someone else's edit" };
    fetchMock.mockResolvedValueOnce(
      jsonResponse(409, {
        error: "Case was updated concurrently. Reload and retry.",
        current: { intake: freshIntake, updated_at: "2026-01-02T00:00:00.000Z" },
      })
    );

    const result = await patchJusticeCaseIntake(CASE_ID, baseIntake);

    expect(fetchMock).toHaveBeenCalledTimes(1); // exactly one PATCH attempt — no automatic retry
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("conflict");
      expect(result.current?.updatedAt).toBe("2026-01-02T00:00:00.000Z");
    }
    // Reconciliation: the locally cached version and intake now reflect the ACTUAL server state,
    // not the stale write that was attempted — so the next call uses the correct token.
    expect(readLocalIntakeUpdatedAt()).toBe("2026-01-02T00:00:00.000Z");
    expect(JSON.parse(sessionStorage.getItem(STORAGE_INTAKE) ?? "null")).toEqual(freshIntake);
  });

  it("a missing precondition (server rejects with 400) is never silently treated as success", async () => {
    writeLocalIntakeUpdatedAt("2026-01-01T00:00:00.000Z");
    fetchMock.mockResolvedValueOnce(jsonResponse(400, { error: "Invalid expected_updated_at" }));

    const result = await patchJusticeCaseIntake(CASE_ID, baseIntake);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("request_failed");
  });
});

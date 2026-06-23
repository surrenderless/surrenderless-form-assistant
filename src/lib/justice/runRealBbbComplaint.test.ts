import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  REAL_BBB_ASSISTED_SUBMISSION_LANE,
  REAL_BBB_COMPLAINT_SUBMISSION_URL,
  resolveAssistedSubmissionFillUrl,
} from "@/lib/justice/assistedSubmissionLane";
import { runRealBbbComplaint } from "@/lib/justice/runRealBbbComplaint";
import { REAL_BBB_AUTOFILL_DISABLED_ERROR } from "@/lib/justice/realBbbAutofillEnabled";
import { labelForTimelineEntryType, readTimeline } from "@/lib/justice/timeline";
import type { JusticeIntake } from "@/lib/justice/types";
import { STORAGE_TIMELINE_V1 } from "@/lib/justice/types";

const CASE_ID = "550e8400-e29b-41d4-a716-446655440000";

const intake: JusticeIntake = {
  company_name: "Acme",
  company_website: "https://acme.example",
  problem_category: "charge_dispute",
  story: "Charged twice",
  money_involved: "$50",
  pay_or_order_date: "2026-01-01",
  order_confirmation_details: "",
  user_display_name: "User",
  reply_email: "user@example.com",
  purchase_or_signup: "Widget",
  already_contacted: "no",
};

function createSessionStorageMock() {
  const storage: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => storage[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      storage[key] = value;
    }),
    storage,
  };
}

describe("labelForTimelineEntryType", () => {
  it("maps real BBB complaint autofill timeline entry types", () => {
    expect(labelForTimelineEntryType("bbb_complaint_autofill_started")).toBe(
      "BBB complaint autofill started"
    );
    expect(labelForTimelineEntryType("bbb_complaint_autofill_completed")).toBe(
      "BBB complaint autofill completed"
    );
    expect(labelForTimelineEntryType("bbb_practice_started")).toBe("BBB practice started");
  });
});

describe("runRealBbbComplaint", () => {
  const fetchMock = vi.fn();
  let sessionStorageMock: ReturnType<typeof createSessionStorageMock>;

  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_JUSTICE_REAL_BBB_AUTOFILL_ENABLED", "true");
    sessionStorageMock = createSessionStorageMock();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("window", { location: { origin: "https://example.com" } });
    vi.stubGlobal("sessionStorage", sessionStorageMock);
    vi.stubGlobal("crypto", { randomUUID: () => "test-timeline-id" });
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("bbb.org")) {
        throw new Error("Tests must not contact bbb.org");
      }
      if (url.includes("/api/submit-form")) {
        return new Response(JSON.stringify({ fillResult: { storageSkipped: false } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("/api/justice/events")) {
        return new Response("{}", { status: 200 });
      }
      if (url.includes("/api/justice/cases/") && init?.method === "PATCH") {
        const body = JSON.parse(String(init.body)) as { timeline?: unknown };
        return new Response(JSON.stringify({ timeline: body.timeline ?? [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("{}", { status: 404 });
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("returns a clear error when real BBB autofill is disabled", async () => {
    vi.stubEnv("NEXT_PUBLIC_JUSTICE_REAL_BBB_AUTOFILL_ENABLED", "false");

    const result = await runRealBbbComplaint({
      intake,
      caseId: CASE_ID,
      isLoaded: true,
      isSignedIn: true,
    });

    expect(result).toEqual({ ok: false, error: REAL_BBB_AUTOFILL_DISABLED_ERROR });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns an error outside the browser", async () => {
    vi.unstubAllGlobals();
    await expect(
      runRealBbbComplaint({
        intake,
        caseId: null,
        isLoaded: false,
        isSignedIn: false,
      })
    ).resolves.toEqual({
      ok: false,
      error: "Real BBB autofill is only available in the browser.",
    });
  });

  it("submits the real BBB submission URL with mapped field values", async () => {
    const result = await runRealBbbComplaint({
      intake,
      caseId: CASE_ID,
      isLoaded: true,
      isSignedIn: true,
    });

    expect(result.ok).toBe(true);
    expect(resolveAssistedSubmissionFillUrl(REAL_BBB_ASSISTED_SUBMISSION_LANE, "https://example.com")).toBe(
      REAL_BBB_COMPLAINT_SUBMISSION_URL
    );

    const submitCall = fetchMock.mock.calls.find(([url]) => String(url).includes("/api/submit-form"));
    expect(submitCall).toBeDefined();
    const body = JSON.parse(String(submitCall?.[1]?.body)) as {
      url: string;
      userData: Record<string, string>;
    };
    expect(body.url).toBe(REAL_BBB_COMPLAINT_SUBMISSION_URL);
    expect(body.userData.business_name).toBe("Acme");
    expect(body.userData.business_website).toBe("https://acme.example");
    expect(body.userData.issue_type).toBe("charge dispute");
    expect(body.userData.what_happened).toBe("Charged twice");
    expect(body.userData.complaint_narrative).toContain("Charged twice");
    expect(body.userData.desired_resolution).toContain("Reversal of the charge");
    expect(body.userData.contact_email).toBe("user@example.com");
    expect(body.userData).not.toHaveProperty("company_name");
    expect(body.userData).not.toHaveProperty("complaint_description");

    expect(fetchMock.mock.calls.every(([url]) => !String(url).includes("bbb.org"))).toBe(true);

    const startedEvent = fetchMock.mock.calls.find(([url]) => String(url).includes("/api/justice/events"));
    expect(startedEvent).toBeDefined();
  });

  it("appends and syncs started/completed timeline events on success", async () => {
    const result = await runRealBbbComplaint({
      intake,
      caseId: CASE_ID,
      isLoaded: true,
      isSignedIn: true,
    });

    expect(result.ok).toBe(true);

    const timeline = readTimeline(CASE_ID);
    expect(timeline.map((entry) => entry.type)).toEqual([
      "bbb_complaint_autofill_started",
      "bbb_complaint_autofill_completed",
    ]);
    expect(timeline[0]?.label).toBe("BBB complaint autofill started");
    expect(timeline[1]?.label).toBe("BBB complaint autofill completed");

    const patchCalls = fetchMock.mock.calls.filter(
      ([url, init]) => String(url).includes("/api/justice/cases/") && init?.method === "PATCH"
    );
    expect(patchCalls).toHaveLength(2);
    expect(sessionStorageMock.storage[STORAGE_TIMELINE_V1]).toBeDefined();
  });

  it("appends failure completed timeline event and syncs when submit fails", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("bbb.org")) {
        throw new Error("Tests must not contact bbb.org");
      }
      if (url.includes("/api/submit-form")) {
        return new Response(JSON.stringify({ error: "Submit failed" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("/api/justice/events")) {
        return new Response("{}", { status: 200 });
      }
      if (url.includes("/api/justice/cases/") && init?.method === "PATCH") {
        const body = JSON.parse(String(init.body)) as { timeline?: unknown };
        return new Response(JSON.stringify({ timeline: body.timeline ?? [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("{}", { status: 404 });
    });

    const result = await runRealBbbComplaint({
      intake,
      caseId: CASE_ID,
      isLoaded: true,
      isSignedIn: true,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("Submit failed");
    }

    const timeline = readTimeline(CASE_ID);
    expect(timeline.map((entry) => entry.type)).toEqual([
      "bbb_complaint_autofill_started",
      "bbb_complaint_autofill_completed",
    ]);
    expect(timeline[1]?.detail).toBe("Did not complete");
  });
});

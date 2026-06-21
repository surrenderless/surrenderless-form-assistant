import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildMockBbbPracticeSubmissionUrl,
  MOCK_BBB_PRACTICE_ASSISTED_SUBMISSION_LANE,
} from "@/lib/justice/assistedSubmissionLane";
import {
  BBB_MOCK_COMPLETED_SESSION_KEY,
  intakeToMockBbbUserData,
  runBbbPractice,
} from "@/lib/justice/runBbbPractice";
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
  it("maps BBB practice timeline entry types", () => {
    expect(labelForTimelineEntryType("bbb_practice_started")).toBe("BBB practice started");
    expect(labelForTimelineEntryType("bbb_practice_completed")).toBe("BBB practice completed");
    expect(labelForTimelineEntryType("ftc_practice_started")).toBeUndefined();
  });
});

describe("intakeToMockBbbUserData", () => {
  it("maps intake to mock BBB page field names", () => {
    expect(intakeToMockBbbUserData(intake)).toEqual({
      issue_type: "billing",
      company_name: "Acme",
      company_website: "https://acme.example",
      complaint_description: expect.stringContaining("Charged twice"),
      incident_date: "2026-01-01",
      contact_full_name: "User",
      contact_email: "user@example.com",
      email: "user@example.com",
    });
  });
});

describe("runBbbPractice", () => {
  const fetchMock = vi.fn();
  let sessionStorageMock: ReturnType<typeof createSessionStorageMock>;

  beforeEach(() => {
    sessionStorageMock = createSessionStorageMock();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("window", { location: { origin: "https://example.com" } });
    vi.stubGlobal("sessionStorage", sessionStorageMock);
    vi.stubGlobal("crypto", { randomUUID: () => "test-timeline-id" });
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
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
    vi.clearAllMocks();
  });

  it("returns an error outside the browser", async () => {
    vi.unstubAllGlobals();
    await expect(
      runBbbPractice({
        intake,
        caseId: null,
        isLoaded: false,
        isSignedIn: false,
      })
    ).resolves.toEqual({
      ok: false,
      error: "Practice autofill is only available in the browser.",
    });
  });

  it("submits the mock BBB page URL with mapped field values", async () => {
    const result = await runBbbPractice({
      intake,
      caseId: CASE_ID,
      isLoaded: true,
      isSignedIn: true,
    });

    expect(result.ok).toBe(true);
    expect(buildMockBbbPracticeSubmissionUrl("https://example.com")).toBe(
      "https://example.com/mock/bbb-complaint"
    );
    expect(buildMockBbbPracticeSubmissionUrl("https://example.com")).toContain(
      MOCK_BBB_PRACTICE_ASSISTED_SUBMISSION_LANE.mockUrlPath
    );

    const submitCall = fetchMock.mock.calls.find(([url]) => String(url).includes("/api/submit-form"));
    expect(submitCall).toBeDefined();
    const body = JSON.parse(String(submitCall?.[1]?.body)) as {
      url: string;
      userData: Record<string, string>;
    };
    expect(body.url).toBe("https://example.com/mock/bbb-complaint");
    expect(body.userData.issue_type).toBe("billing");
    expect(body.userData.company_name).toBe("Acme");
    expect(body.userData.complaint_description).toContain("Charged twice");
    expect(body.userData.contact_email).toBe("user@example.com");

    expect(sessionStorageMock.setItem).toHaveBeenCalledWith(BBB_MOCK_COMPLETED_SESSION_KEY, "1");

    const startedEvent = fetchMock.mock.calls.find(([url]) => String(url).includes("/api/justice/events"));
    expect(startedEvent).toBeDefined();
  });

  it("appends and syncs started/completed timeline events on success", async () => {
    const result = await runBbbPractice({
      intake,
      caseId: CASE_ID,
      isLoaded: true,
      isSignedIn: true,
    });

    expect(result.ok).toBe(true);

    const timeline = readTimeline(CASE_ID);
    expect(timeline.map((entry) => entry.type)).toEqual(["bbb_practice_started", "bbb_practice_completed"]);
    expect(timeline[0]?.label).toBe("BBB practice started");
    expect(timeline[1]?.label).toBe("BBB practice completed");

    const patchCalls = fetchMock.mock.calls.filter(
      ([url, init]) => String(url).includes("/api/justice/cases/") && init?.method === "PATCH"
    );
    expect(patchCalls).toHaveLength(2);
    const firstPatchTimeline = JSON.parse(String(patchCalls[0]?.[1]?.body)).timeline as Array<{ type: string }>;
    const secondPatchTimeline = JSON.parse(String(patchCalls[1]?.[1]?.body)).timeline as Array<{ type: string }>;
    expect(firstPatchTimeline.map((entry) => entry.type)).toEqual(["bbb_practice_started"]);
    expect(secondPatchTimeline.map((entry) => entry.type)).toEqual([
      "bbb_practice_started",
      "bbb_practice_completed",
    ]);
    expect(sessionStorageMock.storage[STORAGE_TIMELINE_V1]).toBeDefined();
  });

  it("appends failure completed timeline event and syncs when submit fails", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
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

    const result = await runBbbPractice({
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
    expect(timeline.map((entry) => entry.type)).toEqual(["bbb_practice_started", "bbb_practice_completed"]);
    expect(timeline[1]?.detail).toBe("Did not complete");

    const patchCalls = fetchMock.mock.calls.filter(
      ([url, init]) => String(url).includes("/api/justice/cases/") && init?.method === "PATCH"
    );
    expect(patchCalls).toHaveLength(2);
  });
});

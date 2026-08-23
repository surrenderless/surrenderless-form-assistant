import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/server/requireUser", () => ({
  getUserOr401: vi.fn(),
}));

import { POST } from "@/app/api/testing/playwright-mock-case-reset/route";
import { getUserOr401 } from "@/server/requireUser";
import { PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID } from "@/lib/testing/playwrightMockIntakeCaseCommitPipeline";
import {
  buildPlaywrightMockCasePatchResponse,
  listPlaywrightMockCaseHydrationSnapshots,
  resetPlaywrightMockCaseHydrationSnapshotsForTests,
} from "@/lib/testing/playwrightMockIntakeCaseHydrationPipeline";
import {
  buildPlaywrightMockJusticeChatMessagesAppendResponse,
  buildPlaywrightMockJusticeChatMessagesGetResponse,
  resetPlaywrightMockJusticeChatMessagesForTests,
} from "@/lib/testing/playwrightMockJusticeChatMessagesPipeline";
import {
  getPlaywrightMockHumanFulfillmentTasks,
  resetPlaywrightMockHumanFulfillmentLadderForTests,
  setPlaywrightMockCaseOwnerUserId,
} from "@/lib/testing/playwrightMockHumanFulfillmentLadderPipeline";

const USER_ID = "user_test_123";
const CASE_ID = PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID;

const ALL_MOCK_PIPELINE_ENV = {
  PLAYWRIGHT_MOCK_INTAKE_CASE_HYDRATION_PIPELINE: "1",
  PLAYWRIGHT_MOCK_JUSTICE_CHAT_MESSAGES_PIPELINE: "1",
  PLAYWRIGHT_MOCK_JUSTICE_EVIDENCE_PIPELINE: "1",
  PLAYWRIGHT_MOCK_JUSTICE_FILINGS_PIPELINE: "1",
  PLAYWRIGHT_MOCK_JUSTICE_TASKS_PIPELINE: "1",
} as const;

function stubAllMockPipelineEnv() {
  for (const [key, value] of Object.entries(ALL_MOCK_PIPELINE_ENV)) {
    vi.stubEnv(key, value);
  }
}

function buildRequest(body?: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/testing/playwright-mock-case-reset", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("POST /api/testing/playwright-mock-case-reset", () => {
  beforeEach(() => {
    vi.mocked(getUserOr401).mockReturnValue(USER_ID);
    resetPlaywrightMockCaseHydrationSnapshotsForTests();
    resetPlaywrightMockJusticeChatMessagesForTests();
    resetPlaywrightMockHumanFulfillmentLadderForTests();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    resetPlaywrightMockCaseHydrationSnapshotsForTests();
    resetPlaywrightMockJusticeChatMessagesForTests();
    resetPlaywrightMockHumanFulfillmentLadderForTests();
  });

  describe("disabled behavior", () => {
    it("fails closed with 404 when the case-hydration pipeline flag is unset", async () => {
      const res = await POST(buildRequest());
      expect(res.status).toBe(404);
      expect(getUserOr401).not.toHaveBeenCalled();
    });

    it("fails closed with 404 on deployed production even when the flag is set", async () => {
      vi.stubEnv("PLAYWRIGHT_MOCK_INTAKE_CASE_HYDRATION_PIPELINE", "1");
      vi.stubEnv("VERCEL_ENV", "production");

      const res = await POST(buildRequest());
      expect(res.status).toBe(404);
    });

    it("returns 401 when no signed-in user, even with the pipeline enabled", async () => {
      vi.stubEnv("PLAYWRIGHT_MOCK_INTAKE_CASE_HYDRATION_PIPELINE", "1");
      vi.mocked(getUserOr401).mockReturnValue(null);

      const res = await POST(buildRequest());
      expect(res.status).toBe(401);
    });
  });

  describe("enabled behavior", () => {
    beforeEach(() => {
      stubAllMockPipelineEnv();
    });

    it("rejects a case id outside the known deterministic mock ids", async () => {
      const res = await POST(buildRequest({ case_id: "00000000-0000-4000-8000-000000000001" }));
      expect(res.status).toBe(400);
    });

    it("defaults to the primary E2E case id when no body/case_id is given", async () => {
      buildPlaywrightMockCasePatchResponse(CASE_ID, {
        client_state: { prepared_packet_approved: true },
      });

      const res = await POST(buildRequest());
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, case_id: CASE_ID });
    });

    it("removes the case from every mock store it touched, not just the case snapshot — the exact GET /api/justice/cases postcondition chat-ai's resume fallback depends on", async () => {
      // Seed state across every store the way production commit/escalation flows would.
      buildPlaywrightMockCasePatchResponse(CASE_ID, {
        client_state: {
          prepared_packet_approved: true,
          approved_next_action: {
            label: "Merchant contact",
            href: "/justice/merchant",
            status: "approved",
            approved_at: "2026-06-21T00:00:01.000Z",
          },
        },
      });
      setPlaywrightMockCaseOwnerUserId(CASE_ID, USER_ID);
      buildPlaywrightMockJusticeChatMessagesAppendResponse(CASE_ID, USER_ID, [
        { client_turn_id: "t1", role: "user", content: "I ordered a widget from Acme Retail." },
      ]);

      // Confirm the seed actually landed before testing the reset.
      expect(
        listPlaywrightMockCaseHydrationSnapshots().some((row) => row.id === CASE_ID)
      ).toBe(true);
      expect(
        buildPlaywrightMockJusticeChatMessagesGetResponse(CASE_ID, USER_ID)?.length
      ).toBeGreaterThan(0);
      expect(getPlaywrightMockHumanFulfillmentTasks(CASE_ID, USER_ID).length).toBeGreaterThan(0);

      const res = await POST(buildRequest({ case_id: CASE_ID }));
      expect(res.status).toBe(200);

      // The decisive postcondition: the case is entirely absent from the list backing
      // GET /api/justice/cases — not archived, not present — so chat-ai's
      // fetchLatestActiveJusticeCaseRow() has nothing to auto-resume. Asserted first, before
      // any other store's getter (some auto-create a baseline snapshot as a side effect).
      expect(
        listPlaywrightMockCaseHydrationSnapshots().some((row) => row.id === CASE_ID)
      ).toBe(false);

      // Ownership is cleared along with the tasks/ladder map (see
      // resetPlaywrightMockHumanFulfillmentLadderForCase), so the chat-messages ownership
      // gate now sees no owner at all rather than an empty-but-owned transcript.
      expect(buildPlaywrightMockJusticeChatMessagesGetResponse(CASE_ID, USER_ID)).toBeNull();
      expect(getPlaywrightMockHumanFulfillmentTasks(CASE_ID, USER_ID)).toEqual([]);
    });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ASSISTED_SUBMISSION_BBB_MOCK_PRACTICE_PREP_HREF,
  MOCK_BBB_PRACTICE_ASSISTED_SUBMISSION_LANE,
} from "@/lib/justice/assistedSubmissionLane";
import {
  buildBbbPracticeFilingBody,
  buildBbbPracticeSubmissionAttempt,
  BBB_PRACTICE_FILING_CONFIRMATION,
  BBB_PRACTICE_FILING_DESTINATION,
  recordBbbPracticeFiling,
} from "@/lib/justice/recordBbbPracticeFiling";
import { buildFilingBodyFromAttempt } from "@/lib/justice/submissionAttempt";
import type { RunBbbPracticeSuccess } from "@/lib/justice/runBbbPractice";

const CASE_ID = "550e8400-e29b-41d4-a716-446655440000";

describe("buildBbbPracticeFilingBody", () => {
  it("builds a practice filing with confirmation and notes", () => {
    const result: RunBbbPracticeSuccess = {
      ok: true,
      storageSkipped: true,
      technicalDetails: JSON.stringify({
        fillResult: {
          screenshot: "https://example.com/bbb-shot.png",
          storageReason: "Missing Supabase storage env vars",
        },
      }),
    };

    const body = buildBbbPracticeFilingBody(result);

    expect(body.destination).toBe(BBB_PRACTICE_FILING_DESTINATION);
    expect(body.confirmation_number).toBe(BBB_PRACTICE_FILING_CONFIRMATION);
    expect(body.filing_url).toBe("https://example.com/bbb-shot.png");
    expect(body.filed_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(body.notes).toContain("Mock BBB practice autofill completed");
    expect(body.notes).toContain(MOCK_BBB_PRACTICE_ASSISTED_SUBMISSION_LANE.mockUrlPath);
    expect(body.notes).toContain("Screenshot storage skipped on this run.");
    expect(body.notes).toContain("Missing Supabase storage env vars");
  });

  it("passes approval metadata into filing notes", () => {
    const result: RunBbbPracticeSuccess = {
      ok: true,
      storageSkipped: false,
      technicalDetails: JSON.stringify({ fillResult: {} }),
    };

    const body = buildFilingBodyFromAttempt(
      buildBbbPracticeSubmissionAttempt(result, CASE_ID, {
        executionContext: "assisted_after_packet_approval",
        approvedAt: "2026-06-15T10:00:00.000Z",
      })
    );

    expect(body?.notes).toContain("Assisted submission after packet approval (approved 2026-06-15T10:00:00.000Z).");
    expect(body?.notes).toContain("Mock BBB practice autofill completed");
    expect(body?.notes).toContain(MOCK_BBB_PRACTICE_ASSISTED_SUBMISSION_LANE.mockUrlPath);
  });

  it("builds submission attempt with lane id, destination, and confirmation", () => {
    const result: RunBbbPracticeSuccess = {
      ok: true,
      storageSkipped: false,
      technicalDetails: JSON.stringify({ fillResult: {} }),
    };

    const attempt = buildBbbPracticeSubmissionAttempt(result);

    expect(attempt.kind).toBe("bbb_practice");
    expect(attempt.kind).toBe(MOCK_BBB_PRACTICE_ASSISTED_SUBMISSION_LANE.id);
    expect(attempt.destination).toBe(MOCK_BBB_PRACTICE_ASSISTED_SUBMISSION_LANE.filingDestination);
    expect(attempt.confirmation).toBe(MOCK_BBB_PRACTICE_ASSISTED_SUBMISSION_LANE.filingConfirmation);
    expect(attempt.notes).toContain(MOCK_BBB_PRACTICE_ASSISTED_SUBMISSION_LANE.mockUrlPath);
    expect(ASSISTED_SUBMISSION_BBB_MOCK_PRACTICE_PREP_HREF).toBe("/justice/assisted-mock/bbb-practice");
  });
});

describe("recordBbbPracticeFiling", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ id: "filing-1" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("posts a filings record via recordSubmissionAttemptAsFiling", async () => {
    const result: RunBbbPracticeSuccess = {
      ok: true,
      storageSkipped: false,
      technicalDetails: JSON.stringify({ fillResult: {} }),
    };

    const recordResult = await recordBbbPracticeFiling(CASE_ID, result);

    expect(recordResult.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toBe("/api/justice/filings");
    expect(init.method).toBe("POST");
    const body = JSON.parse(String(init.body)) as Record<string, string>;
    expect(body.case_id).toBe(CASE_ID);
    expect(body.destination).toBe(BBB_PRACTICE_FILING_DESTINATION);
    expect(body.confirmation_number).toBe(BBB_PRACTICE_FILING_CONFIRMATION);
    expect(body.notes).toContain(MOCK_BBB_PRACTICE_ASSISTED_SUBMISSION_LANE.mockUrlPath);
  });
});

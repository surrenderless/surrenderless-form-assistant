import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ASSISTED_SUBMISSION_REAL_BBB_PREP_HREF,
  REAL_BBB_ASSISTED_SUBMISSION_LANE,
  REAL_BBB_COMPLAINT_SUBMISSION_URL,
} from "@/lib/justice/assistedSubmissionLane";
import {
  buildRealBbbComplaintFilingBody,
  buildRealBbbComplaintSubmissionAttempt,
  REAL_BBB_COMPLAINT_FILING_CONFIRMATION,
  REAL_BBB_COMPLAINT_FILING_DESTINATION,
  recordRealBbbComplaintFiling,
} from "@/lib/justice/recordRealBbbComplaintFiling";
import { buildFilingBodyFromAttempt } from "@/lib/justice/submissionAttempt";
import type { RunBbbPracticeSuccess } from "@/lib/justice/runBbbPractice";

const CASE_ID = "550e8400-e29b-41d4-a716-446655440000";

describe("buildRealBbbComplaintFilingBody", () => {
  it("builds a real BBB filing with confirmation and notes", () => {
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

    const body = buildRealBbbComplaintFilingBody(result);

    expect(body.destination).toBe(REAL_BBB_COMPLAINT_FILING_DESTINATION);
    expect(body.confirmation_number).toBe(REAL_BBB_COMPLAINT_FILING_CONFIRMATION);
    expect(body.filing_url).toBe("https://example.com/bbb-shot.png");
    expect(body.filed_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(body.notes).toContain("Real BBB complaint autofill completed");
    expect(body.notes).toContain(REAL_BBB_COMPLAINT_SUBMISSION_URL);
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
      buildRealBbbComplaintSubmissionAttempt(result, CASE_ID, {
        executionContext: "assisted_after_packet_approval",
        approvedAt: "2026-06-15T10:00:00.000Z",
      })
    );

    expect(body?.notes).toContain("Assisted submission after packet approval (approved 2026-06-15T10:00:00.000Z).");
    expect(body?.notes).toContain("Real BBB complaint autofill completed");
    expect(body?.notes).toContain(REAL_BBB_COMPLAINT_SUBMISSION_URL);
  });

  it("builds submission attempt with lane id, destination, and confirmation", () => {
    const result: RunBbbPracticeSuccess = {
      ok: true,
      storageSkipped: false,
      technicalDetails: JSON.stringify({ fillResult: {} }),
    };

    const attempt = buildRealBbbComplaintSubmissionAttempt(result);

    expect(attempt.kind).toBe("bbb_complaint");
    expect(attempt.kind).toBe(REAL_BBB_ASSISTED_SUBMISSION_LANE.id);
    expect(attempt.destination).toBe(REAL_BBB_ASSISTED_SUBMISSION_LANE.filingDestination);
    expect(attempt.confirmation).toBe(REAL_BBB_ASSISTED_SUBMISSION_LANE.filingConfirmation);
    expect(attempt.notes).toContain(REAL_BBB_COMPLAINT_SUBMISSION_URL);
    expect(ASSISTED_SUBMISSION_REAL_BBB_PREP_HREF).toBe("/justice/bbb");
  });
});

describe("recordRealBbbComplaintFiling", () => {
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

    const recordResult = await recordRealBbbComplaintFiling(CASE_ID, result);

    expect(recordResult.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toBe("/api/justice/filings");
    expect(init.method).toBe("POST");
    const body = JSON.parse(String(init.body)) as Record<string, string>;
    expect(body.case_id).toBe(CASE_ID);
    expect(body.destination).toBe(REAL_BBB_COMPLAINT_FILING_DESTINATION);
    expect(body.confirmation_number).toBe(REAL_BBB_COMPLAINT_FILING_CONFIRMATION);
    expect(body.notes).toContain(REAL_BBB_COMPLAINT_SUBMISSION_URL);
  });
});

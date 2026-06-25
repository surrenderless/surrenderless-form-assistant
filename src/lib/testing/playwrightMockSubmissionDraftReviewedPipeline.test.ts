import { afterEach, describe, expect, it, vi } from "vitest";
import { SUBMISSION_DRAFT_REVIEWED_TIMELINE_ID } from "@/lib/justice/timeline";
import { PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID } from "@/lib/testing/playwrightMockIntakeCaseCommitPipeline";
import {
  buildPlaywrightMockSubmissionDraftReviewedResponse,
  isPlaywrightMockSubmissionDraftReviewedPipelineEnabled,
} from "@/lib/testing/playwrightMockSubmissionDraftReviewedPipeline";

describe("playwrightMockSubmissionDraftReviewedPipeline", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is disabled unless PLAYWRIGHT_MOCK_SUBMISSION_DRAFT_REVIEWED_PIPELINE=1", () => {
    expect(isPlaywrightMockSubmissionDraftReviewedPipelineEnabled()).toBe(false);
    vi.stubEnv("PLAYWRIGHT_MOCK_SUBMISSION_DRAFT_REVIEWED_PIPELINE", "1");
    expect(isPlaywrightMockSubmissionDraftReviewedPipelineEnabled()).toBe(true);
  });

  it("is disabled on deployed production even when the flag is set", () => {
    vi.stubEnv("PLAYWRIGHT_MOCK_SUBMISSION_DRAFT_REVIEWED_PIPELINE", "1");
    vi.stubEnv("VERCEL_ENV", "production");
    expect(isPlaywrightMockSubmissionDraftReviewedPipelineEnabled()).toBe(false);
  });

  it("returns production POST /api/justice/submission-draft-reviewed contract", () => {
    const result = buildPlaywrightMockSubmissionDraftReviewedResponse(
      PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID,
      { destinationLabel: "FTC complaint (practice)", usedAi: false }
    );

    expect(Array.isArray(result.timeline)).toBe(true);
    expect(result.timeline).toHaveLength(2);
    expect(result.timeline[1]?.id).toBe(SUBMISSION_DRAFT_REVIEWED_TIMELINE_ID);
    expect(result.timeline[1]?.type).toBe("submission_draft_reviewed");
    expect(result.timeline[1]?.label).toBe("Submission draft reviewed");
    expect(result.timeline[1]?.case_id).toBe(PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID);
    expect(result.timeline[1]?.detail).toContain("FTC complaint (practice)");
    expect(result.timeline[1]?.detail).toContain("Deterministic draft only.");
  });
});

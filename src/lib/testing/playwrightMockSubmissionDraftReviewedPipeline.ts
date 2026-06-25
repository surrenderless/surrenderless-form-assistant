import {
  buildSubmissionDraftReviewedDetail,
  SUBMISSION_DRAFT_REVIEWED_TIMELINE_ID,
} from "@/lib/justice/timeline";
import type { TimelineEntry } from "@/lib/justice/types";

const PLAYWRIGHT_MOCK_CASE_STARTED_TIMESTAMP = "2026-06-21T00:00:00.000Z";
const PLAYWRIGHT_MOCK_SUBMISSION_DRAFT_REVIEWED_TIMESTAMP = "2026-06-21T00:00:01.000Z";
const PLAYWRIGHT_MOCK_CASE_STARTED_TIMELINE_ID = "playwright_e2e_case_started";

export type PlaywrightMockSubmissionDraftReviewedResponse = {
  timeline: TimelineEntry[];
};

/** Enabled only when Playwright webServer sets PLAYWRIGHT_MOCK_SUBMISSION_DRAFT_REVIEWED_PIPELINE=1. */
export function isPlaywrightMockSubmissionDraftReviewedPipelineEnabled(): boolean {
  if (process.env.PLAYWRIGHT_MOCK_SUBMISSION_DRAFT_REVIEWED_PIPELINE !== "1") {
    return false;
  }
  // Never allow on deployed production, even if the env var is set.
  if (process.env.VERCEL_ENV === "production") {
    return false;
  }
  return true;
}

/**
 * Deterministic POST /api/justice/submission-draft-reviewed response for Playwright E2E.
 * Matches production route shape without Supabase persistence.
 */
export function buildPlaywrightMockSubmissionDraftReviewedResponse(
  caseId: string,
  opts: { destinationLabel?: string; usedAi?: boolean } = {}
): PlaywrightMockSubmissionDraftReviewedResponse {
  const detail = buildSubmissionDraftReviewedDetail(opts);

  return {
    timeline: [
      {
        id: PLAYWRIGHT_MOCK_CASE_STARTED_TIMELINE_ID,
        case_id: caseId,
        type: "case_started",
        label: "Case started",
        ts: PLAYWRIGHT_MOCK_CASE_STARTED_TIMESTAMP,
      },
      {
        id: SUBMISSION_DRAFT_REVIEWED_TIMELINE_ID,
        case_id: caseId,
        type: "submission_draft_reviewed",
        label: "Submission draft reviewed",
        ts: PLAYWRIGHT_MOCK_SUBMISSION_DRAFT_REVIEWED_TIMESTAMP,
        detail,
      },
    ],
  };
}

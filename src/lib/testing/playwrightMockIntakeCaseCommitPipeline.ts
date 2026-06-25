/** Deterministic server case id returned by the Playwright intake commit mock. */
export const PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID =
  "00000000-0000-4000-8000-000000000745";

const PLAYWRIGHT_MOCK_CASE_CREATE_TIMESTAMP = "2026-06-21T00:00:00.000Z";

export type PlaywrightMockCaseCreateResponse = {
  id: string;
  intake: unknown;
  timeline: unknown;
  payment_dispute_draft: unknown;
  client_state: unknown;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  case_label: string | null;
};

/** Enabled only when Playwright webServer sets PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_PIPELINE=1. */
export function isPlaywrightMockIntakeCaseCommitPipelineEnabled(): boolean {
  if (process.env.PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_PIPELINE !== "1") {
    return false;
  }
  // Never allow on deployed production, even if the env var is set.
  if (process.env.VERCEL_ENV === "production") {
    return false;
  }
  return true;
}

/**
 * Deterministic POST /api/justice/cases response for Playwright E2E.
 * Matches production route shape without Supabase persistence.
 */
export function buildPlaywrightMockCaseCreateResponse(
  intake: unknown,
  timeline: unknown,
  payment_dispute_draft: unknown = null,
  client_state: unknown = null
): PlaywrightMockCaseCreateResponse {
  return {
    id: PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID,
    intake,
    timeline,
    payment_dispute_draft,
    client_state,
    created_at: PLAYWRIGHT_MOCK_CASE_CREATE_TIMESTAMP,
    updated_at: PLAYWRIGHT_MOCK_CASE_CREATE_TIMESTAMP,
    archived_at: null,
    case_label: null,
  };
}

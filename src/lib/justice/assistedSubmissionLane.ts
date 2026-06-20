/** Mock FTC practice lane for assisted submission after packet approval. */
export const MOCK_FTC_PRACTICE_ASSISTED_SUBMISSION_LANE = {
  id: "ftc_practice",
  name: "FTC mock practice",
  mockUrlPath: "/mock/ftc-complaint",
  filingDestination: "FTC (practice)",
  filingConfirmation: "FTC mock practice complete",
} as const;

export type MockFtcPracticeAssistedSubmissionLaneId =
  (typeof MOCK_FTC_PRACTICE_ASSISTED_SUBMISSION_LANE)["id"];

export function buildMockFtcPracticeSubmissionUrl(origin: string): string {
  return `${origin}${MOCK_FTC_PRACTICE_ASSISTED_SUBMISSION_LANE.mockUrlPath}`;
}

/** Approved-action href for mock FTC practice assisted submission. */
export const ASSISTED_SUBMISSION_FTC_MOCK_PRACTICE_PREP_HREF = "/justice/ftc-review";

/** Mock FTC practice lane for assisted submission after packet approval. */
export const MOCK_FTC_PRACTICE_ASSISTED_SUBMISSION_LANE = {
  id: "ftc_practice",
  name: "FTC mock practice",
  mockUrlPath: "/mock/ftc-complaint",
  filingDestination: "FTC (practice)",
  filingConfirmation: "FTC mock practice complete",
} as const;

/** Approved-action href for mock BBB practice assisted submission. */
export const ASSISTED_SUBMISSION_BBB_MOCK_PRACTICE_PREP_HREF =
  "/justice/assisted-mock/bbb-practice";

/** Mock BBB practice lane for assisted submission after packet approval. */
export const MOCK_BBB_PRACTICE_ASSISTED_SUBMISSION_LANE = {
  id: "bbb_practice",
  name: "BBB mock practice",
  mockUrlPath: "/mock/bbb-complaint",
  filingDestination: "BBB (practice)",
  filingConfirmation: "BBB mock practice complete",
} as const;

export type AssistedSubmissionLaneConfig =
  | typeof MOCK_FTC_PRACTICE_ASSISTED_SUBMISSION_LANE
  | typeof MOCK_BBB_PRACTICE_ASSISTED_SUBMISSION_LANE;

export type MockFtcPracticeAssistedSubmissionLaneId =
  (typeof MOCK_FTC_PRACTICE_ASSISTED_SUBMISSION_LANE)["id"];

export type MockBbbPracticeAssistedSubmissionLaneId =
  (typeof MOCK_BBB_PRACTICE_ASSISTED_SUBMISSION_LANE)["id"];

export function buildMockFtcPracticeSubmissionUrl(origin: string): string {
  return `${origin}${MOCK_FTC_PRACTICE_ASSISTED_SUBMISSION_LANE.mockUrlPath}`;
}

export function buildMockBbbPracticeSubmissionUrl(origin: string): string {
  return `${origin}${MOCK_BBB_PRACTICE_ASSISTED_SUBMISSION_LANE.mockUrlPath}`;
}

/** Lanes that may activate assisted mock submission eligibility/prep/run today. */
export function isRunnableAssistedSubmissionLane(lane: AssistedSubmissionLaneConfig): boolean {
  return (
    lane.id === MOCK_FTC_PRACTICE_ASSISTED_SUBMISSION_LANE.id ||
    lane.id === MOCK_BBB_PRACTICE_ASSISTED_SUBMISSION_LANE.id
  );
}

/** Map an approved next-action href to its assisted-submission lane, if any. */
export function resolveAssistedSubmissionLaneForApprovedHref(
  href: string | null | undefined
): AssistedSubmissionLaneConfig | undefined {
  const trimmed = href?.trim();
  if (!trimmed) return undefined;
  if (trimmed === ASSISTED_SUBMISSION_FTC_MOCK_PRACTICE_PREP_HREF) {
    return MOCK_FTC_PRACTICE_ASSISTED_SUBMISSION_LANE;
  }
  if (trimmed === ASSISTED_SUBMISSION_BBB_MOCK_PRACTICE_PREP_HREF) {
    return MOCK_BBB_PRACTICE_ASSISTED_SUBMISSION_LANE;
  }
  return undefined;
}

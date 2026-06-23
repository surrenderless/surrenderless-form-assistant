import { isRealBbbComplaintAutofillEnabled } from "@/lib/justice/realBbbAutofillEnabled";

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

/** Approved-action href for real BBB complaint assisted submission. */
export const ASSISTED_SUBMISSION_REAL_BBB_PREP_HREF = "/justice/bbb";

/** Canonical filing destination for real BBB (matches MANUAL_ACTION_TRACKING_REAL_BBB_FILING_DESTINATIONS). */
export const REAL_BBB_COMPLAINT_FILING_DESTINATION = "Better Business Bureau" as const;

/** Official BBB.org entry point (same URL linked from /justice/bbb prep). */
export const REAL_BBB_COMPLAINT_SUBMISSION_URL = "https://www.bbb.org";

/** Real BBB complaint lane for assisted submission after packet approval. */
export const REAL_BBB_ASSISTED_SUBMISSION_LANE = {
  id: "bbb_complaint",
  name: "BBB complaint",
  prepHref: ASSISTED_SUBMISSION_REAL_BBB_PREP_HREF,
  submissionUrl: REAL_BBB_COMPLAINT_SUBMISSION_URL,
  filingDestination: REAL_BBB_COMPLAINT_FILING_DESTINATION,
  filingConfirmation: "BBB complaint complete",
} as const;

export type AssistedSubmissionLaneConfig =
  | typeof MOCK_FTC_PRACTICE_ASSISTED_SUBMISSION_LANE
  | typeof MOCK_BBB_PRACTICE_ASSISTED_SUBMISSION_LANE
  | typeof REAL_BBB_ASSISTED_SUBMISSION_LANE;

export type MockFtcPracticeAssistedSubmissionLaneId =
  (typeof MOCK_FTC_PRACTICE_ASSISTED_SUBMISSION_LANE)["id"];

export type MockBbbPracticeAssistedSubmissionLaneId =
  (typeof MOCK_BBB_PRACTICE_ASSISTED_SUBMISSION_LANE)["id"];

export type RealBbbAssistedSubmissionLaneId = (typeof REAL_BBB_ASSISTED_SUBMISSION_LANE)["id"];

export function buildMockFtcPracticeSubmissionUrl(origin: string): string {
  return `${origin}${MOCK_FTC_PRACTICE_ASSISTED_SUBMISSION_LANE.mockUrlPath}`;
}

export function buildMockBbbPracticeSubmissionUrl(origin: string): string {
  return `${origin}${MOCK_BBB_PRACTICE_ASSISTED_SUBMISSION_LANE.mockUrlPath}`;
}

export function buildRealBbbComplaintSubmissionUrl(): string {
  return REAL_BBB_ASSISTED_SUBMISSION_LANE.submissionUrl;
}

export function isMockAssistedSubmissionLane(
  lane: AssistedSubmissionLaneConfig
): lane is typeof MOCK_FTC_PRACTICE_ASSISTED_SUBMISSION_LANE | typeof MOCK_BBB_PRACTICE_ASSISTED_SUBMISSION_LANE {
  return (
    lane.id === MOCK_FTC_PRACTICE_ASSISTED_SUBMISSION_LANE.id ||
    lane.id === MOCK_BBB_PRACTICE_ASSISTED_SUBMISSION_LANE.id
  );
}

export function isExternalAssistedSubmissionLane(
  lane: AssistedSubmissionLaneConfig
): lane is typeof REAL_BBB_ASSISTED_SUBMISSION_LANE {
  return lane.id === REAL_BBB_ASSISTED_SUBMISSION_LANE.id;
}

/** Mock lanes use same-origin mock paths; external lanes use absolute submission URLs. */
export function resolveAssistedSubmissionFillUrl(lane: AssistedSubmissionLaneConfig, origin: string): string {
  if (isMockAssistedSubmissionLane(lane)) {
    return `${origin}${lane.mockUrlPath}`;
  }
  return lane.submissionUrl;
}

/** Lanes that may activate assisted submission eligibility/prep/run in chat today. */
export function isRunnableAssistedSubmissionLane(lane: AssistedSubmissionLaneConfig): boolean {
  if (lane.id === MOCK_FTC_PRACTICE_ASSISTED_SUBMISSION_LANE.id) return true;
  if (lane.id === MOCK_BBB_PRACTICE_ASSISTED_SUBMISSION_LANE.id) return true;
  if (lane.id === REAL_BBB_ASSISTED_SUBMISSION_LANE.id) {
    return isRealBbbComplaintAutofillEnabled();
  }
  return false;
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
  if (trimmed === ASSISTED_SUBMISSION_REAL_BBB_PREP_HREF) {
    return REAL_BBB_ASSISTED_SUBMISSION_LANE;
  }
  return undefined;
}

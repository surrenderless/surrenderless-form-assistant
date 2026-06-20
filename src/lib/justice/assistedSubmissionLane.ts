import { CHAT_INLINE_FTC_REVIEW_PREP_HREF } from "@/lib/justice/chatInlineApprovedPrep";

/** Mock FTC practice lane for assisted submission after packet approval. */
export const MOCK_FTC_PRACTICE_ASSISTED_SUBMISSION_LANE = {
  id: "ftc_practice",
  name: "FTC mock practice",
  mockUrlPath: "/mock/ftc-complaint",
  filingDestination: "FTC (practice)",
  filingConfirmation: "FTC mock practice complete",
} as const;

export type AssistedSubmissionLaneConfig = typeof MOCK_FTC_PRACTICE_ASSISTED_SUBMISSION_LANE;

export type MockFtcPracticeAssistedSubmissionLaneId =
  (typeof MOCK_FTC_PRACTICE_ASSISTED_SUBMISSION_LANE)["id"];

export function buildMockFtcPracticeSubmissionUrl(origin: string): string {
  return `${origin}${MOCK_FTC_PRACTICE_ASSISTED_SUBMISSION_LANE.mockUrlPath}`;
}

/** Map an approved next-action href to its assisted-submission lane, if any. */
export function resolveAssistedSubmissionLaneForApprovedHref(
  href: string | null | undefined
): AssistedSubmissionLaneConfig | undefined {
  const trimmed = href?.trim();
  if (trimmed === CHAT_INLINE_FTC_REVIEW_PREP_HREF) {
    return MOCK_FTC_PRACTICE_ASSISTED_SUBMISSION_LANE;
  }
  return undefined;
}

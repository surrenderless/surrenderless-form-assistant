import type { RunBbbPracticeSuccess } from "@/lib/justice/runBbbPractice";
import { MOCK_BBB_PRACTICE_ASSISTED_SUBMISSION_LANE } from "@/lib/justice/assistedSubmissionLane";
import {
  buildFilingBodyFromAttempt,
  BBB_PRACTICE_FILING_CONFIRMATION,
  BBB_PRACTICE_FILING_DESTINATION,
  recordSubmissionAttemptAsFiling,
  type RecordSubmissionAttemptAsFilingResult,
  type SubmissionAttemptExecutionContext,
  type SubmissionAttemptOutcome,
} from "@/lib/justice/submissionAttempt";

export { BBB_PRACTICE_FILING_CONFIRMATION, BBB_PRACTICE_FILING_DESTINATION };

export type BbbPracticeFilingOptions = {
  approvedAt?: string;
  executionContext?: SubmissionAttemptExecutionContext;
};

function parseBbbPracticeFillResult(technicalDetails: string): {
  screenshot?: string;
  storageReason?: string;
} {
  try {
    const parsed = JSON.parse(technicalDetails) as {
      fillResult?: { screenshot?: string; storageReason?: string };
    };
    const fillResult = parsed.fillResult;
    if (!fillResult || typeof fillResult !== "object") return {};
    return {
      screenshot:
        typeof fillResult.screenshot === "string" && fillResult.screenshot.trim()
          ? fillResult.screenshot.trim()
          : undefined,
      storageReason:
        typeof fillResult.storageReason === "string" && fillResult.storageReason.trim()
          ? fillResult.storageReason.trim()
          : undefined,
    };
  } catch {
    return {};
  }
}

export function buildBbbPracticeSubmissionAttempt(
  result: RunBbbPracticeSuccess,
  caseId = "",
  options?: BbbPracticeFilingOptions
): SubmissionAttemptOutcome {
  const attemptedAt = new Date().toISOString();
  const { screenshot, storageReason } = parseBbbPracticeFillResult(result.technicalDetails);
  const noteParts = [
    `Mock BBB practice autofill completed (${MOCK_BBB_PRACTICE_ASSISTED_SUBMISSION_LANE.mockUrlPath}).`,
    result.storageSkipped ? "Screenshot storage skipped on this run." : null,
    storageReason ?? null,
  ].filter((part): part is string => Boolean(part));
  const approvedAt = options?.approvedAt?.trim();

  return {
    kind: MOCK_BBB_PRACTICE_ASSISTED_SUBMISSION_LANE.id,
    caseId,
    status: "success",
    attemptedAt,
    filedAt: attemptedAt,
    destination: MOCK_BBB_PRACTICE_ASSISTED_SUBMISSION_LANE.filingDestination,
    confirmation: MOCK_BBB_PRACTICE_ASSISTED_SUBMISSION_LANE.filingConfirmation,
    notes: noteParts.join(" "),
    ...(screenshot ? { artifactUrl: screenshot } : {}),
    ...(approvedAt ? { approvedAt } : {}),
    ...(options?.executionContext ? { executionContext: options.executionContext } : {}),
  };
}

export function buildBbbPracticeFilingBody(result: RunBbbPracticeSuccess): Record<string, string> {
  const body = buildFilingBodyFromAttempt(buildBbbPracticeSubmissionAttempt(result));
  if (!body) {
    throw new Error("BBB practice attempt did not produce a filing body.");
  }
  return body;
}

export type RecordBbbPracticeFilingResult = RecordSubmissionAttemptAsFilingResult;

/** Persist a mock BBB practice run as a justice_case_filings row (practice lane only). */
export async function recordBbbPracticeFiling(
  caseId: string,
  result: RunBbbPracticeSuccess,
  options?: BbbPracticeFilingOptions
): Promise<RecordBbbPracticeFilingResult> {
  return recordSubmissionAttemptAsFiling(buildBbbPracticeSubmissionAttempt(result, caseId, options));
}

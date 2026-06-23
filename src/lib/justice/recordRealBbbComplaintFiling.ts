import { REAL_BBB_ASSISTED_SUBMISSION_LANE } from "@/lib/justice/assistedSubmissionLane";
import type { RunBbbPracticeSuccess } from "@/lib/justice/runBbbPractice";
import {
  buildFilingBodyFromAttempt,
  recordSubmissionAttemptAsFiling,
  type RecordSubmissionAttemptAsFilingResult,
  type SubmissionAttemptExecutionContext,
  type SubmissionAttemptOutcome,
} from "@/lib/justice/submissionAttempt";

export const REAL_BBB_COMPLAINT_FILING_DESTINATION =
  REAL_BBB_ASSISTED_SUBMISSION_LANE.filingDestination;

export const REAL_BBB_COMPLAINT_FILING_CONFIRMATION =
  REAL_BBB_ASSISTED_SUBMISSION_LANE.filingConfirmation;

export type RealBbbComplaintFilingOptions = {
  approvedAt?: string;
  executionContext?: SubmissionAttemptExecutionContext;
};

function parseRealBbbComplaintFillResult(technicalDetails: string): {
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

export function buildRealBbbComplaintSubmissionAttempt(
  result: RunBbbPracticeSuccess,
  caseId = "",
  options?: RealBbbComplaintFilingOptions
): SubmissionAttemptOutcome {
  const attemptedAt = new Date().toISOString();
  const { screenshot, storageReason } = parseRealBbbComplaintFillResult(result.technicalDetails);
  const noteParts = [
    `Real BBB complaint autofill completed (${REAL_BBB_ASSISTED_SUBMISSION_LANE.submissionUrl}).`,
    result.storageSkipped ? "Screenshot storage skipped on this run." : null,
    storageReason ?? null,
  ].filter((part): part is string => Boolean(part));
  const approvedAt = options?.approvedAt?.trim();

  return {
    kind: REAL_BBB_ASSISTED_SUBMISSION_LANE.id,
    caseId,
    status: "success",
    attemptedAt,
    filedAt: attemptedAt,
    destination: REAL_BBB_ASSISTED_SUBMISSION_LANE.filingDestination,
    confirmation: REAL_BBB_ASSISTED_SUBMISSION_LANE.filingConfirmation,
    notes: noteParts.join(" "),
    ...(screenshot ? { artifactUrl: screenshot } : {}),
    ...(approvedAt ? { approvedAt } : {}),
    ...(options?.executionContext ? { executionContext: options.executionContext } : {}),
  };
}

export function buildRealBbbComplaintFilingBody(result: RunBbbPracticeSuccess): Record<string, string> {
  const body = buildFilingBodyFromAttempt(buildRealBbbComplaintSubmissionAttempt(result));
  if (!body) {
    throw new Error("Real BBB complaint attempt did not produce a filing body.");
  }
  return body;
}

export type RecordRealBbbComplaintFilingResult = RecordSubmissionAttemptAsFilingResult;

/** Persist a real BBB complaint run as a justice_case_filings row (real lane only). */
export async function recordRealBbbComplaintFiling(
  caseId: string,
  result: RunBbbPracticeSuccess,
  options?: RealBbbComplaintFilingOptions
): Promise<RecordRealBbbComplaintFilingResult> {
  return recordSubmissionAttemptAsFiling(buildRealBbbComplaintSubmissionAttempt(result, caseId, options));
}

import type { RunFtcPracticeSuccess } from "@/lib/justice/runFtcPractice";
import {
  buildFilingBodyFromAttempt,
  FTC_PRACTICE_FILING_CONFIRMATION,
  FTC_PRACTICE_FILING_DESTINATION,
  recordSubmissionAttemptAsFiling,
  type RecordSubmissionAttemptAsFilingResult,
  type SubmissionAttemptExecutionContext,
  type SubmissionAttemptOutcome,
} from "@/lib/justice/submissionAttempt";

export { FTC_PRACTICE_FILING_CONFIRMATION, FTC_PRACTICE_FILING_DESTINATION };

export type FtcPracticeFilingOptions = {
  approvedAt?: string;
  executionContext?: SubmissionAttemptExecutionContext;
};

function parseFtcPracticeFillResult(technicalDetails: string): {
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

export function buildFtcPracticeSubmissionAttempt(
  result: RunFtcPracticeSuccess,
  caseId = "",
  options?: FtcPracticeFilingOptions
): SubmissionAttemptOutcome {
  const attemptedAt = new Date().toISOString();
  const { screenshot, storageReason } = parseFtcPracticeFillResult(result.technicalDetails);
  const noteParts = [
    "Mock FTC practice autofill completed (/mock/ftc-complaint).",
    result.storageSkipped ? "Screenshot storage skipped on this run." : null,
    storageReason ?? null,
  ].filter((part): part is string => Boolean(part));
  const approvedAt = options?.approvedAt?.trim();

  return {
    kind: "ftc_practice",
    caseId,
    status: "success",
    attemptedAt,
    filedAt: attemptedAt,
    destination: FTC_PRACTICE_FILING_DESTINATION,
    confirmation: FTC_PRACTICE_FILING_CONFIRMATION,
    notes: noteParts.join(" "),
    ...(screenshot ? { artifactUrl: screenshot } : {}),
    ...(approvedAt ? { approvedAt } : {}),
    ...(options?.executionContext ? { executionContext: options.executionContext } : {}),
  };
}

export function buildFtcPracticeFilingBody(result: RunFtcPracticeSuccess): Record<string, string> {
  const body = buildFilingBodyFromAttempt(buildFtcPracticeSubmissionAttempt(result));
  if (!body) {
    throw new Error("FTC practice attempt did not produce a filing body.");
  }
  return body;
}

export type RecordFtcPracticeFilingResult = RecordSubmissionAttemptAsFilingResult;

/** Persist a mock FTC practice run as a justice_case_filings row (practice lane only). */
export async function recordFtcPracticeFiling(
  caseId: string,
  result: RunFtcPracticeSuccess,
  options?: FtcPracticeFilingOptions
): Promise<RecordFtcPracticeFilingResult> {
  return recordSubmissionAttemptAsFiling(buildFtcPracticeSubmissionAttempt(result, caseId, options));
}

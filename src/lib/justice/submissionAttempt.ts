import {
  MOCK_BBB_PRACTICE_ASSISTED_SUBMISSION_LANE,
  MOCK_FTC_PRACTICE_ASSISTED_SUBMISSION_LANE,
} from "@/lib/justice/assistedSubmissionLane";

export type SubmissionAttemptKind = "ftc_practice" | "bbb_practice";

export type SubmissionAttemptStatus = "success" | "failed";

export type SubmissionAttemptExecutionContext = "assisted_after_packet_approval";

export type SubmissionAttemptOutcome = {
  kind: SubmissionAttemptKind;
  caseId: string;
  status: SubmissionAttemptStatus;
  attemptedAt: string;
  destination: string;
  confirmation?: string;
  notes?: string;
  artifactUrl?: string;
  filedAt?: string;
  approvedAt?: string;
  executionContext?: SubmissionAttemptExecutionContext;
};

export function buildSubmissionAttemptFilingNotes(outcome: SubmissionAttemptOutcome): string | undefined {
  const parts: string[] = [];
  if (outcome.executionContext === "assisted_after_packet_approval") {
    const approvedAt = outcome.approvedAt?.trim();
    parts.push(
      approvedAt
        ? `Assisted submission after packet approval (approved ${approvedAt}).`
        : "Assisted submission after packet approval."
    );
  }
  const base = outcome.notes?.trim();
  if (base) parts.push(base);
  return parts.length > 0 ? parts.join(" ") : undefined;
}

export const FTC_PRACTICE_FILING_DESTINATION =
  MOCK_FTC_PRACTICE_ASSISTED_SUBMISSION_LANE.filingDestination;

export const FTC_PRACTICE_FILING_CONFIRMATION =
  MOCK_FTC_PRACTICE_ASSISTED_SUBMISSION_LANE.filingConfirmation;

export const BBB_PRACTICE_FILING_DESTINATION =
  MOCK_BBB_PRACTICE_ASSISTED_SUBMISSION_LANE.filingDestination;

export const BBB_PRACTICE_FILING_CONFIRMATION =
  MOCK_BBB_PRACTICE_ASSISTED_SUBMISSION_LANE.filingConfirmation;

export type RecordSubmissionAttemptAsFilingResult =
  | { ok: true; payload: unknown }
  | { ok: false; error: string };

/** Map a successful submission attempt to a justice_case_filings POST body (without case_id). */
export function buildFilingBodyFromAttempt(
  outcome: SubmissionAttemptOutcome
): Record<string, string> | null {
  if (outcome.status !== "success") return null;

  const body: Record<string, string> = {
    destination: outcome.destination.trim(),
    filed_at: (outcome.filedAt ?? outcome.attemptedAt).trim(),
  };

  const confirmation = outcome.confirmation?.trim();
  if (confirmation) body.confirmation_number = confirmation;

  const notes = buildSubmissionAttemptFilingNotes(outcome);
  if (notes) body.notes = notes;

  const artifactUrl = outcome.artifactUrl?.trim();
  if (artifactUrl) body.filing_url = artifactUrl;

  return body;
}

/** Persist a successful submission attempt as a justice_case_filings row. */
export async function recordSubmissionAttemptAsFiling(
  outcome: SubmissionAttemptOutcome
): Promise<RecordSubmissionAttemptAsFilingResult> {
  const body = buildFilingBodyFromAttempt(outcome);
  if (!body) {
    return { ok: false, error: "Submission attempt did not produce a filing record." };
  }

  const caseId = outcome.caseId.trim();
  if (!caseId) {
    return { ok: false, error: "caseId is required." };
  }

  try {
    const res = await fetch("/api/justice/filings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        case_id: caseId,
        ...body,
      }),
    });
    const payload: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const err = (payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {}) as {
        error?: string;
      };
      return { ok: false, error: err.error ?? "Could not save filing record." };
    }
    return { ok: true, payload };
  } catch {
    return { ok: false, error: "Could not save filing record." };
  }
}

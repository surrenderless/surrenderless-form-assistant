import { parseJusticeCaseClientState } from "@/lib/justice/approvedNextActionState";
import {
  MOCK_BBB_PRACTICE_ASSISTED_SUBMISSION_LANE,
  MOCK_FTC_PRACTICE_ASSISTED_SUBMISSION_LANE,
} from "@/lib/justice/assistedSubmissionLane";
import type {
  SubmissionAttemptExecutionContext,
  SubmissionAttemptKind,
  SubmissionAttemptOutcome,
  SubmissionAttemptStatus,
} from "@/lib/justice/submissionAttempt";
import type { JusticeCaseClientState } from "@/lib/justice/types";

export type LastAssistedSubmissionAttemptSnapshot = {
  kind: SubmissionAttemptKind;
  attemptedAt: string;
  filingDestination: string;
  approvedAt?: string;
  executionContext?: SubmissionAttemptExecutionContext;
  filingId?: string;
  confirmation?: string;
  artifactUrl?: string;
  /** Omitted on legacy success snapshots; treated as success when absent. */
  outcome?: SubmissionAttemptStatus;
  error?: string;
};

export function buildLastAssistedSubmissionAttemptSnapshot(input: {
  kind: SubmissionAttemptKind;
  attemptedAt: string;
  filingDestination: string;
  approvedAt?: string;
  executionContext?: SubmissionAttemptExecutionContext;
  filingId?: string;
  confirmation?: string;
  artifactUrl?: string;
  outcome?: SubmissionAttemptStatus;
  error?: string;
}): LastAssistedSubmissionAttemptSnapshot {
  const snapshot: LastAssistedSubmissionAttemptSnapshot = {
    kind: input.kind,
    attemptedAt: input.attemptedAt.trim(),
    filingDestination: input.filingDestination.trim(),
  };
  const approvedAt = input.approvedAt?.trim();
  if (approvedAt) snapshot.approvedAt = approvedAt;
  if (input.executionContext) snapshot.executionContext = input.executionContext;
  const filingId = input.filingId?.trim();
  if (filingId) snapshot.filingId = filingId;
  const confirmation = input.confirmation?.trim();
  if (confirmation) snapshot.confirmation = confirmation;
  const artifactUrl = input.artifactUrl?.trim();
  if (artifactUrl) snapshot.artifactUrl = artifactUrl;
  if (input.outcome) snapshot.outcome = input.outcome;
  const error = input.error?.trim();
  if (error) snapshot.error = error;
  return snapshot;
}

export function buildFailedLastAssistedSubmissionAttemptSnapshot(input: {
  attemptedAt: string;
  error: string;
  approvedAt?: string;
  executionContext?: SubmissionAttemptExecutionContext;
}): LastAssistedSubmissionAttemptSnapshot {
  return buildLastAssistedSubmissionAttemptSnapshot({
    kind: MOCK_FTC_PRACTICE_ASSISTED_SUBMISSION_LANE.id,
    attemptedAt: input.attemptedAt,
    filingDestination: MOCK_FTC_PRACTICE_ASSISTED_SUBMISSION_LANE.filingDestination,
    outcome: "failed",
    error: input.error,
    ...(input.approvedAt?.trim() ? { approvedAt: input.approvedAt.trim() } : {}),
    ...(input.executionContext ? { executionContext: input.executionContext } : {}),
  });
}

export function extractFilingRefsFromRecordPayload(payload: unknown): {
  filingId?: string;
  filingDestination?: string;
  confirmation?: string;
  artifactUrl?: string;
} {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {};
  const row = payload as Record<string, unknown>;
  const filingId = typeof row.id === "string" ? row.id.trim() : "";
  const filingDestination = typeof row.destination === "string" ? row.destination.trim() : "";
  const confirmation =
    typeof row.confirmation_number === "string" ? row.confirmation_number.trim() : "";
  const artifactUrl = typeof row.filing_url === "string" ? row.filing_url.trim() : "";
  return {
    ...(filingId ? { filingId } : {}),
    ...(filingDestination ? { filingDestination } : {}),
    ...(confirmation ? { confirmation } : {}),
    ...(artifactUrl ? { artifactUrl } : {}),
  };
}

export function buildLastAssistedSubmissionAttemptFromSubmissionAttempt(
  attempt: SubmissionAttemptOutcome,
  filingPayload: unknown
): LastAssistedSubmissionAttemptSnapshot {
  const refs = extractFilingRefsFromRecordPayload(filingPayload);
  return buildLastAssistedSubmissionAttemptSnapshot({
    kind: attempt.kind,
    attemptedAt: attempt.attemptedAt,
    approvedAt: attempt.approvedAt,
    executionContext: attempt.executionContext,
    filingDestination: refs.filingDestination ?? attempt.destination,
    filingId: refs.filingId,
    confirmation: refs.confirmation ?? attempt.confirmation,
    artifactUrl: refs.artifactUrl ?? attempt.artifactUrl,
  });
}

function isAssistedPracticeSubmissionAttemptKind(kind: unknown): kind is SubmissionAttemptKind {
  return (
    kind === MOCK_FTC_PRACTICE_ASSISTED_SUBMISSION_LANE.id ||
    kind === MOCK_BBB_PRACTICE_ASSISTED_SUBMISSION_LANE.id
  );
}

export function parseLastAssistedSubmissionAttempt(
  raw: unknown
): LastAssistedSubmissionAttemptSnapshot | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  if (!isAssistedPracticeSubmissionAttemptKind(o.kind)) return undefined;
  const attemptedAt = typeof o.attemptedAt === "string" ? o.attemptedAt.trim() : "";
  const filingDestination = typeof o.filingDestination === "string" ? o.filingDestination.trim() : "";
  if (!attemptedAt || !filingDestination) return undefined;

  const snapshot: LastAssistedSubmissionAttemptSnapshot = {
    kind: o.kind,
    attemptedAt,
    filingDestination,
  };
  const approvedAt = typeof o.approvedAt === "string" ? o.approvedAt.trim() : "";
  if (approvedAt) snapshot.approvedAt = approvedAt;
  if (o.executionContext === "assisted_after_packet_approval") {
    snapshot.executionContext = "assisted_after_packet_approval";
  }
  const filingId = typeof o.filingId === "string" ? o.filingId.trim() : "";
  if (filingId) snapshot.filingId = filingId;
  const confirmation = typeof o.confirmation === "string" ? o.confirmation.trim() : "";
  if (confirmation) snapshot.confirmation = confirmation;
  const artifactUrl = typeof o.artifactUrl === "string" ? o.artifactUrl.trim() : "";
  if (artifactUrl) snapshot.artifactUrl = artifactUrl;
  if (o.outcome === "success" || o.outcome === "failed") snapshot.outcome = o.outcome;
  const error = typeof o.error === "string" ? o.error.trim() : "";
  if (error) snapshot.error = error;
  return snapshot;
}

export function isLastAssistedSubmissionAttemptFailed(
  snapshot: LastAssistedSubmissionAttemptSnapshot
): boolean {
  return snapshot.outcome === "failed";
}

export function readLastAssistedSubmissionAttemptFromClientState(
  clientState: unknown
): LastAssistedSubmissionAttemptSnapshot | undefined {
  if (!clientState || typeof clientState !== "object" || Array.isArray(clientState)) return undefined;
  return parseLastAssistedSubmissionAttempt(
    (clientState as Record<string, unknown>).last_assisted_submission_attempt
  );
}

export function mergeClientStateWithLastAssistedSubmissionAttempt(
  existingClientState: unknown,
  snapshot: LastAssistedSubmissionAttemptSnapshot
): JusticeCaseClientState & { last_assisted_submission_attempt: LastAssistedSubmissionAttemptSnapshot } {
  const base = parseJusticeCaseClientState(existingClientState);
  return {
    ...base,
    last_assisted_submission_attempt: snapshot,
  };
}

export type LastAssistedSubmissionAttemptSummaryDisplay = {
  destination: string;
  attemptedAtLabel: string;
  confirmation?: string;
  filingId?: string;
  executionContextLabel?: string;
  isFailed: boolean;
  outcomeLabel?: string;
  error?: string;
};

function formatLastAssistedSubmissionAttemptAttemptedAt(iso: string): string {
  const t = iso.trim();
  const d = new Date(t);
  if (!Number.isNaN(d.getTime())) {
    try {
      return d.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
    } catch {
      return t;
    }
  }
  return t;
}

/** Compact read-only summary for workbench / handling surfaces. */
export function buildLastAssistedSubmissionAttemptSummaryDisplay(
  snapshot: LastAssistedSubmissionAttemptSnapshot
): LastAssistedSubmissionAttemptSummaryDisplay {
  const confirmation = snapshot.confirmation?.trim();
  const filingId = snapshot.filingId?.trim();
  const failed = isLastAssistedSubmissionAttemptFailed(snapshot);
  const error = snapshot.error?.trim();
  return {
    destination: snapshot.filingDestination,
    attemptedAtLabel: formatLastAssistedSubmissionAttemptAttemptedAt(snapshot.attemptedAt),
    isFailed: failed,
    ...(failed ? { outcomeLabel: "Failed — retry needed" } : {}),
    ...(failed && error ? { error } : {}),
    ...(confirmation ? { confirmation } : {}),
    ...(filingId ? { filingId } : {}),
    ...(snapshot.executionContext === "assisted_after_packet_approval"
      ? { executionContextLabel: "Assisted after packet approval" }
      : {}),
  };
}

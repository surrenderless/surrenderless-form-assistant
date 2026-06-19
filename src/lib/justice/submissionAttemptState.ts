import { parseJusticeCaseClientState } from "@/lib/justice/approvedNextActionState";
import type {
  SubmissionAttemptExecutionContext,
  SubmissionAttemptKind,
  SubmissionAttemptOutcome,
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
  return snapshot;
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

export function parseLastAssistedSubmissionAttempt(
  raw: unknown
): LastAssistedSubmissionAttemptSnapshot | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  if (o.kind !== "ftc_practice") return undefined;
  const attemptedAt = typeof o.attemptedAt === "string" ? o.attemptedAt.trim() : "";
  const filingDestination = typeof o.filingDestination === "string" ? o.filingDestination.trim() : "";
  if (!attemptedAt || !filingDestination) return undefined;

  const snapshot: LastAssistedSubmissionAttemptSnapshot = {
    kind: "ftc_practice",
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
  return snapshot;
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
  return {
    destination: snapshot.filingDestination,
    attemptedAtLabel: formatLastAssistedSubmissionAttemptAttemptedAt(snapshot.attemptedAt),
    ...(confirmation ? { confirmation } : {}),
    ...(filingId ? { filingId } : {}),
    ...(snapshot.executionContext === "assisted_after_packet_approval"
      ? { executionContextLabel: "Assisted after packet approval" }
      : {}),
  };
}

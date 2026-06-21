import { validate as isUuid } from "uuid";
import {
  mergeApprovedNextActionTrackingFields,
  mergeClientStateWithApprovedNextAction,
  omitClearedHandlingRequestNoteFromApprovedNextAction,
} from "@/lib/justice/approvedNextActionState";
import {
  MOCK_FTC_PRACTICE_ASSISTED_SUBMISSION_LANE,
  isRunnableAssistedSubmissionLane,
  resolveAssistedSubmissionLaneForApprovedHref,
} from "@/lib/justice/assistedSubmissionLane";
import {
  buildFtcPracticeSubmissionAttempt,
  recordFtcPracticeFiling,
} from "@/lib/justice/recordFtcPracticeFiling";
import {
  runFtcPractice,
  type RunFtcPracticeResult,
  type RunFtcPracticeSuccess,
} from "@/lib/justice/runFtcPractice";
import {
  buildFailedLastAssistedSubmissionAttemptSnapshot,
  buildLastAssistedSubmissionAttemptFromSubmissionAttempt,
  mergeClientStateWithLastAssistedSubmissionAttempt,
  type LastAssistedSubmissionAttemptSnapshot,
} from "@/lib/justice/submissionAttemptState";
import { advanceApprovedNextActionAfterCompleted } from "@/lib/justice/recomputeApprovedNextActionAfterIntake";
import { applyServerTimelineFromResponse } from "@/lib/justice/timeline";
import type { JusticeApprovedNextAction, JusticeIntake } from "@/lib/justice/types";

export type ExecuteAssistedFtcPracticeSubmissionParams = {
  intake: JusticeIntake;
  caseId: string;
  isLoaded: boolean;
  isSignedIn: boolean;
  preparedPacketApproved: boolean;
  approvedNextAction: JusticeApprovedNextAction | null | undefined;
  logLabel?: string;
  onApprovedNextActionPromoted?: (promoted: JusticeApprovedNextAction) => void;
  onApprovedNextActionCompleted?: (completed: JusticeApprovedNextAction) => void;
  onAssistedSubmissionRecorded?: () => void;
  fetchFn?: typeof fetch;
  runPractice?: typeof runFtcPractice;
  recordFiling?: typeof recordFtcPracticeFiling;
  applyTimeline?: typeof applyServerTimelineFromResponse;
};

export type ExecuteAssistedFtcPracticeSubmissionSuccess = {
  ok: true;
  practice: RunFtcPracticeSuccess;
  storageSkipped: boolean;
  assistedSubmissionRecorded: boolean;
  approvedNextActionForSubmission: JusticeApprovedNextAction | null | undefined;
  lastAssistedSubmissionAttempt?: LastAssistedSubmissionAttemptSnapshot;
};

export type ExecuteAssistedFtcPracticeSubmissionFailure = {
  ok: false;
  error: string;
  lastAssistedSubmissionAttempt?: LastAssistedSubmissionAttemptSnapshot;
};

export type ExecuteAssistedFtcPracticeSubmissionResult =
  | ExecuteAssistedFtcPracticeSubmissionSuccess
  | ExecuteAssistedFtcPracticeSubmissionFailure;

function buildStartedApprovedNextAction(
  approvedNextAction: JusticeApprovedNextAction
): {
  withTracking: JusticeApprovedNextAction;
  local: JusticeApprovedNextAction;
} {
  const targetHref = approvedNextAction.href?.trim() || "/justice/packet";
  const label = approvedNextAction.label?.trim();
  const next: JusticeApprovedNextAction = {
    ...approvedNextAction,
    ...(label ? { label } : {}),
    href: approvedNextAction.href ?? targetHref,
    status: "started",
    started_at: approvedNextAction.started_at ?? new Date().toISOString(),
    ...(approvedNextAction.approved_at ? { approved_at: approvedNextAction.approved_at } : {}),
  };
  const withTracking = mergeApprovedNextActionTrackingFields(approvedNextAction, next);
  const local = omitClearedHandlingRequestNoteFromApprovedNextAction(withTracking);
  return { withTracking, local };
}

function buildCompletedApprovedNextAction(
  approvedNextAction: JusticeApprovedNextAction
): {
  withTracking: JusticeApprovedNextAction;
  local: JusticeApprovedNextAction;
} {
  const targetHref = approvedNextAction.href?.trim() || "/justice/packet";
  const label = approvedNextAction.label?.trim();
  const next: JusticeApprovedNextAction = {
    ...approvedNextAction,
    ...(label ? { label } : {}),
    href: approvedNextAction.href ?? targetHref,
    status: "completed",
    completed_at: approvedNextAction.completed_at ?? new Date().toISOString(),
    ...(approvedNextAction.approved_at ? { approved_at: approvedNextAction.approved_at } : {}),
    ...(approvedNextAction.started_at ? { started_at: approvedNextAction.started_at } : {}),
  };
  const withTracking = mergeApprovedNextActionTrackingFields(approvedNextAction, next);
  const local = omitClearedHandlingRequestNoteFromApprovedNextAction(withTracking);
  return { withTracking, local };
}

async function persistApprovedNextActionClientStateUpdate(
  caseId: string,
  withTracking: JusticeApprovedNextAction,
  logLabel: string,
  fetchFn: typeof fetch,
  failureMessage: string
): Promise<void> {
  try {
    const getRes = await fetchFn(`/api/justice/cases/${encodeURIComponent(caseId)}`);
    if (!getRes.ok) {
      console.warn(`${logLabel}: GET before ${failureMessage} failed`, getRes.status);
      return;
    }
    const existing = (await getRes.json()) as { client_state?: unknown };
    const merged = mergeClientStateWithApprovedNextAction(existing.client_state, withTracking);
    const patchRes = await fetchFn(`/api/justice/cases/${encodeURIComponent(caseId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_state: merged }),
    });
    if (!patchRes.ok) {
      console.warn(`${logLabel}: PATCH ${failureMessage} failed`, patchRes.status);
    }
  } catch (e) {
    console.warn(`${logLabel}: ${failureMessage} error`, e);
  }
}

async function persistApprovedNextActionStartedPromotion(
  caseId: string,
  withTracking: JusticeApprovedNextAction,
  logLabel: string,
  fetchFn: typeof fetch
): Promise<void> {
  await persistApprovedNextActionClientStateUpdate(
    caseId,
    withTracking,
    logLabel,
    fetchFn,
    "FTC practice promote to started"
  );
}

async function persistApprovedNextActionCompletedUpdate(
  caseId: string,
  withTracking: JusticeApprovedNextAction,
  logLabel: string,
  fetchFn: typeof fetch
): Promise<void> {
  await persistApprovedNextActionClientStateUpdate(
    caseId,
    withTracking,
    logLabel,
    fetchFn,
    "assisted submission complete approved next action"
  );
}

async function persistLastAssistedSubmissionAttemptSnapshot(
  caseId: string,
  snapshot: LastAssistedSubmissionAttemptSnapshot,
  logLabel: string,
  fetchFn: typeof fetch
): Promise<void> {
  try {
    const getRes = await fetchFn(`/api/justice/cases/${encodeURIComponent(caseId)}`);
    if (!getRes.ok) {
      console.warn(`${logLabel}: GET before last assisted submission attempt failed`, getRes.status);
      return;
    }
    const existing = (await getRes.json()) as { client_state?: unknown };
    const merged = mergeClientStateWithLastAssistedSubmissionAttempt(existing.client_state, snapshot);
    const patchRes = await fetchFn(`/api/justice/cases/${encodeURIComponent(caseId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_state: merged }),
    });
    if (!patchRes.ok) {
      console.warn(`${logLabel}: PATCH last assisted submission attempt failed`, patchRes.status);
    }
  } catch (e) {
    console.warn(`${logLabel}: persist last assisted submission attempt error`, e);
  }
}

function shouldRecordAssistedSubmission(
  isSignedIn: boolean,
  caseId: string,
  preparedPacketApproved: boolean,
  approvedNextActionForSubmission: JusticeApprovedNextAction | null | undefined
): approvedNextActionForSubmission is JusticeApprovedNextAction {
  const lane = approvedNextActionForSubmission
    ? resolveAssistedSubmissionLaneForApprovedHref(approvedNextActionForSubmission.href)
    : undefined;
  return Boolean(
    isSignedIn &&
      caseId &&
      isUuid(caseId) &&
      preparedPacketApproved &&
      approvedNextActionForSubmission &&
      lane !== undefined &&
      isRunnableAssistedSubmissionLane(lane) &&
      (approvedNextActionForSubmission.status === "started" ||
        approvedNextActionForSubmission.status === "completed")
  );
}

async function promoteApprovedNextActionIfNeeded(
  params: ExecuteAssistedFtcPracticeSubmissionParams,
  fetchFn: typeof fetch,
  logLabel: string
): Promise<JusticeApprovedNextAction | null | undefined> {
  const { caseId, isSignedIn, preparedPacketApproved, approvedNextAction, onApprovedNextActionPromoted } =
    params;
  let approvedNextActionForSubmission = approvedNextAction;

  if (
    isSignedIn &&
    caseId &&
    isUuid(caseId) &&
    preparedPacketApproved &&
    approvedNextAction &&
    approvedNextAction.status === "approved"
  ) {
    const { withTracking, local } = buildStartedApprovedNextAction(approvedNextAction);
    approvedNextActionForSubmission = local;
    onApprovedNextActionPromoted?.(local);
    await persistApprovedNextActionStartedPromotion(caseId, withTracking, logLabel, fetchFn);
  }

  return approvedNextActionForSubmission;
}

async function recordAssistedSubmissionArtifacts(
  params: ExecuteAssistedFtcPracticeSubmissionParams,
  practice: RunFtcPracticeSuccess,
  approvedNextActionForSubmission: JusticeApprovedNextAction,
  fetchFn: typeof fetch,
  logLabel: string,
  recordFiling: typeof recordFtcPracticeFiling,
  applyTimeline: typeof applyServerTimelineFromResponse
): Promise<{
  recorded: boolean;
  snapshot?: LastAssistedSubmissionAttemptSnapshot;
}> {
  const { caseId } = params;
  const assistedFilingOptions = {
    executionContext: "assisted_after_packet_approval" as const,
    ...(approvedNextActionForSubmission.approved_at?.trim()
      ? { approvedAt: approvedNextActionForSubmission.approved_at.trim() }
      : {}),
  };
  const filing = await recordFiling(caseId, practice, assistedFilingOptions);
  if (!filing.ok) {
    console.warn(`${logLabel}: FTC practice filing record failed`, filing.error);
    const snapshot = buildFailedAssistedSubmissionSnapshot(
      approvedNextActionForSubmission,
      filing.error
    );
    await persistLastAssistedSubmissionAttemptSnapshot(caseId, snapshot, logLabel, fetchFn);
    return { recorded: false, snapshot };
  }

  applyTimeline(caseId, filing.payload);
  params.onAssistedSubmissionRecorded?.();

  const attempt = buildFtcPracticeSubmissionAttempt(practice, caseId, assistedFilingOptions);
  const snapshot = buildLastAssistedSubmissionAttemptFromSubmissionAttempt(attempt, filing.payload);
  await persistLastAssistedSubmissionAttemptSnapshot(caseId, snapshot, logLabel, fetchFn);
  return { recorded: true, snapshot };
}

async function completeApprovedNextActionAfterAssistedRecording(
  params: ExecuteAssistedFtcPracticeSubmissionParams,
  approvedNextActionForSubmission: JusticeApprovedNextAction,
  fetchFn: typeof fetch,
  logLabel: string
): Promise<JusticeApprovedNextAction> {
  const { caseId, isSignedIn, preparedPacketApproved, intake, onApprovedNextActionCompleted } =
    params;

  if (approvedNextActionForSubmission.status === "completed") {
    return approvedNextActionForSubmission;
  }

  if (!isSignedIn || !caseId || !isUuid(caseId) || !preparedPacketApproved) {
    return approvedNextActionForSubmission;
  }

  const completedHref = approvedNextActionForSubmission.href?.trim() ?? "";
  const { withTracking: completedWithTracking, local: completedLocal } =
    buildCompletedApprovedNextAction(approvedNextActionForSubmission);
  onApprovedNextActionCompleted?.(completedLocal);

  const advanced = advanceApprovedNextActionAfterCompleted(intake, completedHref, {
    existing: completedWithTracking,
  });
  if (
    advanced?.href?.trim() &&
    advanced.href.trim() !== completedHref &&
    advanced.status === "approved"
  ) {
    const resultLocal = omitClearedHandlingRequestNoteFromApprovedNextAction(advanced);
    await persistApprovedNextActionCompletedUpdate(caseId, advanced, logLabel, fetchFn);
    return resultLocal;
  }

  await persistApprovedNextActionCompletedUpdate(caseId, completedWithTracking, logLabel, fetchFn);
  return completedLocal;
}

function buildFailedAssistedSubmissionSnapshot(
  approvedNextActionForSubmission: JusticeApprovedNextAction,
  error: string
): LastAssistedSubmissionAttemptSnapshot {
  return buildFailedLastAssistedSubmissionAttemptSnapshot({
    attemptedAt: new Date().toISOString(),
    error,
    executionContext: "assisted_after_packet_approval",
    ...(approvedNextActionForSubmission.approved_at?.trim()
      ? { approvedAt: approvedNextActionForSubmission.approved_at.trim() }
      : {}),
  });
}

async function persistFailedAssistedSubmissionAttemptIfEligible(
  params: ExecuteAssistedFtcPracticeSubmissionParams,
  approvedNextActionForSubmission: JusticeApprovedNextAction | null | undefined,
  error: string,
  fetchFn: typeof fetch,
  logLabel: string
): Promise<LastAssistedSubmissionAttemptSnapshot | undefined> {
  if (
    !shouldRecordAssistedSubmission(
      params.isSignedIn,
      params.caseId,
      params.preparedPacketApproved,
      approvedNextActionForSubmission
    )
  ) {
    return undefined;
  }

  const snapshot = buildFailedAssistedSubmissionSnapshot(approvedNextActionForSubmission, error);
  await persistLastAssistedSubmissionAttemptSnapshot(params.caseId, snapshot, logLabel, fetchFn);
  return snapshot;
}

/** Chat-ai assisted FTC practice lane: promote, run mock practice, record filing + snapshot. */
export async function executeAssistedFtcPracticeSubmission(
  params: ExecuteAssistedFtcPracticeSubmissionParams
): Promise<ExecuteAssistedFtcPracticeSubmissionResult> {
  const logLabel = params.logLabel ?? "justice chat-ai";
  const fetchFn = params.fetchFn ?? fetch;
  const runPractice = params.runPractice ?? runFtcPractice;
  const recordFiling = params.recordFiling ?? recordFtcPracticeFiling;
  const applyTimeline = params.applyTimeline ?? applyServerTimelineFromResponse;

  const resolvedLane = resolveAssistedSubmissionLaneForApprovedHref(params.approvedNextAction?.href);
  if (resolvedLane && resolvedLane !== MOCK_FTC_PRACTICE_ASSISTED_SUBMISSION_LANE) {
    return { ok: false, error: "Assisted submission is not available for this lane yet." };
  }

  const approvedNextActionForSubmission = await promoteApprovedNextActionIfNeeded(
    params,
    fetchFn,
    logLabel
  );

  const practiceResult: RunFtcPracticeResult = await runPractice({
    intake: params.intake,
    caseId: params.caseId || null,
    isLoaded: params.isLoaded,
    isSignedIn: params.isSignedIn,
    logLabel,
  });

  if (!practiceResult.ok) {
    const lastAssistedSubmissionAttempt = await persistFailedAssistedSubmissionAttemptIfEligible(
      params,
      approvedNextActionForSubmission,
      practiceResult.error,
      fetchFn,
      logLabel
    );
    return {
      ok: false,
      error: practiceResult.error,
      ...(lastAssistedSubmissionAttempt ? { lastAssistedSubmissionAttempt } : {}),
    };
  }

  let assistedSubmissionRecorded = false;
  let lastAssistedSubmissionAttempt: LastAssistedSubmissionAttemptSnapshot | undefined;
  let approvedNextActionAfterSubmission = approvedNextActionForSubmission;
  if (
    shouldRecordAssistedSubmission(
      params.isSignedIn,
      params.caseId,
      params.preparedPacketApproved,
      approvedNextActionForSubmission
    )
  ) {
    const artifacts = await recordAssistedSubmissionArtifacts(
      params,
      practiceResult,
      approvedNextActionForSubmission,
      fetchFn,
      logLabel,
      recordFiling,
      applyTimeline
    );
    assistedSubmissionRecorded = artifacts.recorded;
    lastAssistedSubmissionAttempt = artifacts.snapshot;
    if (artifacts.recorded && approvedNextActionForSubmission) {
      approvedNextActionAfterSubmission = await completeApprovedNextActionAfterAssistedRecording(
        params,
        approvedNextActionForSubmission,
        fetchFn,
        logLabel
      );
    }
  }

  return {
    ok: true,
    practice: practiceResult,
    storageSkipped: practiceResult.storageSkipped,
    assistedSubmissionRecorded,
    approvedNextActionForSubmission: approvedNextActionAfterSubmission,
    ...(lastAssistedSubmissionAttempt ? { lastAssistedSubmissionAttempt } : {}),
  };
}

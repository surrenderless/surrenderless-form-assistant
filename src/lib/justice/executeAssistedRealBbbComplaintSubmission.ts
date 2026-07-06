import { validate as isUuid } from "uuid";
import {
  mergeApprovedNextActionTrackingFields,
  mergeClientStateWithApprovedNextAction,
  omitClearedHandlingRequestNoteFromApprovedNextAction,
} from "@/lib/justice/approvedNextActionState";
import {
  REAL_BBB_ASSISTED_SUBMISSION_LANE,
  resolveAssistedSubmissionLaneForApprovedHref,
} from "@/lib/justice/assistedSubmissionLane";
import {
  buildRealBbbComplaintSubmissionAttempt,
  REAL_BBB_COMPLAINT_FILING_CONFIRMATION,
  recordRealBbbComplaintFiling,
} from "@/lib/justice/recordRealBbbComplaintFiling";
import {
  runRealBbbComplaint,
  type RunRealBbbComplaintResult,
  type RunRealBbbComplaintSuccess,
} from "@/lib/justice/runRealBbbComplaint";
import {
  buildLastAssistedSubmissionAttemptFromSubmissionAttempt,
  buildLastAssistedSubmissionAttemptSnapshot,
  mergeClientStateWithLastAssistedSubmissionAttempt,
  type LastAssistedSubmissionAttemptSnapshot,
} from "@/lib/justice/submissionAttemptState";
import { autoRequestHandlingAfterSuccessfulRealBbbAutofill } from "@/lib/justice/autoHandlingRequestAfterRealBbbAutofill";
import { autoInitiateOutcomeTrackingAfterSuccessfulRealBbbAutofill } from "@/lib/justice/autoOutcomeTrackingAfterRealBbbAutofill";
import { advanceApprovedNextActionAfterCompleted } from "@/lib/justice/recomputeApprovedNextActionAfterIntake";
import { applyServerTimelineFromResponse } from "@/lib/justice/timeline";
import type { JusticeApprovedNextAction, JusticeIntake } from "@/lib/justice/types";

export type ExecuteAssistedRealBbbComplaintSubmissionParams = {
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
  runComplaint?: typeof runRealBbbComplaint;
  recordFiling?: typeof recordRealBbbComplaintFiling;
  applyTimeline?: typeof applyServerTimelineFromResponse;
};

export type ExecuteAssistedRealBbbComplaintSubmissionSuccess = {
  ok: true;
  complaint: RunRealBbbComplaintSuccess;
  storageSkipped: boolean;
  assistedSubmissionRecorded: boolean;
  approvedNextActionForSubmission: JusticeApprovedNextAction | null | undefined;
  lastAssistedSubmissionAttempt?: LastAssistedSubmissionAttemptSnapshot;
};

export type ExecuteAssistedRealBbbComplaintSubmissionFailure = {
  ok: false;
  error: string;
  lastAssistedSubmissionAttempt?: LastAssistedSubmissionAttemptSnapshot;
};

export type ExecuteAssistedRealBbbComplaintSubmissionResult =
  | ExecuteAssistedRealBbbComplaintSubmissionSuccess
  | ExecuteAssistedRealBbbComplaintSubmissionFailure;

const REAL_BBB_LANE_MISMATCH_ERROR = "Assisted submission requires the real BBB complaint lane.";

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
    "BBB complaint promote to started"
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
      lane === REAL_BBB_ASSISTED_SUBMISSION_LANE &&
      (approvedNextActionForSubmission.status === "started" ||
        approvedNextActionForSubmission.status === "completed")
  );
}

async function promoteApprovedNextActionIfNeeded(
  params: ExecuteAssistedRealBbbComplaintSubmissionParams,
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
  params: ExecuteAssistedRealBbbComplaintSubmissionParams,
  complaint: RunRealBbbComplaintSuccess,
  approvedNextActionForSubmission: JusticeApprovedNextAction,
  fetchFn: typeof fetch,
  logLabel: string,
  recordFiling: typeof recordRealBbbComplaintFiling,
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
  const filing = await recordFiling(caseId, complaint, assistedFilingOptions);
  if (!filing.ok) {
    console.warn(`${logLabel}: real BBB complaint filing record failed`, filing.error);
    const snapshot = buildFailedAssistedSubmissionSnapshot(
      approvedNextActionForSubmission,
      filing.error
    );
    await persistLastAssistedSubmissionAttemptSnapshot(caseId, snapshot, logLabel, fetchFn);
    return { recorded: false, snapshot };
  }

  applyTimeline(caseId, filing.payload);
  params.onAssistedSubmissionRecorded?.();

  const attempt = buildRealBbbComplaintSubmissionAttempt(complaint, caseId, assistedFilingOptions);
  const snapshot = buildLastAssistedSubmissionAttemptFromSubmissionAttempt(attempt, filing.payload);
  await persistLastAssistedSubmissionAttemptSnapshot(caseId, snapshot, logLabel, fetchFn);
  return { recorded: true, snapshot };
}

async function completeApprovedNextActionAfterAssistedRecording(
  params: ExecuteAssistedRealBbbComplaintSubmissionParams,
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
  return buildLastAssistedSubmissionAttemptSnapshot({
    kind: REAL_BBB_ASSISTED_SUBMISSION_LANE.id,
    attemptedAt: new Date().toISOString(),
    filingDestination: REAL_BBB_ASSISTED_SUBMISSION_LANE.filingDestination,
    outcome: "failed",
    error,
    executionContext: "assisted_after_packet_approval",
    ...(approvedNextActionForSubmission.approved_at?.trim()
      ? { approvedAt: approvedNextActionForSubmission.approved_at.trim() }
      : {}),
  });
}

async function persistFailedAssistedSubmissionAttemptIfEligible(
  params: ExecuteAssistedRealBbbComplaintSubmissionParams,
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

/** Real BBB complaint lane: promote, run autofill, record filing + snapshot. */
export async function executeAssistedRealBbbComplaintSubmission(
  params: ExecuteAssistedRealBbbComplaintSubmissionParams
): Promise<ExecuteAssistedRealBbbComplaintSubmissionResult> {
  const logLabel = params.logLabel ?? "justice bbb-complaint";
  const fetchFn = params.fetchFn ?? fetch;
  const runComplaint = params.runComplaint ?? runRealBbbComplaint;
  const recordFiling = params.recordFiling ?? recordRealBbbComplaintFiling;
  const applyTimeline = params.applyTimeline ?? applyServerTimelineFromResponse;

  const resolvedLane = resolveAssistedSubmissionLaneForApprovedHref(params.approvedNextAction?.href);
  if (resolvedLane !== REAL_BBB_ASSISTED_SUBMISSION_LANE) {
    return { ok: false, error: REAL_BBB_LANE_MISMATCH_ERROR };
  }

  const approvedNextActionForSubmission = await promoteApprovedNextActionIfNeeded(
    params,
    fetchFn,
    logLabel
  );

  const complaintResult: RunRealBbbComplaintResult = await runComplaint({
    intake: params.intake,
    caseId: params.caseId || null,
    isLoaded: params.isLoaded,
    isSignedIn: params.isSignedIn,
    logLabel,
  });

  if (!complaintResult.ok) {
    const lastAssistedSubmissionAttempt = await persistFailedAssistedSubmissionAttemptIfEligible(
      params,
      approvedNextActionForSubmission,
      complaintResult.error,
      fetchFn,
      logLabel
    );
    return {
      ok: false,
      error: complaintResult.error,
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
      complaintResult,
      approvedNextActionForSubmission,
      fetchFn,
      logLabel,
      recordFiling,
      applyTimeline
    );
    assistedSubmissionRecorded = artifacts.recorded;
    lastAssistedSubmissionAttempt = artifacts.snapshot;
    if (artifacts.recorded && approvedNextActionForSubmission) {
      const afterAdvance = await completeApprovedNextActionAfterAssistedRecording(
        params,
        approvedNextActionForSubmission,
        fetchFn,
        logLabel
      );
      const afterHandling = await autoRequestHandlingAfterSuccessfulRealBbbAutofill({
        caseId: params.caseId,
        intake: params.intake,
        actionAfterAdvance: afterAdvance,
        logLabel,
        fetchFn,
        applyTimeline,
      });
      approvedNextActionAfterSubmission =
        await autoInitiateOutcomeTrackingAfterSuccessfulRealBbbAutofill({
          caseId: params.caseId,
          intake: params.intake,
          actionAfterHandling: afterHandling,
          confirmationNumber: REAL_BBB_COMPLAINT_FILING_CONFIRMATION,
          filedAt: lastAssistedSubmissionAttempt?.attemptedAt,
          logLabel,
          fetchFn,
          applyTimeline,
        });
    }
  }

  return {
    ok: true,
    complaint: complaintResult,
    storageSkipped: complaintResult.storageSkipped,
    assistedSubmissionRecorded,
    approvedNextActionForSubmission: approvedNextActionAfterSubmission,
    ...(lastAssistedSubmissionAttempt ? { lastAssistedSubmissionAttempt } : {}),
  };
}

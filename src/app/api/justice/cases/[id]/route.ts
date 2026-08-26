import { NextResponse, type NextRequest } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { validate as isUuid } from "uuid";
import { parseApprovedNextActionFromClientState } from "@/lib/justice/approvedNextActionState";
import { isJusticeIntakePayload, isTimelineArray } from "@/lib/justice/caseApiValidation";
import {
  buildHandlingRequestTimelineEntry,
  isFirstHandlingRequestTransition,
} from "@/lib/justice/handlingRequestTimeline";
import { ensureHandlingRequestTask } from "@/lib/justice/handlingRequestTask";
import {
  completeFollowUpCaseTaskIfOwnedByAction,
  isFirstFollowUpClearedTransition,
} from "@/lib/justice/followUpCaseTask";
import { ensureFollowUpAfterOperatorClientStateWrite } from "@/lib/justice/ensureFollowUpAfterOperatorClientStateWrite";
import {
  buildHandlingAcknowledgedTimelineEntry,
  buildOutcomeRecordedTimelineEntry,
  isFirstHandlingAcknowledgedTransition,
  isFirstOutcomeNoteTransition,
} from "@/lib/justice/handlingClosureTimeline";
import {
  buildCaseArchivedTimelineEntry,
  isFirstArchiveTransition,
} from "@/lib/justice/caseArchiveTimeline";
import {
  ensureOwnedFilingTaskAfterClientStateWrite,
  OWNED_FILING_TASK_ENSURE_RETRYABLE_ERROR,
} from "@/lib/justice/ensureOwnedFilingTaskAfterClientStateWrite";
import { attemptAutomatedDemandLetterEmailDeliveryAfterEnsure } from "@/lib/justice/demandLetterEmailDelivery";
import {
  attemptAutomatedBbbFilingAfterEnsure,
  maybeAttemptAutomatedBbbFilingForClientState,
} from "@/lib/justice/bbbOwnedFilingDelivery";
import { attemptAutomatedFtcFilingAfterEnsure } from "@/lib/justice/ftcOwnedFilingDelivery";
import {
  buildBbbOwnedFilingSubmitContextFromRequest,
  runWithBbbOwnedFilingSubmitContext,
} from "@/lib/justice/bbbOwnedFilingSubmitContext";
import { attemptAutomatedMerchantContactEmailDelivery } from "@/lib/justice/merchantContactEmailDelivery";
import { attemptAutomatedPaymentDisputeEmailDelivery } from "@/lib/justice/paymentDisputeEmailDelivery";
import { rejectCasePatchEscalationViolations } from "@/lib/justice/rejectPrematureResolutionClientStatePatch";
import { rejectDemandLetterApprovalWithoutRecipient } from "@/lib/justice/rejectDemandLetterApprovalWithoutRecipient";
import { rejectMerchantContactApprovalWithoutRecipient } from "@/lib/justice/rejectMerchantContactApprovalWithoutRecipient";
import { rejectUnpaidPreparedPacketApprovalPatch } from "@/lib/justice/rejectUnpaidPreparedPacketApprovalPatch";
import { sanitizeClientStateForEscalationLadder } from "@/lib/justice/escalationLadderResolution";
import { CLIENT_STATE_UPDATE_CONFLICT_ERROR } from "@/lib/justice/updateClientStateIfUnchanged";
import {
  isMerchantResolvedTerminalAction,
  type ManualActionTrackingFiling,
} from "@/lib/justice/handlingTrackingProgress";
import { completeMerchantContactFilingTaskIfOpen } from "@/lib/justice/merchantContactFilingTask";
import { resolveHasUploadedEvidenceFile } from "@/lib/justice/resolveHasUploadedEvidenceFile";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";
import type { JusticeIntake, TimelineEntry } from "@/lib/justice/types";
import { getUserOr401 } from "@/server/requireUser";
import { appendCaseTimelineEntry } from "@/server/justiceTimelineAppend";
import {
  buildPlaywrightMockCaseGetResponse,
  buildPlaywrightMockCasePatchResponse,
  isPlaywrightMockIntakeCaseHydrationCaseId,
  isPlaywrightMockIntakeCaseHydrationPipelineEnabled,
} from "@/lib/testing/playwrightMockIntakeCaseHydrationPipeline";
import { buildPlaywrightMockJusticeFilingsGetResponse } from "@/lib/testing/playwrightMockJusticeFilingsPipeline";
import { buildPlaywrightMockJusticeTasksGetResponse } from "@/lib/testing/playwrightMockJusticeTasksPipeline";

/** Owned BBB autofill (Playwright + decide-action) can run during PATCH. */
export const maxDuration = 300;

function getSupabaseAdmin(): SupabaseClient | null {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !supabaseServiceRoleKey) return null;

  return createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch },
  });
}

function supabaseUnavailableResponse() {
  return NextResponse.json(
    { error: "Supabase is not configured on this server." },
    { status: 503 }
  );
}

type CaseResponse = {
  id: string;
  intake: unknown;
  timeline: unknown;
  payment_dispute_draft: unknown;
  client_state: unknown;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  case_label: string | null;
  paid_at: string | null;
};

const SELECT =
  "id, intake, timeline, payment_dispute_draft, client_state, created_at, updated_at, archived_at, case_label, paid_at" as const;

function isValidArchivedAt(value: unknown): value is string | null {
  if (value === null) return true;
  if (typeof value !== "string") return false;
  return !Number.isNaN(Date.parse(value));
}

function isValidCaseLabel(value: unknown): value is string | null {
  if (value === null) return true;
  if (typeof value !== "string") return false;
  return value.length <= 500;
}

function sanitizeCaseResponseForRead(data: CaseResponse): CaseResponse {
  if (data.client_state === null || data.client_state === undefined) {
    return data;
  }
  return {
    ...data,
    client_state: sanitizeClientStateForEscalationLadder(data.client_state),
  };
}

type RouteCtx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, context: RouteCtx) {
  const userId = getUserOr401(req);
  if (!userId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { id } = await context.params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "Invalid case id" }, { status: 400 });
  }

  if (
    isPlaywrightMockIntakeCaseHydrationPipelineEnabled() &&
    isPlaywrightMockIntakeCaseHydrationCaseId(id)
  ) {
    return NextResponse.json(buildPlaywrightMockCaseGetResponse(id));
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) return supabaseUnavailableResponse();

  const { data, error } = await supabase
    .from("justice_cases")
    .select(SELECT)
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.warn("justice_cases select:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(sanitizeCaseResponseForRead(data as CaseResponse));
}

export async function PATCH(req: NextRequest, context: RouteCtx) {
  const userId = getUserOr401(req);
  if (!userId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { id } = await context.params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "Invalid case id" }, { status: 400 });
  }

  const submitContext = buildBbbOwnedFilingSubmitContextFromRequest(req);
  return runWithBbbOwnedFilingSubmitContext(submitContext, () =>
    patchJusticeCase(req, userId, id)
  );
}

async function patchJusticeCase(
  req: NextRequest,
  userId: string,
  id: string
): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const b = body as Record<string, unknown>;
  const allowed = [
    "intake",
    "timeline",
    "payment_dispute_draft",
    "client_state",
    "archived_at",
    "case_label",
  ] as const;
  const patch: Record<string, unknown> = {};

  for (const key of allowed) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) continue;
    if (key === "intake") {
      if (!isJusticeIntakePayload(b.intake)) {
        return NextResponse.json({ error: "Invalid intake" }, { status: 400 });
      }
      patch.intake = b.intake;
    } else if (key === "timeline") {
      if (!isTimelineArray(b.timeline)) {
        return NextResponse.json({ error: "Invalid timeline" }, { status: 400 });
      }
      patch.timeline = b.timeline;
    } else if (key === "payment_dispute_draft") {
      patch.payment_dispute_draft = b.payment_dispute_draft;
    } else if (key === "client_state") {
      patch.client_state = b.client_state;
    } else if (key === "archived_at") {
      if (!isValidArchivedAt(b.archived_at)) {
        return NextResponse.json({ error: "Invalid archived_at" }, { status: 400 });
      }
      patch.archived_at = b.archived_at;
    } else if (key === "case_label") {
      if (!isValidCaseLabel(b.case_label)) {
        return NextResponse.json({ error: "Invalid case_label" }, { status: 400 });
      }
      const v = b.case_label;
      patch.case_label = v === null || v.trim() === "" ? null : v.trim();
    }
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  const isMockCase =
    isPlaywrightMockIntakeCaseHydrationPipelineEnabled() &&
    isPlaywrightMockIntakeCaseHydrationCaseId(id);

  const needsEscalationValidation =
    Object.prototype.hasOwnProperty.call(patch, "client_state") ||
    Object.prototype.hasOwnProperty.call(patch, "archived_at");

  let existingClientState: unknown;
  let existingArchivedAt: string | null | undefined;
  let existingRowUpdatedAt: string | undefined;
  let existingIntake: JusticeIntake | null | undefined;
  // Mock/E2E cases have no real Stripe-backed payment record — treated as already paid so the
  // payment gate never interferes with the Playwright pipeline.
  let existingPaidAt: string | null | undefined = isMockCase ? new Date(0).toISOString() : undefined;
  let validationTasks: JusticeCaseTaskRow[] = [];
  let validationFilings: ManualActionTrackingFiling[] = [];
  // Only populated (real, non-mock cases) when the incoming client_state is attempting the
  // merchant-resolved terminal transition — resolveHasUploadedEvidenceFile does a real query, so
  // it's skipped for every other PATCH. Consumed only by isAllowedMerchantResolvedTerminalClientStatePatch,
  // which requires it when the consumer's declared proof type is "upload"/"screenshot".
  let hasUploadedEvidenceFileForMerchantResolved = false;

  if (needsEscalationValidation) {
    if (isMockCase) {
      const mockRow = buildPlaywrightMockCaseGetResponse(id);
      existingClientState = mockRow.client_state;
      existingArchivedAt = mockRow.archived_at;
      validationTasks = buildPlaywrightMockJusticeTasksGetResponse(id, userId) as JusticeCaseTaskRow[];
      validationFilings = buildPlaywrightMockJusticeFilingsGetResponse(id).map((row) => ({
        destination: row.destination,
        confirmation_number: row.confirmation_number,
      }));
    } else {
      const supabaseForValidation = getSupabaseAdmin();
      if (!supabaseForValidation) return supabaseUnavailableResponse();

      const { data: existingRow, error: existingErr } = await supabaseForValidation
        .from("justice_cases")
        .select("client_state, archived_at, updated_at, paid_at, intake")
        .eq("id", id)
        .eq("user_id", userId)
        .maybeSingle();

      if (existingErr) {
        console.warn("justice_cases select before patch:", existingErr.message);
        return NextResponse.json({ error: existingErr.message }, { status: 500 });
      }
      if (!existingRow) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }

      existingClientState = existingRow.client_state;
      existingArchivedAt = existingRow.archived_at as string | null;
      existingRowUpdatedAt = existingRow.updated_at as string;
      existingPaidAt = existingRow.paid_at as string | null;
      existingIntake = existingRow.intake as JusticeIntake | null;

      if (Object.prototype.hasOwnProperty.call(patch, "client_state")) {
        const { data: taskRows, error: tasksErr } = await supabaseForValidation
          .from("justice_case_tasks")
          .select(
            "id, user_id, case_id, title, due_date, notes, completed_at, created_at, updated_at"
          )
          .eq("case_id", id)
          .eq("user_id", userId);

        if (tasksErr) {
          console.warn("justice_cases select tasks before patch:", tasksErr.message);
          return NextResponse.json({ error: tasksErr.message }, { status: 500 });
        }

        const { data: filingRows, error: filingsErr } = await supabaseForValidation
          .from("justice_case_filings")
          .select("destination, confirmation_number")
          .eq("case_id", id)
          .eq("user_id", userId);

        if (filingsErr) {
          console.warn("justice_cases select filings before patch:", filingsErr.message);
          return NextResponse.json({ error: filingsErr.message }, { status: 500 });
        }

        validationTasks = (taskRows ?? []) as JusticeCaseTaskRow[];
        validationFilings = filingRows ?? [];

        const incomingActionPreview = parseApprovedNextActionFromClientState(patch.client_state);
        if (incomingActionPreview && isMerchantResolvedTerminalAction(incomingActionPreview)) {
          hasUploadedEvidenceFileForMerchantResolved = await resolveHasUploadedEvidenceFile(
            supabaseForValidation,
            id,
            userId
          );
        }
      } else {
        const { data: taskRows, error: tasksErr } = await supabaseForValidation
          .from("justice_case_tasks")
          .select(
            "id, user_id, case_id, title, due_date, notes, completed_at, created_at, updated_at"
          )
          .eq("case_id", id)
          .eq("user_id", userId);

        if (tasksErr) {
          console.warn("justice_cases select tasks before archive patch:", tasksErr.message);
          return NextResponse.json({ error: tasksErr.message }, { status: 500 });
        }

        validationTasks = (taskRows ?? []) as JusticeCaseTaskRow[];
      }
    }

    // The intake this write persists (patch.intake) or, when the PATCH carries only client_state,
    // the intake already stored on the case. Either way this is a CONSUMER-authored record, not
    // independent server verification — used below (recipient gates) and by
    // rejectCasePatchEscalationViolations' narrow merchant-resolved terminal exception, which
    // additionally re-validates it (contact date, proof content, uploaded-evidence requirement)
    // via the same shared documentation validator the consumer-facing form itself uses, rather
    // than trusting the bare already_contacted/merchant_response_type enum values alone. That
    // validation re-runs against whatever intake is effective at the moment of THIS transition,
    // regardless of whether it arrived in this same PATCH body or was persisted earlier.
    const effectiveIntake: JusticeIntake | null =
      (patch.intake as JusticeIntake | undefined) ?? existingIntake ?? null;

    const escalationReject = rejectCasePatchEscalationViolations({
      caseId: id,
      existingClientState,
      existingArchivedAt,
      patch,
      tasks: validationTasks,
      filings: validationFilings,
      intake: effectiveIntake,
      hasUploadedEvidenceFile: hasUploadedEvidenceFileForMerchantResolved,
    });
    if (escalationReject) {
      return NextResponse.json({ error: escalationReject }, { status: 409 });
    }

    if (Object.prototype.hasOwnProperty.call(patch, "client_state")) {
      // Gate ONLY the first prepared-packet-approval transition — the exact moment Surrenderless/
      // operator labor is committed. Intake, evidence, and an already-approved/in-progress case
      // are never blocked by this check. paid_at here comes only from the database (written
      // exclusively by the signature-verified Stripe webhook) — never from this request's body.
      const paymentReject = rejectUnpaidPreparedPacketApprovalPatch({
        existingClientState,
        incomingClientState: patch.client_state,
        paidAt: existingPaidAt,
      });
      if (paymentReject) {
        return NextResponse.json(
          { error: paymentReject, requiresPayment: true },
          { status: 402 }
        );
      }

      // Merchant-contact outreach is sent by Surrenderless itself, so the exact approval transition
      // that queues it must have a valid recipient email — otherwise delivery silently skips and the
      // action is stuck showing "queued". Mock/E2E cases are exempt (no real outreach).
      if (!isMockCase) {
        const recipientReject = rejectMerchantContactApprovalWithoutRecipient({
          existingClientState,
          incomingClientState: patch.client_state,
          intake: effectiveIntake,
        });
        if (recipientReject) {
          return NextResponse.json(
            { error: recipientReject, requiresMerchantContactEmail: true },
            { status: 422 }
          );
        }
        // Demand letters are sent to the same company_contact_email as merchant contact, so the same
        // recipient/operator-fallback gate applies to the demand-letter approval transition.
        const demandLetterReject = rejectDemandLetterApprovalWithoutRecipient({
          existingClientState,
          incomingClientState: patch.client_state,
          intake: effectiveIntake,
        });
        if (demandLetterReject) {
          return NextResponse.json(
            { error: demandLetterReject, requiresMerchantContactEmail: true },
            { status: 422 }
          );
        }
      }
    }
  }

  if (isMockCase) {
    return NextResponse.json(buildPlaywrightMockCasePatchResponse(id, patch));
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) return supabaseUnavailableResponse();

  if (!needsEscalationValidation) {
    existingClientState = undefined;
    existingArchivedAt = undefined;
  }

  // Task reconciliation happens BEFORE the terminal client_state is persisted, not after: if
  // reconciliation fails, the write must not proceed at all — a persisted terminal action with a
  // still-open (or unconfirmed-completion) task is exactly the dead end this exists to prevent,
  // and there is no later step that would ever revisit it. If reconciliation succeeds and the
  // WRITE below then fails (e.g. a concurrent-update conflict), the already-completed task stays
  // completed — completeMerchantContactFilingTaskIfOpen is idempotent — so the client can simply
  // retry the whole PATCH; the retry will find the task already done (not "failed") and proceed
  // straight to the write.
  let preWriteReconcileTimeline: TimelineEntry[] | null = null;
  if (Object.prototype.hasOwnProperty.call(patch, "client_state")) {
    const incomingNextForReconcile = parseApprovedNextActionFromClientState(patch.client_state);
    if (incomingNextForReconcile && isMerchantResolvedTerminalAction(incomingNextForReconcile)) {
      const taskReconcile = await completeMerchantContactFilingTaskIfOpen(supabase, userId, id);
      if (taskReconcile.failed) {
        return NextResponse.json(
          { error: OWNED_FILING_TASK_ENSURE_RETRYABLE_ERROR },
          { status: 500 }
        );
      }
      preWriteReconcileTimeline = taskReconcile.timeline;

      // Reconciliation's own writes (completing the task; appending the audit timeline entry to
      // justice_cases.timeline) can themselves advance justice_cases.updated_at via the
      // set_justice_cases_updated_at trigger (BEFORE UPDATE ... FOR EACH ROW, unconditional on
      // which columns changed). The updated_at captured before reconciliation ran is now stale
      // by construction — not because of any concurrent writer — so the CAS-guarded write below
      // would self-invalidate every single time a real open task gets reconciled. Re-read the row
      // and compare the fields the CAS exists to protect (client_state, archived_at, intake):
      // identical means the only intervening write was our own reconciliation, so it's safe to
      // adopt the fresh updated_at; different means a genuine concurrent writer intervened while
      // we were reconciling, and this must still fail exactly as the CAS was designed to — never
      // silently clobber a real concurrent change.
      if (existingRowUpdatedAt) {
        const { data: freshRow, error: freshErr } = await supabase
          .from("justice_cases")
          .select("client_state, archived_at, updated_at, intake")
          .eq("id", id)
          .eq("user_id", userId)
          .maybeSingle();

        if (freshErr || !freshRow) {
          return NextResponse.json({ error: CLIENT_STATE_UPDATE_CONFLICT_ERROR }, { status: 409 });
        }

        const unchangedSinceReconciliation =
          JSON.stringify(freshRow.client_state ?? null) ===
            JSON.stringify(existingClientState ?? null) &&
          (freshRow.archived_at as string | null) === (existingArchivedAt ?? null) &&
          JSON.stringify(freshRow.intake ?? null) === JSON.stringify(existingIntake ?? null);

        if (!unchangedSinceReconciliation) {
          return NextResponse.json({ error: CLIENT_STATE_UPDATE_CONFLICT_ERROR }, { status: 409 });
        }

        existingRowUpdatedAt = freshRow.updated_at as string;
      }
    }
  }

  // When we read the row above for escalation validation, guard the write with a
  // compare-and-swap on updated_at (stamped on every row write by a DB trigger) so a
  // concurrent writer — an operator completing a filing at the same time — can't have its
  // change silently clobbered by this blind update.
  let updateQuery = supabase.from("justice_cases").update(patch).eq("id", id).eq("user_id", userId);
  if (existingRowUpdatedAt) {
    updateQuery = updateQuery.eq("updated_at", existingRowUpdatedAt);
  }

  const { data, error } = await updateQuery.select(SELECT).maybeSingle();

  if (error) {
    console.warn("justice_cases update:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    if (existingRowUpdatedAt) {
      return NextResponse.json({ error: CLIENT_STATE_UPDATE_CONFLICT_ERROR }, { status: 409 });
    }
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let responseData = data as CaseResponse;
  if (preWriteReconcileTimeline) {
    // Defensive merge — the write above already reflects this via the justice_cases.timeline
    // column (reconciliation committed it before this .update ran, and patch never carries an
    // explicit stale `timeline` for these client_state-only requests), but this guards against
    // exactly that case if a caller ever does combine client_state with a stale timeline field.
    responseData = { ...responseData, timeline: preWriteReconcileTimeline };
  }

  if (
    Object.prototype.hasOwnProperty.call(patch, "client_state") &&
    isFirstHandlingRequestTransition(existingClientState, patch.client_state)
  ) {
    const incomingNext = parseApprovedNextActionFromClientState(patch.client_state);
    if (incomingNext?.handling_requested_at?.trim()) {
      const timeline = await appendCaseTimelineEntry(supabase, userId, id, {
        ...buildHandlingRequestTimelineEntry(id, incomingNext),
      });
      if (timeline) {
        responseData = { ...responseData, timeline };
      }

      const taskResult = await ensureHandlingRequestTask(supabase, userId, id, incomingNext);
      if (taskResult.timeline) {
        responseData = { ...responseData, timeline: taskResult.timeline };
      }
    }
  }

  if (Object.prototype.hasOwnProperty.call(patch, "client_state")) {
    const followUpEnsure = await ensureFollowUpAfterOperatorClientStateWrite(supabase, {
      userId,
      caseId: id,
      existingClientState,
      nextClientState: patch.client_state,
    });
    if (!followUpEnsure.ok) {
      return NextResponse.json({ error: followUpEnsure.error }, { status: 500 });
    }
    if (followUpEnsure.timeline) {
      responseData = { ...responseData, timeline: followUpEnsure.timeline };
    }
  }

  if (
    Object.prototype.hasOwnProperty.call(patch, "client_state") &&
    isFirstFollowUpClearedTransition(existingClientState, patch.client_state)
  ) {
    // The follow-up being cleared is the one belonging to whichever action's follow_up_needed
    // just went true → false — i.e. the PRE-patch approved action, not necessarily the lane the
    // patch is advancing to. Scope completion to that lane's own follow-up: a case can have more
    // than one lane's follow-up open at once, and this must never close a different one. If the
    // owning href can't be determined, safely no-op rather than guessing at an open row.
    const clearedActionHref = parseApprovedNextActionFromClientState(existingClientState)?.href?.trim();
    if (clearedActionHref) {
      const taskResult = await completeFollowUpCaseTaskIfOwnedByAction(
        supabase,
        userId,
        id,
        clearedActionHref
      );
      if (taskResult.timeline) {
        responseData = { ...responseData, timeline: taskResult.timeline };
      }
    }
  }

  if (Object.prototype.hasOwnProperty.call(patch, "client_state")) {
    const incomingNext = parseApprovedNextActionFromClientState(patch.client_state);

    if (
      isFirstOutcomeNoteTransition(existingClientState, patch.client_state) &&
      incomingNext?.outcome_note?.trim()
    ) {
      const timeline = await appendCaseTimelineEntry(supabase, userId, id, {
        ...buildOutcomeRecordedTimelineEntry(id, incomingNext),
      });
      if (timeline) {
        responseData = { ...responseData, timeline };
      }
    }

    if (
      isFirstHandlingAcknowledgedTransition(existingClientState, patch.client_state) &&
      incomingNext?.handling_acknowledged_at?.trim()
    ) {
      const timeline = await appendCaseTimelineEntry(supabase, userId, id, {
        ...buildHandlingAcknowledgedTimelineEntry(id, incomingNext),
      });
      if (timeline) {
        responseData = { ...responseData, timeline };
      }
    }
  }

  if (Object.prototype.hasOwnProperty.call(patch, "client_state")) {
    const intakePayload = data.intake;
    if (isJusticeIntakePayload(intakePayload)) {
      // Fail-closed owned filing handoff: ensure required marker task after client_state write.
      // Delivery side effects stay in this route so refetch/BBB behavior remains identical.
      const ownedEnsure = await ensureOwnedFilingTaskAfterClientStateWrite(supabase, {
        userId,
        caseId: id,
        clientState: patch.client_state,
        intake: intakePayload as JusticeIntake,
        paymentDisputeDraft: data.payment_dispute_draft,
        attemptDemandLetterEmail: false,
        attemptPaymentDisputeEmail: false,
      });
      if (!ownedEnsure.ok) {
        return NextResponse.json(
          { error: OWNED_FILING_TASK_ENSURE_RETRYABLE_ERROR },
          { status: 500 }
        );
      }
      if (ownedEnsure.timeline) {
        responseData = { ...responseData, timeline: ownedEnsure.timeline };
      }

      if (ownedEnsure.kind === "merchant_contact") {
        const emailResult = await attemptAutomatedMerchantContactEmailDelivery(
          supabase,
          userId,
          id
        );
        if (emailResult.status === "accepted" || emailResult.status === "failed") {
          if (emailResult.timeline) {
            responseData = { ...responseData, timeline: emailResult.timeline };
          }
          if (emailResult.status === "accepted" && emailResult.task) {
            const { data: refreshed } = await supabase
              .from("justice_cases")
              .select(SELECT)
              .eq("id", id)
              .eq("user_id", userId)
              .maybeSingle();
            if (refreshed) {
              responseData = { ...responseData, ...(refreshed as CaseResponse) };
            }
            const bbbAutofill = await maybeAttemptAutomatedBbbFilingForClientState(
              supabase,
              userId,
              id,
              responseData.client_state,
              (responseData.timeline as TimelineEntry[] | null | undefined) ?? null
            );
            if (bbbAutofill.timeline) {
              responseData = { ...responseData, timeline: bbbAutofill.timeline };
            }
            if (bbbAutofill.result.status === "accepted") {
              const { data: afterBbb } = await supabase
                .from("justice_cases")
                .select(SELECT)
                .eq("id", id)
                .eq("user_id", userId)
                .maybeSingle();
              if (afterBbb) {
                responseData = { ...responseData, ...(afterBbb as CaseResponse) };
              }
            }
          }
        }
      }

      if (ownedEnsure.kind === "demand_letter") {
        const emailAttempt = await attemptAutomatedDemandLetterEmailDeliveryAfterEnsure(
          supabase,
          userId,
          id,
          (responseData.timeline as TimelineEntry[] | null | undefined) ?? null
        );
        if (emailAttempt.timeline) {
          responseData = { ...responseData, timeline: emailAttempt.timeline };
        }
        if (emailAttempt.result.status === "accepted" && emailAttempt.result.task) {
          const { data: refreshed } = await supabase
            .from("justice_cases")
            .select(SELECT)
            .eq("id", id)
            .eq("user_id", userId)
            .maybeSingle();
          if (refreshed) {
            responseData = { ...responseData, ...(refreshed as CaseResponse) };
          }
        }
      }

      if (ownedEnsure.kind === "payment_dispute") {
        const emailResult = await attemptAutomatedPaymentDisputeEmailDelivery(
          supabase,
          userId,
          id
        );
        if (emailResult.status === "accepted" || emailResult.status === "failed") {
          if (emailResult.timeline) {
            responseData = { ...responseData, timeline: emailResult.timeline };
          }
          if (emailResult.status === "accepted" && emailResult.task) {
            const { data: refreshed } = await supabase
              .from("justice_cases")
              .select(SELECT)
              .eq("id", id)
              .eq("user_id", userId)
              .maybeSingle();
            if (refreshed) {
              responseData = { ...responseData, ...(refreshed as CaseResponse) };
            }
            const bbbAutofill = await maybeAttemptAutomatedBbbFilingForClientState(
              supabase,
              userId,
              id,
              responseData.client_state,
              (responseData.timeline as TimelineEntry[] | null | undefined) ?? null
            );
            if (bbbAutofill.timeline) {
              responseData = { ...responseData, timeline: bbbAutofill.timeline };
            }
            if (bbbAutofill.result.status === "accepted") {
              const { data: afterBbb } = await supabase
                .from("justice_cases")
                .select(SELECT)
                .eq("id", id)
                .eq("user_id", userId)
                .maybeSingle();
              if (afterBbb) {
                responseData = { ...responseData, ...(afterBbb as CaseResponse) };
              }
            }
          }
        }
      }

      if (ownedEnsure.kind === "bbb") {
        const autofill = await attemptAutomatedBbbFilingAfterEnsure(
          supabase,
          userId,
          id,
          (responseData.timeline as TimelineEntry[] | null | undefined) ?? null
        );
        if (autofill.timeline) {
          responseData = { ...responseData, timeline: autofill.timeline };
        }
        if (autofill.result.status === "accepted" && autofill.result.task) {
          const { data: refreshed } = await supabase
            .from("justice_cases")
            .select(SELECT)
            .eq("id", id)
            .eq("user_id", userId)
            .maybeSingle();
          if (refreshed) {
            responseData = { ...responseData, ...(refreshed as CaseResponse) };
          }
        }
      }

      if (ownedEnsure.kind === "ftc") {
        const autofill = await attemptAutomatedFtcFilingAfterEnsure(
          supabase,
          userId,
          id,
          (responseData.timeline as TimelineEntry[] | null | undefined) ?? null
        );
        if (autofill.timeline) {
          responseData = { ...responseData, timeline: autofill.timeline };
        }
        if (autofill.result.status === "accepted" && autofill.result.task) {
          const { data: refreshed } = await supabase
            .from("justice_cases")
            .select(SELECT)
            .eq("id", id)
            .eq("user_id", userId)
            .maybeSingle();
          if (refreshed) {
            responseData = { ...responseData, ...(refreshed as CaseResponse) };
          }
        }
      }
    }
  }

  if (
    Object.prototype.hasOwnProperty.call(patch, "archived_at") &&
    isFirstArchiveTransition(existingArchivedAt, patch.archived_at)
  ) {
    const archivedAt =
      typeof patch.archived_at === "string" ? patch.archived_at.trim() : "";
    if (archivedAt) {
      const timeline = await appendCaseTimelineEntry(supabase, userId, id, {
        ...buildCaseArchivedTimelineEntry(id, archivedAt),
      });
      if (timeline) {
        responseData = { ...responseData, timeline };
      }
    }
  }

  return NextResponse.json(sanitizeCaseResponseForRead(responseData));
}

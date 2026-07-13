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
  completeFollowUpCaseTaskIfOpen,
  ensureFollowUpCaseTask,
  isFirstFollowUpClearedTransition,
  isFirstFollowUpNeededTransition,
} from "@/lib/justice/followUpCaseTask";
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
import { ensureStateAgFilingTask, shouldQueueStateAgFilingTask } from "@/lib/justice/stateAgFilingTask";
import {
  ensureDemandLetterFilingTask,
  shouldQueueDemandLetterFilingTask,
} from "@/lib/justice/demandLetterFilingTask";
import { ensureCfpbFilingTask, shouldQueueCfpbFilingTask } from "@/lib/justice/cfpbFilingTask";
import {
  ensureFccFilingTask,
  shouldQueueFccFilingTask,
} from "@/lib/justice/fccFilingTask";
import {
  ensureDotFilingTask,
  shouldQueueDotFilingTask,
} from "@/lib/justice/dotFilingTask";
import {
  ensureBbbFilingTask,
  shouldQueueBbbFilingTask,
} from "@/lib/justice/bbbFilingTask";
import {
  ensureFtcFilingTask,
  shouldQueueFtcFilingTask,
} from "@/lib/justice/ftcFilingTask";
import {
  ensurePaymentDisputeFilingTask,
  shouldQueuePaymentDisputeFilingTask,
} from "@/lib/justice/paymentDisputeFilingTask";
import { rejectCasePatchEscalationViolations } from "@/lib/justice/rejectPrematureResolutionClientStatePatch";
import { sanitizeClientStateForEscalationLadder } from "@/lib/justice/escalationLadderResolution";
import type { ManualActionTrackingFiling } from "@/lib/justice/handlingTrackingProgress";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";
import type { JusticeIntake } from "@/lib/justice/types";
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
};

const SELECT =
  "id, intake, timeline, payment_dispute_draft, client_state, created_at, updated_at, archived_at, case_label" as const;

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
  let validationTasks: JusticeCaseTaskRow[] = [];
  let validationFilings: ManualActionTrackingFiling[] = [];

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
        .select("client_state, archived_at")
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

    const escalationReject = rejectCasePatchEscalationViolations({
      caseId: id,
      existingClientState,
      existingArchivedAt,
      patch,
      tasks: validationTasks,
      filings: validationFilings,
    });
    if (escalationReject) {
      return NextResponse.json({ error: escalationReject }, { status: 409 });
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

  const { data, error } = await supabase
    .from("justice_cases")
    .update(patch)
    .eq("id", id)
    .eq("user_id", userId)
    .select(SELECT)
    .maybeSingle();

  if (error) {
    console.warn("justice_cases update:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let responseData = data as CaseResponse;

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

  if (
    Object.prototype.hasOwnProperty.call(patch, "client_state") &&
    isFirstFollowUpNeededTransition(existingClientState, patch.client_state)
  ) {
    const incomingNext = parseApprovedNextActionFromClientState(patch.client_state);
    if (incomingNext?.follow_up_needed === true) {
      const taskResult = await ensureFollowUpCaseTask(supabase, userId, id, incomingNext);
      if (taskResult.timeline) {
        responseData = { ...responseData, timeline: taskResult.timeline };
      }
    }
  }

  if (
    Object.prototype.hasOwnProperty.call(patch, "client_state") &&
    isFirstFollowUpClearedTransition(existingClientState, patch.client_state)
  ) {
    const taskResult = await completeFollowUpCaseTaskIfOpen(supabase, userId, id);
    if (taskResult.timeline) {
      responseData = { ...responseData, timeline: taskResult.timeline };
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

  if (
    Object.prototype.hasOwnProperty.call(patch, "client_state") &&
    shouldQueueStateAgFilingTask(patch.client_state)
  ) {
    const intakePayload = data.intake;
    if (isJusticeIntakePayload(intakePayload)) {
      const taskResult = await ensureStateAgFilingTask(
        supabase,
        userId,
        id,
        intakePayload as JusticeIntake
      );
      if (taskResult.timeline) {
        responseData = { ...responseData, timeline: taskResult.timeline };
      }
    }
  }

  if (
    Object.prototype.hasOwnProperty.call(patch, "client_state") &&
    shouldQueueDemandLetterFilingTask(patch.client_state)
  ) {
    const intakePayload = data.intake;
    if (isJusticeIntakePayload(intakePayload)) {
      const taskResult = await ensureDemandLetterFilingTask(
        supabase,
        userId,
        id,
        intakePayload as JusticeIntake
      );
      if (taskResult.timeline) {
        responseData = { ...responseData, timeline: taskResult.timeline };
      }
    }
  }

  if (
    Object.prototype.hasOwnProperty.call(patch, "client_state") &&
    shouldQueueCfpbFilingTask(patch.client_state)
  ) {
    const intakePayload = data.intake;
    if (isJusticeIntakePayload(intakePayload)) {
      const taskResult = await ensureCfpbFilingTask(
        supabase,
        userId,
        id,
        intakePayload as JusticeIntake
      );
      if (taskResult.timeline) {
        responseData = { ...responseData, timeline: taskResult.timeline };
      }
    }
  }

  if (
    Object.prototype.hasOwnProperty.call(patch, "client_state") &&
    shouldQueuePaymentDisputeFilingTask(patch.client_state)
  ) {
    const intakePayload = data.intake;
    if (isJusticeIntakePayload(intakePayload)) {
      const taskResult = await ensurePaymentDisputeFilingTask(
        supabase,
        userId,
        id,
        intakePayload as JusticeIntake,
        data.payment_dispute_draft
      );
      if (taskResult.timeline) {
        responseData = { ...responseData, timeline: taskResult.timeline };
      }
    }
  }

  if (
    Object.prototype.hasOwnProperty.call(patch, "client_state") &&
    shouldQueueFccFilingTask(patch.client_state)
  ) {
    const intakePayload = data.intake;
    if (isJusticeIntakePayload(intakePayload)) {
      const taskResult = await ensureFccFilingTask(
        supabase,
        userId,
        id,
        intakePayload as JusticeIntake
      );
      if (taskResult.timeline) {
        responseData = { ...responseData, timeline: taskResult.timeline };
      }
    }
  }

  if (
    Object.prototype.hasOwnProperty.call(patch, "client_state") &&
    shouldQueueDotFilingTask(patch.client_state)
  ) {
    const intakePayload = data.intake;
    if (isJusticeIntakePayload(intakePayload)) {
      const taskResult = await ensureDotFilingTask(
        supabase,
        userId,
        id,
        intakePayload as JusticeIntake
      );
      if (taskResult.timeline) {
        responseData = { ...responseData, timeline: taskResult.timeline };
      }
    }
  }

  if (
    Object.prototype.hasOwnProperty.call(patch, "client_state") &&
    shouldQueueFtcFilingTask(patch.client_state)
  ) {
    const intakePayload = data.intake;
    if (isJusticeIntakePayload(intakePayload)) {
      const taskResult = await ensureFtcFilingTask(
        supabase,
        userId,
        id,
        intakePayload as JusticeIntake
      );
      if (taskResult.timeline) {
        responseData = { ...responseData, timeline: taskResult.timeline };
      }
    }
  }

  if (
    Object.prototype.hasOwnProperty.call(patch, "client_state") &&
    shouldQueueBbbFilingTask(patch.client_state)
  ) {
    const intakePayload = data.intake;
    if (isJusticeIntakePayload(intakePayload)) {
      const taskResult = await ensureBbbFilingTask(
        supabase,
        userId,
        id,
        intakePayload as JusticeIntake
      );
      if (taskResult.timeline) {
        responseData = { ...responseData, timeline: taskResult.timeline };
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

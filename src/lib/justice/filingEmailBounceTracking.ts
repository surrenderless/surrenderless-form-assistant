import type { SupabaseClient } from "@supabase/supabase-js";
import { appendCaseTimelineEntry } from "@/server/justiceTimelineAppend";

const FILING_SELECT = "id, user_id, case_id, notes, created_at" as const;
const TASK_SELECT = "id, user_id, case_id, notes, created_at" as const;

export type FilingEmailBounceEventType = "email.bounced" | "email.complained";

export type FilingOutreachEmailDeliveryState =
  | "sending"
  | "accepted"
  | "failed"
  | "bounced"
  | "complained";

type BaseFilingEmailDeliveryRecord = {
  delivery_state: FilingOutreachEmailDeliveryState;
  provider_message_id?: string;
};

export type FilingEmailBounceLane<TRecord extends BaseFilingEmailDeliveryRecord> = {
  /** Human-readable name used in the timeline label, e.g. "Demand letter". */
  label: string;
  /** Prefix for the idempotent timeline entry id, e.g. "demand_letter_email". */
  timelineIdPrefix: string;
  parseRecord: (notes: string | null | undefined) => TRecord | null;
  upsertNotes: (notes: string | null | undefined, record: TRecord) => string;
};

export type FilingEmailBounceResult =
  | {
      status: "recorded";
      caseId: string;
      userId: string;
      state: "bounced" | "complained";
      matchedRowCreatedAt: string;
    }
  | {
      status: "ignored_duplicate";
      caseId: string;
      userId: string;
      state: FilingOutreachEmailDeliveryState;
      matchedRowCreatedAt: string;
    }
  | { status: "ignored_unknown" }
  | { status: "error"; reason: string };

/**
 * Public result shape for a lane's record*EmailBounceEvent wrapper. "recorded" here means the
 * delivery is durably flagged bounced/complained AND both follow-on actions (operator task
 * reopened, false follow-up countdown stopped) are confirmed complete — never a partial state.
 * If either action can't be confirmed complete, the result is "error" instead (so the webhook
 * responds 5xx and Resend retries), even when the delivery-state flip itself was a no-op replay.
 */
export type FilingEmailBounceActionResult =
  | { status: "recorded"; caseId: string; state: "bounced" | "complained" }
  | { status: "ignored_duplicate"; caseId: string; state: FilingOutreachEmailDeliveryState }
  | { status: "ignored_unknown" }
  | { status: "error"; reason: string };

/** Reopens the lane's operator task for this bounce/complaint. Must be idempotent: calling it
 * again after a prior success (or on an already-open task) must re-report success, not fail or
 * duplicate timeline entries. */
export type FilingEmailBounceReopenTask = (
  supabase: SupabaseClient,
  userId: string,
  caseId: string,
  state: "bounced" | "complained"
) => Promise<{ reopened: boolean }>;

/** Stops the case's false follow-up countdown. Must be idempotent: "already closed" and "never
 * existed" both count as success (task: null), only a genuinely still-open task that fails to
 * close counts as failure. Implementations must be lane-scoped (e.g.
 * completeFollowUpCaseTaskIfOwnedByAction) so a bounce for one lane can never close a follow-up
 * that belongs to a different, later lane's escalation step: skippedNotOwned:true reports a safe
 * no-op (an open follow-up exists but isn't confirmed to be this lane's — also success), and
 * error:true reports a failed lookup/update as retriable (task may be null on an error too, but
 * that must NOT be read as "confirmed nothing to close"). */
export type FilingEmailBounceStopFollowUp = (
  supabase: SupabaseClient,
  userId: string,
  caseId: string
) => Promise<{ completed: boolean; task: unknown | null; skippedNotOwned?: boolean; error?: boolean }>;

/** Returns the created_at of the most recently created filing for this lane+case; null if none
 * exists yet (confirmed absence — safe to treat as "not superseded"); or the literal "error" if
 * the lookup itself failed. Used to detect that a bounce/complaint replay concerns an attempt
 * that has since been superseded by a newer, successful filing — in which case repair must be
 * skipped rather than reopening/closing state that belongs to the newer attempt. Callers must
 * NOT treat "error" the same as null: an unknown answer must fail closed (skip repair, surface a
 * retriable error) rather than fall through to repair as if absence were confirmed. */
export type FilingEmailBounceFindLatestFilingCreatedAt = (
  supabase: SupabaseClient,
  userId: string,
  caseId: string
) => Promise<string | null | "error">;

export type FilingEmailBounceActionabilityLane<TRecord extends BaseFilingEmailDeliveryRecord> =
  FilingEmailBounceLane<TRecord> & {
    reopenTask: FilingEmailBounceReopenTask;
    stopFollowUp: FilingEmailBounceStopFollowUp;
    findLatestFilingCreatedAt: FilingEmailBounceFindLatestFilingCreatedAt;
  };

/** Monotonic precedence: bounced/complained are terminal and never downgrade back to accepted. */
const STATE_RANK: Record<FilingOutreachEmailDeliveryState, number> = {
  sending: 0,
  accepted: 0,
  failed: 0,
  bounced: 1,
  complained: 1,
};

type MatchRow<TRecord> = {
  id: string;
  user_id: string;
  case_id: string;
  notes: string | null;
  created_at: string;
  record: TRecord;
};

async function findRowByProviderMessageId<TRecord extends BaseFilingEmailDeliveryRecord>(
  supabase: SupabaseClient,
  table: "justice_case_filings" | "justice_case_tasks",
  select: string,
  messageId: string,
  parseRecord: FilingEmailBounceLane<TRecord>["parseRecord"]
): Promise<MatchRow<TRecord> | null | "error"> {
  const { data, error } = await supabase.from(table).select(select).like("notes", `%${messageId}%`).limit(25);
  if (error) {
    console.warn(`filing email bounce tracking: find ${table}`, error.message);
    return "error";
  }
  const rows = (data ?? []) as unknown as Array<{
    id: string;
    user_id: string;
    case_id: string;
    notes: string | null;
    created_at: string;
  }>;
  for (const row of rows) {
    const record = parseRecord(row.notes);
    if (record && record.provider_message_id === messageId) {
      return { ...row, record };
    }
  }
  return null;
}

/**
 * Records a Resend bounce/complaint event against whichever row (the completed filing, or —
 * rarer — a still-open task, if provider acceptance completed but the filing write itself
 * failed) currently holds this lane's delivery record for the given provider message id.
 *
 * By design this never reverses a completed filing or re-opens a task: it durably flags the
 * delivery as bounced/complained (monotonic, idempotent replay-safe) and appends a case timeline
 * entry so the failure is visible and actionable instead of silently remaining a successful
 * filing.
 */
export async function recordFilingEmailBounceEvent<TRecord extends BaseFilingEmailDeliveryRecord>(
  supabase: SupabaseClient,
  lane: FilingEmailBounceLane<TRecord>,
  params: { messageId: string; eventType: FilingEmailBounceEventType }
): Promise<FilingEmailBounceResult> {
  const messageId = params.messageId.trim();
  if (!messageId) return { status: "ignored_unknown" };

  const targetState: "bounced" | "complained" =
    params.eventType === "email.bounced" ? "bounced" : "complained";

  let table: "justice_case_filings" | "justice_case_tasks" = "justice_case_filings";
  let match = await findRowByProviderMessageId(
    supabase,
    "justice_case_filings",
    FILING_SELECT,
    messageId,
    lane.parseRecord
  );
  if (match === "error") return { status: "error", reason: "lookup_failed" };
  if (!match) {
    table = "justice_case_tasks";
    match = await findRowByProviderMessageId(
      supabase,
      "justice_case_tasks",
      TASK_SELECT,
      messageId,
      lane.parseRecord
    );
    if (match === "error") return { status: "error", reason: "lookup_failed" };
  }
  if (!match) return { status: "ignored_unknown" };

  const currentState = match.record.delivery_state;
  if (STATE_RANK[targetState] <= STATE_RANK[currentState]) {
    return {
      status: "ignored_duplicate",
      caseId: match.case_id,
      userId: match.user_id,
      state: currentState,
      matchedRowCreatedAt: match.created_at,
    };
  }

  const nextRecord = { ...match.record, delivery_state: targetState } as TRecord;
  const nextNotes = lane.upsertNotes(match.notes, nextRecord);

  const { error: updateErr } = await supabase
    .from(table)
    .update({ notes: nextNotes })
    .eq("id", match.id)
    .eq("user_id", match.user_id);
  if (updateErr) {
    console.warn(`filing email bounce tracking: update ${table}`, updateErr.message);
    return { status: "error", reason: "update_failed" };
  }

  await appendCaseTimelineEntry(supabase, match.user_id, match.case_id, {
    id: `${lane.timelineIdPrefix}_${targetState}:${messageId}`,
    type: "outcome_recorded",
    label:
      targetState === "complained"
        ? `${lane.label} email marked as spam — manual follow-up required`
        : `${lane.label} email bounced — manual follow-up required`,
    detail:
      "This was recorded as sent, but the provider reports it did not reach the recipient. Operator should verify and follow up with the company another way.",
  });

  return {
    status: "recorded",
    caseId: match.case_id,
    userId: match.user_id,
    state: targetState,
    matchedRowCreatedAt: match.created_at,
  };
}

/**
 * Records the bounce/complaint (see recordFilingEmailBounceEvent) and ensures both follow-on
 * actions — reopening the operator task, stopping the false follow-up countdown — are complete.
 *
 * Critically, this runs the actionability check on EVERY call that reaches a bounced/complained
 * delivery state, not only the first: a replayed webhook event for the same message id is
 * "ignored_duplicate" at the delivery-state layer (the flip already happened), but that must not
 * suppress retrying an incomplete action from a prior attempt. Both actions are individually
 * idempotent (see FilingEmailBounceReopenTask/FilingEmailBounceStopFollowUp), so re-running them
 * on an already-satisfied case is a safe no-op — no duplicate timeline entries or tasks.
 *
 * Guards against a *stale* replay: reopenTask/stopFollowUp are scoped to "the case's current
 * task/follow-up for this lane", not to this specific bounce's filing — so once the operator
 * remediates (a fresh filing, created after this one, exists), retrying them would incorrectly
 * reopen the newly-completed task or close the newly-started follow-up. Whenever the case's
 * latest lane filing is more recent than the filing this event resolved to, the attempt has
 * already been superseded and repair is skipped entirely, returning success as-is.
 *
 * That supersession check itself can fail (a database error, not merely "no filing found"). Such
 * a failure must fail closed: it is indistinguishable from "possibly superseded", so repair is
 * skipped just as on confirmed supersession, but — unlike confirmed supersession — this is NOT
 * reported as success. It returns "error" so the webhook responds 5xx and Resend retries the
 * event later, once the lookup can actually confirm whether repair is safe.
 *
 * Returns "error" whenever either action cannot be confirmed complete, so the webhook route
 * surfaces a 5xx and the provider retries; returns "recorded" only once both are confirmed done
 * (or the event is confirmed superseded).
 */
export async function recordFilingEmailBounceEventAndEnsureActionability<
  TRecord extends BaseFilingEmailDeliveryRecord,
>(
  supabase: SupabaseClient,
  lane: FilingEmailBounceActionabilityLane<TRecord>,
  params: { messageId: string; eventType: FilingEmailBounceEventType }
): Promise<FilingEmailBounceActionResult> {
  const result = await recordFilingEmailBounceEvent(supabase, lane, params);

  let caseId: string;
  let userId: string;
  let state: "bounced" | "complained";
  let matchedRowCreatedAt: string;
  if (result.status === "recorded") {
    ({ caseId, userId, state, matchedRowCreatedAt } = result);
  } else if (
    result.status === "ignored_duplicate" &&
    (result.state === "bounced" || result.state === "complained")
  ) {
    caseId = result.caseId;
    userId = result.userId;
    state = result.state;
    matchedRowCreatedAt = result.matchedRowCreatedAt;
  } else {
    return result;
  }

  const latestFilingCreatedAt = await lane.findLatestFilingCreatedAt(supabase, userId, caseId);
  if (latestFilingCreatedAt === "error") {
    // Cannot confirm whether this attempt has been superseded — do not risk reopening a
    // completed task or closing a fresh follow-up that may belong to a newer filing. Fail
    // closed and let the provider retry once the lookup can actually answer the question.
    return { status: "error", reason: "latest_filing_lookup_failed" };
  }
  if (latestFilingCreatedAt && latestFilingCreatedAt.localeCompare(matchedRowCreatedAt) > 0) {
    // A newer filing exists than the one this bounce/complaint concerns — the attempt has
    // already been remediated. Do not touch the current task/follow-up, which now belong to
    // that newer, successful filing.
    return { status: "recorded", caseId, state };
  }

  const [reopenResult, followUpResult] = await Promise.all([
    lane.reopenTask(supabase, userId, caseId, state),
    lane.stopFollowUp(supabase, userId, caseId),
  ]);

  const taskReopened = reopenResult.reopened;
  // "Already closed", "never existed" (no open task found), and "an open follow-up exists but
  // isn't confirmed to be this lane's" all count as satisfied — only a genuinely still-open,
  // lane-owned task that failed to close, or a failed lookup/update, is a real failure needing a
  // retry. A lookup/update error must never be conflated with "confirmed nothing to close".
  const followUpStopped =
    followUpResult.completed ||
    followUpResult.skippedNotOwned === true ||
    (followUpResult.task === null && followUpResult.error !== true);

  if (!taskReopened || !followUpStopped) {
    const reasons: string[] = [];
    if (!taskReopened) reasons.push("task_reopen_failed");
    if (!followUpStopped) reasons.push("follow_up_stop_failed");
    return { status: "error", reason: reasons.join(",") };
  }

  return { status: "recorded", caseId, state };
}

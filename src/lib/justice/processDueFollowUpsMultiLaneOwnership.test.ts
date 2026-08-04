import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildJusticeIntakeFromParts, defaultBuildJusticeIntakeParts } from "@/lib/justice/buildJusticeIntake";
import {
  MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF,
  MANUAL_ACTION_TRACKING_REAL_MERCHANT_PREP_HREF,
  MANUAL_ACTION_TRACKING_REAL_PAYMENT_DISPUTE_PREP_HREF,
} from "@/lib/justice/handlingTrackingProgress";
import {
  appendSupersededLaneReviewDecisionToNotes,
  buildSupersededLaneResponseReviewTaskNotes,
  ensureSupersededLaneResponseReviewTask,
  supersededLaneReviewLinkedFollowUpTaskId,
  supersededLaneReviewOutcomeTimelineId,
} from "@/lib/justice/followUpResponseReviewTask";
import { completeSupersededLaneReviewTask } from "@/lib/justice/completeSupersededLaneReviewTask";
import { classifyOpenOperatorTask } from "@/lib/justice/operatorFulfillmentQueue";
import { taskNotesMatchAnyOperatorFulfillmentMarker } from "@/lib/justice/operatorEvidenceFileAccess";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";
import type { JusticeIntake, TimelineEntry } from "@/lib/justice/types";

const CASE_ID = "550e8400-e29b-41d4-a716-446655440000";
const USER_ID = "user-owner-1";

import {
  processDueFollowUps,
  SUPERSEDED_LANE_FOLLOW_UP_CLOSE_RETRYABLE_ERROR,
  SUPERSEDED_LANE_OUTCOME_APPEND_RETRYABLE_ERROR,
} from "@/lib/justice/processDueFollowUps";

function intake(): JusticeIntake {
  return buildJusticeIntakeFromParts({
    ...defaultBuildJusticeIntakeParts(),
    problem_category: "online_purchase",
    company_name: "Acme Retail",
    purchase_or_signup: "widget order",
    story: "Ordered a widget that never arrived and merchant refused a refund.",
    money_amount: "$89.00",
    pay_or_order_date: "2026-01-10",
    already_contacted: "yes",
    contact_method: "email",
    contact_date: "2026-01-15",
    merchant_response_type: "refused_help",
    user_display_name: "Jordan Lee",
    reply_email: "e2e@example.com",
    consumer_us_state: "CA",
  });
}

function followUpRow(params: {
  id: string;
  ownerHref: string;
  dueDate: string | null;
}): JusticeCaseTaskRow {
  return {
    id: params.id,
    user_id: USER_ID,
    case_id: CASE_ID,
    title: `Surrenderless follow-up: ${params.ownerHref}`,
    due_date: params.dueDate,
    notes: `follow_up:${CASE_ID}\nowner_href:${params.ownerHref}`,
    completed_at: null,
    created_at: "2026-06-01T00:00:00.000Z",
    updated_at: "2026-06-01T00:00:00.000Z",
  };
}

/** A historical, already-decided superseded-lane review from a PRIOR remediation attempt — linked
 * to a specific (now-closed) follow-up task id, never merely to (case, owner_href). Used to prove
 * a later, genuinely new attempt on the same lane can never be silently answered by it. */
function decidedSupersededLaneReviewRow(params: {
  id: string;
  ownerHref: string;
  linkedFollowUpTaskId: string;
  outcome: "response_received" | "no_response";
  completedAt: string;
}): JusticeCaseTaskRow {
  return {
    id: params.id,
    user_id: USER_ID,
    case_id: CASE_ID,
    title: "Follow-up response review: prior attempt",
    due_date: null,
    notes: appendSupersededLaneReviewDecisionToNotes(
      buildSupersededLaneResponseReviewTaskNotes(
        CASE_ID,
        params.ownerHref,
        params.linkedFollowUpTaskId,
        "prior attempt"
      ),
      params.outcome
    ),
    completed_at: params.completedAt,
    created_at: "2026-04-01T00:00:00.000Z",
    updated_at: params.completedAt,
  };
}

/** A legacy row predating owner_href tagging — no line 2 at all. */
function unownedFollowUpRow(params: { id: string; dueDate: string | null }): JusticeCaseTaskRow {
  return {
    id: params.id,
    user_id: USER_ID,
    case_id: CASE_ID,
    title: "Surrenderless follow-up: legacy",
    due_date: params.dueDate,
    notes: `follow_up:${CASE_ID}`,
    completed_at: null,
    created_at: "2026-05-01T00:00:00.000Z",
    updated_at: "2026-05-01T00:00:00.000Z",
  };
}

/**
 * Real production path for "lane A already has a recorded decision by the time its follow-up
 * becomes due": creates the review via ensureSupersededLaneResponseReviewTask — scoped to case +
 * owner_href + this EXACT follow-up task id, idempotent for the same attempt only — confirms it
 * is actually surfaced through the real managed operator queue/marker
 * (taskNotesMatchAnyOperatorFulfillmentMarker + classifyOpenOperatorTask — the exact functions
 * the operator queue and generic task PATCH route use), then records the decision via the real
 * semantic completion API (completeSupersededLaneReviewTask), which itself fetches the linked
 * follow-up by that same exact id. Never fabricates a completed_at directly.
 */
async function createAndDecideSupersededLaneReview(
  supabase: SupabaseClient,
  ownerHref: string,
  followUpTaskId: string,
  label: string,
  outcome: "response_received" | "no_response"
): Promise<JusticeCaseTaskRow> {
  const ensured = await ensureSupersededLaneResponseReviewTask(
    supabase,
    USER_ID,
    CASE_ID,
    ownerHref,
    followUpTaskId,
    label
  );
  if (!ensured.task) throw new Error("test setup: failed to create superseded-lane review");

  expect(taskNotesMatchAnyOperatorFulfillmentMarker(ensured.task.notes, CASE_ID)).toBe(true);
  const queueItem = classifyOpenOperatorTask(ensured.task, intake());
  expect(queueItem?.step).toBe("superseded_lane_review");
  expect(queueItem?.owner_href).toBe(ownerHref);

  const completed = await completeSupersededLaneReviewTask(supabase, USER_ID, {
    caseId: CASE_ID,
    taskId: ensured.task.id,
    ownerHref,
    outcome,
  });
  if (!completed.ok) {
    throw new Error(`test setup: failed to complete superseded-lane review: ${completed.error}`);
  }
  return completed.task;
}

type CaseState = {
  intake: JusticeIntake;
  client_state: Record<string, unknown>;
  timeline?: TimelineEntry[];
};

type QueryBuilder = {
  eq: (col: string, val: unknown) => QueryBuilder;
  is: (col: string, val: null) => QueryBuilder;
  like: (col: string, pattern: string) => QueryBuilder;
  order: (col: string, opts?: unknown) => QueryBuilder;
  limit: (n: number) => Promise<{ data: JusticeCaseTaskRow[]; error: null }>;
  maybeSingle: () => Promise<{ data: JusticeCaseTaskRow | null; error: null }>;
};

/** Generic filter-accumulating query builder over the in-memory tasks array — supports whatever
 * order/combination of .eq()/.is()/.like()/.order() real callers chain, since the point of these
 * tests is exercising the REAL ensure/complete functions, not a narrowly-shaped stand-in. */
function taskQueryBuilder(rows: JusticeCaseTaskRow[]): QueryBuilder {
  let filtered = rows;
  const builder: QueryBuilder = {
    eq(col, val) {
      filtered = filtered.filter((t) => (t as unknown as Record<string, unknown>)[col] === val);
      return builder;
    },
    is(col, val) {
      filtered = filtered.filter((t) => (t as unknown as Record<string, unknown>)[col] == val);
      return builder;
    },
    like(col, pattern) {
      const prefix = pattern.endsWith("%") ? pattern.slice(0, -1) : pattern;
      filtered = filtered.filter((t) =>
        ((t as unknown as Record<string, unknown>)[col] as string | null ?? "").startsWith(prefix)
      );
      return builder;
    },
    order(col) {
      filtered = [...filtered].sort((a, b) =>
        String((a as unknown as Record<string, unknown>)[col] ?? "").localeCompare(
          String((b as unknown as Record<string, unknown>)[col] ?? "")
        )
      );
      return builder;
    },
    limit: async (n) => ({ data: filtered.slice(0, n).map((t) => ({ ...t })), error: null }),
    maybeSingle: async () => ({ data: filtered[0] ? { ...filtered[0] } : null, error: null }),
  };
  return builder;
}

/**
 * Minimal fake supabase for processDueFollowUps: a generic filter-accumulating query builder for
 * justice_case_tasks (select/update/insert), a case lookup/patch, and a real timeline read/write
 * so appendCaseTimelineEntry's own dedupe and null-on-failure behavior run for real. No .limit(1)
 * truncation on the follow-up scan, so row order in `tasks` cannot mask correctness.
 */
function makeSupabase(store: { tasks: JusticeCaseTaskRow[]; caseState: CaseState }): SupabaseClient {
  let taskIdCounter = 0;
  return {
    from(table: string) {
      if (table === "justice_case_tasks") {
        return {
          select: () => taskQueryBuilder(store.tasks),
          insert: (patch: Record<string, unknown>) => ({
            select: () => ({
              single: async () => {
                taskIdCounter += 1;
                const row: JusticeCaseTaskRow = {
                  id: `generated-task-${taskIdCounter}`,
                  user_id: patch.user_id as string,
                  case_id: patch.case_id as string,
                  title: patch.title as string,
                  due_date: (patch.due_date as string | undefined) ?? null,
                  notes: patch.notes as string,
                  completed_at: null,
                  created_at: "2026-07-15T16:00:00.000Z",
                  updated_at: "2026-07-15T16:00:00.000Z",
                };
                store.tasks.push(row);
                return { data: { ...row }, error: null };
              },
            }),
          }),
          update: (patch: Record<string, unknown>) => {
            const filters: Record<string, unknown> = {};
            const builder = {
              eq: (col: string, val: unknown) => {
                filters[col] = val;
                return builder;
              },
              select: () => ({
                maybeSingle: async () => {
                  const row = store.tasks.find((t) =>
                    Object.entries(filters).every(
                      ([col, val]) => (t as unknown as Record<string, unknown>)[col] === val
                    )
                  );
                  if (!row) return { data: null, error: null };
                  if (typeof patch.completed_at === "string") {
                    row.completed_at = patch.completed_at;
                  }
                  if (typeof patch.notes === "string") {
                    row.notes = patch.notes;
                  }
                  return { data: { ...row }, error: null };
                },
              }),
            };
            return builder;
          },
        };
      }
      if (table === "justice_cases") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    id: CASE_ID,
                    user_id: USER_ID,
                    intake: store.caseState.intake,
                    client_state: store.caseState.client_state,
                    archived_at: null,
                    payment_dispute_draft: null,
                    timeline: store.caseState.timeline ?? [],
                  },
                  error: null,
                }),
              }),
            }),
          }),
          update: (patch: Record<string, unknown>) => ({
            eq: () => ({
              eq: async () => {
                if (patch.client_state) {
                  store.caseState.client_state = patch.client_state as Record<string, unknown>;
                }
                if (patch.timeline) {
                  store.caseState.timeline = patch.timeline as TimelineEntry[];
                }
                return { error: null };
              },
            }),
          }),
        };
      }
      if (table === "justice_case_evidence") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                order: () => ({
                  limit: async () => ({ data: [], error: null }),
                }),
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  } as unknown as SupabaseClient;
}

/** Demand letter is the ladder's terminal step, so a due follow-up here always resolves via the
 * simple terminal_response_review path — no owned-filing-ensure machinery needed to reach it. */
const currentActionClientState: CaseState["client_state"] = {
  prepared_packet_approved: true,
  approved_next_action: {
    label: "Small claims / demand letter",
    href: MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF,
    status: "completed",
    follow_up_needed: true,
    follow_up_at: "2026-07-01T00:00:00.000Z",
    outcome_note: "Escalation complete. Awaiting responses.",
  },
};

describe("processDueFollowUps — two simultaneously open, differently owned follow-ups", () => {
  const now = new Date("2026-07-15T16:00:00.000Z");

  it("processes only the current lane's due task and never touches the other lane's open row — current-lane row seeded first", async () => {
    const currentLaneTask = followUpRow({
      id: "task-demand-letter",
      ownerHref: MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF,
      dueDate: "2026-07-10",
    });
    const otherLaneTask = followUpRow({
      id: "task-merchant",
      ownerHref: MANUAL_ACTION_TRACKING_REAL_MERCHANT_PREP_HREF,
      dueDate: null,
    });
    const store = {
      tasks: [currentLaneTask, otherLaneTask],
      caseState: { intake: intake(), client_state: { ...currentActionClientState }, timeline: [] as TimelineEntry[] },
    };
    const supabase = makeSupabase(store);

    const summary = await processDueFollowUps(supabase, { now });

    expect(summary.scanned).toBe(2);
    expect(summary.terminal_response_review).toBe(1);
    // The other lane's task has no due_date of its own — it must never fire, and must never be
    // touched by processing the current lane's task, regardless of scan order. Merchant contact
    // is itself a supported superseded lane, but with no due_date it's simply not due yet.
    const otherResult = summary.results.find((r) => r.task_id === "task-merchant");
    expect(otherResult).toEqual({
      case_id: CASE_ID,
      task_id: "task-merchant",
      kind: "skipped",
      reason: "not_due",
    });
    expect(currentLaneTask.completed_at).toBeTruthy();
    expect(otherLaneTask.completed_at).toBeNull();
  });

  it("processes only the current lane's due task and never touches the other lane's open row — other-lane row seeded first (row order must not matter)", async () => {
    const currentLaneTask = followUpRow({
      id: "task-demand-letter",
      ownerHref: MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF,
      dueDate: "2026-07-10",
    });
    const otherLaneTask = followUpRow({
      id: "task-merchant",
      ownerHref: MANUAL_ACTION_TRACKING_REAL_MERCHANT_PREP_HREF,
      dueDate: null,
    });
    const store = {
      tasks: [otherLaneTask, currentLaneTask],
      caseState: { intake: intake(), client_state: { ...currentActionClientState }, timeline: [] as TimelineEntry[] },
    };
    const supabase = makeSupabase(store);

    const summary = await processDueFollowUps(supabase, { now });

    expect(summary.terminal_response_review).toBe(1);
    const otherResult = summary.results.find((r) => r.task_id === "task-merchant");
    expect(otherResult).toEqual({
      case_id: CASE_ID,
      task_id: "task-merchant",
      kind: "skipped",
      reason: "not_due",
    });
    expect(currentLaneTask.completed_at).toBeTruthy();
    expect(otherLaneTask.completed_at).toBeNull();
  });

  it("never inherits the case-level follow_up_at for a task with no due_date of its own, even when that date is overdue", async () => {
    // The case's approved_next_action.follow_up_at (2026-07-01) is well overdue relative to
    // `now` — proving the other lane's task doesn't fire is only meaningful if that fallback
    // date really would have made it due under the old (removed) behavior.
    const currentLaneTask = followUpRow({
      id: "task-demand-letter",
      ownerHref: MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF,
      dueDate: "2026-08-01", // upcoming — not due yet on its own schedule
    });
    const otherLaneTask = followUpRow({
      id: "task-merchant",
      ownerHref: MANUAL_ACTION_TRACKING_REAL_MERCHANT_PREP_HREF,
      dueDate: null,
    });
    const store = {
      tasks: [currentLaneTask, otherLaneTask],
      caseState: { intake: intake(), client_state: { ...currentActionClientState }, timeline: [] as TimelineEntry[] },
    };
    const supabase = makeSupabase(store);

    const summary = await processDueFollowUps(supabase, { now });

    expect(summary.processed).toBe(0);
    expect(summary.results).toEqual(
      expect.arrayContaining([
        { case_id: CASE_ID, task_id: "task-demand-letter", kind: "skipped", reason: "not_due" },
        { case_id: CASE_ID, task_id: "task-merchant", kind: "skipped", reason: "not_due" },
      ])
    );
    expect(currentLaneTask.completed_at).toBeNull();
    expect(otherLaneTask.completed_at).toBeNull();
  });

  it("an overdue unowned legacy row is safely skipped — never advances client_state, records an outcome, or completes itself", async () => {
    const unownedTask = unownedFollowUpRow({ id: "task-legacy", dueDate: "2026-07-01" });
    const clientStateBefore = { ...currentActionClientState };
    const store = {
      tasks: [unownedTask],
      caseState: { intake: intake(), client_state: { ...clientStateBefore }, timeline: [] as TimelineEntry[] },
    };
    const supabase = makeSupabase(store);

    const summary = await processDueFollowUps(supabase, { now });

    expect(summary.scanned).toBe(1);
    expect(summary.processed).toBe(0);
    expect(summary.results).toEqual([
      { case_id: CASE_ID, task_id: "task-legacy", kind: "skipped", reason: "missing_owner" },
    ]);
    expect(unownedTask.completed_at).toBeNull();
    // No outcome recorded, no ladder advance — client_state is byte-for-byte untouched.
    expect(store.caseState.client_state).toEqual(clientStateBefore);
  });

  it("an overdue unowned legacy row beside a correctly owned, also-due current-lane row: only the owned row is processed — owned row seeded first", async () => {
    const ownedTask = followUpRow({
      id: "task-demand-letter",
      ownerHref: MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF,
      dueDate: "2026-07-10",
    });
    const unownedTask = unownedFollowUpRow({ id: "task-legacy", dueDate: "2026-07-01" });
    const store = {
      tasks: [ownedTask, unownedTask],
      caseState: { intake: intake(), client_state: { ...currentActionClientState }, timeline: [] as TimelineEntry[] },
    };
    const supabase = makeSupabase(store);

    const summary = await processDueFollowUps(supabase, { now });

    expect(summary.terminal_response_review).toBe(1);
    expect(summary.results).toEqual(
      expect.arrayContaining([
        { case_id: CASE_ID, task_id: "task-legacy", kind: "skipped", reason: "missing_owner" },
      ])
    );
    expect(ownedTask.completed_at).toBeTruthy();
    // Never touched, and never the row that got completed for the current lane's processing.
    expect(unownedTask.completed_at).toBeNull();
  });

  it("an overdue unowned legacy row beside a correctly owned, also-due current-lane row: only the owned row is processed — unowned row seeded first (row order must not matter)", async () => {
    const ownedTask = followUpRow({
      id: "task-demand-letter",
      ownerHref: MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF,
      dueDate: "2026-07-10",
    });
    const unownedTask = unownedFollowUpRow({ id: "task-legacy", dueDate: "2026-07-01" });
    const store = {
      tasks: [unownedTask, ownedTask],
      caseState: { intake: intake(), client_state: { ...currentActionClientState }, timeline: [] as TimelineEntry[] },
    };
    const supabase = makeSupabase(store);

    const summary = await processDueFollowUps(supabase, { now });

    expect(summary.terminal_response_review).toBe(1);
    expect(summary.results).toEqual(
      expect.arrayContaining([
        { case_id: CASE_ID, task_id: "task-legacy", kind: "skipped", reason: "missing_owner" },
      ])
    );
    expect(ownedTask.completed_at).toBeTruthy();
    expect(unownedTask.completed_at).toBeNull();
  });
});

describe("processDueFollowUps — a superseded lane's own due follow-up is processed independently of the current lane", () => {
  const now = new Date("2026-07-15T16:00:00.000Z");

  function currentLaneClientState(href: string, label: string): Record<string, unknown> {
    return {
      prepared_packet_approved: true,
      approved_next_action: {
        label,
        href,
        status: "approved",
        follow_up_needed: true,
        follow_up_at: "2026-08-01T12:00:00.000Z",
      },
    };
  }

  const cases: Array<{
    name: string;
    laneAHref: string;
    laneALabel: string;
    laneBHref: string;
    laneBLabel: string;
  }> = [
    {
      name: "demand letter (superseded) beside payment dispute (current)",
      laneAHref: MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF,
      laneALabel: "Small claims / demand letter",
      laneBHref: MANUAL_ACTION_TRACKING_REAL_PAYMENT_DISPUTE_PREP_HREF,
      laneBLabel: "Payment dispute (bank/card)",
    },
    {
      name: "payment dispute (superseded) beside merchant contact (current)",
      laneAHref: MANUAL_ACTION_TRACKING_REAL_PAYMENT_DISPUTE_PREP_HREF,
      laneALabel: "Payment dispute (bank/card)",
      laneBHref: MANUAL_ACTION_TRACKING_REAL_MERCHANT_PREP_HREF,
      laneBLabel: "Merchant contact",
    },
    {
      name: "merchant contact (superseded) beside demand letter (current)",
      laneAHref: MANUAL_ACTION_TRACKING_REAL_MERCHANT_PREP_HREF,
      laneALabel: "Merchant contact",
      laneBHref: MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF,
      laneBLabel: "Small claims / demand letter",
    },
  ];

  for (const { name, laneAHref, laneBHref } of cases) {
    it(`${name}: no recorded decision at due — lane A's follow-up stays open and gets its own owned review, lane B untouched — lane A row seeded first`, async () => {
      const laneATask = followUpRow({ id: "task-lane-a", ownerHref: laneAHref, dueDate: "2026-07-01" });
      const laneBTask = followUpRow({ id: "task-lane-b", ownerHref: laneBHref, dueDate: "2026-08-15" });
      const clientStateBefore = currentLaneClientState(laneBHref, "Lane B");
      const store = {
        tasks: [laneATask, laneBTask],
        caseState: { intake: intake(), client_state: { ...clientStateBefore }, timeline: [] as TimelineEntry[] },
      };
      const supabase = makeSupabase(store);

      const firstRun = await processDueFollowUps(supabase, { now });

      // The deadline alone is never evidence of "no response" — without an explicit decision,
      // lane A's follow-up must stay open and get its own owned, idempotent review task.
      expect(firstRun.superseded_lane_review_pending).toBe(1);
      expect(firstRun.superseded_lane_closed).toBe(0);
      expect(firstRun.results).toContainEqual({
        case_id: CASE_ID,
        task_id: "task-lane-a",
        kind: "superseded_lane_review_pending",
      });
      expect(laneATask.completed_at).toBeNull();
      expect(laneBTask.completed_at).toBeNull();
      expect(store.caseState.client_state).toEqual(clientStateBefore);

      const reviewTask = store.tasks.find(
        (t) => t.notes?.startsWith(`superseded_lane_review:${CASE_ID}`) && t.notes?.includes(`owner_href:${laneAHref}`)
      );
      expect(reviewTask).toBeTruthy();
      expect(reviewTask?.completed_at).toBeNull();
      // Real managed-queue reachability: the task processDueFollowUps just created is actually
      // surfaced through the same marker/classifier the operator queue and generic PATCH route
      // use — not an orphaned row nothing else can ever see.
      expect(taskNotesMatchAnyOperatorFulfillmentMarker(reviewTask!.notes, CASE_ID)).toBe(true);
      expect(classifyOpenOperatorTask(reviewTask!, intake())?.step).toBe("superseded_lane_review");

      // Re-running before any decision is recorded must stay idempotent: no duplicate review
      // task, lane A's follow-up still open.
      const secondRun = await processDueFollowUps(supabase, { now });
      expect(secondRun.superseded_lane_review_pending).toBe(1);
      expect(
        store.tasks.filter((t) => t.notes?.startsWith(`superseded_lane_review:${CASE_ID}`)).length
      ).toBe(1);
      expect(laneATask.completed_at).toBeNull();

      // Once the operator records a decision via the real semantic completion API (never a
      // seeded completed_at), the next run closes lane A's follow-up specifically — lane B
      // remains completely untouched throughout.
      const decided = await completeSupersededLaneReviewTask(supabase, USER_ID, {
        caseId: CASE_ID,
        taskId: reviewTask!.id,
        ownerHref: laneAHref,
        outcome: "no_response",
      });
      expect(decided.ok).toBe(true);
      const thirdRun = await processDueFollowUps(supabase, { now });

      expect(thirdRun.superseded_lane_closed).toBe(1);
      expect(thirdRun.results).toContainEqual({
        case_id: CASE_ID,
        task_id: "task-lane-a",
        kind: "superseded_lane_closed",
      });
      expect(laneATask.completed_at).toBeTruthy();
      expect(laneBTask.completed_at).toBeNull();
      expect(store.caseState.client_state).toEqual(clientStateBefore);
      expect(
        (store.caseState.timeline ?? []).some(
          (e) => e.id === supersededLaneReviewOutcomeTimelineId(CASE_ID, "task-lane-a")
        )
      ).toBe(true);
    });

    it(`${name}: no recorded decision at due — lane A's follow-up stays open and gets its own owned review, lane B untouched — lane B row seeded first (row order must not matter)`, async () => {
      const laneATask = followUpRow({ id: "task-lane-a", ownerHref: laneAHref, dueDate: "2026-07-01" });
      const laneBTask = followUpRow({ id: "task-lane-b", ownerHref: laneBHref, dueDate: "2026-08-15" });
      const clientStateBefore = currentLaneClientState(laneBHref, "Lane B");
      const store = {
        tasks: [laneBTask, laneATask],
        caseState: { intake: intake(), client_state: { ...clientStateBefore }, timeline: [] as TimelineEntry[] },
      };
      const supabase = makeSupabase(store);

      const firstRun = await processDueFollowUps(supabase, { now });
      expect(firstRun.superseded_lane_review_pending).toBe(1);
      expect(laneATask.completed_at).toBeNull();
      expect(laneBTask.completed_at).toBeNull();

      const reviewTask = store.tasks.find(
        (t) => t.notes?.startsWith(`superseded_lane_review:${CASE_ID}`) && t.notes?.includes(`owner_href:${laneAHref}`)
      );
      expect(reviewTask).toBeTruthy();
      expect(taskNotesMatchAnyOperatorFulfillmentMarker(reviewTask!.notes, CASE_ID)).toBe(true);
      const decided = await completeSupersededLaneReviewTask(supabase, USER_ID, {
        caseId: CASE_ID,
        taskId: reviewTask!.id,
        ownerHref: laneAHref,
        outcome: "no_response",
      });
      expect(decided.ok).toBe(true);

      const secondRun = await processDueFollowUps(supabase, { now });
      expect(secondRun.superseded_lane_closed).toBe(1);
      expect(secondRun.results).toContainEqual({
        case_id: CASE_ID,
        task_id: "task-lane-a",
        kind: "superseded_lane_closed",
      });
      expect(laneATask.completed_at).toBeTruthy();
      expect(laneBTask.completed_at).toBeNull();
      expect(store.caseState.client_state).toEqual(clientStateBefore);
    });
  }

  for (const { name, laneAHref, laneALabel, laneBHref } of cases) {
    it(`${name}: a pre-due response is honored — a review already decided before the deadline lets lane A close in one pass without ever recording "no response"`, async () => {
      const laneATask = followUpRow({ id: "task-lane-a", ownerHref: laneAHref, dueDate: "2026-07-01" });
      const laneBTask = followUpRow({ id: "task-lane-b", ownerHref: laneBHref, dueDate: "2026-08-15" });
      const clientStateBefore = currentLaneClientState(laneBHref, "Lane B");
      const store = {
        tasks: [laneATask, laneBTask],
        caseState: { intake: intake(), client_state: { ...clientStateBefore }, timeline: [] as TimelineEntry[] },
      };
      const supabase = makeSupabase(store);

      // Lane A's own response was already reviewed and recorded BEFORE the follow-up became
      // due — created, listed through the real managed queue, and decided via the real
      // semantic completion API (never a seeded completed_at).
      const preDueReview = await createAndDecideSupersededLaneReview(
        supabase,
        laneAHref,
        laneATask.id,
        laneALabel,
        "response_received"
      );
      expect(preDueReview.completed_at).toBeTruthy();

      const summary = await processDueFollowUps(supabase, { now });

      expect(summary.superseded_lane_closed).toBe(1);
      expect(summary.superseded_lane_review_pending).toBe(0);
      expect(summary.results).toContainEqual({
        case_id: CASE_ID,
        task_id: "task-lane-a",
        kind: "superseded_lane_closed",
      });
      expect(laneATask.completed_at).toBeTruthy();
      expect(laneBTask.completed_at).toBeNull();
      expect(store.caseState.client_state).toEqual(clientStateBefore);
      // No duplicate review task was created — the pre-existing owned row was reused.
      expect(
        store.tasks.filter(
          (t) => t.notes?.startsWith(`superseded_lane_review:${CASE_ID}`) && t.notes?.includes(`owner_href:${laneAHref}`)
        ).length
      ).toBe(1);
      const timeline = store.caseState.timeline ?? [];
      expect(timeline.some((e) => e.id === supersededLaneReviewOutcomeTimelineId(CASE_ID, "task-lane-a"))).toBe(
        true
      );
      // Never the "no response" outcome — this attempt DID get a response.
      expect(timeline.some((e) => e.label.toLowerCase().includes("no response"))).toBe(false);
    });
  }

  for (const { name, laneAHref, laneALabel, laneBHref } of cases) {
    it(`${name}: a review created well ahead of the deadline permits response_received early but rejects no_response before its own follow-up is due`, async () => {
      // Far in the future so "not due yet" holds regardless of when this suite runs — proving
      // the review exists and is decidable long before processDueFollowUps would ever create or
      // notice it itself.
      const laneATask = followUpRow({ id: "task-lane-a", ownerHref: laneAHref, dueDate: "2099-01-01" });
      const laneBTask = followUpRow({ id: "task-lane-b", ownerHref: laneBHref, dueDate: "2099-06-01" });
      const clientStateBefore = currentLaneClientState(laneBHref, "Lane B");
      const store = {
        tasks: [laneATask, laneBTask],
        caseState: { intake: intake(), client_state: { ...clientStateBefore }, timeline: [] as TimelineEntry[] },
      };
      const supabase = makeSupabase(store);

      // Real production creation (the same function real bounce remediation calls), listed
      // through the real managed-queue marker/classifier.
      const ensured = await ensureSupersededLaneResponseReviewTask(
        supabase,
        USER_ID,
        CASE_ID,
        laneAHref,
        laneATask.id,
        laneALabel
      );
      expect(ensured.task).toBeTruthy();
      expect(taskNotesMatchAnyOperatorFulfillmentMarker(ensured.task!.notes, CASE_ID)).toBe(true);
      expect(classifyOpenOperatorTask(ensured.task!, intake())?.step).toBe("superseded_lane_review");

      // "No response" is a claim the deadline passed unanswered — that claim is false here, so
      // it must be rejected rather than silently accepted.
      const rejectedNoResponse = await completeSupersededLaneReviewTask(supabase, USER_ID, {
        caseId: CASE_ID,
        taskId: ensured.task!.id,
        ownerHref: laneAHref,
        outcome: "no_response",
      });
      expect(rejectedNoResponse.ok).toBe(false);
      if (rejectedNoResponse.ok) return;
      expect(rejectedNoResponse.status).toBe(400);
      expect(rejectedNoResponse.error).toMatch(/not due yet/i);

      // "Response received" makes no claim about the deadline — it is always permitted.
      const acceptedResponse = await completeSupersededLaneReviewTask(supabase, USER_ID, {
        caseId: CASE_ID,
        taskId: ensured.task!.id,
        ownerHref: laneAHref,
        outcome: "response_received",
      });
      expect(acceptedResponse.ok).toBe(true);
      if (!acceptedResponse.ok) return;
      expect(acceptedResponse.task.completed_at).toBeTruthy();

      // Neither attempt ever touched lane A's or lane B's own follow-up tasks, or client_state.
      expect(laneATask.completed_at).toBeNull();
      expect(laneBTask.completed_at).toBeNull();
      expect(store.caseState.client_state).toEqual(clientStateBefore);

      // The cron still correctly treats lane A's follow-up as not due yet — the review being
      // decided early doesn't fabricate a due date for the follow-up itself.
      const summary = await processDueFollowUps(supabase, { now });
      expect(summary.results).toContainEqual({
        case_id: CASE_ID,
        task_id: "task-lane-a",
        kind: "skipped",
        reason: "not_due",
      });
    });
  }

  for (const { name, laneAHref, laneALabel, laneBHref } of cases) {
    it(`${name}: failed outcome persistence leaves lane A's follow-up open and is retried without duplicating the outcome`, async () => {
      const laneATask = followUpRow({ id: "task-lane-a", ownerHref: laneAHref, dueDate: "2026-07-01" });
      const laneBTask = followUpRow({ id: "task-lane-b", ownerHref: laneBHref, dueDate: "2026-08-15" });
      const clientStateBefore = currentLaneClientState(laneBHref, "Lane B");
      const store = {
        tasks: [laneATask, laneBTask],
        caseState: { intake: intake(), client_state: { ...clientStateBefore }, timeline: [] as TimelineEntry[] },
      };
      const supabase = makeSupabase(store);

      // Real creation → listing → decision, before the DB failure is installed below.
      const decidedReview = await createAndDecideSupersededLaneReview(
        supabase,
        laneAHref,
        laneATask.id,
        laneALabel,
        "no_response"
      );
      expect(decidedReview.completed_at).toBeTruthy();

      // Force the timeline write (justice_cases.update) to fail on the first run only, simulating
      // a transient DB error persisting the reviewed outcome.
      const originalFrom = supabase.from.bind(supabase);
      let failNextCasesUpdate = true;
      vi.spyOn(supabase, "from").mockImplementation((table: string) => {
        const real = originalFrom(table);
        if (table === "justice_cases" && failNextCasesUpdate) {
          return {
            ...real,
            update: () => ({
              eq: () => ({
                eq: async () => ({ error: { message: "timeline update failed" } }),
              }),
            }),
          } as unknown as ReturnType<SupabaseClient["from"]>;
        }
        return real;
      });

      const timelineLengthBeforeCronRun = (store.caseState.timeline ?? []).length;
      const firstRun = await processDueFollowUps(supabase, { now });

      expect(firstRun.superseded_lane_closed).toBe(0);
      expect(firstRun.failed_retryable).toBe(1);
      expect(firstRun.results).toContainEqual({
        case_id: CASE_ID,
        task_id: "task-lane-a",
        kind: "failed_retryable",
        error: SUPERSEDED_LANE_OUTCOME_APPEND_RETRYABLE_ERROR,
      });
      // The task must NOT close when its outcome was never durably persisted, and no new
      // timeline entry (from the failed cron-side append) was recorded.
      expect(laneATask.completed_at).toBeNull();
      expect(laneBTask.completed_at).toBeNull();
      expect((store.caseState.timeline ?? []).length).toBe(timelineLengthBeforeCronRun);

      // Retry with the underlying failure resolved: succeeds, and does not duplicate the outcome.
      failNextCasesUpdate = false;
      const secondRun = await processDueFollowUps(supabase, { now });

      expect(secondRun.superseded_lane_closed).toBe(1);
      expect(laneATask.completed_at).toBeTruthy();
      expect(laneBTask.completed_at).toBeNull();
      expect(store.caseState.client_state).toEqual(clientStateBefore);
      const timeline = store.caseState.timeline ?? [];
      expect(timeline.filter((e) => e.id === supersededLaneReviewOutcomeTimelineId(CASE_ID, "task-lane-a")).length).toBe(
        1
      );
    });
  }

  it("retries on a real database failure closing the task instead of silently succeeding — leaves lane A's task open", async () => {
    const laneATask = followUpRow({
      id: "task-lane-a",
      ownerHref: MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF,
      dueDate: "2026-07-01",
    });
    const store = {
      tasks: [laneATask],
      caseState: {
        intake: intake(),
        client_state: currentLaneClientState(
          MANUAL_ACTION_TRACKING_REAL_PAYMENT_DISPUTE_PREP_HREF,
          "Payment dispute (bank/card)"
        ),
        timeline: [] as TimelineEntry[],
      },
    };
    const supabase = makeSupabase(store);

    // Real creation → listing → decision, before the DB failure is installed below.
    const decidedReview = await createAndDecideSupersededLaneReview(
      supabase,
      MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF,
      laneATask.id,
      "Small claims / demand letter",
      "no_response"
    );
    expect(decidedReview.completed_at).toBeTruthy();

    // Force the task-completion update to fail (after the outcome timeline entry has already
    // been durably recorded), simulating a transient DB error at the final close step.
    const originalFrom = supabase.from.bind(supabase);
    vi.spyOn(supabase, "from").mockImplementation((table: string) => {
      const real = originalFrom(table);
      if (table === "justice_case_tasks") {
        return {
          ...real,
          update: () => ({
            eq: () => ({
              eq: () => ({
                select: () => ({
                  maybeSingle: async () => ({ data: null, error: { message: "update failed" } }),
                }),
              }),
            }),
          }),
        } as unknown as ReturnType<SupabaseClient["from"]>;
      }
      return real;
    });

    const summary = await processDueFollowUps(supabase, { now });

    expect(summary.superseded_lane_closed).toBe(0);
    expect(summary.failed_retryable).toBe(1);
    expect(summary.results).toContainEqual({
      case_id: CASE_ID,
      task_id: "task-lane-a",
      kind: "failed_retryable",
      error: SUPERSEDED_LANE_FOLLOW_UP_CLOSE_RETRYABLE_ERROR,
    });
    // Left open specifically so the next cron run retries it.
    expect(laneATask.completed_at).toBeNull();
    // The reviewed outcome was still durably recorded even though the close itself failed.
    expect(
      (store.caseState.timeline ?? []).some(
        (e) => e.id === supersededLaneReviewOutcomeTimelineId(CASE_ID, "task-lane-a")
      )
    ).toBe(true);
  });

  it("safely skips (not_current_lane) a superseded row owned by a lane without a remediation-follow-up model — never guesses", async () => {
    const unsupportedLaneTask = followUpRow({
      id: "task-unsupported",
      ownerHref: "/justice/bbb",
      dueDate: "2026-07-01",
    });
    const store = {
      tasks: [unsupportedLaneTask],
      caseState: {
        intake: intake(),
        client_state: currentLaneClientState(
          MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF,
          "Small claims / demand letter"
        ),
      },
    };
    const supabase = makeSupabase(store);

    const summary = await processDueFollowUps(supabase, { now });

    expect(summary.superseded_lane_closed).toBe(0);
    expect(summary.processed).toBe(0);
    expect(summary.results).toEqual([
      { case_id: CASE_ID, task_id: "task-unsupported", kind: "skipped", reason: "not_current_lane" },
    ]);
    expect(unsupportedLaneTask.completed_at).toBeNull();
  });

  for (const { name, laneAHref, laneBHref } of cases) {
    it(`${name}: an old completed follow-up/review from a PRIOR attempt never answers for a fresh new attempt — old rows seeded first`, async () => {
      const oldFollowUp = followUpRow({ id: "task-lane-a-old", ownerHref: laneAHref, dueDate: "2026-05-01" });
      oldFollowUp.completed_at = "2026-05-02T00:00:00.000Z";
      const oldReview = decidedSupersededLaneReviewRow({
        id: "review-old",
        ownerHref: laneAHref,
        linkedFollowUpTaskId: "task-lane-a-old",
        outcome: "no_response",
        completedAt: "2026-05-02T00:00:00.000Z",
      });
      const newFollowUp = followUpRow({ id: "task-lane-a-new", ownerHref: laneAHref, dueDate: "2026-07-01" });
      const laneBTask = followUpRow({ id: "task-lane-b", ownerHref: laneBHref, dueDate: "2026-08-15" });
      const clientStateBefore = currentLaneClientState(laneBHref, "Lane B");
      const store = {
        tasks: [oldFollowUp, oldReview, newFollowUp, laneBTask],
        caseState: { intake: intake(), client_state: { ...clientStateBefore }, timeline: [] as TimelineEntry[] },
      };
      const supabase = makeSupabase(store);

      const firstRun = await processDueFollowUps(supabase, { now });

      // The new attempt gets its OWN pending review — the old, already-decided review for the
      // prior attempt on this same lane must never silently answer for it.
      expect(firstRun.superseded_lane_review_pending).toBe(1);
      expect(firstRun.superseded_lane_closed).toBe(0);
      expect(firstRun.results).toContainEqual({
        case_id: CASE_ID,
        task_id: "task-lane-a-new",
        kind: "superseded_lane_review_pending",
      });
      expect(newFollowUp.completed_at).toBeNull();
      // The old pair is completely untouched.
      expect(oldFollowUp.completed_at).toBe("2026-05-02T00:00:00.000Z");
      expect(oldReview.completed_at).toBe("2026-05-02T00:00:00.000Z");
      expect(laneBTask.completed_at).toBeNull();
      expect(store.caseState.client_state).toEqual(clientStateBefore);

      // A fresh review was created, linked to the NEW follow-up id — never the old one — and the
      // old review was never reused (still exactly one row for the old attempt).
      const newReview = store.tasks.find(
        (t) =>
          t.notes?.startsWith(`superseded_lane_review:${CASE_ID}`) &&
          supersededLaneReviewLinkedFollowUpTaskId(t.notes) === "task-lane-a-new"
      );
      expect(newReview).toBeTruthy();
      expect(newReview?.id).not.toBe("review-old");
      expect(newReview?.completed_at).toBeNull();
      expect(
        store.tasks.filter((t) => t.notes?.startsWith(`superseded_lane_review:${CASE_ID}`)).length
      ).toBe(2);

      // Decide the NEW review for real, then confirm the cron closes ONLY the new follow-up.
      const decided = await completeSupersededLaneReviewTask(supabase, USER_ID, {
        caseId: CASE_ID,
        taskId: newReview!.id,
        ownerHref: laneAHref,
        outcome: "response_received",
      });
      expect(decided.ok).toBe(true);

      const secondRun = await processDueFollowUps(supabase, { now });
      expect(secondRun.superseded_lane_closed).toBe(1);
      expect(secondRun.results).toContainEqual({
        case_id: CASE_ID,
        task_id: "task-lane-a-new",
        kind: "superseded_lane_closed",
      });
      expect(newFollowUp.completed_at).toBeTruthy();
      // The old attempt's follow-up remains closed exactly as it always was — never reopened,
      // never re-closed, never the row this run acted on.
      expect(oldFollowUp.completed_at).toBe("2026-05-02T00:00:00.000Z");
      expect(oldReview.completed_at).toBe("2026-05-02T00:00:00.000Z");
      expect(laneBTask.completed_at).toBeNull();
      expect(store.caseState.client_state).toEqual(clientStateBefore);
    });

    it(`${name}: an old completed follow-up/review from a PRIOR attempt never answers for a fresh new attempt — new row seeded first (row order must not matter)`, async () => {
      const oldFollowUp = followUpRow({ id: "task-lane-a-old", ownerHref: laneAHref, dueDate: "2026-05-01" });
      oldFollowUp.completed_at = "2026-05-02T00:00:00.000Z";
      const oldReview = decidedSupersededLaneReviewRow({
        id: "review-old",
        ownerHref: laneAHref,
        linkedFollowUpTaskId: "task-lane-a-old",
        outcome: "no_response",
        completedAt: "2026-05-02T00:00:00.000Z",
      });
      const newFollowUp = followUpRow({ id: "task-lane-a-new", ownerHref: laneAHref, dueDate: "2026-07-01" });
      const laneBTask = followUpRow({ id: "task-lane-b", ownerHref: laneBHref, dueDate: "2026-08-15" });
      const clientStateBefore = currentLaneClientState(laneBHref, "Lane B");
      // Same rows, reversed/interleaved order — the exact-id linkage means matching can never
      // depend on array position.
      const store = {
        tasks: [laneBTask, newFollowUp, oldReview, oldFollowUp],
        caseState: { intake: intake(), client_state: { ...clientStateBefore }, timeline: [] as TimelineEntry[] },
      };
      const supabase = makeSupabase(store);

      const firstRun = await processDueFollowUps(supabase, { now });

      expect(firstRun.superseded_lane_review_pending).toBe(1);
      expect(firstRun.superseded_lane_closed).toBe(0);
      expect(newFollowUp.completed_at).toBeNull();
      expect(oldFollowUp.completed_at).toBe("2026-05-02T00:00:00.000Z");
      expect(oldReview.completed_at).toBe("2026-05-02T00:00:00.000Z");

      const newReview = store.tasks.find(
        (t) =>
          t.notes?.startsWith(`superseded_lane_review:${CASE_ID}`) &&
          supersededLaneReviewLinkedFollowUpTaskId(t.notes) === "task-lane-a-new"
      );
      expect(newReview).toBeTruthy();
      expect(newReview?.id).not.toBe("review-old");

      // no_response is correctly gated on the NEW follow-up's own due date (already overdue here
      // relative to `now`), never on the old follow-up's — proving the due-check itself resolves
      // the exact linked row regardless of seeding order.
      const decided = await completeSupersededLaneReviewTask(supabase, USER_ID, {
        caseId: CASE_ID,
        taskId: newReview!.id,
        ownerHref: laneAHref,
        outcome: "no_response",
      });
      expect(decided.ok).toBe(true);

      const secondRun = await processDueFollowUps(supabase, { now });
      expect(secondRun.superseded_lane_closed).toBe(1);
      expect(secondRun.results).toContainEqual({
        case_id: CASE_ID,
        task_id: "task-lane-a-new",
        kind: "superseded_lane_closed",
      });
      expect(newFollowUp.completed_at).toBeTruthy();
      expect(oldFollowUp.completed_at).toBe("2026-05-02T00:00:00.000Z");
      expect(oldReview.completed_at).toBe("2026-05-02T00:00:00.000Z");
      expect(laneBTask.completed_at).toBeNull();
      expect(store.caseState.client_state).toEqual(clientStateBefore);
    });
  }
});

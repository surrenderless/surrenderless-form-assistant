import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildJusticeIntakeFromParts, defaultBuildJusticeIntakeParts } from "@/lib/justice/buildJusticeIntake";
import {
  followUpResponseReviewTaskNotesMarker,
  taskNotesMatchFollowUpResponseReviewMarker,
} from "@/lib/justice/followUpResponseReviewTask";
import { NO_RESPONSE_OUTCOME_MARKER } from "@/lib/justice/processDueFollowUps";
import {
  caseNeedsFollowUpResponseReviewTask,
  reconcileMissingFollowUpResponseReviewTasks,
} from "@/lib/justice/reconcileMissingFollowUpResponseReviewTasks";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";
import type { JusticeIntake, TimelineEntry } from "@/lib/justice/types";

const CASE_ID = "550e8400-e29b-41d4-a716-446655440000";
const CASE_ID_2 = "550e8400-e29b-41d4-a716-446655440001";
const USER_ID = "user-owner-1";

const timelineStore: { entries: TimelineEntry[] } = { entries: [] };

vi.mock("@/server/justiceTimelineAppend", () => ({
  appendCaseTimelineEntry: vi.fn(
    async (
      _supabase: SupabaseClient,
      _userId: string,
      caseId: string,
      entry: { id: string; type: TimelineEntry["type"]; label: string; detail?: string; ts?: string }
    ) => {
      if (timelineStore.entries.some((row) => row.id === entry.id)) {
        return timelineStore.entries;
      }
      const next: TimelineEntry = {
        id: entry.id,
        case_id: caseId,
        type: entry.type,
        label: entry.label,
        ts: entry.ts ?? new Date().toISOString(),
        ...(entry.detail ? { detail: entry.detail } : {}),
      };
      timelineStore.entries = [...timelineStore.entries, next];
      return timelineStore.entries;
    }
  ),
}));

function retailIntake(): JusticeIntake {
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

function terminalNoResponseClientState(): Record<string, unknown> {
  return {
    prepared_packet_approved: true,
    approved_next_action: {
      label: "Small claims / demand letter",
      href: "/justice/demand-letter",
      status: "completed",
      completed_at: "2026-07-01T12:00:00.000Z",
      follow_up_needed: false,
      outcome_note: `${NO_RESPONSE_OUTCOME_MARKER} (due 2026-07-01). Follow-up check completed by Surrenderless — case remains open; no automatic resolution applied.`,
    },
  };
}

type CaseRow = {
  id: string;
  user_id: string;
  intake: JusticeIntake;
  client_state: unknown;
  archived_at: string | null;
  updated_at: string;
};

type MockState = {
  cases: CaseRow[];
  tasks: JusticeCaseTaskRow[];
  insertCount: number;
  insertFailCaseIds: Set<string>;
};

function createReconcileSupabase(state: MockState): SupabaseClient {
  return {
    from: (table: string) => {
      if (table === "justice_cases") {
        return {
          select: () => ({
            is: () => ({
              order: () => ({
                limit: async () => ({
                  data: state.cases.filter((c) => !c.archived_at?.trim()),
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      if (table === "justice_case_tasks") {
        return {
          select: () => ({
            eq: (_col: string, userId: string) => ({
              eq: (_col2: string, caseId: string) => ({
                like: (_column: string, pattern: string) => ({
                  limit: async () => {
                    const prefix = String(pattern).replace(/%$/, "");
                    const matched = state.tasks.filter(
                      (task) =>
                        task.user_id === userId &&
                        task.case_id === caseId &&
                        (task.notes ?? "").startsWith(prefix)
                    );
                    return { data: matched.slice(0, 1), error: null };
                  },
                }),
              }),
            }),
          }),
          insert: (row: Record<string, unknown>) => ({
            select: () => ({
              single: async () => {
                const caseId = String(row.case_id ?? "");
                if (state.insertFailCaseIds.has(caseId)) {
                  return { data: null, error: { message: "insert failed" } };
                }
                state.insertCount += 1;
                const task: JusticeCaseTaskRow = {
                  id: `response-review-${state.insertCount}`,
                  user_id: String(row.user_id ?? ""),
                  case_id: caseId,
                  title: String(row.title ?? ""),
                  due_date: typeof row.due_date === "string" ? row.due_date : null,
                  notes: typeof row.notes === "string" ? row.notes : null,
                  completed_at: null,
                  created_at: "2026-07-17T12:00:00.000Z",
                  updated_at: "2026-07-17T12:00:00.000Z",
                };
                state.tasks = [...state.tasks, task];
                return { data: task, error: null };
              },
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  } as unknown as SupabaseClient;
}

describe("reconcileMissingFollowUpResponseReviewTasks", () => {
  beforeEach(() => {
    timelineStore.entries = [];
  });

  it("detects terminal no-response client_state that needs a response-review task", () => {
    expect(caseNeedsFollowUpResponseReviewTask(terminalNoResponseClientState())).toBe(true);
    expect(
      caseNeedsFollowUpResponseReviewTask({
        approved_next_action: {
          href: "/justice/demand-letter",
          status: "completed",
          follow_up_needed: true,
          outcome_note: NO_RESPONSE_OUTCOME_MARKER,
        },
      })
    ).toBe(false);
  });

  it("creates a missing response-review task for orphaned terminal no-response cases", async () => {
    const state: MockState = {
      cases: [
        {
          id: CASE_ID,
          user_id: USER_ID,
          intake: retailIntake(),
          client_state: terminalNoResponseClientState(),
          archived_at: null,
          updated_at: "2026-07-17T12:00:00.000Z",
        },
        {
          id: CASE_ID_2,
          user_id: USER_ID,
          intake: retailIntake(),
          client_state: { approved_next_action: { status: "approved", href: "/justice/merchant" } },
          archived_at: null,
          updated_at: "2026-07-17T11:00:00.000Z",
        },
      ],
      tasks: [],
      insertCount: 0,
      insertFailCaseIds: new Set(),
    };

    const summary = await reconcileMissingFollowUpResponseReviewTasks(
      createReconcileSupabase(state)
    );

    expect(summary.scanned).toBe(2);
    expect(summary.needing_response_review).toBe(1);
    expect(summary.created).toBe(1);
    expect(summary.already_present).toBe(0);
    expect(summary.failed).toBe(0);
    expect(state.insertCount).toBe(1);
    expect(state.tasks).toHaveLength(1);
    expect(taskNotesMatchFollowUpResponseReviewMarker(state.tasks[0].notes, CASE_ID)).toBe(true);
    expect(summary.results.some((r) => r.case_id === CASE_ID && r.kind === "created")).toBe(true);
  });

  it("does not duplicate when a response-review task already exists", async () => {
    const marker = followUpResponseReviewTaskNotesMarker(CASE_ID);
    const existing: JusticeCaseTaskRow = {
      id: "existing-review",
      user_id: USER_ID,
      case_id: CASE_ID,
      title: "Follow-up response review: Acme Retail",
      due_date: null,
      notes: marker,
      completed_at: null,
      created_at: "2026-07-01T00:00:00.000Z",
      updated_at: "2026-07-01T00:00:00.000Z",
    };
    const state: MockState = {
      cases: [
        {
          id: CASE_ID,
          user_id: USER_ID,
          intake: retailIntake(),
          client_state: terminalNoResponseClientState(),
          archived_at: null,
          updated_at: "2026-07-17T12:00:00.000Z",
        },
      ],
      tasks: [existing],
      insertCount: 0,
      insertFailCaseIds: new Set(),
    };

    const summary = await reconcileMissingFollowUpResponseReviewTasks(
      createReconcileSupabase(state)
    );

    expect(summary.needing_response_review).toBe(1);
    expect(summary.already_present).toBe(1);
    expect(summary.created).toBe(0);
    expect(state.insertCount).toBe(0);
    expect(state.tasks).toHaveLength(1);
  });

  it("reports failure when ensure cannot insert the missing task", async () => {
    const state: MockState = {
      cases: [
        {
          id: CASE_ID,
          user_id: USER_ID,
          intake: retailIntake(),
          client_state: terminalNoResponseClientState(),
          archived_at: null,
          updated_at: "2026-07-17T12:00:00.000Z",
        },
      ],
      tasks: [],
      insertCount: 0,
      insertFailCaseIds: new Set([CASE_ID]),
    };

    const summary = await reconcileMissingFollowUpResponseReviewTasks(
      createReconcileSupabase(state)
    );

    expect(summary.created).toBe(0);
    expect(summary.failed).toBe(1);
    expect(summary.results[0]).toMatchObject({
      case_id: CASE_ID,
      kind: "failed",
      reason: "ensure_failed",
    });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { OPERATOR_RESOLVED_OUTCOME_MARKER } from "@/lib/justice/completeFollowUpResponseReview";
import { followUpResponseReviewTaskNotesMarker } from "@/lib/justice/followUpResponseReviewTask";
import { completeOperatorCaseArchive } from "@/lib/justice/operatorOwnedCaseArchive";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";
import type { TimelineEntry } from "@/lib/justice/types";

const CASE_ID = "550e8400-e29b-41d4-a716-446655440000";
const USER_ID = "user-owner-1";
const TASK_ID = "550e8400-e29b-41d4-a716-446655440081";

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

type MockState = {
  archived_at: string | null;
  client_state: Record<string, unknown>;
  task: JusticeCaseTaskRow;
  patchedArchivedAt: string | null;
};

function createSupabase(state: MockState): SupabaseClient {
  return {
    from: (table: string) => {
      if (table === "justice_cases") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    id: CASE_ID,
                    user_id: USER_ID,
                    intake: { company_name: "Acme" },
                    client_state: state.client_state,
                    archived_at: state.archived_at,
                  },
                  error: null,
                }),
              }),
            }),
          }),
          update: (patch: Record<string, unknown>) => ({
            eq: () => ({
              eq: async () => {
                if (typeof patch.archived_at === "string") {
                  state.archived_at = patch.archived_at;
                  state.patchedArchivedAt = patch.archived_at;
                }
                return { error: null };
              },
            }),
          }),
        };
      }
      if (table === "justice_case_tasks") {
        return {
          select: () => ({
            eq: () => ({
              eq: async () => ({ data: [state.task], error: null }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  } as unknown as SupabaseClient;
}

describe("completeOperatorCaseArchive", () => {
  beforeEach(() => {
    timelineStore.entries = [];
  });

  it("requires explicit confirm_archive", async () => {
    const state: MockState = {
      archived_at: null,
      patchedArchivedAt: null,
      client_state: {
        prepared_packet_approved: true,
        approved_next_action: {
          label: "Demand letter",
          href: "/justice/demand-letter",
          status: "completed",
          completed_at: "2026-06-01T00:00:00.000Z",
          follow_up_needed: false,
          outcome_note: OPERATOR_RESOLVED_OUTCOME_MARKER,
          handling_requested_at: "2026-06-01T00:00:00.000Z",
          handling_acknowledged_at: "2026-07-15T12:00:00.000Z",
        },
      },
      task: {
        id: TASK_ID,
        user_id: USER_ID,
        case_id: CASE_ID,
        title: "Follow-up response review",
        due_date: null,
        notes: followUpResponseReviewTaskNotesMarker(CASE_ID),
        completed_at: "2026-07-15T12:00:00.000Z",
        created_at: "2026-07-01T00:00:00.000Z",
        updated_at: "2026-07-15T12:00:00.000Z",
      },
    };

    const denied = await completeOperatorCaseArchive(createSupabase(state), USER_ID, {
      caseId: CASE_ID,
      confirmArchive: false,
    });
    expect(denied.ok).toBe(false);
    if (denied.ok) return;
    expect(denied.status).toBe(400);
    expect(state.patchedArchivedAt).toBeNull();
  });

  it("archives an eligible resolved case and records timeline", async () => {
    const state: MockState = {
      archived_at: null,
      patchedArchivedAt: null,
      client_state: {
        prepared_packet_approved: true,
        approved_next_action: {
          label: "Demand letter",
          href: "/justice/demand-letter",
          status: "completed",
          completed_at: "2026-06-01T00:00:00.000Z",
          follow_up_needed: false,
          outcome_note: OPERATOR_RESOLVED_OUTCOME_MARKER,
          handling_requested_at: "2026-06-01T00:00:00.000Z",
          handling_acknowledged_at: "2026-07-15T12:00:00.000Z",
        },
      },
      task: {
        id: TASK_ID,
        user_id: USER_ID,
        case_id: CASE_ID,
        title: "Follow-up response review",
        due_date: null,
        notes: followUpResponseReviewTaskNotesMarker(CASE_ID),
        completed_at: "2026-07-15T12:00:00.000Z",
        created_at: "2026-07-01T00:00:00.000Z",
        updated_at: "2026-07-15T12:00:00.000Z",
      },
    };

    const result = await completeOperatorCaseArchive(createSupabase(state), USER_ID, {
      caseId: CASE_ID,
      confirmArchive: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.idempotent).toBe(false);
    expect(result.outcome).toBe("resolved");
    expect(state.patchedArchivedAt).toBeTruthy();
    expect(timelineStore.entries.some((e) => e.type === "case_archived")).toBe(true);
  });

  it("rejects cases without operator terminal response-review outcomes", async () => {
    const state: MockState = {
      archived_at: null,
      patchedArchivedAt: null,
      client_state: {
        prepared_packet_approved: true,
        approved_next_action: {
          label: "Demand letter",
          href: "/justice/demand-letter",
          status: "completed",
          follow_up_needed: false,
          outcome_note: "Awaiting responses.",
          handling_requested_at: "2026-06-01T00:00:00.000Z",
          handling_acknowledged_at: "2026-07-15T12:00:00.000Z",
        },
      },
      task: {
        id: TASK_ID,
        user_id: USER_ID,
        case_id: CASE_ID,
        title: "Follow-up response review",
        due_date: null,
        notes: followUpResponseReviewTaskNotesMarker(CASE_ID),
        completed_at: "2026-07-15T12:00:00.000Z",
        created_at: "2026-07-01T00:00:00.000Z",
        updated_at: "2026-07-15T12:00:00.000Z",
      },
    };

    const result = await completeOperatorCaseArchive(createSupabase(state), USER_ID, {
      caseId: CASE_ID,
      confirmArchive: true,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(409);
    expect(state.patchedArchivedAt).toBeNull();
  });
});

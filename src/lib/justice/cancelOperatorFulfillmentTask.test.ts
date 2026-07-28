import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { paymentDisputeFilingTaskNotesMarker } from "@/lib/justice/paymentDisputeFilingTask";
import { stateAgFilingTaskNotesMarker } from "@/lib/justice/stateAgFilingTask";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";
import { cancelOperatorFulfillmentTask } from "@/lib/justice/cancelOperatorFulfillmentTask";

const CASE_ID = "550e8400-e29b-41d4-a716-446655440000";
const USER_ID = "user-owner-1";
const TASK_ID = "550e8400-e29b-41d4-a716-446655440099";

type MockCase = {
  id: string;
  user_id: string;
  client_state: Record<string, unknown>;
  timeline: unknown[];
};

type MockState = {
  task: JusticeCaseTaskRow | null;
  case: MockCase | null;
  rpcCalls: Record<string, unknown>[];
  updateCalls: { table: string; patch: Record<string, unknown> }[];
  forceRpcTransportError: string | null;
};

function basePaymentDisputeTask(): JusticeCaseTaskRow {
  const marker = paymentDisputeFilingTaskNotesMarker(CASE_ID);
  return {
    id: TASK_ID,
    user_id: USER_ID,
    case_id: CASE_ID,
    title: "Payment dispute filing: Acme Retail",
    due_date: null,
    notes: `${marker}\ncase_id: ${CASE_ID}\ndraft:\nDispute this charge`,
    completed_at: null,
    created_at: "2026-02-01T00:00:00.000Z",
    updated_at: "2026-02-01T00:00:00.000Z",
  };
}

function approvedPaymentDisputeClientState(): Record<string, unknown> {
  return {
    prepared_packet_approved: true,
    approved_next_action: {
      label: "Payment dispute (bank/card)",
      href: "/justice/payment-dispute",
      status: "approved",
    },
  };
}

/**
 * Simulates the `cancel_operator_fulfillment_task` Postgres function's logic in JS against
 * the same mutable state the mock supabase client reads/writes, so tests can exercise the exact
 * precondition surface (task/case identity, openness, marker, approved-action match) without a
 * real Postgres instance. Mutates `state` only in the single all-or-nothing branch that a real
 * transaction commit would apply.
 */
function simulateCancelRpc(
  state: MockState,
  params: {
    p_task_id: string;
    p_case_id: string;
    p_expected_href: string;
    p_expected_marker: string;
    p_operator_note: string | null;
  }
): { data: unknown; error: null } | { data: null; error: { message: string } } {
  if (state.forceRpcTransportError) {
    return { data: null, error: { message: state.forceRpcTransportError } };
  }

  const task = state.task;
  if (!task || task.id !== params.p_task_id) {
    return { data: { ok: false, error: "task_not_found", status: 404 }, error: null };
  }
  if (task.case_id !== params.p_case_id) {
    return { data: { ok: false, error: "case_mismatch", status: 409 }, error: null };
  }
  if (task.completed_at?.trim()) {
    return { data: { ok: false, error: "task_already_closed", status: 409 }, error: null };
  }

  const notesTrimmed = (task.notes ?? "").trim();
  const markerMatches =
    notesTrimmed === params.p_expected_marker ||
    notesTrimmed.startsWith(`${params.p_expected_marker}\n`);
  if (!markerMatches) {
    return { data: { ok: false, error: "task_marker_mismatch", status: 409 }, error: null };
  }

  const caseRow = state.case;
  if (!caseRow || caseRow.id !== params.p_case_id) {
    return { data: { ok: false, error: "case_not_found", status: 404 }, error: null };
  }
  if (caseRow.user_id !== task.user_id) {
    return { data: { ok: false, error: "case_user_mismatch", status: 409 }, error: null };
  }

  const action = caseRow.client_state.approved_next_action as
    | { href?: string; status?: string }
    | undefined;
  if (
    !action ||
    action.href !== params.p_expected_href ||
    action.status !== "approved"
  ) {
    return { data: { ok: false, error: "approved_action_mismatch", status: 409 }, error: null };
  }

  const cancelledAt = "2026-03-01T00:00:00.000Z";
  const noteClean = params.p_operator_note?.trim() || null;
  const cancelBlock = [
    "---operator_cancelled---",
    `cancelled_at: ${cancelledAt}`,
    ...(noteClean ? [`note: ${noteClean}`] : []),
  ].join("\n");
  const nextNotes = [notesTrimmed, cancelBlock].filter(Boolean).join("\n\n");

  // Applied together, in the single branch that stands in for the real transaction commit.
  state.task = { ...task, completed_at: cancelledAt, notes: nextNotes };
  const nextClientState = { ...caseRow.client_state };
  delete nextClientState.approved_next_action;
  const timelineEntryId = `task_cancelled:${params.p_task_id}`;
  const alreadyPresent = caseRow.timeline.some(
    (e) => (e as { id?: string }).id === timelineEntryId
  );
  const nextTimeline = alreadyPresent
    ? caseRow.timeline
    : [
        ...caseRow.timeline,
        {
          id: timelineEntryId,
          case_id: params.p_case_id,
          type: "task_cancelled",
          label: "Operator cancelled fulfillment task",
          detail: [`task: ${task.title}`, ...(noteClean ? [`note: ${noteClean}`] : [])].join("\n"),
          ts: cancelledAt,
        },
      ];
  state.case = { ...caseRow, client_state: nextClientState, timeline: nextTimeline };

  return {
    data: {
      ok: true,
      task_id: params.p_task_id,
      case_id: params.p_case_id,
      user_id: task.user_id,
      cancelled_at: cancelledAt,
      notes: nextNotes,
      client_state: nextClientState,
    },
    error: null,
  };
}

function createMockSupabase(state: MockState): SupabaseClient {
  return {
    from: (table: string) => {
      if (table === "justice_case_tasks") {
        return {
          select: () => ({
            eq: (_col: string, value: string) => ({
              maybeSingle: async () => ({
                data: state.task && state.task.id === value ? state.task : null,
                error: null,
              }),
            }),
          }),
          update: (patch: Record<string, unknown>) => {
            state.updateCalls.push({ table, patch });
            throw new Error(
              "cancelOperatorFulfillmentTask must not issue a separate update() on justice_case_tasks — it should only call the atomic RPC."
            );
          },
        };
      }

      if (table === "justice_cases") {
        return {
          update: (patch: Record<string, unknown>) => {
            state.updateCalls.push({ table, patch });
            throw new Error(
              "cancelOperatorFulfillmentTask must not issue a separate update() on justice_cases — it should only call the atomic RPC."
            );
          },
        };
      }

      throw new Error(`unexpected table ${table}`);
    },
    rpc: (fn: string, params: Record<string, unknown>) => {
      state.rpcCalls.push({ fn, params });
      if (fn !== "cancel_operator_fulfillment_task") {
        throw new Error(`unexpected rpc ${fn}`);
      }
      return simulateCancelRpc(
        state,
        params as Parameters<typeof simulateCancelRpc>[1]
      );
    },
  } as unknown as SupabaseClient;
}

function freshState(overrides?: Partial<MockState>): MockState {
  return {
    task: basePaymentDisputeTask(),
    case: {
      id: CASE_ID,
      user_id: USER_ID,
      client_state: approvedPaymentDisputeClientState(),
      timeline: [],
    },
    rpcCalls: [],
    updateCalls: [],
    forceRpcTransportError: null,
    ...overrides,
  };
}

describe("cancelOperatorFulfillmentTask (atomic RPC)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("closes the task and clears only approved_next_action via a single rpc() call, preserving other client_state fields", async () => {
    const state = freshState();

    const result = await cancelOperatorFulfillmentTask(createMockSupabase(state), {
      taskId: TASK_ID,
      operatorNote: "Test order, never a real dispute.",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.task.completed_at).toBe("2026-03-01T00:00:00.000Z");
    expect(result.task.notes).toContain("---operator_cancelled---");
    expect(result.task.notes).toContain("Test order, never a real dispute.");
    expect(result.clientState.approved_next_action).toBeUndefined();
    expect(result.clientState.prepared_packet_approved).toBe(true);

    // Exactly one write path: the atomic rpc(), never a separate per-table update().
    expect(state.rpcCalls).toHaveLength(1);
    expect(state.rpcCalls[0].fn).toBe("cancel_operator_fulfillment_task");
    expect(state.updateCalls).toHaveLength(0);

    expect(state.case?.timeline).toHaveLength(1);
    expect((state.case?.timeline[0] as { type?: string })?.type).toBe("task_cancelled");
  });

  it("never partially applies: when the rpc call itself fails (transport/DB error), neither the task nor the case is touched", async () => {
    const state = freshState({ forceRpcTransportError: "connection reset by peer" });
    const taskBefore = { ...state.task };
    const caseBefore = { ...state.case! };

    const result = await cancelOperatorFulfillmentTask(createMockSupabase(state), {
      taskId: TASK_ID,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(500);
    expect(result.error).toBe("connection reset by peer");

    expect(state.task).toEqual(taskBefore);
    expect(state.case).toEqual(caseBefore);
    expect(state.updateCalls).toHaveLength(0);
  });

  it("rejects an already-completed task without calling the rpc write path having any effect", async () => {
    const state = freshState({
      task: { ...basePaymentDisputeTask(), completed_at: "2026-02-10T00:00:00.000Z" },
    });

    const result = await cancelOperatorFulfillmentTask(createMockSupabase(state), {
      taskId: TASK_ID,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(409);
    // Rejected by the pre-check before ever calling rpc().
    expect(state.rpcCalls).toHaveLength(0);
  });

  it("rejects (via the rpc's own re-check) when approved_next_action status is not 'approved', even if pre-check passed", async () => {
    const state = freshState({
      case: {
        id: CASE_ID,
        user_id: USER_ID,
        client_state: {
          approved_next_action: {
            label: "Payment dispute (bank/card)",
            href: "/justice/payment-dispute",
            status: "started",
          },
        },
        timeline: [],
      },
    });

    const result = await cancelOperatorFulfillmentTask(createMockSupabase(state), {
      taskId: TASK_ID,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(409);
    expect(state.rpcCalls).toHaveLength(1);
    expect(state.task?.completed_at).toBeNull();
  });

  it("rejects when the task's marker does not match any known destination (pre-check, no rpc call)", async () => {
    const state = freshState({
      task: {
        ...basePaymentDisputeTask(),
        notes: `${stateAgFilingTaskNotesMarker("different-case-id")}\ncase_id: different-case-id\ndraft:\nComplaint`,
      },
    });

    const result = await cancelOperatorFulfillmentTask(createMockSupabase(state), {
      taskId: TASK_ID,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(409);
    expect(state.rpcCalls).toHaveLength(0);
  });

  it("surfaces the rpc's case-not-found rejection when the case row is missing at commit time", async () => {
    const state = freshState({ case: null });

    const result = await cancelOperatorFulfillmentTask(createMockSupabase(state), {
      taskId: TASK_ID,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(404);
    expect(result.error).toBe("Case not found");
  });

  it("returns 404 when the task does not exist", async () => {
    const state = freshState({ task: null });

    const result = await cancelOperatorFulfillmentTask(createMockSupabase(state), {
      taskId: TASK_ID,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(404);
  });

  it("rejects (via the rpc's own re-check) a concurrent close that happened between the pre-check read and the rpc call", async () => {
    const state = freshState();

    // Simulate another request closing the task after our pre-check read but before our rpc call
    // fires, by having the mock flip state just-in-time inside a wrapped rpc.
    const supabase = createMockSupabase(state);
    const originalRpc = supabase.rpc.bind(supabase);
    (supabase as unknown as { rpc: typeof supabase.rpc }).rpc = ((fn: string, params: unknown) => {
      state.task = { ...(state.task as JusticeCaseTaskRow), completed_at: "2026-02-20T00:00:00.000Z" };
      return originalRpc(fn, params as Record<string, unknown>);
    }) as typeof supabase.rpc;

    const result = await cancelOperatorFulfillmentTask(supabase, { taskId: TASK_ID });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(409);
    expect(result.error).toBe("Task is already closed");
  });
});

describe("migration SQL marker match parity (guards the LIKE-wildcard regression)", () => {
  // Mirrors the fixed comparison in cancel_operator_fulfillment_task:
  //   btrim(v_notes) = p_expected_marker
  //   or left(btrim(v_notes), length(p_expected_marker) + 1) = p_expected_marker || E'\n'
  // Neither left()/length()/= nor JS slice()/=== interpret '_' or '%' as wildcards.
  function sqlLiteralMarkerMatch(notes: string, marker: string): boolean {
    const trimmed = notes.trim();
    if (trimmed === marker) return true;
    return trimmed.slice(0, marker.length + 1) === `${marker}\n`;
  }

  // Mirrors what the ORIGINAL (buggy) migration did: a Postgres LIKE pattern
  // `marker || '\n%'` with no ESCAPE clause, where '_' matches any single character and '%'
  // matches any run of characters. Kept only so the fixture below can prove it is a genuine
  // regression case for that defect, not a hypothetical one.
  function likeWildcardMarkerMatch(notes: string, marker: string): boolean {
    const trimmed = notes.trim();
    if (trimmed === marker) return true;
    const pattern = `${marker}\n%`;
    // Escape real regex metacharacters first (none of these appear in '_' or '%'), then
    // translate the two LIKE wildcards into their regex equivalents.
    const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regexBody = escaped.replace(/_/g, ".").replace(/%/g, ".*");
    return new RegExp(`^${regexBody}$`, "s").test(trimmed);
  }

  const marker = paymentDisputeFilingTaskNotesMarker(CASE_ID);
  const realNotes = `${marker}\ndraft:\nDispute this charge`;
  // Every underscore in the marker substituted with a different literal character — exactly
  // what an unescaped LIKE '_' wildcard would have accepted as a match.
  const nearMissNotes = `${marker.replace(/_/g, "X")}\ndraft:\nDispute this charge`;

  it("accepts the real marker, single-line", () => {
    expect(sqlLiteralMarkerMatch(marker, marker)).toBe(true);
  });

  it("accepts the real marker followed by a newline and more content", () => {
    expect(sqlLiteralMarkerMatch(realNotes, marker)).toBe(true);
  });

  it("rejects a near-match marker with underscores substituted for other characters", () => {
    expect(sqlLiteralMarkerMatch(nearMissNotes, marker)).toBe(false);
  });

  it("rejects a marker embedded mid-string rather than as a true prefix", () => {
    expect(sqlLiteralMarkerMatch(`noise ${marker}\ndraft:`, marker)).toBe(false);
  });

  it("proves the near-miss fixture is a genuine regression case: the old LIKE-wildcard logic wrongly accepted it", () => {
    expect(likeWildcardMarkerMatch(nearMissNotes, marker)).toBe(true);
    expect(sqlLiteralMarkerMatch(nearMissNotes, marker)).toBe(false);
  });
});

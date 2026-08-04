import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  recordFilingEmailBounceEvent,
  recordFilingEmailBounceEventAndEnsureActionability,
  type FilingEmailBounceActionabilityLane,
  type FilingEmailBounceLane,
} from "@/lib/justice/filingEmailBounceTracking";
import type { TimelineEntry } from "@/lib/justice/types";

type Row = { id: string; user_id: string; case_id: string; notes: string; created_at: string };
type CaseRow = { id: string; user_id: string; timeline: TimelineEntry[] };

type Store = {
  filings: Row[];
  tasks: Row[];
  cases: CaseRow[];
  failFilingSelect?: boolean;
  failUpdate?: boolean;
};

function makeSupabase(store: Store): SupabaseClient {
  const from = (table: string) => {
    const state: {
      table: string;
      op: "select" | "update";
      update: Record<string, unknown> | null;
      filters: Record<string, string>;
      like: string | null;
    } = { table, op: "select", update: null, filters: {}, like: null };

    const rowsForTable = (): Row[] =>
      table === "justice_case_filings" ? store.filings : table === "justice_case_tasks" ? store.tasks : [];

    const resolveTerminal = () => {
      if (state.op === "update") {
        if (store.failUpdate) return { data: null, error: { message: "update down" } };
        const row = rowsForTable().find((r) => r.id === state.filters.id);
        if (row) row.notes = String((state.update as Record<string, unknown>).notes);
        return { data: null, error: null };
      }
      return { data: null, error: null };
    };

    const builder: Record<string, unknown> = {
      select() {
        return builder;
      },
      update(payload: Record<string, unknown>) {
        state.op = "update";
        state.update = payload;
        return builder;
      },
      eq(col: string, val: string) {
        state.filters[col] = val;
        return builder;
      },
      like(_col: string, pattern: string) {
        state.like = pattern;
        return builder;
      },
      limit() {
        if (table === "justice_case_filings" && store.failFilingSelect) {
          return Promise.resolve({ data: null, error: { message: "select down" } });
        }
        const needle = (state.like ?? "").replace(/^%/, "").replace(/%$/, "");
        const matches = rowsForTable().filter((r) => r.notes.includes(needle));
        return Promise.resolve({ data: matches, error: null });
      },
      maybeSingle() {
        if (state.table === "justice_cases") {
          const row = store.cases.find(
            (c) => c.id === state.filters.id && c.user_id === state.filters.user_id
          );
          return Promise.resolve({ data: row ? { timeline: row.timeline } : null, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      },
      then(onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) {
        return Promise.resolve(resolveTerminal()).then(onF, onR);
      },
    };
    return builder;
  };

  // justice_cases timeline reads/writes go through appendCaseTimelineEntry, which does its own
  // select().eq().eq().maybeSingle() then update().eq().eq() — reuse the same builder shape.
  const patchedFrom = (table: string) => {
    if (table !== "justice_cases") return from(table);
    const state: { op: "select" | "update"; filters: Record<string, string>; update: Record<string, unknown> | null } = {
      op: "select",
      filters: {},
      update: null,
    };
    const builder: Record<string, unknown> = {
      select() {
        return builder;
      },
      eq(col: string, val: string) {
        state.filters[col] = val;
        return builder;
      },
      maybeSingle() {
        const row = store.cases.find(
          (c) => c.id === state.filters.id && c.user_id === state.filters.user_id
        );
        return Promise.resolve({ data: row ? { timeline: row.timeline } : null, error: null });
      },
      update(payload: Record<string, unknown>) {
        state.op = "update";
        state.update = payload;
        return builder;
      },
      then(onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) {
        if (state.op === "update") {
          const row = store.cases.find(
            (c) => c.id === state.filters.id && c.user_id === state.filters.user_id
          );
          if (row) row.timeline = (state.update as Record<string, unknown>).timeline as TimelineEntry[];
        }
        return Promise.resolve({ data: null, error: null }).then(onF, onR);
      },
    };
    return builder;
  };

  return { from: patchedFrom } as unknown as SupabaseClient;
}

const MARKER = "---fake_lane_delivery---";

type FakeRecord = {
  delivery_state: "sending" | "accepted" | "failed" | "bounced" | "complained";
  provider: string;
  recipient: string;
  provider_message_id?: string;
};

function parseFakeRecord(notes: string | null | undefined): FakeRecord | null {
  const trimmed = notes?.trim() ?? "";
  const idx = trimmed.indexOf(MARKER);
  if (idx < 0) return null;
  const lines = trimmed
    .slice(idx + MARKER.length)
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const map = new Map<string, string>();
  for (const line of lines) {
    const colon = line.indexOf(":");
    if (colon > 0) map.set(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
  }
  const state = map.get("delivery_state");
  if (
    state !== "sending" &&
    state !== "accepted" &&
    state !== "failed" &&
    state !== "bounced" &&
    state !== "complained"
  ) {
    return null;
  }
  return {
    delivery_state: state,
    provider: map.get("provider") ?? "",
    recipient: map.get("recipient") ?? "",
    ...(map.get("provider_message_id") ? { provider_message_id: map.get("provider_message_id") } : {}),
  };
}

function upsertFakeNotes(notes: string | null | undefined, record: FakeRecord): string {
  const base = (notes ?? "").trim();
  const without = base.indexOf(MARKER) >= 0 ? base.slice(0, base.indexOf(MARKER)).trimEnd() : base;
  const lines = [
    MARKER,
    `delivery_state: ${record.delivery_state}`,
    `provider: ${record.provider}`,
    `recipient: ${record.recipient}`,
    ...(record.provider_message_id ? [`provider_message_id: ${record.provider_message_id}`] : []),
  ];
  return [without, lines.join("\n")].filter(Boolean).join("\n\n");
}

const LANE: FilingEmailBounceLane<FakeRecord> = {
  label: "Fake lane",
  timelineIdPrefix: "fake_lane_email",
  parseRecord: parseFakeRecord,
  upsertNotes: upsertFakeNotes,
};

function acceptedNotes(messageId: string): string {
  return upsertFakeNotes(null, {
    delivery_state: "accepted",
    provider: "resend",
    recipient: "company@example.com",
    provider_message_id: messageId,
  });
}

function baseStore(overrides: Partial<Store> = {}): Store {
  return {
    filings: [
      {
        id: "filing-1",
        user_id: "owner-case-1",
        case_id: "case-1",
        notes: acceptedNotes("re_msg_1"),
        created_at: "2026-06-01T00:00:00.000Z",
      },
    ],
    tasks: [],
    cases: [{ id: "case-1", user_id: "owner-case-1", timeline: [] }],
    ...overrides,
  };
}

describe("recordFilingEmailBounceEvent", () => {
  it("records a bounce against a completed filing without reversing it, and flags it actionable", async () => {
    const store = baseStore();
    const result = await recordFilingEmailBounceEvent(makeSupabase(store), LANE, {
      messageId: "re_msg_1",
      eventType: "email.bounced",
    });

    expect(result).toEqual({
      status: "recorded",
      caseId: "case-1",
      userId: "owner-case-1",
      state: "bounced",
      matchedRowCreatedAt: "2026-06-01T00:00:00.000Z",
    });
    expect(parseFakeRecord(store.filings[0].notes)?.delivery_state).toBe("bounced");
    // The filing confirmation itself is untouched — only the delivery_state marker flips.
    expect(store.filings[0].notes).toContain("provider_message_id: re_msg_1");
    expect(store.cases[0].timeline).toHaveLength(1);
    expect(store.cases[0].timeline[0].label).toBe("Fake lane email bounced — manual follow-up required");
  });

  it("records a spam complaint", async () => {
    const store = baseStore();
    const result = await recordFilingEmailBounceEvent(makeSupabase(store), LANE, {
      messageId: "re_msg_1",
      eventType: "email.complained",
    });
    expect(result).toEqual({
      status: "recorded",
      caseId: "case-1",
      userId: "owner-case-1",
      state: "complained",
      matchedRowCreatedAt: "2026-06-01T00:00:00.000Z",
    });
    expect(store.cases[0].timeline[0].label).toContain("marked as spam");
  });

  it("falls back to a still-open task when no filing matches (accept succeeded, completion write failed)", async () => {
    const store = baseStore({
      filings: [],
      tasks: [
        {
          id: "task-1",
          user_id: "owner-case-1",
          case_id: "case-1",
          notes: acceptedNotes("re_msg_1"),
          created_at: "2026-06-01T00:00:00.000Z",
        },
      ],
    });
    const result = await recordFilingEmailBounceEvent(makeSupabase(store), LANE, {
      messageId: "re_msg_1",
      eventType: "email.bounced",
    });
    expect(result).toEqual({
      status: "recorded",
      caseId: "case-1",
      userId: "owner-case-1",
      state: "bounced",
      matchedRowCreatedAt: "2026-06-01T00:00:00.000Z",
    });
    expect(parseFakeRecord(store.tasks[0].notes)?.delivery_state).toBe("bounced");
  });

  it("is idempotent on replayed bounce events", async () => {
    const store = baseStore();
    const supabase = makeSupabase(store);
    const first = await recordFilingEmailBounceEvent(supabase, LANE, {
      messageId: "re_msg_1",
      eventType: "email.bounced",
    });
    const second = await recordFilingEmailBounceEvent(supabase, LANE, {
      messageId: "re_msg_1",
      eventType: "email.bounced",
    });

    expect(first.status).toBe("recorded");
    expect(second).toEqual({
      status: "ignored_duplicate",
      caseId: "case-1",
      userId: "owner-case-1",
      state: "bounced",
      matchedRowCreatedAt: "2026-06-01T00:00:00.000Z",
    });
    expect(store.cases[0].timeline).toHaveLength(1);
  });

  it("never downgrades a bounce back to accepted on out-of-order events", async () => {
    const store = baseStore();
    const supabase = makeSupabase(store);
    await recordFilingEmailBounceEvent(supabase, LANE, { messageId: "re_msg_1", eventType: "email.bounced" });
    const late = await recordFilingEmailBounceEvent(supabase, LANE, {
      messageId: "re_msg_1",
      eventType: "email.complained",
    });

    // complained and bounced share the same terminal rank — a second terminal event is a no-op,
    // it does not flip bounced -> complained or vice versa.
    expect(late).toEqual({
      status: "ignored_duplicate",
      caseId: "case-1",
      userId: "owner-case-1",
      state: "bounced",
      matchedRowCreatedAt: "2026-06-01T00:00:00.000Z",
    });
    expect(parseFakeRecord(store.filings[0].notes)?.delivery_state).toBe("bounced");
  });

  it("ignores an unknown message id", async () => {
    const store = baseStore();
    const result = await recordFilingEmailBounceEvent(makeSupabase(store), LANE, {
      messageId: "re_does_not_exist",
      eventType: "email.bounced",
    });
    expect(result).toEqual({ status: "ignored_unknown" });
    expect(store.cases[0].timeline).toHaveLength(0);
  });

  it("returns an error when the filing lookup fails", async () => {
    const store = baseStore({ failFilingSelect: true });
    const result = await recordFilingEmailBounceEvent(makeSupabase(store), LANE, {
      messageId: "re_msg_1",
      eventType: "email.bounced",
    });
    expect(result).toEqual({ status: "error", reason: "lookup_failed" });
  });
});

describe("recordFilingEmailBounceEventAndEnsureActionability", () => {
  function actionabilityLane(overrides: {
    reopenTask?: FilingEmailBounceActionabilityLane<FakeRecord>["reopenTask"];
    stopFollowUp?: FilingEmailBounceActionabilityLane<FakeRecord>["stopFollowUp"];
    findLatestFilingCreatedAt?: FilingEmailBounceActionabilityLane<FakeRecord>["findLatestFilingCreatedAt"];
  } = {}): FilingEmailBounceActionabilityLane<FakeRecord> {
    return {
      ...LANE,
      reopenTask: overrides.reopenTask ?? vi.fn().mockResolvedValue({ reopened: true }),
      stopFollowUp: overrides.stopFollowUp ?? vi.fn().mockResolvedValue({ completed: true, task: {} }),
      // Defaults to "not superseded" (no newer filing found) so existing repair-focused tests are
      // unaffected; supersession itself is covered by the dedicated tests below.
      findLatestFilingCreatedAt: overrides.findLatestFilingCreatedAt ?? vi.fn().mockResolvedValue(null),
    };
  }

  it("returns an error on the initial bounce when task reopen fails, without hiding it as success", async () => {
    const store = baseStore();
    const reopenTask = vi.fn().mockResolvedValue({ reopened: false });
    const stopFollowUp = vi.fn().mockResolvedValue({ completed: true, task: {} });

    const result = await recordFilingEmailBounceEventAndEnsureActionability(
      makeSupabase(store),
      actionabilityLane({ reopenTask, stopFollowUp }),
      { messageId: "re_msg_1", eventType: "email.bounced" }
    );

    expect(result).toEqual({ status: "error", reason: "task_reopen_failed" });
    expect(reopenTask).toHaveBeenCalledTimes(1);
    expect(stopFollowUp).toHaveBeenCalledTimes(1);
    // The delivery-state flip itself still landed — only actionability is incomplete.
    expect(parseFakeRecord(store.filings[0].notes)?.delivery_state).toBe("bounced");
  });

  it("returns an error on the initial bounce when follow-up stop fails (task exists but stays open)", async () => {
    const store = baseStore();
    const reopenTask = vi.fn().mockResolvedValue({ reopened: true });
    const stopFollowUp = vi.fn().mockResolvedValue({ completed: false, task: { id: "follow-up-1" } });

    const result = await recordFilingEmailBounceEventAndEnsureActionability(
      makeSupabase(store),
      actionabilityLane({ reopenTask, stopFollowUp }),
      { messageId: "re_msg_1", eventType: "email.bounced" }
    );

    expect(result).toEqual({ status: "error", reason: "follow_up_stop_failed" });
  });

  it("treats a follow-up task that never existed (or was already closed) as satisfied, not failed", async () => {
    const store = baseStore();
    const reopenTask = vi.fn().mockResolvedValue({ reopened: true });
    const stopFollowUp = vi.fn().mockResolvedValue({ completed: false, task: null });

    const result = await recordFilingEmailBounceEventAndEnsureActionability(
      makeSupabase(store),
      actionabilityLane({ reopenTask, stopFollowUp }),
      { messageId: "re_msg_1", eventType: "email.bounced" }
    );

    expect(result).toEqual({ status: "recorded", caseId: "case-1", state: "bounced" });
  });

  it("succeeds on the first attempt when both actions complete", async () => {
    const store = baseStore();
    const reopenTask = vi.fn().mockResolvedValue({ reopened: true });
    const stopFollowUp = vi.fn().mockResolvedValue({ completed: true, task: { id: "follow-up-1" } });

    const result = await recordFilingEmailBounceEventAndEnsureActionability(
      makeSupabase(store),
      actionabilityLane({ reopenTask, stopFollowUp }),
      { messageId: "re_msg_1", eventType: "email.bounced" }
    );

    expect(result).toEqual({ status: "recorded", caseId: "case-1", state: "bounced" });
  });

  it("retries and repairs an incomplete action on replay, after the delivery state already flipped to a duplicate", async () => {
    const store = baseStore();
    const supabase = makeSupabase(store);
    // First attempt: delivery state flips, but reopen fails.
    const failingReopen = vi.fn().mockResolvedValue({ reopened: false });
    const stopFollowUp = vi.fn().mockResolvedValue({ completed: true, task: { id: "follow-up-1" } });
    const first = await recordFilingEmailBounceEventAndEnsureActionability(
      supabase,
      actionabilityLane({ reopenTask: failingReopen, stopFollowUp }),
      { messageId: "re_msg_1", eventType: "email.bounced" }
    );
    expect(first).toEqual({ status: "error", reason: "task_reopen_failed" });

    // Replay with the same message id: the delivery-state flip is now a no-op duplicate, but the
    // previously-failed reopen must still be retried — not swallowed as ignored_duplicate.
    const succeedingReopen = vi.fn().mockResolvedValue({ reopened: true });
    const second = await recordFilingEmailBounceEventAndEnsureActionability(
      supabase,
      actionabilityLane({ reopenTask: succeedingReopen, stopFollowUp }),
      { messageId: "re_msg_1", eventType: "email.bounced" }
    );

    expect(second).toEqual({ status: "recorded", caseId: "case-1", state: "bounced" });
    expect(succeedingReopen).toHaveBeenCalledTimes(1);
    // Still exactly one delivery-state timeline entry — the replay did not duplicate it.
    expect(
      store.cases[0].timeline.filter((e) => e.label.includes("bounced — manual follow-up required"))
    ).toHaveLength(1);
  });

  it("is harmless on a later replay once both actions are already satisfied: still returns success, no duplicate work", async () => {
    const store = baseStore();
    const supabase = makeSupabase(store);
    const reopenTask = vi.fn().mockResolvedValue({ reopened: true });
    const stopFollowUp = vi.fn().mockResolvedValue({ completed: true, task: { id: "follow-up-1" } });
    const lane = actionabilityLane({ reopenTask, stopFollowUp });

    const first = await recordFilingEmailBounceEventAndEnsureActionability(supabase, lane, {
      messageId: "re_msg_1",
      eventType: "email.bounced",
    });
    const second = await recordFilingEmailBounceEventAndEnsureActionability(supabase, lane, {
      messageId: "re_msg_1",
      eventType: "email.bounced",
    });

    expect(first).toEqual({ status: "recorded", caseId: "case-1", state: "bounced" });
    expect(second).toEqual({ status: "recorded", caseId: "case-1", state: "bounced" });
    // Both idempotent actions are called again (safe no-ops per their own contract) but no
    // duplicate timeline entries result.
    expect(reopenTask).toHaveBeenCalledTimes(2);
    expect(stopFollowUp).toHaveBeenCalledTimes(2);
    expect(store.cases[0].timeline).toHaveLength(1);
  });

  it("does not attempt either action for an unknown message id", async () => {
    const store = baseStore();
    const reopenTask = vi.fn().mockResolvedValue({ reopened: true });
    const stopFollowUp = vi.fn().mockResolvedValue({ completed: true, task: {} });

    const result = await recordFilingEmailBounceEventAndEnsureActionability(
      makeSupabase(store),
      actionabilityLane({ reopenTask, stopFollowUp }),
      { messageId: "re_does_not_exist", eventType: "email.bounced" }
    );

    expect(result).toEqual({ status: "ignored_unknown" });
    expect(reopenTask).not.toHaveBeenCalled();
    expect(stopFollowUp).not.toHaveBeenCalled();
  });

  it("skips repair entirely when the matched filing has already been superseded by a newer one", async () => {
    // baseStore's filing was created 2026-06-01; a lane filing created after that date signals
    // that this specific attempt has since been remediated.
    const store = baseStore();
    const reopenTask = vi.fn().mockResolvedValue({ reopened: true });
    const stopFollowUp = vi.fn().mockResolvedValue({ completed: true, task: {} });
    const findLatestFilingCreatedAt = vi.fn().mockResolvedValue("2026-06-21T00:00:00.000Z");

    const result = await recordFilingEmailBounceEventAndEnsureActionability(
      makeSupabase(store),
      actionabilityLane({ reopenTask, stopFollowUp, findLatestFilingCreatedAt }),
      { messageId: "re_msg_1", eventType: "email.bounced" }
    );

    expect(result).toEqual({ status: "recorded", caseId: "case-1", state: "bounced" });
    expect(reopenTask).not.toHaveBeenCalled();
    expect(stopFollowUp).not.toHaveBeenCalled();
  });

  it("still repairs when the matched filing is itself the latest one (not superseded)", async () => {
    const store = baseStore();
    const reopenTask = vi.fn().mockResolvedValue({ reopened: true });
    const stopFollowUp = vi.fn().mockResolvedValue({ completed: true, task: {} });
    // Same created_at as the matched filing itself — the latest lane filing IS this one.
    const findLatestFilingCreatedAt = vi.fn().mockResolvedValue("2026-06-01T00:00:00.000Z");

    const result = await recordFilingEmailBounceEventAndEnsureActionability(
      makeSupabase(store),
      actionabilityLane({ reopenTask, stopFollowUp, findLatestFilingCreatedAt }),
      { messageId: "re_msg_1", eventType: "email.bounced" }
    );

    expect(result).toEqual({ status: "recorded", caseId: "case-1", state: "bounced" });
    expect(reopenTask).toHaveBeenCalledTimes(1);
    expect(stopFollowUp).toHaveBeenCalledTimes(1);
  });

  it("skips repair on a replay too, once superseded — not only on the first attempt", async () => {
    const store = baseStore();
    const supabase = makeSupabase(store);

    // First call: not yet superseded, repair runs normally.
    const first = await recordFilingEmailBounceEventAndEnsureActionability(
      supabase,
      actionabilityLane({ findLatestFilingCreatedAt: vi.fn().mockResolvedValue(null) }),
      { messageId: "re_msg_1", eventType: "email.bounced" }
    );
    expect(first).toEqual({ status: "recorded", caseId: "case-1", state: "bounced" });

    // Replay: delivery state is now a duplicate, and remediation has since superseded it.
    const reopenTask = vi.fn().mockResolvedValue({ reopened: true });
    const stopFollowUp = vi.fn().mockResolvedValue({ completed: true, task: {} });
    const replay = await recordFilingEmailBounceEventAndEnsureActionability(
      supabase,
      actionabilityLane({
        reopenTask,
        stopFollowUp,
        findLatestFilingCreatedAt: vi.fn().mockResolvedValue("2026-06-21T00:00:00.000Z"),
      }),
      { messageId: "re_msg_1", eventType: "email.bounced" }
    );

    expect(replay).toEqual({ status: "recorded", caseId: "case-1", state: "bounced" });
    expect(reopenTask).not.toHaveBeenCalled();
    expect(stopFollowUp).not.toHaveBeenCalled();
  });

  it("treats confirmed absence (no lane filing exists yet) as not superseded — repair still proceeds, unlike a lookup error", async () => {
    const store = baseStore();
    const reopenTask = vi.fn().mockResolvedValue({ reopened: true });
    const stopFollowUp = vi.fn().mockResolvedValue({ completed: true, task: {} });
    const findLatestFilingCreatedAt = vi.fn().mockResolvedValue(null);

    const result = await recordFilingEmailBounceEventAndEnsureActionability(
      makeSupabase(store),
      actionabilityLane({ reopenTask, stopFollowUp, findLatestFilingCreatedAt }),
      { messageId: "re_msg_1", eventType: "email.bounced" }
    );

    expect(result).toEqual({ status: "recorded", caseId: "case-1", state: "bounced" });
    expect(reopenTask).toHaveBeenCalledTimes(1);
    expect(stopFollowUp).toHaveBeenCalledTimes(1);
  });

  it("fails closed — does not touch the task or follow-up — when the supersession lookup itself errors", async () => {
    const store = baseStore();
    const reopenTask = vi.fn().mockResolvedValue({ reopened: true });
    const stopFollowUp = vi.fn().mockResolvedValue({ completed: true, task: {} });
    const findLatestFilingCreatedAt = vi.fn().mockResolvedValue("error" as const);

    const result = await recordFilingEmailBounceEventAndEnsureActionability(
      makeSupabase(store),
      actionabilityLane({ reopenTask, stopFollowUp, findLatestFilingCreatedAt }),
      { messageId: "re_msg_1", eventType: "email.bounced" }
    );

    expect(result).toEqual({ status: "error", reason: "latest_filing_lookup_failed" });
    expect(reopenTask).not.toHaveBeenCalled();
    expect(stopFollowUp).not.toHaveBeenCalled();
  });

  it("fails closed on a replay too, once the lookup errors — not only reported as success", async () => {
    const store = baseStore();
    const supabase = makeSupabase(store);

    // First call: lookup confirms no supersession, repair runs normally.
    const first = await recordFilingEmailBounceEventAndEnsureActionability(
      supabase,
      actionabilityLane({ findLatestFilingCreatedAt: vi.fn().mockResolvedValue(null) }),
      { messageId: "re_msg_1", eventType: "email.bounced" }
    );
    expect(first).toEqual({ status: "recorded", caseId: "case-1", state: "bounced" });

    // Replay: delivery state is now a duplicate, and the supersession lookup fails transiently.
    const reopenTask = vi.fn().mockResolvedValue({ reopened: true });
    const stopFollowUp = vi.fn().mockResolvedValue({ completed: true, task: {} });
    const replay = await recordFilingEmailBounceEventAndEnsureActionability(
      supabase,
      actionabilityLane({
        reopenTask,
        stopFollowUp,
        findLatestFilingCreatedAt: vi.fn().mockResolvedValue("error" as const),
      }),
      { messageId: "re_msg_1", eventType: "email.bounced" }
    );

    expect(replay).toEqual({ status: "error", reason: "latest_filing_lookup_failed" });
    expect(reopenTask).not.toHaveBeenCalled();
    expect(stopFollowUp).not.toHaveBeenCalled();
  });
});

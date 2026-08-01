import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { EmailSendRequest, EmailSendResult } from "@/lib/email/emailProvider";
import { bbbFilingTaskNotesMarker } from "@/lib/justice/bbbFilingTask";
import { upsertBbbOwnedFilingDeliveryNotes } from "@/lib/justice/bbbOwnedFilingDeliveryState";
import { ftcFilingTaskNotesMarker } from "@/lib/justice/ftcFilingTask";
import { upsertFtcOwnedFilingDeliveryNotes } from "@/lib/justice/ftcOwnedFilingDeliveryState";
import { hasOperatorAlertBeenSent, operatorFallbackAlertKey } from "@/lib/justice/operatorFallbackAlertState";
import { bbbOwnedFilingIdempotencyKey } from "@/lib/justice/bbbOwnedFilingDeliveryState";
import { ftcOwnedFilingIdempotencyKey } from "@/lib/justice/ftcOwnedFilingDeliveryState";
import { merchantContactFilingTaskNotesMarker } from "@/lib/justice/merchantContactFilingTask";
import { stateAgFilingTaskNotesMarker } from "@/lib/justice/stateAgFilingTask";
import { dotFilingTaskNotesMarker } from "@/lib/justice/dotFilingTask";
import { followUpResponseReviewTaskNotesMarker } from "@/lib/justice/followUpResponseReviewTask";
import { parseKeysetOrFilter } from "@/lib/justice/reconcilerKeysetPaginationTestSupport";

const timelineAppend = vi.fn(async (..._args: unknown[]) => {});
vi.mock("@/server/justiceTimelineAppend", () => ({
  appendCaseTimelineEntry: (...args: unknown[]) => timelineAppend(...args),
}));

type ProviderResolution =
  | { ok: true; provider: { name: string; send: (r: EmailSendRequest) => Promise<EmailSendResult> }; from: string }
  | { ok: false; reason: string };

let providerResolution: ProviderResolution;
const send = vi.fn(async (req: EmailSendRequest): Promise<EmailSendResult> => ({
  ok: true,
  messageId: `msg_${req.idempotencyKey}`,
}));

vi.mock("@/lib/email/resolveMerchantOutreachEmailProvider", () => ({
  resolveMerchantOutreachEmailProvider: () => providerResolution,
}));

import { reconcileOperatorFallbackAlerts } from "@/lib/justice/operatorFallbackAlertReconciler";

type Task = {
  id: string;
  user_id: string;
  case_id: string;
  title: string | null;
  notes: string | null;
  completed_at: string | null;
  created_at: string | null;
  updated_at: string;
};

type Store = { tasks: Task[]; failSelect?: boolean; failUpdate?: boolean };

function makeSupabase(store: Store): SupabaseClient {
  const from = (table: string) => {
    const state: {
      table: string;
      op: "select" | "update";
      filters: Record<string, string>;
      like: string | null;
      update: Record<string, unknown> | null;
      orderBy: { col: string; ascending: boolean }[];
      cursor: { updatedAt: string; id: string } | null;
    } = { table, op: "select", filters: {}, like: null, update: null, orderBy: [], cursor: null };

    const resolveSelect = (opts: { range?: [number, number]; limit?: number }) => {
      if (store.failSelect) return { data: null, error: { message: "select down" } };
      const needle = state.like ? state.like.replace(/%/g, "") : "";
      let rows = store.tasks.filter(
        (t) => !t.completed_at && (!needle || (t.notes ?? "").includes(needle))
      );
      // The composite keyset predicate PostgREST evaluates server-side via `.or()`: only rows
      // strictly after the cursor's (updated_at, id) are visible on this page.
      if (state.cursor) {
        const cursor = state.cursor;
        rows = rows.filter(
          (t) =>
            t.updated_at > cursor.updatedAt ||
            (t.updated_at === cursor.updatedAt && t.id > cursor.id)
        );
      }
      // Stable multi-key sort: apply keys in reverse priority order (each Array#sort is
      // stable), mirroring Postgres ORDER BY col1, col2 semantics.
      for (const { col, ascending } of [...state.orderBy].reverse()) {
        rows = [...rows].sort((a, b) => {
          const av = String((a as unknown as Record<string, unknown>)[col] ?? "");
          const bv = String((b as unknown as Record<string, unknown>)[col] ?? "");
          const cmp = av < bv ? -1 : av > bv ? 1 : 0;
          return ascending ? cmp : -cmp;
        });
      }
      if (opts.range) {
        const [start, end] = opts.range;
        rows = rows.slice(start, end + 1);
      } else if (opts.limit != null) {
        rows = rows.slice(0, opts.limit);
      }
      return { data: rows, error: null };
    };

    const resolve = (range?: [number, number], limit?: number) => {
      if (state.op === "update" && state.table === "justice_case_tasks") {
        if (store.failUpdate) return { data: null, error: { message: "update down" } };
        const task = store.tasks.find(
          (t) => t.id === state.filters.id && t.user_id === state.filters.user_id
        );
        if (task) task.notes = String((state.update as Record<string, unknown>).notes);
        return { data: null, error: null };
      }
      if (state.op === "select" && state.table === "justice_case_tasks") {
        return resolveSelect({ range, limit });
      }
      return { data: [], error: null };
    };

    const api: Record<string, unknown> = {
      select: () => api,
      is: () => api,
      eq: (col: string, val: string) => {
        state.filters[col] = val;
        return api;
      },
      like: (_col: string, pattern: string) => {
        state.like = pattern;
        return api;
      },
      or: (filter: string) => {
        state.cursor = parseKeysetOrFilter(filter);
        return api;
      },
      order: (col: string, opts?: { ascending?: boolean }) => {
        state.orderBy.push({ col, ascending: opts?.ascending !== false });
        return api;
      },
      update: (payload: Record<string, unknown>) => {
        state.op = "update";
        state.update = payload;
        return api;
      },
      limit: (n: number) => Promise.resolve(resolve(undefined, n)),
      range: (start: number, end: number) => Promise.resolve(resolve([start, end])),
      then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
        Promise.resolve(resolve()).then(onF, onR),
    };
    return api;
  };
  return { from } as unknown as SupabaseClient;
}

function bbbFailedTask(
  overrides: Partial<Task> & { caseId: string; stopReason?: string; failureDetail?: string }
): Task {
  const caseId = overrides.caseId;
  const base = `${bbbFilingTaskNotesMarker(caseId)}\nBBB complaint draft`;
  const notes = upsertBbbOwnedFilingDeliveryNotes(base, {
    delivery_state: "failed",
    provider: "bbb",
    ...(overrides.stopReason ? { stop_reason: overrides.stopReason } : {}),
    ...(overrides.failureDetail ? { failure_detail: overrides.failureDetail } : {}),
  });
  return {
    id: overrides.id ?? `task_${caseId}`,
    user_id: overrides.user_id ?? `user_${caseId}`,
    case_id: caseId,
    title: overrides.title ?? "BBB filing",
    notes: overrides.notes ?? notes,
    completed_at: overrides.completed_at ?? null,
    created_at: overrides.created_at ?? new Date(Date.now() - 3_600_000).toISOString(),
    updated_at: overrides.updated_at ?? overrides.created_at ?? new Date(Date.now() - 3_600_000).toISOString(),
  };
}

function ftcFailedTask(
  overrides: Partial<Task> & { caseId: string; stopReason?: string; failureDetail?: string }
): Task {
  const caseId = overrides.caseId;
  const base = `${ftcFilingTaskNotesMarker(caseId)}\nFTC complaint draft`;
  const notes = upsertFtcOwnedFilingDeliveryNotes(base, {
    delivery_state: "failed",
    provider: "ftc",
    ...(overrides.stopReason ? { stop_reason: overrides.stopReason } : {}),
    ...(overrides.failureDetail ? { failure_detail: overrides.failureDetail } : {}),
  });
  return {
    id: overrides.id ?? `task_${caseId}`,
    user_id: overrides.user_id ?? `user_${caseId}`,
    case_id: caseId,
    title: overrides.title ?? "FTC filing",
    notes: overrides.notes ?? notes,
    completed_at: overrides.completed_at ?? null,
    created_at: overrides.created_at ?? new Date(Date.now() - 3_600_000).toISOString(),
    updated_at: overrides.updated_at ?? overrides.created_at ?? new Date(Date.now() - 3_600_000).toISOString(),
  };
}

function openTask(overrides: Partial<Task> & { caseId: string; marker: string }): Task {
  const caseId = overrides.caseId;
  return {
    id: overrides.id ?? `task_${caseId}`,
    user_id: overrides.user_id ?? `user_${caseId}`,
    case_id: caseId,
    title: overrides.title ?? "Filing task",
    notes: overrides.notes ?? `${overrides.marker}\ndraft text`,
    completed_at: overrides.completed_at ?? null,
    created_at: overrides.created_at ?? new Date(Date.now() - 3_600_000).toISOString(),
    updated_at: overrides.updated_at ?? overrides.created_at ?? new Date(Date.now() - 3_600_000).toISOString(),
  };
}

describe("reconcileOperatorFallbackAlerts", () => {
  beforeEach(() => {
    send.mockReset().mockImplementation(async (req: EmailSendRequest) => ({
      ok: true,
      messageId: `msg_${req.idempotencyKey}`,
    }));
    timelineAppend.mockReset().mockResolvedValue(undefined);
    providerResolution = { ok: true, provider: { name: "mock", send }, from: "ops@surrenderless.test" };
    vi.stubEnv("OPERATOR_ALERT_EMAIL", "alerts@surrenderless.test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("alerts once for every fallback source (worker/uncertain/config/stale-queued/stale-submitting) across BBB and FTC", async () => {
    const store: Store = {
      tasks: [
        bbbFailedTask({ caseId: "c-worker", failureDetail: "browserless timeout" }),
        bbbFailedTask({ caseId: "c-uncertain", stopReason: "invalid_decision" }),
        bbbFailedTask({ caseId: "c-config", failureDetail: "autofill not enabled" }),
        ftcFailedTask({ caseId: "c-stale-q", stopReason: "stale_queued_reclaimed" }),
        ftcFailedTask({ caseId: "c-stale-s", stopReason: "stale_submitting_reclaimed" }),
      ],
    };
    const supabase = makeSupabase(store);

    const summary = await reconcileOperatorFallbackAlerts(supabase);

    expect(summary.attempted).toBe(5);
    expect(summary.sent).toBe(5);
    expect(summary.failed).toBe(0);
    expect(send).toHaveBeenCalledTimes(5);
    for (const call of send.mock.calls) {
      expect(call[0].to).toBe("alerts@surrenderless.test");
      expect(call[0].from).toBe("ops@surrenderless.test");
      expect(call[0].subject).toContain("Manual filing needed");
    }
    // Durable marker persisted on each task.
    for (const t of store.tasks) {
      expect(t.notes).toContain("operator_alert_sent:");
    }
  });

  it("includes case id, destination, failure reason, task age, and operator-workspace URL in the alert", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.surrenderless.test");
    const created = new Date(Date.now() - 2 * 3_600_000).toISOString();
    const store: Store = {
      tasks: [ftcFailedTask({ caseId: "case-42", stopReason: "invalid_decision", failureDetail: "portal changed", created_at: created })],
    };

    await reconcileOperatorFallbackAlerts(makeSupabase(store), { nowMs: Date.now() });

    const body = send.mock.calls[0][0].text;
    expect(body).toContain("case-42");
    expect(body).toContain("FTC (consumer complaint)");
    expect(body).toContain("invalid_decision");
    expect(body).toContain("portal changed");
    expect(body).toMatch(/Task age: 2h/);
    expect(body).toContain("https://app.surrenderless.test/operator/fulfillment?case=case-42");
  });

  it("is exactly-once: a second run does not re-alert an already-alerted fallback", async () => {
    const store: Store = { tasks: [bbbFailedTask({ caseId: "c1", stopReason: "invalid_decision" })] };
    const supabase = makeSupabase(store);

    const first = await reconcileOperatorFallbackAlerts(supabase);
    expect(first.sent).toBe(1);

    const second = await reconcileOperatorFallbackAlerts(supabase);
    expect(second.sent).toBe(0);
    expect(second.skipped).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);

    const key = operatorFallbackAlertKey("task_c1", bbbOwnedFilingIdempotencyKey("c1"), "invalid_decision");
    expect(hasOperatorAlertBeenSent(store.tasks[0].notes, key)).toBe(true);
  });

  it("keeps the event retryable when the provider send fails (no marker persisted)", async () => {
    send.mockResolvedValue({ ok: false, error: "resend 500", retryable: true });
    const store: Store = { tasks: [ftcFailedTask({ caseId: "c1", stopReason: "invalid_decision" })] };
    const supabase = makeSupabase(store);

    const first = await reconcileOperatorFallbackAlerts(supabase);
    expect(first.failed).toBe(1);
    expect(first.sent).toBe(0);
    expect(store.tasks[0].notes).not.toContain("operator_alert_sent:");

    // Recovers on the next run once the provider accepts.
    send.mockResolvedValue({ ok: true, messageId: "msg_ok" });
    const second = await reconcileOperatorFallbackAlerts(supabase);
    expect(second.sent).toBe(1);
    expect(store.tasks[0].notes).toContain("operator_alert_sent:");
  });

  it("keeps the event retryable when the marker write fails after an accepted send", async () => {
    const store: Store = {
      tasks: [bbbFailedTask({ caseId: "c1", stopReason: "invalid_decision" })],
      failUpdate: true,
    };
    const supabase = makeSupabase(store);

    const summary = await reconcileOperatorFallbackAlerts(supabase);
    expect(summary.failed).toBe(1);
    expect(summary.sent).toBe(0);
    expect(store.tasks[0].notes).not.toContain("operator_alert_sent:");
    // The provider idempotency key guards against a duplicate email on retry.
    expect(send.mock.calls[0][0].idempotencyKey).toBe("operator-fallback-alert:task_c1:invalid_decision");
  });

  it("never alerts for filed or completed tasks", async () => {
    const filedNotes = upsertBbbOwnedFilingDeliveryNotes(`${bbbFilingTaskNotesMarker("c-filed")}\ndraft`, {
      delivery_state: "filed",
      provider: "bbb",
      confirmation: "BBB-123",
    });
    const store: Store = {
      tasks: [
        {
          id: "t-filed",
          user_id: "u",
          case_id: "c-filed",
          title: "BBB filing",
          notes: filedNotes,
          completed_at: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        // failed but already completed task — excluded by the open-task filter.
        bbbFailedTask({ caseId: "c-done", stopReason: "invalid_decision", completed_at: new Date().toISOString() }),
      ],
    };

    const summary = await reconcileOperatorFallbackAlerts(makeSupabase(store));
    expect(summary.attempted).toBe(0);
    expect(summary.sent).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it("is concurrency-safe: parallel runs share one idempotency key and one durable marker", async () => {
    const store: Store = { tasks: [ftcFailedTask({ caseId: "c1", stopReason: "invalid_decision" })] };
    const supabase = makeSupabase(store);

    await Promise.all([
      reconcileOperatorFallbackAlerts(supabase),
      reconcileOperatorFallbackAlerts(supabase),
    ]);

    // Every send used the identical provider idempotency key, so Resend dedupes to one email.
    const keys = new Set(send.mock.calls.map((c) => c[0].idempotencyKey));
    expect(keys.size).toBe(1);
    expect([...keys][0]).toBe("operator-fallback-alert:task_c1:invalid_decision");
    // The durable marker is idempotent — it appears exactly once regardless of parallel writes.
    const occurrences = (store.tasks[0].notes ?? "").match(/operator_alert_sent:/g) ?? [];
    expect(occurrences.length).toBe(1);
  });

  it("fails safe when OPERATOR_ALERT_EMAIL is not configured", async () => {
    vi.stubEnv("OPERATOR_ALERT_EMAIL", "");
    const store: Store = { tasks: [bbbFailedTask({ caseId: "c1", stopReason: "invalid_decision" })] };

    const summary = await reconcileOperatorFallbackAlerts(makeSupabase(store));
    expect(summary.sent).toBe(0);
    expect(summary.attempted).toBe(0);
    expect(send).not.toHaveBeenCalled();
    expect(store.tasks[0].notes).not.toContain("operator_alert_sent:");
  });

  it("fails safe when the Resend provider is unavailable", async () => {
    providerResolution = { ok: false, reason: "RESEND_API_KEY is not configured" };
    const store: Store = { tasks: [bbbFailedTask({ caseId: "c1", stopReason: "invalid_decision" })] };

    const summary = await reconcileOperatorFallbackAlerts(makeSupabase(store));
    expect(summary.sent).toBe(0);
    expect(send).not.toHaveBeenCalled();
    expect(store.tasks[0].notes).not.toContain("operator_alert_sent:");
  });

  it("reaches and processes an eligible task beyond the first page (phase 1 keyset pagination)", async () => {
    const baseMs = Date.parse("2026-07-01T12:00:00.000Z");
    // Already-filed tasks still carry the BBB delivery-block marker (so they match the query's
    // .like() filter and are scanned), but delivery_state !== "failed" so they're skipped.
    const staleTasks: Task[] = Array.from({ length: 4 }, (_, i) => {
      const t = bbbFailedTask({ caseId: `case-page-${i}`, stopReason: "invalid_decision" });
      return {
        ...t,
        notes: upsertBbbOwnedFilingDeliveryNotes(t.notes ?? "", {
          delivery_state: "filed",
          provider: "bbb",
          confirmation: "BBB-DONE",
        }),
        updated_at: new Date(baseMs + i * 1000).toISOString(),
      };
    });
    const target: Task = {
      ...bbbFailedTask({ caseId: "case-page-4", stopReason: "invalid_decision", id: "target-task" }),
      updated_at: new Date(baseMs + 4 * 1000).toISOString(),
    };
    // The only eligible task sorts last (updated_at ASC), so with pageSize 2 it only surfaces
    // on page 3 — proving the scan doesn't stop after the first capped page.
    const store: Store = { tasks: [...staleTasks, target] };

    const summary = await reconcileOperatorFallbackAlerts(makeSupabase(store), { limit: 2 });

    expect(summary.scanned).toBe(5);
    expect(summary.attempted).toBe(1);
    expect(summary.sent).toBe(1);
    expect(
      summary.results.some((r) => r.task_id === "target-task" && r.result === "sent")
    ).toBe(true);
  });

  it("deterministically paginates through tasks sharing the same updated_at via id tie-breaker", async () => {
    const tiedUpdatedAt = "2026-07-17T12:00:00.000Z";
    const staleTasks: Task[] = Array.from({ length: 4 }, (_, i) => {
      const t = bbbFailedTask({ caseId: `case-tie-${i}`, stopReason: "invalid_decision" });
      return {
        ...t,
        notes: upsertBbbOwnedFilingDeliveryNotes(t.notes ?? "", {
          delivery_state: "filed",
          provider: "bbb",
          confirmation: "BBB-DONE",
        }),
        updated_at: tiedUpdatedAt,
      };
    });
    // task ids sort: task_case-tie-0 < task_case-tie-1 < task_case-tie-2 < task_case-tie-2b <
    // task_case-tie-3 — the target sits in the middle of the tied group by id, so it's only
    // reachable if the composite (updated_at, id) cursor correctly advances past ties instead
    // of re-fetching the same page or looping forever.
    const target: Task = {
      ...bbbFailedTask({
        caseId: "case-tie-mid",
        stopReason: "invalid_decision",
        id: "task_case-tie-2b",
      }),
      updated_at: tiedUpdatedAt,
    };
    const store: Store = { tasks: [...staleTasks, target] };

    const summary = await reconcileOperatorFallbackAlerts(makeSupabase(store), { limit: 2 });

    expect(summary.scanned).toBe(5);
    expect(summary.attempted).toBe(1);
    expect(summary.sent).toBe(1);
    expect(
      summary.results.some((r) => r.task_id === "task_case-tie-2b" && r.result === "sent")
    ).toBe(true);
  });
});

describe("reconcileOperatorFallbackAlerts — default-mode operator-queue alerts", () => {
  beforeEach(() => {
    send.mockReset().mockImplementation(async (req: EmailSendRequest) => ({
      ok: true,
      messageId: `msg_${req.idempotencyKey}`,
    }));
    timelineAppend.mockReset().mockResolvedValue(undefined);
    providerResolution = { ok: true, provider: { name: "mock", send }, from: "ops@surrenderless.test" };
    vi.stubEnv("OPERATOR_ALERT_EMAIL", "alerts@surrenderless.test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("alerts on ordinary open operator-fulfillment work across all 9 destinations, with no delivery block", async () => {
    const store: Store = {
      tasks: [
        openTask({ caseId: "c-bbb", marker: bbbFilingTaskNotesMarker("c-bbb") }),
        openTask({ caseId: "c-ftc", marker: ftcFilingTaskNotesMarker("c-ftc") }),
        openTask({ caseId: "c-merchant", marker: merchantContactFilingTaskNotesMarker("c-merchant") }),
        openTask({ caseId: "c-stateag", marker: stateAgFilingTaskNotesMarker("c-stateag") }),
      ],
    };

    const summary = await reconcileOperatorFallbackAlerts(makeSupabase(store));

    expect(summary.attempted).toBe(4);
    expect(summary.sent).toBe(4);
    expect(summary.failed).toBe(0);
    expect(send).toHaveBeenCalledTimes(4);
    for (const t of store.tasks) {
      expect(t.notes).toContain("operator_alert_sent:");
    }
  });

  it("includes the destination, case id, and operator-workspace URL, without fabricating a failure reason", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.surrenderless.test");
    const store: Store = {
      tasks: [openTask({ caseId: "case-queue-1", marker: stateAgFilingTaskNotesMarker("case-queue-1") })],
    };

    await reconcileOperatorFallbackAlerts(makeSupabase(store));

    const body = send.mock.calls[0][0].text;
    expect(body).toContain("case-queue-1");
    expect(body).toContain("State Attorney General (consumer)");
    expect(body).toContain("No automated filing was attempted");
    expect(body).toContain("https://app.surrenderless.test/operator/fulfillment?case=case-queue-1");
  });

  it("is exactly-once: a second run does not re-alert an already-alerted open task", async () => {
    const store: Store = {
      tasks: [openTask({ caseId: "c1", marker: merchantContactFilingTaskNotesMarker("c1") })],
    };
    const supabase = makeSupabase(store);

    const first = await reconcileOperatorFallbackAlerts(supabase);
    expect(first.sent).toBe(1);

    const second = await reconcileOperatorFallbackAlerts(supabase);
    expect(second.sent).toBe(0);
    expect(second.skipped).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("does not double-alert a BBB/FTC task that already carries an owned-filing delivery block (queued, submitting, or filed — not just failed)", async () => {
    const queuedNotes = upsertBbbOwnedFilingDeliveryNotes(
      `${bbbFilingTaskNotesMarker("c-queued")}\ndraft`,
      { delivery_state: "queued", provider: "bbb" }
    );
    const submittingNotes = upsertFtcOwnedFilingDeliveryNotes(
      `${ftcFilingTaskNotesMarker("c-submitting")}\ndraft`,
      { delivery_state: "submitting", provider: "ftc" }
    );
    const filedNotes = upsertBbbOwnedFilingDeliveryNotes(
      `${bbbFilingTaskNotesMarker("c-filed")}\ndraft`,
      { delivery_state: "filed", provider: "bbb", confirmation: "BBB-1" }
    );
    const now = new Date().toISOString();
    const store: Store = {
      tasks: [
        { id: "t-queued", user_id: "u", case_id: "c-queued", title: "BBB", notes: queuedNotes, completed_at: null, created_at: now, updated_at: now },
        { id: "t-submitting", user_id: "u", case_id: "c-submitting", title: "FTC", notes: submittingNotes, completed_at: null, created_at: now, updated_at: now },
        { id: "t-filed", user_id: "u", case_id: "c-filed", title: "BBB", notes: filedNotes, completed_at: null, created_at: now, updated_at: now },
      ],
    };

    const summary = await reconcileOperatorFallbackAlerts(makeSupabase(store));

    // These are either actively automated (queued/submitting) or already filed — none are an
    // "ordinary open, never-automated" queue item, and none carry a failed delivery either.
    expect(summary.attempted).toBe(0);
    expect(summary.sent).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it("does not alert a BBB/FTC failed-delivery task twice via both phases", async () => {
    const store: Store = { tasks: [bbbFailedTask({ caseId: "c1", stopReason: "invalid_decision" })] };

    const summary = await reconcileOperatorFallbackAlerts(makeSupabase(store));

    expect(summary.sent).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("does not alert for a follow-up response review task — that is not one of the 9 filing destinations", async () => {
    const store: Store = {
      tasks: [openTask({ caseId: "c1", marker: followUpResponseReviewTaskNotesMarker("c1") })],
    };

    const summary = await reconcileOperatorFallbackAlerts(makeSupabase(store));

    expect(summary.attempted).toBe(0);
    expect(summary.sent).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it("never alerts for a completed task", async () => {
    const store: Store = {
      tasks: [
        openTask({
          caseId: "c1",
          marker: merchantContactFilingTaskNotesMarker("c1"),
          completed_at: new Date().toISOString(),
        }),
      ],
    };

    const summary = await reconcileOperatorFallbackAlerts(makeSupabase(store));

    expect(summary.attempted).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it("fails safe when OPERATOR_ALERT_EMAIL is not configured", async () => {
    vi.stubEnv("OPERATOR_ALERT_EMAIL", "");
    const store: Store = {
      tasks: [openTask({ caseId: "c1", marker: merchantContactFilingTaskNotesMarker("c1") })],
    };

    const summary = await reconcileOperatorFallbackAlerts(makeSupabase(store));
    expect(summary.sent).toBe(0);
    expect(summary.attempted).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it("keeps the event retryable when the provider send fails (no marker persisted)", async () => {
    send.mockResolvedValue({ ok: false, error: "resend 500", retryable: true });
    const store: Store = {
      tasks: [openTask({ caseId: "c1", marker: stateAgFilingTaskNotesMarker("c1") })],
    };
    const supabase = makeSupabase(store);

    const first = await reconcileOperatorFallbackAlerts(supabase);
    expect(first.failed).toBe(1);
    expect(first.sent).toBe(0);
    expect(store.tasks[0].notes).not.toContain("operator_alert_sent:");

    send.mockResolvedValue({ ok: true, messageId: "msg_ok" });
    const second = await reconcileOperatorFallbackAlerts(supabase);
    expect(second.sent).toBe(1);
    expect(store.tasks[0].notes).toContain("operator_alert_sent:");
  });

  it("reaches an alertable task beyond the first 100 open tasks — the regression this pagination fix targets", async () => {
    // 149 older, non-matching open tasks (plain reminders — no destination marker) sort ahead
    // of the target in created_at order, so a single capped, unpaged query would never reach it.
    const baseMs = Date.now() - 10_000_000;
    const noiseTasks: Task[] = Array.from({ length: 149 }, (_, i) => ({
      id: `noise-${String(i).padStart(4, "0")}`,
      user_id: "user-noise",
      case_id: `case-noise-${i}`,
      title: "Personal reminder",
      notes: "Call back merchant next week",
      completed_at: null,
      created_at: new Date(baseMs + i * 1000).toISOString(),
      updated_at: new Date(baseMs + i * 1000).toISOString(),
    }));
    const targetCaseId = "case-target";
    const targetTask: Task = openTask({
      caseId: targetCaseId,
      marker: stateAgFilingTaskNotesMarker(targetCaseId),
      id: "target-task",
      // Created after all 149 noise tasks, so it sorts last (beyond the first 100-row page).
      created_at: new Date(baseMs + 149 * 1000).toISOString(),
    });
    const store: Store = { tasks: [...noiseTasks, targetTask] };

    const summary = await reconcileOperatorFallbackAlerts(makeSupabase(store));

    expect(summary.sent).toBe(1);
    expect(summary.results.some((r) => r.task_id === "target-task" && r.result === "sent")).toBe(
      true
    );
    expect(store.tasks.find((t) => t.id === "target-task")?.notes).toContain(
      "operator_alert_sent:"
    );
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("does not spam-alert once open-task volume exceeds one page: still exactly-once per task across multiple runs", async () => {
    const baseMs = Date.now() - 10_000_000;
    const noiseTasks: Task[] = Array.from({ length: 120 }, (_, i) => ({
      id: `noise-${String(i).padStart(4, "0")}`,
      user_id: "user-noise",
      case_id: `case-noise-${i}`,
      title: "Personal reminder",
      notes: "Follow up personally",
      completed_at: null,
      created_at: new Date(baseMs + i * 1000).toISOString(),
      updated_at: new Date(baseMs + i * 1000).toISOString(),
    }));
    const store: Store = {
      tasks: [
        ...noiseTasks,
        openTask({
          caseId: "case-a",
          marker: merchantContactFilingTaskNotesMarker("case-a"),
          id: "task-a",
          created_at: new Date(baseMs + 200 * 1000).toISOString(),
        }),
        openTask({
          caseId: "case-b",
          marker: stateAgFilingTaskNotesMarker("case-b"),
          id: "task-b",
          created_at: new Date(baseMs + 201 * 1000).toISOString(),
        }),
      ],
    };
    const supabase = makeSupabase(store);

    const first = await reconcileOperatorFallbackAlerts(supabase);
    expect(first.sent).toBe(2);

    const second = await reconcileOperatorFallbackAlerts(supabase);
    expect(second.sent).toBe(0);
    expect(second.skipped).toBe(2);
    expect(send).toHaveBeenCalledTimes(2);
  });
});

describe("reconcileOperatorFallbackAlerts — 24h/72h staleness escalation", () => {
  const T0 = Date.parse("2026-07-01T00:00:00.000Z");
  const HOUR = 3_600_000;

  beforeEach(() => {
    send.mockReset().mockImplementation(async (req: EmailSendRequest) => ({
      ok: true,
      messageId: `msg_${req.idempotencyKey}`,
    }));
    timelineAppend.mockReset().mockResolvedValue(undefined);
    providerResolution = { ok: true, provider: { name: "mock", send }, from: "ops@surrenderless.test" };
    vi.stubEnv("OPERATOR_ALERT_EMAIL", "alerts@surrenderless.test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("preserves the existing immediate alert for a freshly queued task", async () => {
    const store: Store = {
      tasks: [openTask({ caseId: "c1", marker: stateAgFilingTaskNotesMarker("c1"), created_at: new Date(T0).toISOString() })],
    };

    const summary = await reconcileOperatorFallbackAlerts(makeSupabase(store), { nowMs: T0 });

    expect(summary.sent).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].subject).toContain("Manual filing needed");
    expect(send.mock.calls[0][0].subject).not.toContain("ESCALATION");
  });

  it("does not escalate before the 24h boundary, then escalates exactly at 24h (distinct tier key, no resend of immediate)", async () => {
    const store: Store = {
      tasks: [openTask({ caseId: "c1", marker: stateAgFilingTaskNotesMarker("c1"), created_at: new Date(T0).toISOString() })],
    };
    const supabase = makeSupabase(store);

    const immediate = await reconcileOperatorFallbackAlerts(supabase, { nowMs: T0 });
    expect(immediate.sent).toBe(1);

    const justUnder = await reconcileOperatorFallbackAlerts(supabase, { nowMs: T0 + 24 * HOUR - 1 });
    expect(justUnder.sent).toBe(0);
    expect(justUnder.skipped).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);

    const atBoundary = await reconcileOperatorFallbackAlerts(supabase, { nowMs: T0 + 24 * HOUR });
    expect(atBoundary.sent).toBe(1);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][0].subject).toContain("ESCALATION (24h)");

    // Distinct per-tier marker keys — both the immediate and the 24h escalation are recorded.
    const notes = store.tasks[0].notes ?? "";
    expect(hasOperatorAlertBeenSent(notes, operatorFallbackAlertKey("task_c1", "operator-queue", "state_ag"))).toBe(true);
    expect(hasOperatorAlertBeenSent(notes, operatorFallbackAlertKey("task_c1", "operator-queue-24h", "state_ag"))).toBe(true);
    expect(hasOperatorAlertBeenSent(notes, operatorFallbackAlertKey("task_c1", "operator-queue-72h", "state_ag"))).toBe(false);
  });

  it("escalates to 72h after 24h, and never resends the 24h tier once 72h has fired", async () => {
    const store: Store = {
      tasks: [openTask({ caseId: "c1", marker: merchantContactFilingTaskNotesMarker("c1"), created_at: new Date(T0).toISOString() })],
    };
    const supabase = makeSupabase(store);

    await reconcileOperatorFallbackAlerts(supabase, { nowMs: T0 });
    await reconcileOperatorFallbackAlerts(supabase, { nowMs: T0 + 24 * HOUR });
    expect(send).toHaveBeenCalledTimes(2);

    const justUnder72 = await reconcileOperatorFallbackAlerts(supabase, { nowMs: T0 + 72 * HOUR - 1 });
    expect(justUnder72.sent).toBe(0);
    expect(send).toHaveBeenCalledTimes(2);

    const at72 = await reconcileOperatorFallbackAlerts(supabase, { nowMs: T0 + 72 * HOUR });
    expect(at72.sent).toBe(1);
    expect(send).toHaveBeenCalledTimes(3);
    expect(send.mock.calls[2][0].subject).toContain("ESCALATION (72h)");

    // Long after 72h, nothing new ever fires again for this task (no tier beyond 72h exists).
    const wellPast = await reconcileOperatorFallbackAlerts(supabase, { nowMs: T0 + 200 * HOUR });
    expect(wellPast.sent).toBe(0);
    expect(wellPast.skipped).toBe(1);
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("sends only the single highest due tier when a task is first observed already past 72h — no burst of immediate + 24h + 72h", async () => {
    const store: Store = {
      tasks: [openTask({ caseId: "c1", marker: ftcFilingTaskNotesMarker("c1"), created_at: new Date(T0).toISOString() })],
    };

    const summary = await reconcileOperatorFallbackAlerts(makeSupabase(store), { nowMs: T0 + 80 * HOUR });

    expect(summary.sent).toBe(1);
    expect(summary.attempted).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].subject).toContain("ESCALATION (72h)");
    expect(send.mock.calls[0][0].subject).not.toContain("ESCALATION (24h)");

    const notes = store.tasks[0].notes ?? "";
    // Only the 72h key is recorded — immediate and 24h were never sent, and never will be.
    expect(hasOperatorAlertBeenSent(notes, operatorFallbackAlertKey("task_c1", "operator-queue", "ftc"))).toBe(false);
    expect(hasOperatorAlertBeenSent(notes, operatorFallbackAlertKey("task_c1", "operator-queue-24h", "ftc"))).toBe(false);
    expect(hasOperatorAlertBeenSent(notes, operatorFallbackAlertKey("task_c1", "operator-queue-72h", "ftc"))).toBe(true);

    // A later run never fires the skipped lower tiers.
    const later = await reconcileOperatorFallbackAlerts(makeSupabase(store), { nowMs: T0 + 200 * HOUR });
    expect(later.sent).toBe(0);
    expect(later.skipped).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("is idempotent: identical concurrent runs at the same escalated age share one tier key and send exactly once", async () => {
    const store: Store = {
      tasks: [openTask({ caseId: "c1", marker: bbbFilingTaskNotesMarker("c1"), created_at: new Date(T0).toISOString() })],
    };
    const supabase = makeSupabase(store);
    // Immediate already sent in an earlier run, so this run is the 24h escalation.
    await reconcileOperatorFallbackAlerts(supabase, { nowMs: T0 });
    send.mockClear();

    await Promise.all([
      reconcileOperatorFallbackAlerts(supabase, { nowMs: T0 + 24 * HOUR }),
      reconcileOperatorFallbackAlerts(supabase, { nowMs: T0 + 24 * HOUR }),
    ]);

    const keys = new Set(send.mock.calls.map((c) => c[0].idempotencyKey));
    expect(keys.size).toBe(1);
    expect([...keys][0]).toBe("operator-queue-alert:task_c1:bbb:24h");
    const occurrences = (store.tasks[0].notes ?? "").match(/operator_alert_sent: task_c1\|operator-queue-24h\|bbb/g) ?? [];
    expect(occurrences.length).toBe(1);
  });

  it("excludes a completed (terminal) task from escalation even though its age would otherwise qualify", async () => {
    const store: Store = {
      tasks: [
        openTask({
          caseId: "c1",
          marker: dotFilingTaskNotesMarker("c1"),
          created_at: new Date(T0).toISOString(),
          completed_at: new Date(T0 + HOUR).toISOString(),
        }),
      ],
    };

    const summary = await reconcileOperatorFallbackAlerts(makeSupabase(store), { nowMs: T0 + 200 * HOUR });

    expect(summary.attempted).toBe(0);
    expect(summary.sent).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });
});

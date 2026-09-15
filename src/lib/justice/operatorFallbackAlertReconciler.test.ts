import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { EmailSendRequest, EmailSendResult } from "@/lib/email/emailProvider";
import { bbbFilingTaskNotesMarker } from "@/lib/justice/bbbFilingTask";
import { upsertBbbOwnedFilingDeliveryNotes } from "@/lib/justice/bbbOwnedFilingDeliveryState";
import { buildJusticeIntakeFromParts, defaultBuildJusticeIntakeParts } from "@/lib/justice/buildJusticeIntake";
import { ftcFilingTaskNotesMarker } from "@/lib/justice/ftcFilingTask";
import { upsertFtcOwnedFilingDeliveryNotes } from "@/lib/justice/ftcOwnedFilingDeliveryState";
import { hasOperatorAlertBeenSent, operatorFallbackAlertKey } from "@/lib/justice/operatorFallbackAlertState";
import { bbbOwnedFilingIdempotencyKey } from "@/lib/justice/bbbOwnedFilingDeliveryState";
import { ftcOwnedFilingIdempotencyKey } from "@/lib/justice/ftcOwnedFilingDeliveryState";
import {
  buildMerchantContactFilingTaskNotes,
  buildMerchantContactFilingTaskTitle,
  merchantContactFilingTaskNotesMarker,
} from "@/lib/justice/merchantContactFilingTask";
import { hasValidMerchantContactRecipient } from "@/lib/justice/merchantContactRecipient";
import { stateAgFilingTaskNotesMarker } from "@/lib/justice/stateAgFilingTask";
import { dotFilingTaskNotesMarker } from "@/lib/justice/dotFilingTask";
import { fccFilingTaskNotesMarker } from "@/lib/justice/fccFilingTask";
import { demandLetterFilingTaskNotesMarker } from "@/lib/justice/demandLetterFilingTask";
import { cfpbFilingTaskNotesMarker } from "@/lib/justice/cfpbFilingTask";
import { paymentDisputeFilingTaskNotesMarker } from "@/lib/justice/paymentDisputeFilingTask";
import {
  fccOwnedFilingIdempotencyKey,
  upsertFccOwnedFilingDeliveryNotes,
} from "@/lib/justice/fccOwnedFilingDeliveryState";
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

type CaseRow = { id: string; archived_at: string | null };

/**
 * Optional deterministic barrier: when present, every SELECT (task list or case-archive lookup)
 * blocks on `wait()` before resolving, calling `onRead()` first so the test can observe how many
 * reads are currently pending. Used to force two "concurrent" reconciler runs to both complete
 * their reads — both genuinely observing "not yet sent" — before either is allowed to proceed to
 * provider.send(), rather than hoping for that interleaving to occur naturally on an unthrottled
 * fake (which it may not: a synchronous mock with no gate can let one run's read-through-write
 * finish entirely before the other's read even starts, silently proving nothing about the actual
 * concurrent-attempt contract).
 */
type SelectGate = { wait: () => Promise<void>; onRead?: () => void };

type Store = {
  tasks: Task[];
  cases?: CaseRow[];
  failSelect?: boolean;
  failUpdate?: boolean;
  failCaseSelect?: boolean;
  gate?: SelectGate;
};

function makeSupabase(store: Store): SupabaseClient {
  const from = (table: string) => {
    const state: {
      table: string;
      op: "select" | "update";
      filters: Record<string, string>;
      inFilter: { col: string; vals: string[] } | null;
      like: string | null;
      update: Record<string, unknown> | null;
      orderBy: { col: string; ascending: boolean }[];
      cursor: { updatedAt: string; id: string } | null;
    } = {
      table,
      op: "select",
      filters: {},
      inFilter: null,
      like: null,
      update: null,
      orderBy: [],
      cursor: null,
    };

    const resolveCasesSelect = () => {
      if (store.failCaseSelect) return { data: null, error: { message: "cases select down" } };
      const ids = new Set(state.inFilter?.vals ?? []);
      const rows = (store.cases ?? []).filter((c) => ids.has(c.id));
      return { data: rows, error: null };
    };

    const resolveSelect = (opts: { range?: [number, number]; limit?: number }) => {
      if (state.table === "justice_cases") return resolveCasesSelect();
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

    const resolve = async (range?: [number, number], limit?: number) => {
      if (state.op === "update" && state.table === "justice_case_tasks") {
        if (store.failUpdate) return { data: null, error: { message: "update down" } };
        const task = store.tasks.find(
          (t) => t.id === state.filters.id && t.user_id === state.filters.user_id
        );
        if (task) task.notes = String((state.update as Record<string, unknown>).notes);
        return { data: null, error: null };
      }
      if (state.op === "select" && (state.table === "justice_case_tasks" || state.table === "justice_cases")) {
        if (store.gate) {
          store.gate.onRead?.();
          await store.gate.wait();
        }
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
      in: (col: string, vals: string[]) => {
        state.inFilter = { col, vals };
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

/**
 * Creates a deterministic SelectGate plus test-side controls: every SELECT the fake Supabase
 * client issues blocks on `wait()` until `release()` is called. Used to force two "concurrent"
 * reconciler runs to both genuinely observe "not yet sent" before either is allowed to reach
 * provider.send() — proving an actual race rather than hoping the JS microtask scheduler happens
 * to interleave two calls against an unthrottled fake.
 */
function makeSelectGate(): { gate: SelectGate; release: () => void; readsStarted: () => number } {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  let reads = 0;
  const gate: SelectGate = {
    wait: () => promise,
    onRead: () => {
      reads += 1;
    },
  };
  return { gate, release, readsStarted: () => reads };
}

/**
 * Advances the microtask queue until both concurrent runs have each issued at least one blocked
 * read (or a small bound is hit) — enough for both to have reached their first select against the
 * gated fake, before the caller releases it.
 */
async function waitUntilBothRunsAreBlocked(readsStarted: () => number, minReads = 2): Promise<void> {
  for (let i = 0; i < 50 && readsStarted() < minReads; i++) {
    await Promise.resolve();
  }
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

  it("concurrent attempts: two runs forced past their reads before either send resolves make exactly two send attempts with the identical key, and exactly one durable marker remains", async () => {
    const store: Store = { tasks: [ftcFailedTask({ caseId: "c1", stopReason: "invalid_decision" })] };
    const { gate, release, readsStarted } = makeSelectGate();
    store.gate = gate;
    const supabase = makeSupabase(store);

    const runA = reconcileOperatorFallbackAlerts(supabase);
    const runB = reconcileOperatorFallbackAlerts(supabase);
    await waitUntilBothRunsAreBlocked(readsStarted);
    release();
    await Promise.all([runA, runB]);

    // The actual current contract: both runs independently observed "not yet sent" and both
    // called provider.send() — this is not deduped by any application-level lock. Collapsing two
    // attempts sharing one idempotency key into a single delivered email is Resend's own
    // idempotency-key contract (see resendEmailProvider.test.ts), not something asserted here.
    expect(send).toHaveBeenCalledTimes(2);
    const keys = new Set(send.mock.calls.map((c) => c[0].idempotencyKey));
    expect(keys.size).toBe(1);
    expect([...keys][0]).toBe("operator-fallback-alert:task_c1:invalid_decision");
    // The durable marker still lands exactly once: both attempts compute an identical
    // marker+timestamp from the same pre-race notes, so the second write is a no-op overwrite.
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

  it("alerts immediately for an open follow-up response review task, same as the 9 filing destinations", async () => {
    const store: Store = {
      tasks: [openTask({ caseId: "c1", marker: followUpResponseReviewTaskNotesMarker("c1") })],
    };

    const summary = await reconcileOperatorFallbackAlerts(makeSupabase(store));

    expect(summary.attempted).toBe(1);
    expect(summary.sent).toBe(1);
    expect(send.mock.calls[0][0].subject).toContain("Manual review needed");
    expect(send.mock.calls[0][0].text).toContain(
      "awaiting an operator's response-review outcome"
    );
    expect(send).toHaveBeenCalledTimes(1);
    expect(store.tasks[0].notes).toContain("operator_alert_sent:");
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

    // Long after 72h, the cadence keeps going: recurring reminder #1 at 144h+ (here 200h), never
    // resending the 24h tier — there is no cutoff.
    const wellPast = await reconcileOperatorFallbackAlerts(supabase, { nowMs: T0 + 200 * HOUR });
    expect(wellPast.sent).toBe(1);
    expect(send).toHaveBeenCalledTimes(4);
    expect(send.mock.calls[3][0].subject).toContain("ESCALATION (overdue reminder #1)");

    // The same window is never resent on a repeat run at the same age.
    const repeatSameWindow = await reconcileOperatorFallbackAlerts(supabase, { nowMs: T0 + 200 * HOUR });
    expect(repeatSameWindow.sent).toBe(0);
    expect(repeatSameWindow.skipped).toBe(1);
    expect(send).toHaveBeenCalledTimes(4);

    // The next 72h window (reminder #2) fires in turn, still with no upper bound.
    const nextWindow = await reconcileOperatorFallbackAlerts(supabase, { nowMs: T0 + 220 * HOUR });
    expect(nextWindow.sent).toBe(1);
    expect(send).toHaveBeenCalledTimes(5);
    expect(send.mock.calls[4][0].subject).toContain("ESCALATION (overdue reminder #2)");

    const finalNotes = store.tasks[0].notes ?? "";
    expect(
      hasOperatorAlertBeenSent(finalNotes, operatorFallbackAlertKey("task_c1", "operator-queue-24h", "merchant_contact"))
    ).toBe(true);
    // 24h was recorded once, at the 24h run — never resent by any later recurring window.
    expect(
      (finalNotes.match(/operator_alert_sent: task_c1\|operator-queue-24h\|merchant_contact/g) ?? []).length
    ).toBe(1);
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

    // A later run never fires the skipped lower tiers, but the recurring cadence past 72h still
    // isn't cut off — reminder #1 is due by 200h.
    const later = await reconcileOperatorFallbackAlerts(makeSupabase(store), { nowMs: T0 + 200 * HOUR });
    expect(later.sent).toBe(1);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][0].subject).toContain("ESCALATION (overdue reminder #1)");
    expect(send.mock.calls[1][0].subject).not.toContain("ESCALATION (24h)");

    const laterNotes = store.tasks[0].notes ?? "";
    expect(hasOperatorAlertBeenSent(laterNotes, operatorFallbackAlertKey("task_c1", "operator-queue-24h", "ftc"))).toBe(false);
  });

  it("concurrent attempts at the same escalated age: two runs forced past their reads make exactly two send attempts with the identical tier key, and exactly one durable marker remains", async () => {
    const store: Store = {
      tasks: [openTask({ caseId: "c1", marker: bbbFilingTaskNotesMarker("c1"), created_at: new Date(T0).toISOString() })],
    };
    const supabase = makeSupabase(store);
    // Immediate already sent in an earlier, ungated run, so this run is the 24h escalation.
    await reconcileOperatorFallbackAlerts(supabase, { nowMs: T0 });
    send.mockClear();

    const { gate, release, readsStarted } = makeSelectGate();
    store.gate = gate;

    const runA = reconcileOperatorFallbackAlerts(supabase, { nowMs: T0 + 24 * HOUR });
    const runB = reconcileOperatorFallbackAlerts(supabase, { nowMs: T0 + 24 * HOUR });
    await waitUntilBothRunsAreBlocked(readsStarted);
    release();
    await Promise.all([runA, runB]);

    // The actual current contract: both runs independently observed "not yet sent" for the 24h
    // tier and both called provider.send() — no application-level lock prevents this. Collapsing
    // two attempts sharing one idempotency key into a single delivered email is Resend's own
    // idempotency-key contract (see resendEmailProvider.test.ts), not something asserted here.
    expect(send).toHaveBeenCalledTimes(2);
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

describe("reconcileOperatorFallbackAlerts — recurring overdue reminders past 72h", () => {
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

  /** Drives a task straight to "72h tier already sent" without asserting on those earlier sends. */
  async function primeThroughSeventyTwoHours(supabase: SupabaseClient): Promise<void> {
    await reconcileOperatorFallbackAlerts(supabase, { nowMs: T0 });
    await reconcileOperatorFallbackAlerts(supabase, { nowMs: T0 + 24 * HOUR });
    await reconcileOperatorFallbackAlerts(supabase, { nowMs: T0 + 72 * HOUR });
  }

  it("timing boundary: no reminder just under 144h, reminder #1 fires exactly at 144h", async () => {
    const store: Store = {
      tasks: [openTask({ caseId: "c1", marker: bbbFilingTaskNotesMarker("c1"), created_at: new Date(T0).toISOString() })],
    };
    const supabase = makeSupabase(store);
    await primeThroughSeventyTwoHours(supabase);
    send.mockClear();

    const justUnder = await reconcileOperatorFallbackAlerts(supabase, { nowMs: T0 + 144 * HOUR - 1 });
    expect(justUnder.sent).toBe(0);
    expect(justUnder.skipped).toBe(1);
    expect(send).not.toHaveBeenCalled();

    const atBoundary = await reconcileOperatorFallbackAlerts(supabase, { nowMs: T0 + 144 * HOUR });
    expect(atBoundary.sent).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].subject).toContain("ESCALATION (overdue reminder #1)");
  });

  it("timing boundary: no reminder #2 just under 216h, fires exactly at 216h — sequential numbering continues", async () => {
    const store: Store = {
      tasks: [openTask({ caseId: "c1", marker: ftcFilingTaskNotesMarker("c1"), created_at: new Date(T0).toISOString() })],
    };
    const supabase = makeSupabase(store);
    await primeThroughSeventyTwoHours(supabase);
    await reconcileOperatorFallbackAlerts(supabase, { nowMs: T0 + 144 * HOUR });
    send.mockClear();

    const justUnder = await reconcileOperatorFallbackAlerts(supabase, { nowMs: T0 + 216 * HOUR - 1 });
    expect(justUnder.sent).toBe(0);
    expect(send).not.toHaveBeenCalled();

    const atBoundary = await reconcileOperatorFallbackAlerts(supabase, { nowMs: T0 + 216 * HOUR });
    expect(atBoundary.sent).toBe(1);
    expect(send.mock.calls[0][0].subject).toContain("ESCALATION (overdue reminder #2)");
    expect(send.mock.calls[0][0].subject).not.toContain("overdue reminder #1");
  });

  it("duplicate run at the identical age does not resend the same reminder window", async () => {
    const store: Store = {
      tasks: [openTask({ caseId: "c1", marker: stateAgFilingTaskNotesMarker("c1"), created_at: new Date(T0).toISOString() })],
    };
    const supabase = makeSupabase(store);
    await primeThroughSeventyTwoHours(supabase);
    send.mockClear();

    const first = await reconcileOperatorFallbackAlerts(supabase, { nowMs: T0 + 150 * HOUR });
    expect(first.sent).toBe(1);

    // A second, independent run at the exact same age — simulating a duplicate cron invocation —
    // must not resend, because the durable marker from the first run is already persisted.
    const duplicate = await reconcileOperatorFallbackAlerts(supabase, { nowMs: T0 + 150 * HOUR });
    expect(duplicate.sent).toBe(0);
    expect(duplicate.skipped).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("concurrent attempts at the same recurring age: two runs forced past their reads make exactly two send attempts with the identical key, and exactly one durable marker remains", async () => {
    const store: Store = {
      tasks: [openTask({ caseId: "c1", marker: demandLetterFilingTaskNotesMarker("c1"), created_at: new Date(T0).toISOString() })],
    };
    const supabase = makeSupabase(store);
    await primeThroughSeventyTwoHours(supabase);
    send.mockClear();

    const { gate, release, readsStarted } = makeSelectGate();
    store.gate = gate;

    const runA = reconcileOperatorFallbackAlerts(supabase, { nowMs: T0 + 150 * HOUR });
    const runB = reconcileOperatorFallbackAlerts(supabase, { nowMs: T0 + 150 * HOUR });
    await waitUntilBothRunsAreBlocked(readsStarted);
    release();
    await Promise.all([runA, runB]);

    // The actual current contract for the new recurring-reminder branch, identical to the
    // pre-existing fixed tiers: both runs independently observed "not yet sent" for reminder #1
    // and both called provider.send() — no application-level lock prevents this. Collapsing two
    // attempts sharing one idempotency key into a single delivered email is Resend's own
    // idempotency-key contract (see resendEmailProvider.test.ts), not something asserted here.
    expect(send).toHaveBeenCalledTimes(2);
    const keys = new Set(send.mock.calls.map((c) => c[0].idempotencyKey));
    expect(keys.size).toBe(1);
    expect([...keys][0]).toBe("operator-queue-alert:task_c1:demand_letter:recurring-1");
    const occurrences =
      (store.tasks[0].notes ?? "").match(/operator_alert_sent: task_c1\|operator-queue-recurring-1\|demand_letter/g) ?? [];
    expect(occurrences.length).toBe(1);
  });

  it("provider failure on a recurring reminder leaves it retryable (no marker written), then succeeds on retry", async () => {
    const store: Store = {
      tasks: [openTask({ caseId: "c1", marker: cfpbFilingTaskNotesMarker("c1"), created_at: new Date(T0).toISOString() })],
    };
    const supabase = makeSupabase(store);
    await primeThroughSeventyTwoHours(supabase);

    send.mockResolvedValueOnce({ ok: false, error: "resend 500", retryable: true });
    const failed = await reconcileOperatorFallbackAlerts(supabase, { nowMs: T0 + 150 * HOUR });
    expect(failed.failed).toBe(1);
    expect(failed.sent).toBe(0);
    expect(
      hasOperatorAlertBeenSent(
        store.tasks[0].notes,
        operatorFallbackAlertKey("task_c1", "operator-queue-recurring-1", "cfpb")
      )
    ).toBe(false);

    send.mockResolvedValue({ ok: true, messageId: "msg_ok" });
    const retried = await reconcileOperatorFallbackAlerts(supabase, { nowMs: T0 + 150 * HOUR });
    expect(retried.sent).toBe(1);
    expect(
      hasOperatorAlertBeenSent(
        store.tasks[0].notes,
        operatorFallbackAlertKey("task_c1", "operator-queue-recurring-1", "cfpb")
      )
    ).toBe(true);
  });

  it("a reconciler outage doesn't burst backlogged reminders — jumping straight to a much later age fires only the single currently-due reminder", async () => {
    const store: Store = {
      tasks: [openTask({ caseId: "c1", marker: paymentDisputeFilingTaskNotesMarker("c1"), created_at: new Date(T0).toISOString() })],
    };
    const supabase = makeSupabase(store);
    await primeThroughSeventyTwoHours(supabase);
    send.mockClear();

    // Reconciler was down for a long stretch; next run observes the task at 500h — well past
    // several backlogged windows (144h/#1, 216h/#2, 288h/#3, 360h/#4, 432h/#5).
    const summary = await reconcileOperatorFallbackAlerts(supabase, { nowMs: T0 + 500 * HOUR });
    expect(summary.sent).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
    // floor(500/72) - 1 = 6 - 1 = 5.
    expect(send.mock.calls[0][0].subject).toContain("ESCALATION (overdue reminder #5)");
  });

  it("includes the actual wait age and the overdue-reminder number in the operator copy", async () => {
    const store: Store = {
      tasks: [openTask({ caseId: "case-copy", marker: bbbFilingTaskNotesMarker("case-copy"), created_at: new Date(T0).toISOString() })],
    };
    const supabase = makeSupabase(store);
    await primeThroughSeventyTwoHours(supabase);
    send.mockClear();

    await reconcileOperatorFallbackAlerts(supabase, { nowMs: T0 + 150 * HOUR });

    const body = send.mock.calls[0][0].text as string;
    // 150h = 6d 6h.
    expect(body).toMatch(/Task age: 6d 6h/);
    expect(body).toContain("overdue reminder #1");
  });

  it("stops immediately once the task itself is completed, even mid-recurring-cadence", async () => {
    const store: Store = {
      tasks: [openTask({ caseId: "c1", marker: dotFilingTaskNotesMarker("c1"), created_at: new Date(T0).toISOString() })],
    };
    const supabase = makeSupabase(store);
    await primeThroughSeventyTwoHours(supabase);
    await reconcileOperatorFallbackAlerts(supabase, { nowMs: T0 + 144 * HOUR });
    send.mockClear();

    // Operator completes the task between reminder #1 and reminder #2.
    store.tasks[0].completed_at = new Date(T0 + 150 * HOUR).toISOString();

    const summary = await reconcileOperatorFallbackAlerts(supabase, { nowMs: T0 + 216 * HOUR });
    expect(summary.attempted).toBe(0);
    expect(summary.sent).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it("stops immediately once the case is archived — no further fixed-tier or recurring alert, across multiple destinations", async () => {
    const store: Store = {
      tasks: [
        openTask({ caseId: "case-archived-1", marker: bbbFilingTaskNotesMarker("case-archived-1"), created_at: new Date(T0).toISOString() }),
        openTask({ caseId: "case-archived-2", marker: merchantContactFilingTaskNotesMarker("case-archived-2"), created_at: new Date(T0).toISOString() }),
      ],
      cases: [
        { id: "case-archived-1", archived_at: new Date(T0 + 100 * HOUR).toISOString() },
        { id: "case-archived-2", archived_at: new Date(T0 + 100 * HOUR).toISOString() },
      ],
    };
    const supabase = makeSupabase(store);
    await primeThroughSeventyTwoHours(supabase);
    send.mockClear();

    const summary = await reconcileOperatorFallbackAlerts(supabase, { nowMs: T0 + 200 * HOUR });
    expect(summary.sent).toBe(0);
    expect(summary.attempted).toBe(0);
    expect(send).not.toHaveBeenCalled();
    expect(summary.results.every((r) => r.result === "skipped" && r.reason === "case_archived")).toBe(
      true
    );
  });

  it("a case_id with no matching justice_cases row is treated as not archived (fail toward existing alerting behavior)", async () => {
    const store: Store = {
      tasks: [openTask({ caseId: "case-orphan", marker: fccFilingTaskNotesMarker("case-orphan"), created_at: new Date(T0).toISOString() })],
      cases: [],
    };

    const summary = await reconcileOperatorFallbackAlerts(makeSupabase(store), { nowMs: T0 });
    expect(summary.sent).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("fails safe (stops the whole reconciliation run) when the archive-check case lookup errors, rather than risk alerting an archived case", async () => {
    const store: Store = {
      tasks: [openTask({ caseId: "c1", marker: bbbFilingTaskNotesMarker("c1"), created_at: new Date(T0).toISOString() })],
      failCaseSelect: true,
    };

    const summary = await reconcileOperatorFallbackAlerts(makeSupabase(store), { nowMs: T0 });
    expect(summary.sent).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });
});

/**
 * Dedicated coverage for follow_up_response_review as its own QUEUE_ALERT_DESTINATIONS entry —
 * the operator's own resolved/no_resolution/further_escalation decision task, added because it
 * used to be entirely excluded from queue alerting (see the "alerts immediately for an open
 * follow-up response review task" test above, which replaced the old "does not alert" test this
 * fix inverted). Mirrors the generic 24h/72h and recurring-reminder describe blocks above,
 * proving this destination follows the identical schedule, wording conventions, pagination, and
 * fail-safe archive handling — not a special case bolted on separately.
 */
describe("reconcileOperatorFallbackAlerts — follow_up_response_review operator alerts", () => {
  const T0 = Date.parse("2026-08-01T00:00:00.000Z");
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

  function reviewTask(overrides: Partial<Task> & { caseId: string }): Task {
    return openTask({ ...overrides, marker: followUpResponseReviewTaskNotesMarker(overrides.caseId) });
  }

  /** Drives a follow_up_response_review task straight to "72h tier already sent". */
  async function primeThroughSeventyTwoHours(supabase: SupabaseClient): Promise<void> {
    await reconcileOperatorFallbackAlerts(supabase, { nowMs: T0 });
    await reconcileOperatorFallbackAlerts(supabase, { nowMs: T0 + 24 * HOUR });
    await reconcileOperatorFallbackAlerts(supabase, { nowMs: T0 + 72 * HOUR });
  }

  it("escalates immediate -> 24h -> 72h with the correct subject wording and distinct per-tier keys", async () => {
    const store: Store = {
      tasks: [reviewTask({ caseId: "c1", created_at: new Date(T0).toISOString() })],
    };
    const supabase = makeSupabase(store);

    const immediate = await reconcileOperatorFallbackAlerts(supabase, { nowMs: T0 });
    expect(immediate.sent).toBe(1);
    expect(send.mock.calls[0][0].subject).toContain("Manual review needed");
    expect(send.mock.calls[0][0].subject).not.toContain("ESCALATION");

    const at24h = await reconcileOperatorFallbackAlerts(supabase, { nowMs: T0 + 24 * HOUR });
    expect(at24h.sent).toBe(1);
    expect(send.mock.calls[1][0].subject).toContain("ESCALATION (24h)");

    const at72h = await reconcileOperatorFallbackAlerts(supabase, { nowMs: T0 + 72 * HOUR });
    expect(at72h.sent).toBe(1);
    expect(send.mock.calls[2][0].subject).toContain("ESCALATION (72h)");

    const notes = store.tasks[0].notes ?? "";
    expect(hasOperatorAlertBeenSent(notes, operatorFallbackAlertKey("task_c1", "operator-queue", "follow_up_response_review"))).toBe(true);
    expect(hasOperatorAlertBeenSent(notes, operatorFallbackAlertKey("task_c1", "operator-queue-24h", "follow_up_response_review"))).toBe(true);
    expect(hasOperatorAlertBeenSent(notes, operatorFallbackAlertKey("task_c1", "operator-queue-72h", "follow_up_response_review"))).toBe(true);
  });

  it("timing boundary: no reminder just under 144h, reminder #1 fires exactly at 144h", async () => {
    const store: Store = {
      tasks: [reviewTask({ caseId: "c1", created_at: new Date(T0).toISOString() })],
    };
    const supabase = makeSupabase(store);
    await primeThroughSeventyTwoHours(supabase);
    send.mockClear();

    const justUnder = await reconcileOperatorFallbackAlerts(supabase, { nowMs: T0 + 144 * HOUR - 1 });
    expect(justUnder.sent).toBe(0);
    expect(justUnder.skipped).toBe(1);
    expect(send).not.toHaveBeenCalled();

    const atBoundary = await reconcileOperatorFallbackAlerts(supabase, { nowMs: T0 + 144 * HOUR });
    expect(atBoundary.sent).toBe(1);
    expect(send.mock.calls[0][0].subject).toContain("ESCALATION (overdue reminder #1)");
  });

  it("timing boundary: no reminder #2 just under 216h, fires exactly at 216h", async () => {
    const store: Store = {
      tasks: [reviewTask({ caseId: "c1", created_at: new Date(T0).toISOString() })],
    };
    const supabase = makeSupabase(store);
    await primeThroughSeventyTwoHours(supabase);
    await reconcileOperatorFallbackAlerts(supabase, { nowMs: T0 + 144 * HOUR });
    send.mockClear();

    const justUnder = await reconcileOperatorFallbackAlerts(supabase, { nowMs: T0 + 216 * HOUR - 1 });
    expect(justUnder.sent).toBe(0);
    expect(send).not.toHaveBeenCalled();

    const atBoundary = await reconcileOperatorFallbackAlerts(supabase, { nowMs: T0 + 216 * HOUR });
    expect(atBoundary.sent).toBe(1);
    expect(send.mock.calls[0][0].subject).toContain("ESCALATION (overdue reminder #2)");
  });

  it("a reconciler outage doesn't burst backlogged reminders — jumping to a much later age fires only the single currently-due reminder", async () => {
    const store: Store = {
      tasks: [reviewTask({ caseId: "c1", created_at: new Date(T0).toISOString() })],
    };
    const supabase = makeSupabase(store);
    await primeThroughSeventyTwoHours(supabase);
    send.mockClear();

    const summary = await reconcileOperatorFallbackAlerts(supabase, { nowMs: T0 + 500 * HOUR });
    expect(summary.sent).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].subject).toContain("ESCALATION (overdue reminder #5)");
  });

  it("provider failure leaves a recurring reminder retryable (no marker written), then succeeds on retry", async () => {
    const store: Store = {
      tasks: [reviewTask({ caseId: "c1", created_at: new Date(T0).toISOString() })],
    };
    const supabase = makeSupabase(store);
    await primeThroughSeventyTwoHours(supabase);

    send.mockResolvedValueOnce({ ok: false, error: "resend 500", retryable: true });
    const failed = await reconcileOperatorFallbackAlerts(supabase, { nowMs: T0 + 150 * HOUR });
    expect(failed.failed).toBe(1);
    expect(failed.sent).toBe(0);
    expect(
      hasOperatorAlertBeenSent(
        store.tasks[0].notes,
        operatorFallbackAlertKey("task_c1", "operator-queue-recurring-1", "follow_up_response_review")
      )
    ).toBe(false);

    send.mockResolvedValue({ ok: true, messageId: "msg_ok" });
    const retried = await reconcileOperatorFallbackAlerts(supabase, { nowMs: T0 + 150 * HOUR });
    expect(retried.sent).toBe(1);
    expect(
      hasOperatorAlertBeenSent(
        store.tasks[0].notes,
        operatorFallbackAlertKey("task_c1", "operator-queue-recurring-1", "follow_up_response_review")
      )
    ).toBe(true);
  });

  it("stops immediately once the review task itself is completed, even mid-recurring-cadence", async () => {
    const store: Store = {
      tasks: [reviewTask({ caseId: "c1", created_at: new Date(T0).toISOString() })],
    };
    const supabase = makeSupabase(store);
    await primeThroughSeventyTwoHours(supabase);
    await reconcileOperatorFallbackAlerts(supabase, { nowMs: T0 + 144 * HOUR });
    send.mockClear();

    store.tasks[0].completed_at = new Date(T0 + 150 * HOUR).toISOString();

    const summary = await reconcileOperatorFallbackAlerts(supabase, { nowMs: T0 + 216 * HOUR });
    expect(summary.attempted).toBe(0);
    expect(summary.sent).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it("stops immediately once the case is archived — no further fixed-tier or recurring alert", async () => {
    const store: Store = {
      tasks: [reviewTask({ caseId: "case-archived-review", created_at: new Date(T0).toISOString() })],
      cases: [{ id: "case-archived-review", archived_at: new Date(T0 + 100 * HOUR).toISOString() }],
    };
    const supabase = makeSupabase(store);
    await primeThroughSeventyTwoHours(supabase);
    send.mockClear();

    const summary = await reconcileOperatorFallbackAlerts(supabase, { nowMs: T0 + 200 * HOUR });
    expect(summary.sent).toBe(0);
    expect(summary.attempted).toBe(0);
    expect(send).not.toHaveBeenCalled();
    expect(
      summary.results.every((r) => r.result === "skipped" && r.reason === "case_archived")
    ).toBe(true);
  });

  it("concurrent attempts at the same recurring age: two runs forced past their reads make exactly two send attempts with the identical key, and exactly one durable marker remains", async () => {
    const store: Store = {
      tasks: [reviewTask({ caseId: "c1", created_at: new Date(T0).toISOString() })],
    };
    const supabase = makeSupabase(store);
    await primeThroughSeventyTwoHours(supabase);
    send.mockClear();

    const { gate, release, readsStarted } = makeSelectGate();
    store.gate = gate;

    const runA = reconcileOperatorFallbackAlerts(supabase, { nowMs: T0 + 150 * HOUR });
    const runB = reconcileOperatorFallbackAlerts(supabase, { nowMs: T0 + 150 * HOUR });
    await waitUntilBothRunsAreBlocked(readsStarted);
    release();
    await Promise.all([runA, runB]);

    // Identical contract to every other destination: no application-level lock, both runs call
    // send() with the same deterministic key, and Resend's own idempotency contract (not this
    // code) is what would collapse two attempts into one delivered email.
    expect(send).toHaveBeenCalledTimes(2);
    const keys = new Set(send.mock.calls.map((c) => c[0].idempotencyKey));
    expect(keys.size).toBe(1);
    expect([...keys][0]).toBe("operator-queue-alert:task_c1:follow_up_response_review:recurring-1");
    const occurrences =
      (store.tasks[0].notes ?? "").match(
        /operator_alert_sent: task_c1\|operator-queue-recurring-1\|follow_up_response_review/g
      ) ?? [];
    expect(occurrences.length).toBe(1);
  });

  it("includes the actual wait age, reminder number, and operator-workspace URL in the copy, with review-specific (not filing) wording", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.surrenderless.test");
    const store: Store = {
      tasks: [reviewTask({ caseId: "case-copy", created_at: new Date(T0).toISOString() })],
    };
    const supabase = makeSupabase(store);
    await primeThroughSeventyTwoHours(supabase);
    send.mockClear();

    await reconcileOperatorFallbackAlerts(supabase, { nowMs: T0 + 150 * HOUR });

    const call = send.mock.calls[0][0];
    expect(call.subject).toContain("Manual review needed");
    expect(call.subject).not.toContain("Manual filing needed");
    const body = call.text as string;
    expect(body).toMatch(/Task age: 6d 6h/);
    expect(body).toContain("overdue reminder #1");
    expect(body).toContain("awaiting an operator's response-review outcome");
    expect(body).not.toContain("No automated filing was attempted");
    expect(body).toContain("https://app.surrenderless.test/operator/fulfillment?case=case-copy");
  });

  it("does not double-alert once open-task volume exceeds one page — reaches a review task beyond the first page", async () => {
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
    const targetCaseId = "case-review-target";
    const store: Store = {
      tasks: [
        ...noiseTasks,
        reviewTask({
          caseId: targetCaseId,
          id: "review-target-task",
          created_at: new Date(baseMs + 200 * 1000).toISOString(),
        }),
      ],
    };
    const supabase = makeSupabase(store);

    const first = await reconcileOperatorFallbackAlerts(supabase);
    expect(first.sent).toBe(1);
    expect(
      first.results.some((r) => r.task_id === "review-target-task" && r.result === "sent")
    ).toBe(true);

    const second = await reconcileOperatorFallbackAlerts(supabase);
    expect(second.sent).toBe(0);
    expect(second.skipped).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe("reconcileOperatorFallbackAlerts — FCC parity scaffold wiring", () => {
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

  function fccFailedTask(
    overrides: Partial<Task> & { caseId: string; stopReason?: string; failureDetail?: string }
  ): Task {
    const caseId = overrides.caseId;
    const base = `${fccFilingTaskNotesMarker(caseId)}\nFCC complaint draft`;
    const notes = upsertFccOwnedFilingDeliveryNotes(base, {
      delivery_state: "failed",
      provider: "fcc",
      ...(overrides.stopReason ? { stop_reason: overrides.stopReason } : {}),
      ...(overrides.failureDetail ? { failure_detail: overrides.failureDetail } : {}),
    });
    return {
      id: overrides.id ?? `task_${caseId}`,
      user_id: overrides.user_id ?? `user_${caseId}`,
      case_id: caseId,
      title: overrides.title ?? "FCC filing",
      notes: overrides.notes ?? notes,
      completed_at: overrides.completed_at ?? null,
      created_at: overrides.created_at ?? new Date(Date.now() - 3_600_000).toISOString(),
      updated_at:
        overrides.updated_at ?? overrides.created_at ?? new Date(Date.now() - 3_600_000).toISOString(),
    };
  }

  it("phase 1: alerts once for an owned FCC filing that fell back to manual fulfillment (failed delivery)", async () => {
    const store: Store = {
      tasks: [fccFailedTask({ caseId: "c-fcc-1", stopReason: "no_verified_harness" })],
    };

    const summary = await reconcileOperatorFallbackAlerts(makeSupabase(store));

    expect(summary.attempted).toBe(1);
    expect(summary.sent).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].subject).toContain("Manual filing needed");
    expect(send.mock.calls[0][0].subject).toContain("FCC");
    expect(send.mock.calls[0][0].text).toContain("no_verified_harness");

    const key = operatorFallbackAlertKey("task_c-fcc-1", fccOwnedFilingIdempotencyKey("c-fcc-1"), "no_verified_harness");
    expect(hasOperatorAlertBeenSent(store.tasks[0].notes, key)).toBe(true);
  });

  it("phase 1: is exactly-once for FCC — a second run does not re-alert", async () => {
    const store: Store = {
      tasks: [fccFailedTask({ caseId: "c-fcc-2", stopReason: "config" })],
    };
    const supabase = makeSupabase(store);

    const first = await reconcileOperatorFallbackAlerts(supabase);
    expect(first.sent).toBe(1);

    const second = await reconcileOperatorFallbackAlerts(supabase);
    expect(second.sent).toBe(0);
    expect(second.skipped).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("never alerts for a filed FCC task", async () => {
    const filedNotes = upsertFccOwnedFilingDeliveryNotes(`${fccFilingTaskNotesMarker("c-fcc-filed")}\ndraft`, {
      delivery_state: "filed",
      provider: "fcc",
      confirmation: "FCC-123",
    });
    const store: Store = {
      tasks: [
        {
          id: "t-fcc-filed",
          user_id: "u",
          case_id: "c-fcc-filed",
          title: "FCC filing",
          notes: filedNotes,
          completed_at: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ],
    };

    const summary = await reconcileOperatorFallbackAlerts(makeSupabase(store));
    expect(summary.attempted).toBe(0);
    expect(summary.sent).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it("phase 2 (ordinary queue alert) still covers a plain FCC task with no owned-filing delivery block", async () => {
    const store: Store = {
      tasks: [openTask({ caseId: "c-fcc-plain", marker: fccFilingTaskNotesMarker("c-fcc-plain") })],
    };

    const summary = await reconcileOperatorFallbackAlerts(makeSupabase(store));

    expect(summary.sent).toBe(1);
    expect(send.mock.calls[0][0].text).toContain("FCC");
    expect(send.mock.calls[0][0].text).toContain("No automated filing was attempted");
  });

  it("never double-alerts an FCC task that carries an owned-filing delivery block (queued/submitting/filed) via phase 2", async () => {
    const queuedNotes = upsertFccOwnedFilingDeliveryNotes(
      `${fccFilingTaskNotesMarker("c-fcc-queued")}\ndraft`,
      { delivery_state: "queued", provider: "fcc" }
    );
    const now = new Date().toISOString();
    const store: Store = {
      tasks: [
        {
          id: "t-fcc-queued",
          user_id: "u",
          case_id: "c-fcc-queued",
          title: "FCC",
          notes: queuedNotes,
          completed_at: null,
          created_at: now,
          updated_at: now,
        },
      ],
    };

    const summary = await reconcileOperatorFallbackAlerts(makeSupabase(store));

    // Actively "automated" per its delivery block (even though FCC has no real execution path
    // yet) — phase 2 must still treat it as covered by phase 1's territory and never double-alert.
    expect(summary.attempted).toBe(0);
    expect(summary.sent).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it("does not alert an FCC failed-delivery task twice via both phases", async () => {
    const store: Store = { tasks: [fccFailedTask({ caseId: "c-fcc-3", stopReason: "config" })] };

    const summary = await reconcileOperatorFallbackAlerts(makeSupabase(store));

    expect(summary.sent).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
  });
});

/**
 * Locks in that this reconciler's existing default-mode queue-alert tiers (immediate/24h/72h,
 * proven generically above) are *already* the "existing operator-alert path" for the specific
 * recipient-required scenario: an approved merchant-contact/demand-letter action whose company
 * recipient email is missing. reconcileRecipientRequiredConsumerReminders (the new 24h consumer
 * reminder) deliberately does not add any operator-alerting logic of its own — it relies on this
 * behavior continuing to hold. Uses the real production task-notes builder (not a synthetic
 * marker string) so a change to that builder that broke marker matching would be caught here too.
 */
describe("reconcileOperatorFallbackAlerts — recipient-required merchant-contact/demand-letter coverage", () => {
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

  it("alerts the operator for a real merchant-contact queue task stuck open with no company recipient, escalating 24h then 72h", async () => {
    const intake = buildJusticeIntakeFromParts({
      ...defaultBuildJusticeIntakeParts(),
      problem_category: "online_purchase",
      company_name: "Acme Retail",
      reply_email: "consumer@example.com",
      company_contact_email: "",
    });
    expect(hasValidMerchantContactRecipient(intake)).toBe(false);

    const notes = buildMerchantContactFilingTaskNotes("case-recipient-missing", intake);
    const store: Store = {
      tasks: [
        {
          id: "task-recipient-missing",
          user_id: "user-recipient-missing",
          case_id: "case-recipient-missing",
          title: buildMerchantContactFilingTaskTitle(intake),
          notes,
          completed_at: null,
          created_at: new Date(T0).toISOString(),
          updated_at: new Date(T0).toISOString(),
        },
      ],
    };
    const supabase = makeSupabase(store);

    const immediate = await reconcileOperatorFallbackAlerts(supabase, { nowMs: T0 });
    expect(immediate.sent).toBe(1);

    const at24h = await reconcileOperatorFallbackAlerts(supabase, { nowMs: T0 + 24 * HOUR });
    expect(at24h.sent).toBe(1);
    expect(send.mock.calls[1][0].subject).toContain("ESCALATION (24h)");

    const at72h = await reconcileOperatorFallbackAlerts(supabase, { nowMs: T0 + 72 * HOUR });
    expect(at72h.sent).toBe(1);
    expect(send.mock.calls[2][0].subject).toContain("ESCALATION (72h)");

    for (const call of send.mock.calls) {
      expect(call[0].to).toBe("alerts@surrenderless.test");
    }
  });
});

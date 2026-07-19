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
    } = { table, op: "select", filters: {}, like: null, update: null };

    const resolve = () => {
      if (state.op === "update" && state.table === "justice_case_tasks") {
        if (store.failUpdate) return { data: null, error: { message: "update down" } };
        const task = store.tasks.find(
          (t) => t.id === state.filters.id && t.user_id === state.filters.user_id
        );
        if (task) task.notes = String((state.update as Record<string, unknown>).notes);
        return { data: null, error: null };
      }
      if (state.op === "select" && state.table === "justice_case_tasks") {
        if (store.failSelect) return { data: null, error: { message: "select down" } };
        const needle = state.like ? state.like.replace(/%/g, "") : "";
        const rows = store.tasks.filter(
          (t) => !t.completed_at && (!needle || (t.notes ?? "").includes(needle))
        );
        return { data: rows, error: null };
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
      update: (payload: Record<string, unknown>) => {
        state.op = "update";
        state.update = payload;
        return api;
      },
      limit: () => Promise.resolve(resolve()),
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
});

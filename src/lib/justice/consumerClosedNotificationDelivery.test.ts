import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  parseConsumerClosedNotificationDeliveryState,
  recordConsumerClosedNotificationDeliveryEvent,
} from "@/lib/justice/consumerClosedNotificationDelivery";
import { taskNotesMatchConsumerClosedNotificationMarker } from "@/lib/justice/reconcileClosedCaseConsumerNotifications";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";
import type { TimelineEntry } from "@/lib/justice/types";

type CaseRow = { id: string; user_id: string; timeline: TimelineEntry[] };

type Store = {
  tasks: JusticeCaseTaskRow[];
  cases: CaseRow[];
  failTaskSelect?: boolean;
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

    const resolveTerminal = () => {
      if (state.op === "update" && state.table === "justice_case_tasks") {
        if (store.failUpdate) return { data: null, error: { message: "update down" } };
        const task = store.tasks.find((t) => t.id === state.filters.id);
        if (task) task.notes = String((state.update as Record<string, unknown>).notes);
        return { data: null, error: null };
      }
      if (state.op === "update" && state.table === "justice_cases") {
        const row = store.cases.find(
          (c) => c.id === state.filters.id && c.user_id === state.filters.user_id
        );
        if (row) row.timeline = (state.update as Record<string, unknown>).timeline as TimelineEntry[];
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
      is(col: string, val: string) {
        state.filters[col] = val;
        return builder;
      },
      order() {
        return builder;
      },
      limit() {
        if (state.table === "justice_case_tasks") {
          if (store.failTaskSelect) {
            return Promise.resolve({ data: null, error: { message: "select down" } });
          }
          const needle = (state.like ?? "").replace(/^%/, "").replace(/%$/, "");
          const matches = store.tasks.filter((t) => (t.notes ?? "").includes(needle));
          return Promise.resolve({ data: matches, error: null });
        }
        return Promise.resolve({ data: [], error: null });
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
  return { from } as unknown as SupabaseClient;
}

function markerNotes(caseId: string, messageId: string, extra: string[] = []): string {
  return [
    `consumer_closed_notified:${caseId}`,
    `case_id: ${caseId}`,
    `recipient: consumer@example.com`,
    `provider_message_id: ${messageId}`,
    `idempotency_key: consumer-closed-email:${caseId}`,
    `outcome: resolved`,
    `delivery_state: accepted`,
    `notified_at: 2026-07-17T15:30:00.000Z`,
    ...extra,
  ].join("\n");
}

function markerTask(caseId: string, messageId: string): JusticeCaseTaskRow {
  return {
    id: `task-${caseId}`,
    user_id: `owner-${caseId}`,
    case_id: caseId,
    title: "Consumer closed-case notification sent",
    due_date: null,
    notes: markerNotes(caseId, messageId),
    completed_at: "2026-07-17T15:30:00.000Z",
    created_at: "2026-07-17T15:30:00.000Z",
    updated_at: "2026-07-17T15:30:00.000Z",
  };
}

function baseStore(caseId = "case-1", messageId = "re_abc_123"): Store {
  return {
    tasks: [markerTask(caseId, messageId)],
    cases: [{ id: caseId, user_id: `owner-${caseId}`, timeline: [] }],
  };
}

describe("recordConsumerClosedNotificationDeliveryEvent", () => {
  it("confirms a delivered notification and preserves the no-re-email marker", async () => {
    const store = baseStore();
    const result = await recordConsumerClosedNotificationDeliveryEvent(makeSupabase(store), {
      messageId: "re_abc_123",
      eventType: "email.delivered",
    });

    expect(result).toEqual({ status: "confirmed", caseId: "case-1", state: "delivered" });
    const task = store.tasks[0];
    expect(parseConsumerClosedNotificationDeliveryState(task.notes)).toBe("delivered");
    // Marker remains intact -> reconcile will still skip (never re-emails).
    expect(taskNotesMatchConsumerClosedNotificationMarker(task.notes, "case-1")).toBe(true);
    expect(store.cases[0].timeline).toHaveLength(1);
    expect(store.cases[0].timeline[0].label).toBe("Closed-case notification delivered");
  });

  it("routes a bounce to operator manual fallback without clearing the notified marker", async () => {
    const store = baseStore();
    const result = await recordConsumerClosedNotificationDeliveryEvent(makeSupabase(store), {
      messageId: "re_abc_123",
      eventType: "email.bounced",
    });

    expect(result).toEqual({ status: "fallback", caseId: "case-1", state: "bounced" });
    const task = store.tasks[0];
    expect(parseConsumerClosedNotificationDeliveryState(task.notes)).toBe("bounced");
    expect((task.notes ?? "").includes("manual_fallback_required: true")).toBe(true);
    // Still marked notified so the daily cron does NOT email the bad address again.
    expect(taskNotesMatchConsumerClosedNotificationMarker(task.notes, "case-1")).toBe(true);
    expect(store.cases[0].timeline[0].label).toContain("manual follow-up required");
  });

  it("routes a spam complaint to operator manual fallback", async () => {
    const store = baseStore();
    const result = await recordConsumerClosedNotificationDeliveryEvent(makeSupabase(store), {
      messageId: "re_abc_123",
      eventType: "email.complained",
    });
    expect(result).toEqual({ status: "fallback", caseId: "case-1", state: "complained" });
    expect((store.tasks[0].notes ?? "").includes("manual_fallback_required: true")).toBe(true);
  });

  it("ignores an unknown message id", async () => {
    const store = baseStore();
    const result = await recordConsumerClosedNotificationDeliveryEvent(makeSupabase(store), {
      messageId: "re_does_not_exist",
      eventType: "email.delivered",
    });
    expect(result).toEqual({ status: "ignored_unknown" });
    expect(parseConsumerClosedNotificationDeliveryState(store.tasks[0].notes)).toBe("accepted");
    expect(store.cases[0].timeline).toHaveLength(0);
  });

  it("is idempotent on replayed delivery events", async () => {
    const store = baseStore();
    const supabase = makeSupabase(store);
    const first = await recordConsumerClosedNotificationDeliveryEvent(supabase, {
      messageId: "re_abc_123",
      eventType: "email.delivered",
    });
    const second = await recordConsumerClosedNotificationDeliveryEvent(supabase, {
      messageId: "re_abc_123",
      eventType: "email.delivered",
    });

    expect(first.status).toBe("confirmed");
    expect(second).toEqual({ status: "ignored_duplicate", caseId: "case-1", state: "delivered" });
    // Timeline dedupe: exactly one delivered entry.
    expect(store.cases[0].timeline).toHaveLength(1);
  });

  it("never downgrades a bounce to delivered on out-of-order events", async () => {
    const store = baseStore();
    const supabase = makeSupabase(store);
    await recordConsumerClosedNotificationDeliveryEvent(supabase, {
      messageId: "re_abc_123",
      eventType: "email.bounced",
    });
    const late = await recordConsumerClosedNotificationDeliveryEvent(supabase, {
      messageId: "re_abc_123",
      eventType: "email.delivered",
    });

    expect(late).toEqual({ status: "ignored_duplicate", caseId: "case-1", state: "bounced" });
    expect(parseConsumerClosedNotificationDeliveryState(store.tasks[0].notes)).toBe("bounced");
  });

  it("resolves by idempotency key when no message id is present", async () => {
    const store = baseStore();
    const result = await recordConsumerClosedNotificationDeliveryEvent(makeSupabase(store), {
      idempotencyKey: "consumer-closed-email:case-1",
      eventType: "email.delivered",
    });
    expect(result).toEqual({ status: "confirmed", caseId: "case-1", state: "delivered" });
  });

  it("returns an error when the marker lookup fails", async () => {
    const store: Store = { ...baseStore(), failTaskSelect: true };
    const result = await recordConsumerClosedNotificationDeliveryEvent(makeSupabase(store), {
      messageId: "re_abc_123",
      eventType: "email.delivered",
    });
    expect(result).toEqual({ status: "error", reason: "marker_lookup_failed" });
  });
});

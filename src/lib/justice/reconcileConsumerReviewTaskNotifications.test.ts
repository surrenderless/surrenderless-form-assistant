import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { EmailSendRequest, EmailSendResult } from "@/lib/email/emailProvider";
import { MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF } from "@/lib/justice/handlingTrackingProgress";
import { parseKeysetOrFilter } from "@/lib/justice/reconcilerKeysetPaginationTestSupport";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";
import type { JusticeIntake } from "@/lib/justice/types";

const mockSend = vi.fn<(req: EmailSendRequest) => Promise<EmailSendResult>>();
const mockAppendCaseTimelineEntry = vi.fn(async () => null);

vi.mock("@/lib/email/resolveMerchantOutreachEmailProvider", () => ({
  resolveMerchantOutreachEmailProvider: () => ({
    ok: true,
    provider: { name: "mock", send: (req: EmailSendRequest) => mockSend(req) },
    from: "reviews@surrenderless.test",
  }),
}));

vi.mock("@/server/justiceTimelineAppend", () => ({
  appendCaseTimelineEntry: (...args: unknown[]) =>
    (mockAppendCaseTimelineEntry as unknown as (...a: unknown[]) => unknown)(...args),
}));

import {
  consumerReviewNotifiedTaskNotesMarker,
  reconcileConsumerReviewTaskNotifications,
} from "@/lib/justice/reconcileConsumerReviewTaskNotifications";

const CASE_ID = "case-1";
const USER_ID = "owner-1";

type CaseRow = { id: string; user_id: string; intake: unknown };

type Store = {
  cases: CaseRow[];
  tasks: JusticeCaseTaskRow[];
  failTasksList?: boolean;
  failMarkerSelect?: boolean;
  failCaseLookup?: boolean;
  failInsert?: boolean;
  insertCount: number;
};

function makeSupabase(store: Store): SupabaseClient {
  const from = (table: string) => {
    const builder: Record<string, unknown> = {};
    const state = {
      table,
      op: "select" as "select" | "insert",
      insert: null as Record<string, unknown> | null,
      eqFilters: {} as Record<string, string>,
      isCalled: false,
      like: null as string | null,
      cursor: null as { updatedAt: string; id: string } | null,
    };

    const resolvePaginatedTaskSelect = (limit: number) => {
      if (store.failTasksList) return { data: null, error: { message: "list down" } };
      const prefix = (state.like ?? "").replace(/%$/, "");
      let rows = store.tasks.filter(
        (t) => !t.completed_at?.trim() && (t.notes ?? "").startsWith(prefix)
      );
      if (state.cursor) {
        const cursor = state.cursor;
        rows = rows.filter(
          (t) =>
            t.updated_at > cursor.updatedAt ||
            (t.updated_at === cursor.updatedAt && t.id > cursor.id)
        );
      }
      rows.sort((a, b) => {
        if (a.updated_at !== b.updated_at) return a.updated_at < b.updated_at ? -1 : 1;
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      });
      return { data: rows.slice(0, limit), error: null };
    };

    const resolveMarkerCheckSelect = (limit: number) => {
      if (store.failMarkerSelect) return { data: null, error: { message: "marker select down" } };
      const prefix = (state.like ?? "").replace(/%$/, "");
      const matches = store.tasks.filter(
        (t) =>
          t.case_id === state.eqFilters.case_id &&
          t.user_id === state.eqFilters.user_id &&
          (t.notes ?? "").startsWith(prefix)
      );
      return { data: matches.slice(0, limit), error: null };
    };

    const resolveCaseMaybeSingle = () => {
      if (store.failCaseLookup) return { data: null, error: { message: "case lookup down" } };
      const c = store.cases.find(
        (c) => c.id === state.eqFilters.id && c.user_id === state.eqFilters.user_id
      );
      return { data: c ? { id: c.id, user_id: c.user_id, intake: c.intake } : null, error: null };
    };

    const resolveInsertSingle = () => {
      if (store.failInsert) return { data: null, error: { message: "insert down" } };
      const payload = state.insert as Record<string, unknown>;
      const task: JusticeCaseTaskRow = {
        id: `marker-${++store.insertCount}`,
        user_id: String(payload.user_id),
        case_id: String(payload.case_id),
        title: String(payload.title),
        due_date: null,
        notes: String(payload.notes),
        completed_at: (payload.completed_at as string) ?? null,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      };
      store.tasks.push(task);
      return { data: task, error: null };
    };

    Object.assign(builder, {
      select: () => builder,
      insert: (payload: Record<string, unknown>) => {
        state.op = "insert";
        state.insert = payload;
        return builder;
      },
      eq: (col: string, val: string) => {
        state.eqFilters[col] = val;
        return builder;
      },
      is: () => {
        state.isCalled = true;
        return builder;
      },
      like: (_col: string, pattern: string) => {
        state.like = pattern;
        return builder;
      },
      or: (filter: string) => {
        state.cursor = parseKeysetOrFilter(filter);
        return builder;
      },
      order: () => builder,
      limit: async (n: number) => {
        if (state.table === "justice_case_tasks" && state.isCalled) {
          return resolvePaginatedTaskSelect(n);
        }
        if (state.table === "justice_case_tasks") return resolveMarkerCheckSelect(n);
        throw new Error(`unexpected .limit() on table ${state.table}`);
      },
      maybeSingle: async () => {
        if (state.table === "justice_cases") return resolveCaseMaybeSingle();
        throw new Error(`unexpected .maybeSingle() on table ${state.table}`);
      },
      single: async () => resolveInsertSingle(),
    });
    return builder;
  };
  return { from } as unknown as SupabaseClient;
}

function intake(overrides: Partial<JusticeIntake> = {}): JusticeIntake {
  return {
    problem_category: "online_purchase",
    company_website: "https://acme.example",
    company_name: "Acme",
    purchase_or_signup: "purchase",
    story: "It broke",
    money_involved: "50",
    pay_or_order_date: "2026-01-01",
    order_confirmation_details: "order 1",
    user_display_name: "Jordan",
    reply_email: "consumer@example.com",
    already_contacted: "yes",
    ...overrides,
  } as JusticeIntake;
}

function caseRow(id: string, userId: string, intakeOverrides: Partial<JusticeIntake> = {}): CaseRow {
  return { id, user_id: userId, intake: intake(intakeOverrides) };
}

function followUpResponseReviewTaskRow(params: {
  id: string;
  caseId?: string;
  userId?: string;
  completedAt?: string | null;
  updatedAt?: string;
}): JusticeCaseTaskRow {
  const caseId = params.caseId ?? CASE_ID;
  return {
    id: params.id,
    user_id: params.userId ?? USER_ID,
    case_id: caseId,
    title: "Follow-up response review: Acme",
    due_date: null,
    notes: `follow_up_response_review:${caseId}\ncase_id: ${caseId}\ndraft:\nReview merchant reply`,
    completed_at: params.completedAt ?? null,
    created_at: params.updatedAt ?? "2026-07-01T00:00:00.000Z",
    updated_at: params.updatedAt ?? "2026-07-01T00:00:00.000Z",
  };
}

function supersededLaneReviewTaskRow(params: {
  id: string;
  caseId?: string;
  userId?: string;
  ownerHref?: string;
  completedAt?: string | null;
  updatedAt?: string;
}): JusticeCaseTaskRow {
  const caseId = params.caseId ?? CASE_ID;
  const ownerHref = params.ownerHref ?? MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF;
  return {
    id: params.id,
    user_id: params.userId ?? USER_ID,
    case_id: caseId,
    title: "Follow-up response review: Small claims / demand letter",
    due_date: null,
    notes: [
      `superseded_lane_review:${caseId}`,
      `owner_href:${ownerHref}`,
      `follow_up_task_id:linked-follow-up`,
      `case_id: ${caseId}`,
      "guidance:",
      "Small claims / demand letter's own follow-up date passed with no recorded decision.",
    ].join("\n"),
    completed_at: params.completedAt ?? null,
    created_at: params.updatedAt ?? "2026-07-01T00:00:00.000Z",
    updated_at: params.updatedAt ?? "2026-07-01T00:00:00.000Z",
  };
}

beforeEach(() => {
  mockSend.mockReset();
  mockSend.mockResolvedValue({ ok: true, messageId: "msg-1" });
  mockAppendCaseTimelineEntry.mockClear();
});

describe("reconcileConsumerReviewTaskNotifications", () => {
  it("sends exactly one notification for an eligible open follow_up_response_review task", async () => {
    const store: Store = {
      cases: [caseRow(CASE_ID, USER_ID)],
      tasks: [followUpResponseReviewTaskRow({ id: "task-frr" })],
      insertCount: 0,
    };

    const summary = await reconcileConsumerReviewTaskNotifications(makeSupabase(store));

    expect(summary).toMatchObject({ attempted: 1, sent: 1, skipped: 0, failed: 0 });
    expect(mockSend).toHaveBeenCalledTimes(1);
    const req = mockSend.mock.calls[0][0];
    expect(req.to).toBe("consumer@example.com");
    // Never claims a response arrived — asks for status/decision instead. (Note: the body
    // legitimately asks "whether ... ever received a response," which is a question, not a
    // claim — so this checks for the absence of an affirmative claim, not the word "received".)
    expect(req.text).not.toMatch(/we('ve| have)? received (a|your) response|response (has arrived|was received)/i);
    expect(req.text).toContain("No response has been confirmed yet");
    expect(req.text).toMatch(/confirm|status|decision/i);
    expect(req.text).toContain("/justice/chat-ai");
    // Deep-links to the EXACT case + source review task, not just the bare chat path — this is
    // what lets a fresh-tab visit (no sessionStorage) or a different active case still resolve to
    // precisely this review (see resolveReviewTaskDeepLinkAction).
    expect(req.text).toContain(`case=${CASE_ID}`);
    expect(req.text).toContain(`task=task-frr`);
    expect(
      store.tasks.filter((t) => (t.notes ?? "").includes("consumer_review_notified:"))
    ).toHaveLength(1);
  });

  it("sends exactly one notification for an eligible open superseded_lane_review task, naming the specific lane", async () => {
    const store: Store = {
      cases: [caseRow(CASE_ID, USER_ID)],
      tasks: [supersededLaneReviewTaskRow({ id: "task-slr" })],
      insertCount: 0,
    };

    const summary = await reconcileConsumerReviewTaskNotifications(makeSupabase(store));

    expect(summary).toMatchObject({ attempted: 1, sent: 1, skipped: 0, failed: 0 });
    const req = mockSend.mock.calls[0][0];
    expect(req.subject).toContain("Small claims / demand letter");
    expect(req.text).toContain("Small claims / demand letter");
    expect(req.text).not.toMatch(/we('ve| have)? received (a|your) response|response (has arrived|was received)/i);
    expect(req.text).toContain("No response has been confirmed yet");
    expect(req.text).toContain(`case=${CASE_ID}`);
    expect(req.text).toContain(`task=task-slr`);
  });

  it("processes BOTH task types in a single run, independently", async () => {
    const store: Store = {
      cases: [caseRow("case-a", "owner-a"), caseRow("case-b", "owner-b")],
      tasks: [
        followUpResponseReviewTaskRow({ id: "task-a", caseId: "case-a", userId: "owner-a" }),
        supersededLaneReviewTaskRow({ id: "task-b", caseId: "case-b", userId: "owner-b" }),
      ],
      insertCount: 0,
    };

    const summary = await reconcileConsumerReviewTaskNotifications(makeSupabase(store));

    expect(summary).toMatchObject({ attempted: 2, sent: 2, skipped: 0, failed: 0 });
    const types = summary.results.map((r) => r.source_type).sort();
    expect(types).toEqual(["follow_up_response_review", "superseded_lane_review"]);
  });

  it("uses a per-task idempotency key, distinct per source task id", async () => {
    const store: Store = {
      cases: [caseRow(CASE_ID, USER_ID)],
      tasks: [
        followUpResponseReviewTaskRow({ id: "task-1", updatedAt: "2026-07-01T00:00:00.000Z" }),
        supersededLaneReviewTaskRow({ id: "task-2", updatedAt: "2026-07-02T00:00:00.000Z" }),
      ],
      insertCount: 0,
    };

    await reconcileConsumerReviewTaskNotifications(makeSupabase(store));

    const keys = mockSend.mock.calls.map((c) => c[0].idempotencyKey);
    expect(new Set(keys).size).toBe(2);
    expect(keys).toContain("consumer-review-email:task-1");
    expect(keys).toContain("consumer-review-email:task-2");
  });

  it("skips a task that already has the notified marker (duplicate prevention)", async () => {
    const sourceTask = followUpResponseReviewTaskRow({ id: "task-1" });
    const store: Store = {
      cases: [caseRow(CASE_ID, USER_ID)],
      tasks: [
        sourceTask,
        {
          id: "existing-marker",
          user_id: USER_ID,
          case_id: CASE_ID,
          title: "Consumer review-needed notification sent",
          due_date: null,
          notes: `${consumerReviewNotifiedTaskNotesMarker("task-1")}\nrecipient: consumer@example.com`,
          completed_at: "2026-07-01T01:00:00.000Z",
          created_at: "2026-07-01T01:00:00.000Z",
          updated_at: "2026-07-01T01:00:00.000Z",
        },
      ],
      insertCount: 0,
    };

    const summary = await reconcileConsumerReviewTaskNotifications(makeSupabase(store));

    expect(summary).toMatchObject({ attempted: 1, sent: 0, skipped: 1, failed: 0 });
    expect(summary.results[0]).toMatchObject({ kind: "skipped", reason: "already_notified" });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("does not send duplicates on rerun", async () => {
    const store: Store = {
      cases: [caseRow(CASE_ID, USER_ID)],
      tasks: [followUpResponseReviewTaskRow({ id: "task-1" })],
      insertCount: 0,
    };
    const supabase = makeSupabase(store);

    const first = await reconcileConsumerReviewTaskNotifications(supabase);
    expect(first).toMatchObject({ attempted: 1, sent: 1, skipped: 0, failed: 0 });

    const second = await reconcileConsumerReviewTaskNotifications(supabase);
    expect(second).toMatchObject({ attempted: 1, sent: 0, skipped: 1, failed: 0 });
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(
      store.tasks.filter((t) => (t.notes ?? "").includes("consumer_review_notified:"))
    ).toHaveLength(1);
  });

  it("skips an already-completed review task instead of notifying about it (completed-task skipping)", async () => {
    const store: Store = {
      cases: [caseRow(CASE_ID, USER_ID)],
      tasks: [
        followUpResponseReviewTaskRow({ id: "task-open" }),
        followUpResponseReviewTaskRow({ id: "task-done", completedAt: "2026-06-01T00:00:00.000Z" }),
      ],
      insertCount: 0,
    };

    const summary = await reconcileConsumerReviewTaskNotifications(makeSupabase(store));

    // Only the open task is ever attempted — the completed one is excluded at the query level
    // (`.is("completed_at", null)`), confirmed here by never appearing as sent/attempted.
    expect(summary.attempted).toBe(1);
    expect(summary.sent).toBe(1);
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(summary.results.some((r) => r.task_id === "task-done")).toBe(false);
  });

  it("leaves the task open and retries on a provider send failure (delivery retry)", async () => {
    const store: Store = {
      cases: [caseRow(CASE_ID, USER_ID)],
      tasks: [followUpResponseReviewTaskRow({ id: "task-1" })],
      insertCount: 0,
    };
    mockSend.mockResolvedValueOnce({ ok: false, error: "provider rejected", retryable: true });
    const supabase = makeSupabase(store);

    const first = await reconcileConsumerReviewTaskNotifications(supabase);
    expect(first).toMatchObject({ attempted: 1, sent: 0, failed: 1 });
    expect(
      store.tasks.filter((t) => (t.notes ?? "").includes("consumer_review_notified:"))
    ).toHaveLength(0);

    // Retry: the same task is attempted again (no marker was written) and now succeeds.
    mockSend.mockResolvedValueOnce({ ok: true, messageId: "msg-retry" });
    const second = await reconcileConsumerReviewTaskNotifications(supabase);
    expect(second).toMatchObject({ attempted: 1, sent: 1, failed: 0 });
    expect(
      store.tasks.filter((t) => (t.notes ?? "").includes("consumer_review_notified:"))
    ).toHaveLength(1);
  });

  it("writes the marker only after an accepted delivery", async () => {
    const store: Store = {
      cases: [caseRow("case-fail", "owner-fail"), caseRow("case-ok", "owner-ok")],
      tasks: [
        followUpResponseReviewTaskRow({ id: "task-fail", caseId: "case-fail", userId: "owner-fail" }),
        followUpResponseReviewTaskRow({ id: "task-ok", caseId: "case-ok", userId: "owner-ok" }),
      ],
      insertCount: 0,
    };
    mockSend.mockImplementation(async (req: EmailSendRequest) =>
      req.idempotencyKey.includes("task-fail")
        ? { ok: false, error: "provider rejected" }
        : { ok: true, messageId: "msg-ok" }
    );

    await reconcileConsumerReviewTaskNotifications(makeSupabase(store));

    const markers = store.tasks.filter((t) => (t.notes ?? "").includes("consumer_review_notified:"));
    expect(markers).toHaveLength(1);
    expect(markers[0].case_id).toBe("case-ok");
    expect(store.tasks.some((t) => t.case_id === "case-fail" && t.id !== "task-fail")).toBe(false);
  });

  it("writes a durable manual-follow-up marker and skips forever when the recipient email is unresolvable (missing email)", async () => {
    const store: Store = {
      cases: [caseRow(CASE_ID, USER_ID, { reply_email: "not-an-email" })],
      tasks: [followUpResponseReviewTaskRow({ id: "task-1" })],
      insertCount: 0,
    };
    const supabase = makeSupabase(store);

    const first = await reconcileConsumerReviewTaskNotifications(supabase);

    expect(first).toMatchObject({ attempted: 1, sent: 0, skipped: 0, failed: 1 });
    expect(mockSend).not.toHaveBeenCalled();
    const marker = store.tasks.find((t) => t.id !== "task-1");
    expect(marker).toBeDefined();
    expect(marker?.notes).toContain("consumer_review_notified:task-1");
    expect(marker?.notes).toContain("delivery_state: unresolvable");
    expect(marker?.notes).toContain("manual_fallback_required: true");
    expect(mockAppendCaseTimelineEntry).toHaveBeenCalledWith(
      expect.anything(),
      USER_ID,
      CASE_ID,
      expect.objectContaining({ label: expect.stringContaining("undeliverable") })
    );

    // Second run recognizes the marker and never re-fails or re-notifies forever.
    const second = await reconcileConsumerReviewTaskNotifications(supabase);
    expect(second).toMatchObject({ attempted: 1, sent: 0, skipped: 1, failed: 0 });
    expect(second.results[0]).toMatchObject({ kind: "skipped", reason: "already_notified" });
    expect(store.tasks.filter((t) => t.id !== "task-1")).toHaveLength(1);
  });

  it("continues the batch when one task fails, and keeps case/user isolation across tasks", async () => {
    const store: Store = {
      cases: [
        caseRow("case-a", "owner-a", { reply_email: "not-an-email" }),
        caseRow("case-b", "owner-b"),
      ],
      tasks: [
        followUpResponseReviewTaskRow({ id: "task-a", caseId: "case-a", userId: "owner-a" }),
        followUpResponseReviewTaskRow({ id: "task-b", caseId: "case-b", userId: "owner-b" }),
      ],
      insertCount: 0,
    };

    const summary = await reconcileConsumerReviewTaskNotifications(makeSupabase(store));

    expect(summary).toMatchObject({ attempted: 2, sent: 1, failed: 1 });
    expect(summary.results.find((r) => r.case_id === "case-b")?.kind).toBe("sent");
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend.mock.calls[0][0].to).toBe("consumer@example.com");
  });

  it("reaches and processes an eligible task beyond the first page (pagination)", async () => {
    const baseMs = Date.parse("2026-07-01T12:00:00.000Z");
    const alreadyNotified: JusticeCaseTaskRow[] = Array.from({ length: 4 }, (_, i) => ({
      ...followUpResponseReviewTaskRow({
        id: `task-page-${i}`,
        updatedAt: new Date(baseMs + i * 1000).toISOString(),
      }),
    }));
    const target = followUpResponseReviewTaskRow({
      id: "task-page-4",
      updatedAt: new Date(baseMs + 4 * 1000).toISOString(),
    });
    const store: Store = {
      cases: [caseRow(CASE_ID, USER_ID)],
      tasks: [
        ...alreadyNotified,
        ...alreadyNotified.map((t) => ({
          id: `existing-marker-${t.id}`,
          user_id: t.user_id,
          case_id: t.case_id,
          title: "Consumer review-needed notification sent",
          due_date: null,
          notes: `${consumerReviewNotifiedTaskNotesMarker(t.id)}\nrecipient: consumer@example.com`,
          completed_at: "2026-07-01T12:00:05.000Z",
          created_at: "2026-07-01T12:00:05.000Z",
          updated_at: "2026-07-01T12:00:05.000Z",
        })),
        target,
      ],
      insertCount: 0,
    };

    const summary = await reconcileConsumerReviewTaskNotifications(makeSupabase(store), {
      limit: 2,
    });

    expect(summary.attempted).toBe(5);
    expect(summary.skipped).toBe(4);
    expect(summary.sent).toBe(1);
    expect(summary.results.find((r) => r.task_id === "task-page-4")?.kind).toBe("sent");
  });
});

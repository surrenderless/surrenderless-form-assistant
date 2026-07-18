import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  OPERATOR_NO_RESOLUTION_OUTCOME_MARKER,
  OPERATOR_RESOLVED_OUTCOME_MARKER,
} from "@/lib/justice/completeFollowUpResponseReview";
import type { EmailSendRequest, EmailSendResult } from "@/lib/email/emailProvider";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";
import type { JusticeIntake } from "@/lib/justice/types";

const mockSend = vi.fn<(req: EmailSendRequest) => Promise<EmailSendResult>>();

vi.mock("@/lib/email/resolveMerchantOutreachEmailProvider", () => ({
  resolveMerchantOutreachEmailProvider: () => ({
    ok: true,
    provider: { name: "mock", send: (req: EmailSendRequest) => mockSend(req) },
    from: "closures@surrenderless.test",
  }),
}));

import {
  consumerClosedNotificationTaskNotesMarker,
  reconcileClosedCaseConsumerNotifications,
} from "@/lib/justice/reconcileClosedCaseConsumerNotifications";

type CaseRow = {
  id: string;
  user_id: string;
  intake: unknown;
  client_state: unknown;
  archived_at: string | null;
};

type Store = {
  cases: CaseRow[];
  tasks: JusticeCaseTaskRow[];
  failCasesList?: boolean;
  failMarkerSelect?: boolean;
  failInsert?: boolean;
  insertCount: number;
};

function makeSupabase(store: Store): SupabaseClient {
  const from = (table: string) => {
    const builder: Record<string, unknown> = {};
    const state = { table, op: "select", insert: null as Record<string, unknown> | null, filters: {} as Record<string, string>, like: null as string | null };

    const resolveSelect = () => {
      if (state.table === "justice_cases") {
        if (store.failCasesList) return { data: null, error: { message: "list down" } };
        return { data: store.cases, error: null };
      }
      if (store.failMarkerSelect) return { data: null, error: { message: "marker select down" } };
      const marker = (state.like ?? "").replace(/%$/, "");
      const matches = store.tasks.filter(
        (t) =>
          t.case_id === state.filters.case_id &&
          t.user_id === state.filters.user_id &&
          (t.notes ?? "").startsWith(marker)
      );
      return { data: matches.slice(0, 1), error: null };
    };

    const resolveTerminal = () => {
      if (state.op === "insert" && state.table === "justice_case_tasks") {
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
      }
      return { data: null, error: { message: "unexpected terminal" } };
    };

    Object.assign(builder, {
      select: () => builder,
      insert: (payload: Record<string, unknown>) => {
        state.op = "insert";
        state.insert = payload;
        return builder;
      },
      eq: (col: string, val: string) => {
        state.filters[col] = val;
        return builder;
      },
      like: (_col: string, pattern: string) => {
        state.like = pattern;
        return builder;
      },
      not: () => builder,
      order: () => builder,
      limit: async () => resolveSelect(),
      single: async () => resolveTerminal(),
      maybeSingle: async () => resolveTerminal(),
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

function terminalClientState(marker: string): Record<string, unknown> {
  return {
    prepared_packet_approved: true,
    approved_next_action: {
      label: "Small claims / demand letter",
      href: "/justice/demand-letter",
      status: "completed",
      completed_at: "2026-06-01T00:00:00.000Z",
      follow_up_needed: false,
      outcome_note: `${marker}. Details.`,
    },
  };
}

function closedCase(
  id: string,
  marker: string,
  intakeOverrides: Partial<JusticeIntake> = {}
): CaseRow {
  return {
    id,
    user_id: `owner-${id}`,
    intake: intake(intakeOverrides),
    client_state: terminalClientState(marker),
    archived_at: "2026-07-17T15:00:00.000Z",
  };
}

beforeEach(() => {
  mockSend.mockReset();
  mockSend.mockResolvedValue({ ok: true, messageId: "msg-1" });
});

describe("reconcileClosedCaseConsumerNotifications", () => {
  it("sends exactly one notification for an eligible unnotified closed case (both outcomes)", async () => {
    const store: Store = {
      cases: [
        closedCase("case-resolved", OPERATOR_RESOLVED_OUTCOME_MARKER),
        closedCase("case-no-res", OPERATOR_NO_RESOLUTION_OUTCOME_MARKER),
      ],
      tasks: [],
      insertCount: 0,
    };

    const summary = await reconcileClosedCaseConsumerNotifications(makeSupabase(store));

    expect(summary).toMatchObject({ attempted: 2, sent: 2, skipped: 0, failed: 0 });
    expect(mockSend).toHaveBeenCalledTimes(2);
    // Provider idempotency key present and per-case.
    const keys = mockSend.mock.calls.map((c) => c[0].idempotencyKey);
    expect(new Set(keys).size).toBe(2);
    // Marker written for each notified case.
    expect(store.tasks.filter((t) => (t.notes ?? "").includes("consumer_closed_notified:"))).toHaveLength(
      2
    );
  });

  it("skips a case that already has the notified marker", async () => {
    const store: Store = {
      cases: [closedCase("case-1", OPERATOR_RESOLVED_OUTCOME_MARKER)],
      tasks: [
        {
          id: "existing-marker",
          user_id: "owner-case-1",
          case_id: "case-1",
          title: "Consumer closed-case notification sent",
          due_date: null,
          notes: `${consumerClosedNotificationTaskNotesMarker("case-1")}\nrecipient: consumer@example.com`,
          completed_at: "2026-07-17T15:30:00.000Z",
          created_at: "2026-07-17T15:30:00.000Z",
          updated_at: "2026-07-17T15:30:00.000Z",
        },
      ],
      insertCount: 0,
    };

    const summary = await reconcileClosedCaseConsumerNotifications(makeSupabase(store));

    expect(summary).toMatchObject({ attempted: 1, sent: 0, skipped: 1, failed: 0 });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("does not send duplicates on rerun", async () => {
    const store: Store = {
      cases: [closedCase("case-1", OPERATOR_RESOLVED_OUTCOME_MARKER)],
      tasks: [],
      insertCount: 0,
    };
    const supabase = makeSupabase(store);

    const first = await reconcileClosedCaseConsumerNotifications(supabase);
    expect(first).toMatchObject({ attempted: 1, sent: 1, skipped: 0, failed: 0 });

    const second = await reconcileClosedCaseConsumerNotifications(supabase);
    expect(second).toMatchObject({ attempted: 1, sent: 0, skipped: 1, failed: 0 });
    // Only the first run actually sent.
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(store.tasks.filter((t) => (t.notes ?? "").includes("consumer_closed_notified:"))).toHaveLength(
      1
    );
  });

  it("continues the batch when a recipient is unresolved or a send fails", async () => {
    const store: Store = {
      cases: [
        closedCase("case-badrecipient", OPERATOR_RESOLVED_OUTCOME_MARKER, { reply_email: "not-an-email" }),
        closedCase("case-sendfail", OPERATOR_NO_RESOLUTION_OUTCOME_MARKER, {
          reply_email: "fail@example.com",
        }),
        closedCase("case-ok", OPERATOR_RESOLVED_OUTCOME_MARKER, { reply_email: "ok@example.com" }),
      ],
      tasks: [],
      insertCount: 0,
    };
    mockSend.mockImplementation(async (req: EmailSendRequest) =>
      req.to === "fail@example.com"
        ? { ok: false, error: "provider rejected", retryable: true }
        : { ok: true, messageId: "msg-ok" }
    );

    const summary = await reconcileClosedCaseConsumerNotifications(makeSupabase(store));

    expect(summary).toMatchObject({ attempted: 3, sent: 1, failed: 2 });
    // The later eligible case still sends despite earlier failures.
    expect(summary.results.find((r) => r.case_id === "case-ok")?.kind).toBe("sent");
    // No provider send attempted for the unresolved-recipient case.
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it("writes the marker only after an accepted delivery", async () => {
    const store: Store = {
      cases: [
        closedCase("case-sendfail", OPERATOR_RESOLVED_OUTCOME_MARKER, { reply_email: "fail@example.com" }),
        closedCase("case-ok", OPERATOR_RESOLVED_OUTCOME_MARKER, { reply_email: "ok@example.com" }),
      ],
      tasks: [],
      insertCount: 0,
    };
    mockSend.mockImplementation(async (req: EmailSendRequest) =>
      req.to === "fail@example.com"
        ? { ok: false, error: "provider rejected" }
        : { ok: true, messageId: "msg-ok" }
    );

    await reconcileClosedCaseConsumerNotifications(makeSupabase(store));

    const markers = store.tasks.filter((t) => (t.notes ?? "").includes("consumer_closed_notified:"));
    expect(markers).toHaveLength(1);
    expect(markers[0].case_id).toBe("case-ok");
    // The failed-send case must not have a marker.
    expect(store.tasks.some((t) => t.case_id === "case-sendfail")).toBe(false);
  });

  it("ignores non-terminal or non-archived cases without attempting them", async () => {
    const store: Store = {
      cases: [
        // Archived but no operator terminal outcome → ignored.
        {
          id: "case-nonterminal",
          user_id: "owner-x",
          intake: intake(),
          client_state: {
            approved_next_action: {
              label: "Demand letter",
              href: "/justice/demand-letter",
              status: "completed",
              outcome_note: "Awaiting responses.",
            },
          },
          archived_at: "2026-07-17T15:00:00.000Z",
        },
        // Terminal outcome but not archived → ignored.
        {
          ...closedCase("case-open", OPERATOR_RESOLVED_OUTCOME_MARKER),
          archived_at: null,
        },
      ],
      tasks: [],
      insertCount: 0,
    };

    const summary = await reconcileClosedCaseConsumerNotifications(makeSupabase(store));

    expect(summary).toMatchObject({ attempted: 0, sent: 0, skipped: 0, failed: 0 });
    expect(mockSend).not.toHaveBeenCalled();
  });
});

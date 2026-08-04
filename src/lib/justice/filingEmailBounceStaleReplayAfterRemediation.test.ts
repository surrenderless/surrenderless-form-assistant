import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TimelineEntry } from "@/lib/justice/types";

import {
  demandLetterFilingTaskNotesMarker,
  taskNotesMatchDemandLetterFilingMarker,
} from "@/lib/justice/demandLetterFilingTask";
import {
  recordDemandLetterEmailBounceEvent,
  upsertDemandLetterEmailDeliveryNotes,
} from "@/lib/justice/demandLetterEmailDelivery";

import {
  paymentDisputeFilingTaskNotesMarker,
  taskNotesMatchPaymentDisputeFilingMarker,
} from "@/lib/justice/paymentDisputeFilingTask";
import {
  recordPaymentDisputeEmailBounceEvent,
  upsertPaymentDisputeEmailDeliveryNotes,
} from "@/lib/justice/paymentDisputeEmailDelivery";

import {
  merchantContactFilingTaskNotesMarker,
  taskNotesMatchMerchantContactFilingMarker,
} from "@/lib/justice/merchantContactFilingTask";
import {
  recordMerchantContactEmailBounceEvent,
  upsertMerchantContactEmailDeliveryNotes,
} from "@/lib/justice/merchantContactEmailDelivery";

import { buildFollowUpTaskNotes } from "@/lib/justice/followUpCaseTask";
import {
  MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF,
  MANUAL_ACTION_TRACKING_REAL_MERCHANT_PREP_HREF,
  MANUAL_ACTION_TRACKING_REAL_PAYMENT_DISPUTE_PREP_HREF,
} from "@/lib/justice/handlingTrackingProgress";

/**
 * A minimal, generic in-memory Supabase stand-in exercising the REAL query shapes issued by:
 *  - recordFilingEmailBounceEvent (messageId substring search + delivery-state update)
 *  - reopen<Lane>FilingTaskForBounce (marker prefix search, order-by-created_at desc, update)
 *  - completeFollowUpCaseTaskIfOwnedByAction (marker prefix search, is(completed_at, null),
 *    owner_href ownership check, update)
 *  - findLatest<Lane>FilingCreatedAt (plain case+user filing scan)
 *  - appendCaseTimelineEntry (justice_cases select/update)
 * No production function is mocked in this file — only Supabase itself is stubbed.
 */
type FilingRow = {
  id: string;
  user_id: string;
  case_id: string;
  destination: string;
  filed_at: string | null;
  confirmation_number: string | null;
  filing_url: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

type TaskRow = {
  id: string;
  user_id: string;
  case_id: string;
  title: string;
  due_date: string | null;
  notes: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

type CaseRow = { id: string; user_id: string; timeline: TimelineEntry[] };

type Store = {
  filings: FilingRow[];
  tasks: TaskRow[];
  cases: CaseRow[];
  /** When true, the plain case+user filings scan (findLatest<Lane>FilingCreatedAt) fails, without
   * affecting the separate messageId-substring lookup used by recordFilingEmailBounceEvent. */
  filingsSelectError?: boolean;
};

function likeMatches(notes: string | null, pattern: string): boolean {
  const text = notes ?? "";
  if (pattern.startsWith("%") && pattern.endsWith("%")) {
    return text.includes(pattern.slice(1, -1));
  }
  if (pattern.endsWith("%")) {
    return text.startsWith(pattern.slice(0, -1));
  }
  return text === pattern;
}

function makeStatefulSupabase(store: Store): SupabaseClient {
  function filingsFrom() {
    const state: {
      op: "select" | "update";
      filters: Record<string, string>;
      like: string | null;
      update: Record<string, unknown> | null;
    } = { op: "select", filters: {}, like: null, update: null };

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
        const matches = store.filings.filter((f) => (state.like ? likeMatches(f.notes, state.like) : true));
        return Promise.resolve({ data: matches, error: null });
      },
      then(onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) {
        if (state.op === "update") {
          const row = store.filings.find((f) => f.id === state.filters.id);
          if (row) Object.assign(row, state.update);
          return Promise.resolve({ data: null, error: null }).then(onF, onR);
        }
        if (store.filingsSelectError) {
          return Promise.resolve({ data: null, error: { message: "filings lookup down" } }).then(onF, onR);
        }
        const matches = store.filings.filter(
          (f) => f.user_id === state.filters.user_id && f.case_id === state.filters.case_id
        );
        return Promise.resolve({ data: matches, error: null }).then(onF, onR);
      },
    };
    return builder;
  }

  function tasksFrom() {
    const state: {
      op: "select" | "update";
      filters: Record<string, string>;
      like: string | null;
      isNullCompletedAt: boolean;
      orderByCreatedAtDesc: boolean;
      update: Record<string, unknown> | null;
    } = {
      op: "select",
      filters: {},
      like: null,
      isNullCompletedAt: false,
      orderByCreatedAtDesc: false,
      update: null,
    };

    const applyFilters = (): TaskRow[] => {
      let rows = store.tasks;
      if (state.filters.user_id) rows = rows.filter((t) => t.user_id === state.filters.user_id);
      if (state.filters.case_id) rows = rows.filter((t) => t.case_id === state.filters.case_id);
      if (state.filters.id) rows = rows.filter((t) => t.id === state.filters.id);
      if (state.like) rows = rows.filter((t) => likeMatches(t.notes, state.like as string));
      if (state.isNullCompletedAt) rows = rows.filter((t) => !t.completed_at?.trim());
      if (state.orderByCreatedAtDesc) {
        rows = [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at));
      }
      return rows;
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
      is(_col: string, _val: null) {
        state.isNullCompletedAt = true;
        return builder;
      },
      order() {
        state.orderByCreatedAtDesc = true;
        return builder;
      },
      limit(n: number) {
        return Promise.resolve({ data: applyFilters().slice(0, n), error: null });
      },
      maybeSingle() {
        if (state.op === "update") {
          const row = store.tasks.find((t) => t.id === state.filters.id);
          if (row) Object.assign(row, state.update);
          return Promise.resolve({ data: row ?? null, error: null });
        }
        const rows = applyFilters();
        return Promise.resolve({ data: rows[0] ?? null, error: null });
      },
    };
    return builder;
  }

  function casesFrom() {
    const state: { op: "select" | "update"; filters: Record<string, string>; update: Record<string, unknown> | null } =
      { op: "select", filters: {}, update: null };
    const builder: Record<string, unknown> = {
      select() {
        return builder;
      },
      eq(col: string, val: string) {
        state.filters[col] = val;
        return builder;
      },
      maybeSingle() {
        const row = store.cases.find((c) => c.id === state.filters.id && c.user_id === state.filters.user_id);
        return Promise.resolve({ data: row ? { timeline: row.timeline } : null, error: null });
      },
      update(payload: Record<string, unknown>) {
        state.op = "update";
        state.update = payload;
        return builder;
      },
      then(onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) {
        if (state.op === "update") {
          const row = store.cases.find((c) => c.id === state.filters.id && c.user_id === state.filters.user_id);
          if (row) row.timeline = (state.update as Record<string, unknown>).timeline as TimelineEntry[];
        }
        return Promise.resolve({ data: null, error: null }).then(onF, onR);
      },
    };
    return builder;
  }

  return {
    from(table: string) {
      if (table === "justice_case_filings") return filingsFrom();
      if (table === "justice_case_tasks") return tasksFrom();
      if (table === "justice_cases") return casesFrom();
      throw new Error(`unexpected table ${table}`);
    },
  } as unknown as SupabaseClient;
}

const USER_ID = "user-owner-1";
const CASE_ID = "case-1";

describe("stale bounce replay after successful remediation — real helpers, no mocks", () => {
  it("demand letter: the task stays completed and the fresh follow-up stays open when the old bounce replays", async () => {
    const marker = demandLetterFilingTaskNotesMarker(CASE_ID);
    const followUpNotes = buildFollowUpTaskNotes(CASE_ID, {
      href: MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF,
    });

    const filingA: FilingRow = {
      id: "fil-A",
      user_id: USER_ID,
      case_id: CASE_ID,
      destination: "Small claims / demand letter",
      filed_at: "2026-06-01",
      confirmation_number: "re_msg_1",
      filing_url: null,
      notes: upsertDemandLetterEmailDeliveryNotes(null, {
        delivery_state: "accepted",
        provider: "resend",
        recipient: "support@acme.example",
        provider_message_id: "re_msg_1",
      }),
      created_at: "2026-06-01T00:00:00.000Z",
      updated_at: "2026-06-01T00:00:00.000Z",
    };
    const taskT: TaskRow = {
      id: "task-T",
      user_id: USER_ID,
      case_id: CASE_ID,
      title: "Demand letter: Acme Retail",
      due_date: null,
      notes: `${marker}\ncase_id: ${CASE_ID}\ndraft:\nLetter`,
      completed_at: "2026-06-01T00:05:00.000Z",
      created_at: "2026-06-01T00:00:00.000Z",
      updated_at: "2026-06-01T00:05:00.000Z",
    };
    const followUpF1: TaskRow = {
      id: "followup-F1",
      user_id: USER_ID,
      case_id: CASE_ID,
      title: "Surrenderless follow-up: Small claims / demand letter",
      due_date: null,
      notes: followUpNotes,
      completed_at: null,
      created_at: "2026-06-01T00:05:00.000Z",
      updated_at: "2026-06-01T00:05:00.000Z",
    };
    const store: Store = {
      filings: [filingA],
      tasks: [taskT, followUpF1],
      cases: [{ id: CASE_ID, user_id: USER_ID, timeline: [] }],
    };
    const supabase = makeStatefulSupabase(store);

    // 1. Original bounce: reopens the task, stops the (only) open follow-up.
    const original = await recordDemandLetterEmailBounceEvent(supabase, {
      messageId: "re_msg_1",
      eventType: "email.bounced",
    });
    expect(original).toEqual({ status: "recorded", caseId: CASE_ID, state: "bounced" });
    expect(taskT.completed_at).toBeNull();
    expect(taskT.title).toBe("[Needs manual follow-up — bounced] Demand letter: Acme Retail");
    expect(followUpF1.completed_at).not.toBeNull();

    // Harmless immediate replay, before any remediation: still recorded, still idempotent.
    const harmlessBeforeRemediation = await recordDemandLetterEmailBounceEvent(supabase, {
      messageId: "re_msg_1",
      eventType: "email.bounced",
    });
    expect(harmlessBeforeRemediation).toEqual({ status: "recorded", caseId: CASE_ID, state: "bounced" });
    // bounce outcome + task reopened + follow-up completed — the replay adds no duplicates.
    expect(store.cases[0].timeline).toHaveLength(3);

    // 2. Simulate successful remediation: a fresh filing (later created_at), the task re-completed,
    // and a fresh open follow-up task — exactly what completeDemandLetterOperatorFiling produces
    // (already covered directly by completeDemandLetterOperatorFiling.test.ts's bounce-remediation
    // suite; reproduced here as end-state so this test can focus on the replay).
    const filingB: FilingRow = {
      id: "fil-B",
      user_id: USER_ID,
      case_id: CASE_ID,
      destination: "Small claims / demand letter",
      filed_at: "2026-06-21",
      confirmation_number: "DL-REMEDIATED-456",
      filing_url: null,
      notes: null,
      created_at: "2026-06-21T00:00:00.000Z",
      updated_at: "2026-06-21T00:00:00.000Z",
    };
    store.filings.push(filingB);
    taskT.completed_at = "2026-06-21T00:05:00.000Z";
    taskT.title = "Demand letter: Acme Retail";
    const followUpF2: TaskRow = {
      id: "followup-F2",
      user_id: USER_ID,
      case_id: CASE_ID,
      title: "Surrenderless follow-up: Small claims / demand letter",
      due_date: null,
      notes: followUpNotes,
      completed_at: null,
      created_at: "2026-06-21T00:05:00.000Z",
      updated_at: "2026-06-21T00:05:00.000Z",
    };
    store.tasks.push(followUpF2);

    // 3. Resend replays the OLD bounce event for the superseded filing A.
    const staleReplay = await recordDemandLetterEmailBounceEvent(supabase, {
      messageId: "re_msg_1",
      eventType: "email.bounced",
    });

    expect(staleReplay).toEqual({ status: "recorded", caseId: CASE_ID, state: "bounced" });
    // The legitimately re-completed task must stay completed — not reopened.
    expect(taskT.completed_at).toBe("2026-06-21T00:05:00.000Z");
    expect(taskT.title).toBe("Demand letter: Acme Retail");
    // The fresh follow-up must stay open — not closed by the stale replay.
    expect(followUpF2.completed_at).toBeNull();
    // The old, superseded filing and its already-closed follow-up are untouched too.
    expect(filingA.notes).toContain("delivery_state: bounced");
    expect(followUpF1.completed_at).not.toBeNull();
    expect(taskNotesMatchDemandLetterFilingMarker(taskT.notes, CASE_ID)).toBe(true);
  });

  it("payment dispute: the task stays completed and the fresh follow-up stays open when the old bounce replays", async () => {
    const marker = paymentDisputeFilingTaskNotesMarker(CASE_ID);
    const followUpNotes = buildFollowUpTaskNotes(CASE_ID, {
      href: MANUAL_ACTION_TRACKING_REAL_PAYMENT_DISPUTE_PREP_HREF,
    });

    const filingA: FilingRow = {
      id: "fil-A",
      user_id: USER_ID,
      case_id: CASE_ID,
      destination: "Payment dispute (bank/card)",
      filed_at: "2026-06-01",
      confirmation_number: "re_pd_1",
      filing_url: null,
      notes: upsertPaymentDisputeEmailDeliveryNotes(null, {
        delivery_state: "accepted",
        provider: "resend",
        recipient: "disputes@issuer.example",
        provider_message_id: "re_pd_1",
      }),
      created_at: "2026-06-01T00:00:00.000Z",
      updated_at: "2026-06-01T00:00:00.000Z",
    };
    const taskT: TaskRow = {
      id: "task-T",
      user_id: USER_ID,
      case_id: CASE_ID,
      title: "Payment dispute: Acme Retail",
      due_date: null,
      notes: `${marker}\ncase_id: ${CASE_ID}\ndraft:\nDISPUTE`,
      completed_at: "2026-06-01T00:05:00.000Z",
      created_at: "2026-06-01T00:00:00.000Z",
      updated_at: "2026-06-01T00:05:00.000Z",
    };
    const followUpF1: TaskRow = {
      id: "followup-F1",
      user_id: USER_ID,
      case_id: CASE_ID,
      title: "Surrenderless follow-up: Payment dispute (bank/card)",
      due_date: null,
      notes: followUpNotes,
      completed_at: null,
      created_at: "2026-06-01T00:05:00.000Z",
      updated_at: "2026-06-01T00:05:00.000Z",
    };
    const store: Store = {
      filings: [filingA],
      tasks: [taskT, followUpF1],
      cases: [{ id: CASE_ID, user_id: USER_ID, timeline: [] }],
    };
    const supabase = makeStatefulSupabase(store);

    const original = await recordPaymentDisputeEmailBounceEvent(supabase, {
      messageId: "re_pd_1",
      eventType: "email.bounced",
    });
    expect(original).toEqual({ status: "recorded", caseId: CASE_ID, state: "bounced" });
    expect(taskT.completed_at).toBeNull();
    expect(followUpF1.completed_at).not.toBeNull();

    const filingB: FilingRow = {
      id: "fil-B",
      user_id: USER_ID,
      case_id: CASE_ID,
      destination: "Payment dispute (bank/card)",
      filed_at: "2026-06-21",
      confirmation_number: "PD-REMEDIATED-456",
      filing_url: null,
      notes: null,
      created_at: "2026-06-21T00:00:00.000Z",
      updated_at: "2026-06-21T00:00:00.000Z",
    };
    store.filings.push(filingB);
    taskT.completed_at = "2026-06-21T00:05:00.000Z";
    taskT.title = "Payment dispute: Acme Retail";
    const followUpF2: TaskRow = {
      id: "followup-F2",
      user_id: USER_ID,
      case_id: CASE_ID,
      title: "Surrenderless follow-up: Payment dispute (bank/card)",
      due_date: null,
      notes: followUpNotes,
      completed_at: null,
      created_at: "2026-06-21T00:05:00.000Z",
      updated_at: "2026-06-21T00:05:00.000Z",
    };
    store.tasks.push(followUpF2);

    const staleReplay = await recordPaymentDisputeEmailBounceEvent(supabase, {
      messageId: "re_pd_1",
      eventType: "email.bounced",
    });

    expect(staleReplay).toEqual({ status: "recorded", caseId: CASE_ID, state: "bounced" });
    expect(taskT.completed_at).toBe("2026-06-21T00:05:00.000Z");
    expect(followUpF2.completed_at).toBeNull();
    expect(followUpF1.completed_at).not.toBeNull();
    expect(taskNotesMatchPaymentDisputeFilingMarker(taskT.notes, CASE_ID)).toBe(true);
  });

  it("merchant contact: the task stays completed and the fresh follow-up stays open when the old bounce replays", async () => {
    const marker = merchantContactFilingTaskNotesMarker(CASE_ID);
    const followUpNotes = buildFollowUpTaskNotes(CASE_ID, {
      href: MANUAL_ACTION_TRACKING_REAL_MERCHANT_PREP_HREF,
    });

    const filingA: FilingRow = {
      id: "fil-A",
      user_id: USER_ID,
      case_id: CASE_ID,
      destination: "Merchant contact",
      filed_at: "2026-06-01",
      confirmation_number: "re_mc_1",
      filing_url: null,
      notes: upsertMerchantContactEmailDeliveryNotes(null, {
        delivery_state: "accepted",
        provider: "resend",
        recipient: "support@acme.example",
        provider_message_id: "re_mc_1",
      }),
      created_at: "2026-06-01T00:00:00.000Z",
      updated_at: "2026-06-01T00:00:00.000Z",
    };
    const taskT: TaskRow = {
      id: "task-T",
      user_id: USER_ID,
      case_id: CASE_ID,
      title: "Merchant contact: Acme Retail",
      due_date: null,
      notes: `${marker}\ncase_id: ${CASE_ID}\ndraft:\nHi`,
      completed_at: "2026-06-01T00:05:00.000Z",
      created_at: "2026-06-01T00:00:00.000Z",
      updated_at: "2026-06-01T00:05:00.000Z",
    };
    const followUpF1: TaskRow = {
      id: "followup-F1",
      user_id: USER_ID,
      case_id: CASE_ID,
      title: "Surrenderless follow-up: Merchant contact",
      due_date: null,
      notes: followUpNotes,
      completed_at: null,
      created_at: "2026-06-01T00:05:00.000Z",
      updated_at: "2026-06-01T00:05:00.000Z",
    };
    const store: Store = {
      filings: [filingA],
      tasks: [taskT, followUpF1],
      cases: [{ id: CASE_ID, user_id: USER_ID, timeline: [] }],
    };
    const supabase = makeStatefulSupabase(store);

    const original = await recordMerchantContactEmailBounceEvent(supabase, {
      messageId: "re_mc_1",
      eventType: "email.bounced",
    });
    expect(original).toEqual({ status: "recorded", caseId: CASE_ID, state: "bounced" });
    expect(taskT.completed_at).toBeNull();
    expect(followUpF1.completed_at).not.toBeNull();

    const filingB: FilingRow = {
      id: "fil-B",
      user_id: USER_ID,
      case_id: CASE_ID,
      destination: "Merchant contact",
      filed_at: "2026-06-21",
      confirmation_number: "MC-REMEDIATED-456",
      filing_url: null,
      notes: null,
      created_at: "2026-06-21T00:00:00.000Z",
      updated_at: "2026-06-21T00:00:00.000Z",
    };
    store.filings.push(filingB);
    taskT.completed_at = "2026-06-21T00:05:00.000Z";
    taskT.title = "Merchant contact: Acme Retail";
    const followUpF2: TaskRow = {
      id: "followup-F2",
      user_id: USER_ID,
      case_id: CASE_ID,
      title: "Surrenderless follow-up: Merchant contact",
      due_date: null,
      notes: followUpNotes,
      completed_at: null,
      created_at: "2026-06-21T00:05:00.000Z",
      updated_at: "2026-06-21T00:05:00.000Z",
    };
    store.tasks.push(followUpF2);

    const staleReplay = await recordMerchantContactEmailBounceEvent(supabase, {
      messageId: "re_mc_1",
      eventType: "email.bounced",
    });

    expect(staleReplay).toEqual({ status: "recorded", caseId: CASE_ID, state: "bounced" });
    expect(taskT.completed_at).toBe("2026-06-21T00:05:00.000Z");
    expect(followUpF2.completed_at).toBeNull();
    expect(followUpF1.completed_at).not.toBeNull();
    expect(taskNotesMatchMerchantContactFilingMarker(taskT.notes, CASE_ID)).toBe(true);
  });
});

describe("stale bounce replay when the supersession lookup itself errors — real helpers, no mocks", () => {
  it("demand letter: leaves the completed task and fresh follow-up untouched, returns a retriable error", async () => {
    const marker = demandLetterFilingTaskNotesMarker(CASE_ID);
    const followUpNotes = buildFollowUpTaskNotes(CASE_ID, {
      href: MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF,
    });

    const filingA: FilingRow = {
      id: "fil-A",
      user_id: USER_ID,
      case_id: CASE_ID,
      destination: "Small claims / demand letter",
      filed_at: "2026-06-01",
      confirmation_number: "re_msg_1",
      filing_url: null,
      notes: upsertDemandLetterEmailDeliveryNotes(null, {
        delivery_state: "accepted",
        provider: "resend",
        recipient: "support@acme.example",
        provider_message_id: "re_msg_1",
      }),
      created_at: "2026-06-01T00:00:00.000Z",
      updated_at: "2026-06-01T00:00:00.000Z",
    };
    const taskT: TaskRow = {
      id: "task-T",
      user_id: USER_ID,
      case_id: CASE_ID,
      title: "Demand letter: Acme Retail",
      due_date: null,
      notes: `${marker}\ncase_id: ${CASE_ID}\ndraft:\nLetter`,
      completed_at: "2026-06-21T00:05:00.000Z",
      created_at: "2026-06-01T00:00:00.000Z",
      updated_at: "2026-06-21T00:05:00.000Z",
    };
    const followUpF1: TaskRow = {
      id: "followup-F1",
      user_id: USER_ID,
      case_id: CASE_ID,
      title: "Surrenderless follow-up: Small claims / demand letter",
      due_date: null,
      notes: followUpNotes,
      completed_at: "2026-06-01T00:06:00.000Z",
      created_at: "2026-06-01T00:05:00.000Z",
      updated_at: "2026-06-01T00:06:00.000Z",
    };
    const filingB: FilingRow = {
      id: "fil-B",
      user_id: USER_ID,
      case_id: CASE_ID,
      destination: "Small claims / demand letter",
      filed_at: "2026-06-21",
      confirmation_number: "DL-REMEDIATED-456",
      filing_url: null,
      notes: null,
      created_at: "2026-06-21T00:00:00.000Z",
      updated_at: "2026-06-21T00:00:00.000Z",
    };
    const followUpF2: TaskRow = {
      id: "followup-F2",
      user_id: USER_ID,
      case_id: CASE_ID,
      title: "Surrenderless follow-up: Small claims / demand letter",
      due_date: null,
      notes: followUpNotes,
      completed_at: null,
      created_at: "2026-06-21T00:05:00.000Z",
      updated_at: "2026-06-21T00:05:00.000Z",
    };
    // Store already reflects successful remediation (fresh filing B, task T re-completed, a
    // fresh open follow-up F2) — this test isolates the replay-during-a-degraded-lookup case.
    const store: Store = {
      filings: [filingA, filingB],
      tasks: [taskT, followUpF1, followUpF2],
      cases: [{ id: CASE_ID, user_id: USER_ID, timeline: [] }],
      filingsSelectError: true,
    };
    const supabase = makeStatefulSupabase(store);

    const staleReplay = await recordDemandLetterEmailBounceEvent(supabase, {
      messageId: "re_msg_1",
      eventType: "email.bounced",
    });

    expect(staleReplay).toEqual({ status: "error", reason: "latest_filing_lookup_failed" });
    // Cannot confirm supersession — must fail closed, not reopen the completed task...
    expect(taskT.completed_at).toBe("2026-06-21T00:05:00.000Z");
    // ...nor close the fresh follow-up...
    expect(followUpF2.completed_at).toBeNull();
    // ...and must leave the already-remediated history alone too.
    expect(followUpF1.completed_at).toBe("2026-06-01T00:06:00.000Z");
    expect(filingA.notes).toContain("delivery_state: bounced");
  });

  it("payment dispute: leaves the completed task and fresh follow-up untouched, returns a retriable error", async () => {
    const marker = paymentDisputeFilingTaskNotesMarker(CASE_ID);
    const followUpNotes = buildFollowUpTaskNotes(CASE_ID, {
      href: MANUAL_ACTION_TRACKING_REAL_PAYMENT_DISPUTE_PREP_HREF,
    });

    const filingA: FilingRow = {
      id: "fil-A",
      user_id: USER_ID,
      case_id: CASE_ID,
      destination: "Payment dispute (bank/card)",
      filed_at: "2026-06-01",
      confirmation_number: "re_pd_1",
      filing_url: null,
      notes: upsertPaymentDisputeEmailDeliveryNotes(null, {
        delivery_state: "accepted",
        provider: "resend",
        recipient: "disputes@issuer.example",
        provider_message_id: "re_pd_1",
      }),
      created_at: "2026-06-01T00:00:00.000Z",
      updated_at: "2026-06-01T00:00:00.000Z",
    };
    const taskT: TaskRow = {
      id: "task-T",
      user_id: USER_ID,
      case_id: CASE_ID,
      title: "Payment dispute: Acme Retail",
      due_date: null,
      notes: `${marker}\ncase_id: ${CASE_ID}\ndraft:\nDISPUTE`,
      completed_at: "2026-06-21T00:05:00.000Z",
      created_at: "2026-06-01T00:00:00.000Z",
      updated_at: "2026-06-21T00:05:00.000Z",
    };
    const followUpF1: TaskRow = {
      id: "followup-F1",
      user_id: USER_ID,
      case_id: CASE_ID,
      title: "Surrenderless follow-up: Payment dispute (bank/card)",
      due_date: null,
      notes: followUpNotes,
      completed_at: "2026-06-01T00:06:00.000Z",
      created_at: "2026-06-01T00:05:00.000Z",
      updated_at: "2026-06-01T00:06:00.000Z",
    };
    const filingB: FilingRow = {
      id: "fil-B",
      user_id: USER_ID,
      case_id: CASE_ID,
      destination: "Payment dispute (bank/card)",
      filed_at: "2026-06-21",
      confirmation_number: "PD-REMEDIATED-456",
      filing_url: null,
      notes: null,
      created_at: "2026-06-21T00:00:00.000Z",
      updated_at: "2026-06-21T00:00:00.000Z",
    };
    const followUpF2: TaskRow = {
      id: "followup-F2",
      user_id: USER_ID,
      case_id: CASE_ID,
      title: "Surrenderless follow-up: Payment dispute (bank/card)",
      due_date: null,
      notes: followUpNotes,
      completed_at: null,
      created_at: "2026-06-21T00:05:00.000Z",
      updated_at: "2026-06-21T00:05:00.000Z",
    };
    const store: Store = {
      filings: [filingA, filingB],
      tasks: [taskT, followUpF1, followUpF2],
      cases: [{ id: CASE_ID, user_id: USER_ID, timeline: [] }],
      filingsSelectError: true,
    };
    const supabase = makeStatefulSupabase(store);

    const staleReplay = await recordPaymentDisputeEmailBounceEvent(supabase, {
      messageId: "re_pd_1",
      eventType: "email.bounced",
    });

    expect(staleReplay).toEqual({ status: "error", reason: "latest_filing_lookup_failed" });
    expect(taskT.completed_at).toBe("2026-06-21T00:05:00.000Z");
    expect(followUpF2.completed_at).toBeNull();
    expect(followUpF1.completed_at).toBe("2026-06-01T00:06:00.000Z");
    expect(filingA.notes).toContain("delivery_state: bounced");
  });

  it("merchant contact: leaves the completed task and fresh follow-up untouched, returns a retriable error", async () => {
    const marker = merchantContactFilingTaskNotesMarker(CASE_ID);
    const followUpNotes = buildFollowUpTaskNotes(CASE_ID, {
      href: MANUAL_ACTION_TRACKING_REAL_MERCHANT_PREP_HREF,
    });

    const filingA: FilingRow = {
      id: "fil-A",
      user_id: USER_ID,
      case_id: CASE_ID,
      destination: "Merchant contact",
      filed_at: "2026-06-01",
      confirmation_number: "re_mc_1",
      filing_url: null,
      notes: upsertMerchantContactEmailDeliveryNotes(null, {
        delivery_state: "accepted",
        provider: "resend",
        recipient: "support@acme.example",
        provider_message_id: "re_mc_1",
      }),
      created_at: "2026-06-01T00:00:00.000Z",
      updated_at: "2026-06-01T00:00:00.000Z",
    };
    const taskT: TaskRow = {
      id: "task-T",
      user_id: USER_ID,
      case_id: CASE_ID,
      title: "Merchant contact: Acme Retail",
      due_date: null,
      notes: `${marker}\ncase_id: ${CASE_ID}\ndraft:\nHi`,
      completed_at: "2026-06-21T00:05:00.000Z",
      created_at: "2026-06-01T00:00:00.000Z",
      updated_at: "2026-06-21T00:05:00.000Z",
    };
    const followUpF1: TaskRow = {
      id: "followup-F1",
      user_id: USER_ID,
      case_id: CASE_ID,
      title: "Surrenderless follow-up: Merchant contact",
      due_date: null,
      notes: followUpNotes,
      completed_at: "2026-06-01T00:06:00.000Z",
      created_at: "2026-06-01T00:05:00.000Z",
      updated_at: "2026-06-01T00:06:00.000Z",
    };
    const filingB: FilingRow = {
      id: "fil-B",
      user_id: USER_ID,
      case_id: CASE_ID,
      destination: "Merchant contact",
      filed_at: "2026-06-21",
      confirmation_number: "MC-REMEDIATED-456",
      filing_url: null,
      notes: null,
      created_at: "2026-06-21T00:00:00.000Z",
      updated_at: "2026-06-21T00:00:00.000Z",
    };
    const followUpF2: TaskRow = {
      id: "followup-F2",
      user_id: USER_ID,
      case_id: CASE_ID,
      title: "Surrenderless follow-up: Merchant contact",
      due_date: null,
      notes: followUpNotes,
      completed_at: null,
      created_at: "2026-06-21T00:05:00.000Z",
      updated_at: "2026-06-21T00:05:00.000Z",
    };
    const store: Store = {
      filings: [filingA, filingB],
      tasks: [taskT, followUpF1, followUpF2],
      cases: [{ id: CASE_ID, user_id: USER_ID, timeline: [] }],
      filingsSelectError: true,
    };
    const supabase = makeStatefulSupabase(store);

    const staleReplay = await recordMerchantContactEmailBounceEvent(supabase, {
      messageId: "re_mc_1",
      eventType: "email.bounced",
    });

    expect(staleReplay).toEqual({ status: "error", reason: "latest_filing_lookup_failed" });
    expect(taskT.completed_at).toBe("2026-06-21T00:05:00.000Z");
    expect(followUpF2.completed_at).toBeNull();
    expect(followUpF1.completed_at).toBe("2026-06-01T00:06:00.000Z");
    expect(filingA.notes).toContain("delivery_state: bounced");
  });
});

describe("cross-lane stale bounce does not close another lane's fresh follow-up — real helpers, no mocks", () => {
  it("demand letter's late bounce (no newer demand-letter filing) reopens only its own task and leaves payment dispute's active follow-up open", async () => {
    const demandLetterMarker = demandLetterFilingTaskNotesMarker(CASE_ID);
    const paymentDisputeMarker = paymentDisputeFilingTaskNotesMarker(CASE_ID);

    // Lane A (demand letter): filed and finished normally — its own follow-up already closed —
    // well before the ladder advanced. No newer demand-letter filing exists, so lane A's own
    // supersession check correctly finds itself "not superseded".
    const filingA: FilingRow = {
      id: "fil-dl",
      user_id: USER_ID,
      case_id: CASE_ID,
      destination: "Small claims / demand letter",
      filed_at: "2026-06-01",
      confirmation_number: "re_msg_1",
      filing_url: null,
      notes: upsertDemandLetterEmailDeliveryNotes(null, {
        delivery_state: "accepted",
        provider: "resend",
        recipient: "support@acme.example",
        provider_message_id: "re_msg_1",
      }),
      created_at: "2026-06-01T00:00:00.000Z",
      updated_at: "2026-06-01T00:00:00.000Z",
    };
    const taskA: TaskRow = {
      id: "task-dl",
      user_id: USER_ID,
      case_id: CASE_ID,
      title: "Demand letter: Acme Retail",
      due_date: null,
      notes: `${demandLetterMarker}\ncase_id: ${CASE_ID}\ndraft:\nLetter`,
      completed_at: "2026-06-02T00:00:00.000Z",
      created_at: "2026-06-01T00:00:00.000Z",
      updated_at: "2026-06-02T00:00:00.000Z",
    };
    const followUpDemandLetter: TaskRow = {
      id: "followup-dl",
      user_id: USER_ID,
      case_id: CASE_ID,
      title: "Surrenderless follow-up: Small claims / demand letter",
      due_date: null,
      notes: buildFollowUpTaskNotes(CASE_ID, { href: MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF }),
      completed_at: "2026-06-02T00:05:00.000Z",
      created_at: "2026-06-01T00:05:00.000Z",
      updated_at: "2026-06-02T00:05:00.000Z",
    };

    // Ladder advanced to lane B (payment dispute): filed and completed successfully, with its own
    // fresh, currently-open follow-up — the case's only open one at the moment lane A's late
    // bounce arrives.
    const filingB: FilingRow = {
      id: "fil-pd",
      user_id: USER_ID,
      case_id: CASE_ID,
      destination: "Payment dispute (bank/card)",
      filed_at: "2026-06-21",
      confirmation_number: "PD-123456",
      filing_url: null,
      notes: null,
      created_at: "2026-06-21T00:00:00.000Z",
      updated_at: "2026-06-21T00:00:00.000Z",
    };
    const taskB: TaskRow = {
      id: "task-pd",
      user_id: USER_ID,
      case_id: CASE_ID,
      title: "Payment dispute: Acme Retail",
      due_date: null,
      notes: `${paymentDisputeMarker}\ncase_id: ${CASE_ID}\ndraft:\nDISPUTE`,
      completed_at: "2026-06-21T00:05:00.000Z",
      created_at: "2026-06-21T00:00:00.000Z",
      updated_at: "2026-06-21T00:05:00.000Z",
    };
    const followUpPaymentDispute: TaskRow = {
      id: "followup-pd",
      user_id: USER_ID,
      case_id: CASE_ID,
      title: "Surrenderless follow-up: Payment dispute (bank/card)",
      due_date: null,
      notes: buildFollowUpTaskNotes(CASE_ID, { href: MANUAL_ACTION_TRACKING_REAL_PAYMENT_DISPUTE_PREP_HREF }),
      completed_at: null,
      created_at: "2026-06-21T00:05:00.000Z",
      updated_at: "2026-06-21T00:05:00.000Z",
    };

    const store: Store = {
      filings: [filingA, filingB],
      tasks: [taskA, taskB, followUpDemandLetter, followUpPaymentDispute],
      cases: [{ id: CASE_ID, user_id: USER_ID, timeline: [] }],
    };
    const supabase = makeStatefulSupabase(store);

    // Resend delivers demand letter's original bounce late — well after the ladder moved on.
    const result = await recordDemandLetterEmailBounceEvent(supabase, {
      messageId: "re_msg_1",
      eventType: "email.bounced",
    });

    expect(result).toEqual({ status: "recorded", caseId: CASE_ID, state: "bounced" });
    // Lane A's own task is correctly reopened (its marker isolates it from lane B's task).
    expect(taskA.completed_at).toBeNull();
    expect(taskA.title).toBe("[Needs manual follow-up — bounced] Demand letter: Acme Retail");
    // Lane B's active, unrelated follow-up must NOT be closed by lane A's bounce.
    expect(followUpPaymentDispute.completed_at).toBeNull();
    // Lane A's own already-closed follow-up and lane B's task are untouched too.
    expect(followUpDemandLetter.completed_at).toBe("2026-06-02T00:05:00.000Z");
    expect(taskB.completed_at).toBe("2026-06-21T00:05:00.000Z");
  });

  it("payment dispute's late bounce (no newer payment-dispute filing) reopens only its own task and leaves merchant contact's active follow-up open", async () => {
    const paymentDisputeMarker = paymentDisputeFilingTaskNotesMarker(CASE_ID);
    const merchantContactMarker = merchantContactFilingTaskNotesMarker(CASE_ID);

    const filingA: FilingRow = {
      id: "fil-pd",
      user_id: USER_ID,
      case_id: CASE_ID,
      destination: "Payment dispute (bank/card)",
      filed_at: "2026-06-01",
      confirmation_number: "re_pd_1",
      filing_url: null,
      notes: upsertPaymentDisputeEmailDeliveryNotes(null, {
        delivery_state: "accepted",
        provider: "resend",
        recipient: "disputes@issuer.example",
        provider_message_id: "re_pd_1",
      }),
      created_at: "2026-06-01T00:00:00.000Z",
      updated_at: "2026-06-01T00:00:00.000Z",
    };
    const taskA: TaskRow = {
      id: "task-pd",
      user_id: USER_ID,
      case_id: CASE_ID,
      title: "Payment dispute: Acme Retail",
      due_date: null,
      notes: `${paymentDisputeMarker}\ncase_id: ${CASE_ID}\ndraft:\nDISPUTE`,
      completed_at: "2026-06-02T00:00:00.000Z",
      created_at: "2026-06-01T00:00:00.000Z",
      updated_at: "2026-06-02T00:00:00.000Z",
    };
    const followUpPaymentDispute: TaskRow = {
      id: "followup-pd",
      user_id: USER_ID,
      case_id: CASE_ID,
      title: "Surrenderless follow-up: Payment dispute (bank/card)",
      due_date: null,
      notes: buildFollowUpTaskNotes(CASE_ID, { href: MANUAL_ACTION_TRACKING_REAL_PAYMENT_DISPUTE_PREP_HREF }),
      completed_at: "2026-06-02T00:05:00.000Z",
      created_at: "2026-06-01T00:05:00.000Z",
      updated_at: "2026-06-02T00:05:00.000Z",
    };

    const filingB: FilingRow = {
      id: "fil-mc",
      user_id: USER_ID,
      case_id: CASE_ID,
      destination: "Merchant contact",
      filed_at: "2026-06-21",
      confirmation_number: "MC-123456",
      filing_url: null,
      notes: null,
      created_at: "2026-06-21T00:00:00.000Z",
      updated_at: "2026-06-21T00:00:00.000Z",
    };
    const taskB: TaskRow = {
      id: "task-mc",
      user_id: USER_ID,
      case_id: CASE_ID,
      title: "Merchant contact: Acme Retail",
      due_date: null,
      notes: `${merchantContactMarker}\ncase_id: ${CASE_ID}\ndraft:\nHi`,
      completed_at: "2026-06-21T00:05:00.000Z",
      created_at: "2026-06-21T00:00:00.000Z",
      updated_at: "2026-06-21T00:05:00.000Z",
    };
    const followUpMerchantContact: TaskRow = {
      id: "followup-mc",
      user_id: USER_ID,
      case_id: CASE_ID,
      title: "Surrenderless follow-up: Merchant contact",
      due_date: null,
      notes: buildFollowUpTaskNotes(CASE_ID, { href: MANUAL_ACTION_TRACKING_REAL_MERCHANT_PREP_HREF }),
      completed_at: null,
      created_at: "2026-06-21T00:05:00.000Z",
      updated_at: "2026-06-21T00:05:00.000Z",
    };

    const store: Store = {
      filings: [filingA, filingB],
      tasks: [taskA, taskB, followUpPaymentDispute, followUpMerchantContact],
      cases: [{ id: CASE_ID, user_id: USER_ID, timeline: [] }],
    };
    const supabase = makeStatefulSupabase(store);

    const result = await recordPaymentDisputeEmailBounceEvent(supabase, {
      messageId: "re_pd_1",
      eventType: "email.bounced",
    });

    expect(result).toEqual({ status: "recorded", caseId: CASE_ID, state: "bounced" });
    expect(taskA.completed_at).toBeNull();
    expect(followUpMerchantContact.completed_at).toBeNull();
    expect(followUpPaymentDispute.completed_at).toBe("2026-06-02T00:05:00.000Z");
    expect(taskB.completed_at).toBe("2026-06-21T00:05:00.000Z");
  });

  it("merchant contact's late bounce (no newer merchant-contact filing) reopens only its own task and leaves demand letter's active follow-up open", async () => {
    const merchantContactMarker = merchantContactFilingTaskNotesMarker(CASE_ID);
    const demandLetterMarker = demandLetterFilingTaskNotesMarker(CASE_ID);

    const filingA: FilingRow = {
      id: "fil-mc",
      user_id: USER_ID,
      case_id: CASE_ID,
      destination: "Merchant contact",
      filed_at: "2026-06-01",
      confirmation_number: "re_mc_1",
      filing_url: null,
      notes: upsertMerchantContactEmailDeliveryNotes(null, {
        delivery_state: "accepted",
        provider: "resend",
        recipient: "support@acme.example",
        provider_message_id: "re_mc_1",
      }),
      created_at: "2026-06-01T00:00:00.000Z",
      updated_at: "2026-06-01T00:00:00.000Z",
    };
    const taskA: TaskRow = {
      id: "task-mc",
      user_id: USER_ID,
      case_id: CASE_ID,
      title: "Merchant contact: Acme Retail",
      due_date: null,
      notes: `${merchantContactMarker}\ncase_id: ${CASE_ID}\ndraft:\nHi`,
      completed_at: "2026-06-02T00:00:00.000Z",
      created_at: "2026-06-01T00:00:00.000Z",
      updated_at: "2026-06-02T00:00:00.000Z",
    };
    const followUpMerchantContact: TaskRow = {
      id: "followup-mc",
      user_id: USER_ID,
      case_id: CASE_ID,
      title: "Surrenderless follow-up: Merchant contact",
      due_date: null,
      notes: buildFollowUpTaskNotes(CASE_ID, { href: MANUAL_ACTION_TRACKING_REAL_MERCHANT_PREP_HREF }),
      completed_at: "2026-06-02T00:05:00.000Z",
      created_at: "2026-06-01T00:05:00.000Z",
      updated_at: "2026-06-02T00:05:00.000Z",
    };

    const filingB: FilingRow = {
      id: "fil-dl",
      user_id: USER_ID,
      case_id: CASE_ID,
      destination: "Small claims / demand letter",
      filed_at: "2026-06-21",
      confirmation_number: "DL-123456",
      filing_url: null,
      notes: null,
      created_at: "2026-06-21T00:00:00.000Z",
      updated_at: "2026-06-21T00:00:00.000Z",
    };
    const taskB: TaskRow = {
      id: "task-dl",
      user_id: USER_ID,
      case_id: CASE_ID,
      title: "Demand letter: Acme Retail",
      due_date: null,
      notes: `${demandLetterMarker}\ncase_id: ${CASE_ID}\ndraft:\nLetter`,
      completed_at: "2026-06-21T00:05:00.000Z",
      created_at: "2026-06-21T00:00:00.000Z",
      updated_at: "2026-06-21T00:05:00.000Z",
    };
    const followUpDemandLetter: TaskRow = {
      id: "followup-dl",
      user_id: USER_ID,
      case_id: CASE_ID,
      title: "Surrenderless follow-up: Small claims / demand letter",
      due_date: null,
      notes: buildFollowUpTaskNotes(CASE_ID, { href: MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF }),
      completed_at: null,
      created_at: "2026-06-21T00:05:00.000Z",
      updated_at: "2026-06-21T00:05:00.000Z",
    };

    const store: Store = {
      filings: [filingA, filingB],
      tasks: [taskA, taskB, followUpMerchantContact, followUpDemandLetter],
      cases: [{ id: CASE_ID, user_id: USER_ID, timeline: [] }],
    };
    const supabase = makeStatefulSupabase(store);

    const result = await recordMerchantContactEmailBounceEvent(supabase, {
      messageId: "re_mc_1",
      eventType: "email.bounced",
    });

    expect(result).toEqual({ status: "recorded", caseId: CASE_ID, state: "bounced" });
    expect(taskA.completed_at).toBeNull();
    expect(followUpDemandLetter.completed_at).toBeNull();
    expect(followUpMerchantContact.completed_at).toBe("2026-06-02T00:05:00.000Z");
    expect(taskB.completed_at).toBe("2026-06-21T00:05:00.000Z");
  });
});

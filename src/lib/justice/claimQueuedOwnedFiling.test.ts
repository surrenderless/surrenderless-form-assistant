import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";
import { upsertBbbOwnedFilingDeliveryNotes } from "@/lib/justice/bbbOwnedFilingDeliveryState";
import {
  parseFtcOwnedFilingDeliveryRecord,
  upsertFtcOwnedFilingDeliveryNotes,
} from "@/lib/justice/ftcOwnedFilingDeliveryState";
import { parseBbbOwnedFilingDeliveryRecord } from "@/lib/justice/bbbOwnedFilingDeliveryState";
import { findAndClaimNextQueuedOwnedFiling } from "@/lib/justice/claimQueuedOwnedFiling";

vi.mock("@/server/justiceTimelineAppend", () => ({
  appendCaseTimelineEntry: vi.fn(async (_s, _u, _c, entry) => [entry]),
}));

const USER_ID = "user_1";
const BBB_CASE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FTC_CASE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function like(value: string | null | undefined, pattern: string): boolean {
  const core = pattern.replace(/^%/, "").replace(/%$/, "");
  return typeof value === "string" && value.includes(core);
}

/** Stateful in-memory tasks table modelling the queued→submitting compare-and-swap. */
function makeStatefulSupabase(tasks: JusticeCaseTaskRow[]): {
  client: SupabaseClient;
  tasks: JusticeCaseTaskRow[];
} {
  const store = tasks;

  function tasksTable() {
    const state: {
      op: "select" | "update";
      payload?: { notes: string };
      eq: Array<[string, unknown]>;
      isNull: string[];
      likes: Array<[string, string]>;
    } = { op: "select", eq: [], isNull: [], likes: [] };

    const builder: Record<string, unknown> = {
      select() {
        return builder;
      },
      update(payload: { notes: string }) {
        state.op = "update";
        state.payload = payload;
        return builder;
      },
      eq(col: string, val: unknown) {
        state.eq.push([col, val]);
        return builder;
      },
      is(col: string, _val: null) {
        state.isNull.push(col);
        return builder;
      },
      like(col: string, pattern: string) {
        state.likes.push([col, pattern]);
        return builder;
      },
      limit() {
        return builder;
      },
      maybeSingle() {
        // Compare-and-swap update path.
        const idx = store.findIndex((t) => {
          const rec = t as unknown as Record<string, unknown>;
          const eqOk = state.eq.every(([c, v]) => rec[c] === v);
          const isOk = state.isNull.every((c) => rec[c] === null);
          return eqOk && isOk;
        });
        if (idx === -1) return Promise.resolve({ data: null, error: null });
        if (state.op === "update" && state.payload) {
          store[idx] = { ...store[idx], notes: state.payload.notes };
        }
        return Promise.resolve({ data: store[idx], error: null });
      },
      then(resolve: (v: { data: JusticeCaseTaskRow[]; error: null }) => unknown) {
        const rows = store.filter((t) => {
          const rec = t as unknown as Record<string, unknown>;
          const isOk = state.isNull.every((c) => rec[c] === null);
          const likeOk = state.likes.every(([c, p]) => like(rec[c] as string, p));
          return isOk && likeOk;
        });
        return Promise.resolve({ data: rows, error: null }).then(resolve);
      },
    };
    return builder;
  }

  const client = {
    from(table: string) {
      if (table === "justice_case_tasks") return tasksTable();
      throw new Error(`unexpected table ${table}`);
    },
  } as unknown as SupabaseClient;

  return { client, tasks: store };
}

function queuedTask(
  kind: "bbb" | "ftc",
  caseId: string,
  id: string,
  queuedAt: string
): JusticeCaseTaskRow {
  const marker = kind === "bbb" ? `bbb_filing_queue:${caseId}` : `ftc_filing_queue:${caseId}`;
  const upsert = kind === "bbb" ? upsertBbbOwnedFilingDeliveryNotes : upsertFtcOwnedFilingDeliveryNotes;
  return {
    id,
    user_id: USER_ID,
    case_id: caseId,
    title: `${kind} filing`,
    due_date: null,
    notes: upsert(`${marker}\ndraft:\nx`, {
      delivery_state: "queued",
      provider: kind === "bbb" ? "real_bbb_bounded_submit" : "real_ftc_bounded_submit",
      started_at: queuedAt,
    }),
    completed_at: null,
    created_at: queuedAt,
    updated_at: queuedAt,
  };
}

describe("findAndClaimNextQueuedOwnedFiling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("claims the oldest queued task by flipping queued → submitting", async () => {
    const { client, tasks } = makeStatefulSupabase([
      queuedTask("ftc", FTC_CASE, "t-ftc", "2026-07-14T02:00:00.000Z"),
      queuedTask("bbb", BBB_CASE, "t-bbb", "2026-07-14T01:00:00.000Z"),
    ]);

    const claimed = await findAndClaimNextQueuedOwnedFiling(client, {
      nowMs: Date.parse("2026-07-14T03:00:00.000Z"),
    });

    expect(claimed?.kind).toBe("bbb");
    expect(claimed?.caseId).toBe(BBB_CASE);
    const bbbRow = tasks.find((t) => t.id === "t-bbb")!;
    expect(parseBbbOwnedFilingDeliveryRecord(bbbRow.notes)?.delivery_state).toBe("submitting");
    const ftcRow = tasks.find((t) => t.id === "t-ftc")!;
    expect(parseFtcOwnedFilingDeliveryRecord(ftcRow.notes)?.delivery_state).toBe("queued");
  });

  it("never claims the same task twice across sequential worker invocations", async () => {
    const { client, tasks } = makeStatefulSupabase([
      queuedTask("bbb", BBB_CASE, "t-bbb", "2026-07-14T01:00:00.000Z"),
    ]);

    const first = await findAndClaimNextQueuedOwnedFiling(client);
    const second = await findAndClaimNextQueuedOwnedFiling(client);

    expect(first?.caseId).toBe(BBB_CASE);
    expect(second).toBeNull();
    expect(parseBbbOwnedFilingDeliveryRecord(tasks[0].notes)?.delivery_state).toBe("submitting");
  });

  it("parallel workers cannot both claim the same queued task (atomic CAS)", async () => {
    const { client, tasks } = makeStatefulSupabase([
      queuedTask("ftc", FTC_CASE, "t-ftc", "2026-07-14T01:00:00.000Z"),
    ]);

    const [a, b] = await Promise.all([
      findAndClaimNextQueuedOwnedFiling(client),
      findAndClaimNextQueuedOwnedFiling(client),
    ]);

    const claims = [a, b].filter(Boolean);
    expect(claims.length).toBe(1);
    expect(parseFtcOwnedFilingDeliveryRecord(tasks[0].notes)?.delivery_state).toBe("submitting");
  });

  it("returns null when there are no queued tasks (submitting/failed are ineligible)", async () => {
    const submitting = queuedTask("bbb", BBB_CASE, "t-bbb", "2026-07-14T01:00:00.000Z");
    submitting.notes = upsertBbbOwnedFilingDeliveryNotes(submitting.notes, {
      delivery_state: "submitting",
      provider: "real_bbb_bounded_submit",
      started_at: "2026-07-14T01:00:00.000Z",
    });
    const { client } = makeStatefulSupabase([submitting]);
    const claimed = await findAndClaimNextQueuedOwnedFiling(client);
    expect(claimed).toBeNull();
  });
});

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const completeBbbOperatorFiling = vi.fn();
const completeFtcOperatorFiling = vi.fn();
const appendCaseTimelineEntry = vi.fn(
  async (_s: unknown, _u: unknown, _c: unknown, entry: { id: string }) => [entry]
);

vi.mock("@/lib/justice/completeBbbOperatorFiling", () => ({
  completeBbbOperatorFiling: (...args: unknown[]) => completeBbbOperatorFiling(...args),
}));
vi.mock("@/lib/justice/completeFtcOperatorFiling", () => ({
  completeFtcOperatorFiling: (...args: unknown[]) => completeFtcOperatorFiling(...args),
}));
vi.mock("@/server/justiceTimelineAppend", () => ({
  appendCaseTimelineEntry: (...args: unknown[]) =>
    (appendCaseTimelineEntry as unknown as (...a: unknown[]) => unknown)(...args),
}));

import {
  bbbOwnedFilingTimelineId,
  parseBbbOwnedFilingDeliveryRecord,
  upsertBbbOwnedFilingDeliveryNotes,
} from "@/lib/justice/bbbOwnedFilingDeliveryState";
import {
  ftcOwnedFilingTimelineId,
  parseFtcOwnedFilingDeliveryRecord,
  upsertFtcOwnedFilingDeliveryNotes,
} from "@/lib/justice/ftcOwnedFilingDeliveryState";
import {
  OWNED_FILING_STALE_SUBMITTING_DEFAULT_TIMEOUT_MS,
  OWNED_FILING_STALE_SUBMITTING_TIMEOUT_ENV,
  reconcileStaleSubmittingOwnedFilings,
  resolveStaleSubmittingTimeoutMs,
} from "@/lib/justice/reconcileStaleSubmittingOwnedFilings";

type Kind = "bbb" | "ftc";

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

type Store = {
  tasks: TaskRow[];
  filings: FilingRow[];
  tasksError?: boolean;
  filingsError?: boolean;
  updateError?: boolean;
};

const USER_ID = "user-1";
const START_ISO = "2026-07-18T00:00:00.000Z";
const START_MS = Date.parse(START_ISO);
const STALE_NOW_MS = START_MS + 20 * 60 * 1000; // 20 min later
const FRESH_NOW_MS = START_MS + 60 * 1000; // 1 min later
const TIMEOUT_MS = 15 * 60 * 1000;

const cfgFor = (kind: Kind) =>
  kind === "bbb"
    ? {
        queueMarker: (caseId: string) => `bbb_filing_queue:${caseId}`,
        upsertNotes: upsertBbbOwnedFilingDeliveryNotes,
        parseRecord: parseBbbOwnedFilingDeliveryRecord,
        timelineId: bbbOwnedFilingTimelineId,
        destination: "Better Business Bureau",
        provider: "real_bbb_bounded_submit",
        complete: completeBbbOperatorFiling,
      }
    : {
        queueMarker: (caseId: string) => `ftc_filing_queue:${caseId}`,
        upsertNotes: upsertFtcOwnedFilingDeliveryNotes,
        parseRecord: parseFtcOwnedFilingDeliveryRecord,
        timelineId: ftcOwnedFilingTimelineId,
        destination: "FTC (consumer complaint)",
        provider: "real_ftc_bounded_submit",
        complete: completeFtcOperatorFiling,
      };

function makeTask(
  kind: Kind,
  caseId: string,
  record: { delivery_state: "submitting" | "failed" | "filed"; started_at?: string; confirmation?: string }
): TaskRow {
  const cfg = cfgFor(kind);
  const base = `${cfg.queueMarker(caseId)}\ndraft:\n${kind.toUpperCase()} DRAFT`;
  const notes = cfg.upsertNotes(base, {
    delivery_state: record.delivery_state,
    provider: cfg.provider,
    ...(record.started_at ? { started_at: record.started_at } : {}),
    ...(record.confirmation ? { confirmation: record.confirmation } : {}),
  });
  return {
    id: `task-${kind}-${caseId}`,
    user_id: USER_ID,
    case_id: caseId,
    title: `${kind.toUpperCase()} filing`,
    due_date: null,
    notes,
    completed_at: null,
    created_at: START_ISO,
    updated_at: START_ISO,
  };
}

function makeConfirmedFiling(kind: Kind, caseId: string): FilingRow {
  const cfg = cfgFor(kind);
  return {
    id: `filing-${kind}-${caseId}`,
    user_id: USER_ID,
    case_id: caseId,
    destination: cfg.destination,
    filed_at: "2026-07-18",
    confirmation_number: `${kind.toUpperCase()}-CONF-1`,
    filing_url: null,
    notes: null,
    created_at: START_ISO,
    updated_at: START_ISO,
  };
}

function makeSupabase(store: Store): SupabaseClient {
  return {
    from(table: string) {
      if (table === "justice_case_tasks") {
        return {
          select() {
            const b: Record<string, unknown> = {};
            let completedNull = false;
            let likePattern = "";
            b.is = (col: string, val: unknown) => {
              if (col === "completed_at" && val === null) completedNull = true;
              return b;
            };
            b.like = (_col: string, pat: string) => {
              likePattern = pat;
              return b;
            };
            b.limit = () => b;
            b.then = (resolve: (v: unknown) => unknown) => {
              if (store.tasksError) {
                return Promise.resolve({ data: null, error: { message: "tasks down" } }).then(
                  resolve
                );
              }
              const marker = likePattern.replace(/%/g, "");
              const rows = store.tasks.filter(
                (t) =>
                  (!completedNull || !t.completed_at?.trim()) &&
                  (t.notes ?? "").includes(marker)
              );
              return Promise.resolve({
                data: rows.map((r) => ({ ...r })),
                error: null,
              }).then(resolve);
            };
            return b;
          },
          update(payload: { notes: string }) {
            const u: Record<string, unknown> = {};
            let id = "";
            let uid = "";
            u.eq = (col: string, val: string) => {
              if (col === "id") id = val;
              if (col === "user_id") uid = val;
              return u;
            };
            u.select = () => u;
            u.maybeSingle = async () => {
              if (store.updateError) return { data: null, error: { message: "update down" } };
              const t = store.tasks.find((x) => x.id === id && x.user_id === uid);
              if (!t) return { data: null, error: { message: "not found" } };
              t.notes = payload.notes;
              return { data: { ...t }, error: null };
            };
            return u;
          },
        };
      }
      if (table === "justice_case_filings") {
        return {
          select() {
            const b: Record<string, unknown> = {};
            let caseId = "";
            let uid = "";
            b.eq = (col: string, val: string) => {
              if (col === "case_id") caseId = val;
              if (col === "user_id") uid = val;
              return b;
            };
            b.then = (resolve: (v: unknown) => unknown) => {
              if (store.filingsError) {
                return Promise.resolve({ data: null, error: { message: "filings down" } }).then(
                  resolve
                );
              }
              const rows = store.filings.filter(
                (f) => f.case_id === caseId && f.user_id === uid
              );
              return Promise.resolve({ data: rows.map((r) => ({ ...r })), error: null }).then(
                resolve
              );
            };
            return b;
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  } as unknown as SupabaseClient;
}

beforeEach(() => {
  completeBbbOperatorFiling.mockReset().mockResolvedValue({ ok: true });
  completeFtcOperatorFiling.mockReset().mockResolvedValue({ ok: true });
  appendCaseTimelineEntry.mockClear();
  delete process.env[OWNED_FILING_STALE_SUBMITTING_TIMEOUT_ENV];
});

afterEach(() => {
  delete process.env[OWNED_FILING_STALE_SUBMITTING_TIMEOUT_ENV];
});

describe("resolveStaleSubmittingTimeoutMs", () => {
  it("defaults to a window longer than the 300s synchronous submit cap", () => {
    expect(resolveStaleSubmittingTimeoutMs({})).toBe(OWNED_FILING_STALE_SUBMITTING_DEFAULT_TIMEOUT_MS);
    expect(OWNED_FILING_STALE_SUBMITTING_DEFAULT_TIMEOUT_MS).toBeGreaterThan(300 * 1000);
  });

  it("honors a positive env override and ignores invalid values", () => {
    expect(
      resolveStaleSubmittingTimeoutMs({ [OWNED_FILING_STALE_SUBMITTING_TIMEOUT_ENV]: "60000" })
    ).toBe(60000);
    expect(
      resolveStaleSubmittingTimeoutMs({ [OWNED_FILING_STALE_SUBMITTING_TIMEOUT_ENV]: "-5" })
    ).toBe(OWNED_FILING_STALE_SUBMITTING_DEFAULT_TIMEOUT_MS);
    expect(
      resolveStaleSubmittingTimeoutMs({ [OWNED_FILING_STALE_SUBMITTING_TIMEOUT_ENV]: "abc" })
    ).toBe(OWNED_FILING_STALE_SUBMITTING_DEFAULT_TIMEOUT_MS);
  });
});

describe.each<[Kind]>([["bbb"], ["ftc"]])(
  "reconcileStaleSubmittingOwnedFilings (%s)",
  (kind) => {
    const cfg = cfgFor(kind);

    it("ignores a submitting task that has not exceeded the timeout", async () => {
      const store: Store = {
        tasks: [makeTask(kind, "case-fresh", { delivery_state: "submitting", started_at: START_ISO })],
        filings: [],
      };
      const summary = await reconcileStaleSubmittingOwnedFilings(makeSupabase(store), {
        nowMs: FRESH_NOW_MS,
        timeoutMs: TIMEOUT_MS,
      });
      const result = summary.results.find((r) => r.case_id === "case-fresh" && r.kind === kind);
      expect(result?.outcome).toBe("ignored_not_stale");
      expect(summary.ignored).toBeGreaterThanOrEqual(1);
      expect(cfg.complete).not.toHaveBeenCalled();
      // notes untouched → still submitting
      expect(store.tasks[0].completed_at).toBeNull();
      expect(cfg.parseRecord(store.tasks[0].notes)?.delivery_state).toBe("submitting");
    });

    it("finalizes a stale task as filed when a confirmed filing already exists", async () => {
      const store: Store = {
        tasks: [makeTask(kind, "case-conf", { delivery_state: "submitting", started_at: START_ISO })],
        filings: [makeConfirmedFiling(kind, "case-conf")],
      };
      const summary = await reconcileStaleSubmittingOwnedFilings(makeSupabase(store), {
        nowMs: STALE_NOW_MS,
        timeoutMs: TIMEOUT_MS,
      });
      const result = summary.results.find((r) => r.case_id === "case-conf" && r.kind === kind);
      expect(result?.outcome).toBe("finalized_filed");
      expect(cfg.complete).toHaveBeenCalledTimes(1);
      expect(cfg.complete).toHaveBeenCalledWith(
        expect.anything(),
        USER_ID,
        expect.objectContaining({
          caseId: "case-conf",
          destination: cfg.destination,
          confirmationNumber: `${kind.toUpperCase()}-CONF-1`,
        })
      );
      // delivery record finalized to filed
      expect(cfg.parseRecord(store.tasks[0].notes)?.delivery_state).toBe("filed");
      // a filed timeline event was appended
      expect(appendCaseTimelineEntry).toHaveBeenCalledWith(
        expect.anything(),
        USER_ID,
        "case-conf",
        expect.objectContaining({ id: cfg.timelineId("case-conf", "filed") })
      );
    });

    it("sends a stale task without confirmation to the operator queue and leaves it open", async () => {
      const store: Store = {
        tasks: [makeTask(kind, "case-op", { delivery_state: "submitting", started_at: START_ISO })],
        filings: [],
      };
      const summary = await reconcileStaleSubmittingOwnedFilings(makeSupabase(store), {
        nowMs: STALE_NOW_MS,
        timeoutMs: TIMEOUT_MS,
      });
      const result = summary.results.find((r) => r.case_id === "case-op" && r.kind === kind);
      expect(result?.outcome).toBe("sent_to_operator");
      expect(cfg.complete).not.toHaveBeenCalled();
      // task remains open for the operator queue
      expect(store.tasks[0].completed_at).toBeNull();
      // delivery record transitioned to failed → chat leaves the perpetual "filing now" state
      const record = cfg.parseRecord(store.tasks[0].notes);
      expect(record?.delivery_state).toBe("failed");
      expect(record?.stop_reason).toBe("stale_submitting_reclaimed");
      expect(appendCaseTimelineEntry).toHaveBeenCalledWith(
        expect.anything(),
        USER_ID,
        "case-op",
        expect.objectContaining({ id: cfg.timelineId("case-op", "failed") })
      );
    });

    it("is idempotent across repeated reconciliation runs", async () => {
      const store: Store = {
        tasks: [makeTask(kind, "case-op2", { delivery_state: "submitting", started_at: START_ISO })],
        filings: [],
      };
      const supabase = makeSupabase(store);
      const first = await reconcileStaleSubmittingOwnedFilings(supabase, {
        nowMs: STALE_NOW_MS,
        timeoutMs: TIMEOUT_MS,
      });
      expect(first.sent_to_operator).toBeGreaterThanOrEqual(1);

      appendCaseTimelineEntry.mockClear();
      const second = await reconcileStaleSubmittingOwnedFilings(supabase, {
        nowMs: STALE_NOW_MS + 60 * 60 * 1000,
        timeoutMs: TIMEOUT_MS,
      });
      // Second pass finds a failed (not submitting) task → skipped, no new operator transition.
      const result = second.results.find((r) => r.case_id === "case-op2" && r.kind === kind);
      expect(result?.outcome).toBe("skipped");
      expect(second.sent_to_operator).toBe(0);
      expect(second.finalized_filed).toBe(0);
      expect(appendCaseTimelineEntry).not.toHaveBeenCalled();
    });

    it("does not crash and reports nothing when the task query fails", async () => {
      const store: Store = { tasks: [], filings: [], tasksError: true };
      const summary = await reconcileStaleSubmittingOwnedFilings(makeSupabase(store), {
        nowMs: STALE_NOW_MS,
        timeoutMs: TIMEOUT_MS,
      });
      expect(summary.scanned).toBe(0);
      expect(summary.results).toHaveLength(0);
    });

    it("leaves a stale task submitting when the filings lookup fails", async () => {
      const store: Store = {
        tasks: [makeTask(kind, "case-dberr", { delivery_state: "submitting", started_at: START_ISO })],
        filings: [],
        filingsError: true,
      };
      const summary = await reconcileStaleSubmittingOwnedFilings(makeSupabase(store), {
        nowMs: STALE_NOW_MS,
        timeoutMs: TIMEOUT_MS,
      });
      const result = summary.results.find((r) => r.case_id === "case-dberr" && r.kind === kind);
      expect(result?.outcome).toBe("error");
      expect(summary.errors).toBeGreaterThanOrEqual(1);
      // still submitting so a later run can retry
      expect(cfg.parseRecord(store.tasks[0].notes)?.delivery_state).toBe("submitting");
      expect(cfg.complete).not.toHaveBeenCalled();
    });
  }
);

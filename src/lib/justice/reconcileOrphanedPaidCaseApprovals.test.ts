import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DurableIntendedAction } from "@/lib/justice/durablePaymentIntendedAction";
import type { FinalizePaidPreparedPacketApprovalResult } from "@/lib/justice/finalizePaidPreparedPacketApproval";
import type { ResolveIntendedPreparedActionResult } from "@/lib/justice/resolveIntendedPreparedAction";
import { buildJusticeIntakeFromParts, defaultBuildJusticeIntakeParts } from "@/lib/justice/buildJusticeIntake";
import { parseKeysetOrFilter } from "@/lib/justice/reconcilerKeysetPaginationTestSupport";

const finalizeMock = vi.fn<(...args: unknown[]) => Promise<FinalizePaidPreparedPacketApprovalResult>>(
  async () => ({ status: "finalized" })
);
vi.mock("@/lib/justice/finalizePaidPreparedPacketApproval", () => ({
  finalizePaidPreparedPacketApproval: (...args: unknown[]) => finalizeMock(...args),
}));

const resolveIntendedMock = vi.fn<
  (...args: unknown[]) => Promise<ResolveIntendedPreparedActionResult>
>(async () => ({ status: "unused" }) as unknown as ResolveIntendedPreparedActionResult);
vi.mock("@/lib/justice/resolveIntendedPreparedAction", () => ({
  resolveIntendedPreparedAction: (...args: unknown[]) => resolveIntendedMock(...args),
}));

const ensureReviewTaskMock = vi.fn<
  (...args: unknown[]) => Promise<{ task: null; timeline: null; created: boolean }>
>(async () => ({ task: null, timeline: null, created: true }));
vi.mock("@/lib/justice/orphanedPaidCaseApprovalTask", () => ({
  ensureOrphanedPaidCaseApprovalTask: (...args: unknown[]) => ensureReviewTaskMock(...args),
}));

const durableMock = vi.fn<(...args: unknown[]) => Promise<DurableIntendedAction | null>>(
  async () => null
);
vi.mock("@/lib/justice/durablePaymentIntendedAction", () => ({
  findDurableIntendedActionForCase: (...args: unknown[]) => durableMock(...args),
}));

import { reconcileOrphanedPaidCaseApprovals } from "@/lib/justice/reconcileOrphanedPaidCaseApprovals";

type CaseRow = {
  id: string;
  user_id: string;
  intake: unknown;
  client_state: Record<string, unknown>;
  paid_at: string | null;
  archived_at: string | null;
  updated_at: string;
};

type Store = { cases: CaseRow[] };

function makeSupabase(store: Store): SupabaseClient {
  const from = (table: string) => {
    if (table !== "justice_cases") throw new Error(`unexpected table ${table}`);

    const state: {
      filters: Record<string, string>;
      notNullFilters: string[];
      isNullFilters: string[];
      cursor: { updatedAt: string; id: string } | null;
      orderBy: { col: string; ascending: boolean }[];
    } = { filters: {}, notNullFilters: [], isNullFilters: [], cursor: null, orderBy: [] };

    const resolveSelect = (limit?: number) => {
      let rows = store.cases.filter((c) => {
        for (const col of state.notNullFilters) {
          if ((c as unknown as Record<string, unknown>)[col] == null) return false;
        }
        for (const col of state.isNullFilters) {
          if ((c as unknown as Record<string, unknown>)[col] != null) return false;
        }
        return true;
      });
      if (state.cursor) {
        const cursor = state.cursor;
        rows = rows.filter(
          (c) =>
            c.updated_at > cursor.updatedAt || (c.updated_at === cursor.updatedAt && c.id > cursor.id)
        );
      }
      for (const { col, ascending } of [...state.orderBy].reverse()) {
        rows = [...rows].sort((a, b) => {
          const av = String((a as unknown as Record<string, unknown>)[col] ?? "");
          const bv = String((b as unknown as Record<string, unknown>)[col] ?? "");
          const cmp = av < bv ? -1 : av > bv ? 1 : 0;
          return ascending ? cmp : -cmp;
        });
      }
      if (limit != null) rows = rows.slice(0, limit);
      return { data: rows, error: null };
    };

    const builder: Record<string, unknown> = {
      select: () => builder,
      not: (col: string, op: string) => {
        if (op === "is") state.notNullFilters.push(col);
        return builder;
      },
      is: (col: string) => {
        state.isNullFilters.push(col);
        return builder;
      },
      eq: (col: string, val: string) => {
        state.filters[col] = val;
        return builder;
      },
      or: (filter: string) => {
        state.cursor = parseKeysetOrFilter(filter);
        return builder;
      },
      order: (col: string, opts?: { ascending?: boolean }) => {
        state.orderBy.push({ col, ascending: opts?.ascending !== false });
        return builder;
      },
      limit: (n: number) => Promise.resolve(resolveSelect(n)),
    };
    return builder as unknown as ReturnType<SupabaseClient["from"]>;
  };
  return { from } as unknown as SupabaseClient;
}

function validIntake(): unknown {
  return buildJusticeIntakeFromParts({
    ...defaultBuildJusticeIntakeParts(),
    problem_category: "online_purchase",
    company_name: "Acme Retail",
    already_contacted: "yes",
  });
}

function paidCase(overrides: Partial<CaseRow> & { id: string }): CaseRow {
  return {
    user_id: `user_${overrides.id}`,
    intake: validIntake(),
    client_state: {},
    paid_at: new Date().toISOString(),
    archived_at: null,
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("reconcileOrphanedPaidCaseApprovals", () => {
  beforeEach(() => {
    finalizeMock.mockReset().mockResolvedValue({ status: "finalized" });
    resolveIntendedMock.mockReset().mockResolvedValue({
      status: "ok" as never,
      ok: true,
      action: { href: "/justice/state-ag", label: "State Attorney General (consumer)" },
    } as ResolveIntendedPreparedActionResult);
    ensureReviewTaskMock.mockReset().mockResolvedValue({ task: null, timeline: null, created: true });
    durableMock.mockReset().mockResolvedValue(null);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("already-approved case: re-confirms its fulfillment task via finalize (reusing the settled action), not skipped as inert", async () => {
    const store: Store = {
      cases: [
        paidCase({
          id: "c1",
          client_state: {
            prepared_packet_approved: true,
            approved_next_action: { href: "/justice/state-ag", label: "State Attorney General (consumer)" },
          },
        }),
      ],
    };
    finalizeMock.mockResolvedValue({ status: "already_finalized" });
    const summary = await reconcileOrphanedPaidCaseApprovals(makeSupabase(store));

    expect(summary.already_approved).toBe(1);
    expect(summary.scanned).toBe(0);
    expect(finalizeMock).toHaveBeenCalledTimes(1);
    expect(finalizeMock.mock.calls[0][1]).toMatchObject({
      caseId: "c1",
      intendedAction: { href: "/justice/state-ag", label: "State Attorney General (consumer)" },
    });
    expect(resolveIntendedMock).not.toHaveBeenCalled();
    expect(durableMock).not.toHaveBeenCalled();
  });

  it("already-approved case with no href on file yet is a pure skip — nothing to confirm", async () => {
    const store: Store = {
      cases: [paidCase({ id: "c1", client_state: { prepared_packet_approved: true } })],
    };
    const summary = await reconcileOrphanedPaidCaseApprovals(makeSupabase(store));

    expect(summary.already_approved).toBe(1);
    expect(finalizeMock).not.toHaveBeenCalled();
  });

  it("already-approved case whose task-confirmation fails is counted as failed for retry on the next run", async () => {
    const store: Store = {
      cases: [
        paidCase({
          id: "c1",
          client_state: {
            prepared_packet_approved: true,
            approved_next_action: { href: "/justice/state-ag", label: "State AG" },
          },
        }),
      ],
    };
    finalizeMock.mockResolvedValue({ status: "error", error: "task insert down" });
    const summary = await reconcileOrphanedPaidCaseApprovals(makeSupabase(store));

    expect(summary.already_approved).toBe(0);
    expect(summary.failed).toBe(1);
    expect(summary.results[0]).toMatchObject({ case_id: "c1", kind: "failed", reason: "error" });
  });

  it("true legacy orphan (no durable payment binding): recomputes and finalizes automatically when unambiguous", async () => {
    const store: Store = { cases: [paidCase({ id: "c1" })] };
    const summary = await reconcileOrphanedPaidCaseApprovals(makeSupabase(store));

    expect(summary.scanned).toBe(1);
    expect(summary.finalized).toBe(1);
    expect(durableMock).toHaveBeenCalledTimes(1);
    expect(resolveIntendedMock).toHaveBeenCalledTimes(1);
    expect(finalizeMock).toHaveBeenCalledTimes(1);
    expect(finalizeMock.mock.calls[0][1]).toMatchObject({
      caseId: "c1",
      intendedAction: { href: "/justice/state-ag" },
    });
    expect(ensureReviewTaskMock).not.toHaveBeenCalled();
  });

  it("durable metadata-bound action agrees with a fresh recompute: finalizes automatically with the durable value", async () => {
    durableMock.mockResolvedValue({ href: "/justice/state-ag", label: "State AG (paid)" });
    const store: Store = { cases: [paidCase({ id: "c1" })] };
    const summary = await reconcileOrphanedPaidCaseApprovals(makeSupabase(store));

    expect(summary.finalized).toBe(1);
    expect(finalizeMock.mock.calls[0][1]).toMatchObject({
      intendedAction: { href: "/justice/state-ag", label: "State AG (paid)" },
    });
    expect(ensureReviewTaskMock).not.toHaveBeenCalled();
  });

  it("never reinterprets a metadata-bound mismatch as a different action: durable action disagrees with the fresh recompute, so neither is guessed — flags for review instead", async () => {
    durableMock.mockResolvedValue({ href: "/justice/merchant", label: "Merchant contact" });
    resolveIntendedMock.mockResolvedValue({
      ok: true,
      action: { href: "/justice/state-ag", label: "State Attorney General (consumer)" },
    } as ResolveIntendedPreparedActionResult);
    const store: Store = { cases: [paidCase({ id: "c1" })] };
    const summary = await reconcileOrphanedPaidCaseApprovals(makeSupabase(store));

    expect(summary.finalized).toBe(0);
    expect(summary.flagged_for_review).toBe(1);
    expect(finalizeMock).not.toHaveBeenCalled();
    expect(ensureReviewTaskMock).toHaveBeenCalledTimes(1);
    expect(ensureReviewTaskMock.mock.calls[0][3]).toBe("durable_intent_mismatch");
  });

  it("never guesses the durable action past a failed recompute either: durable action present but current intake resolves to no routable destination — flags for review, does not blindly trust the durable href", async () => {
    durableMock.mockResolvedValue({ href: "/justice/state-ag", label: "State AG" });
    resolveIntendedMock.mockResolvedValue({ ok: false, reason: "no_routable_destination" });
    const store: Store = { cases: [paidCase({ id: "c1" })] };
    const summary = await reconcileOrphanedPaidCaseApprovals(makeSupabase(store));

    expect(summary.flagged_for_review).toBe(1);
    expect(finalizeMock).not.toHaveBeenCalled();
    expect(ensureReviewTaskMock.mock.calls[0][3]).toBe("durable_intent_mismatch");
  });

  it("ambiguous historical orphan handling: invalid intake creates a durable review task instead of guessing", async () => {
    const store: Store = { cases: [paidCase({ id: "c1", intake: { not: "a real intake" } })] };
    const summary = await reconcileOrphanedPaidCaseApprovals(makeSupabase(store));

    expect(summary.scanned).toBe(1);
    expect(summary.flagged_for_review).toBe(1);
    expect(summary.finalized).toBe(0);
    expect(finalizeMock).not.toHaveBeenCalled();
    expect(resolveIntendedMock).not.toHaveBeenCalled();
    expect(durableMock).not.toHaveBeenCalled();
    expect(ensureReviewTaskMock).toHaveBeenCalledTimes(1);
    expect(ensureReviewTaskMock.mock.calls[0][3]).toBe("invalid_intake");
  });

  it("ambiguous historical orphan handling: no routable destination (no durable binding either) creates a durable review task instead of guessing", async () => {
    resolveIntendedMock.mockResolvedValue({ ok: false, reason: "no_routable_destination" });
    const store: Store = { cases: [paidCase({ id: "c1" })] };
    const summary = await reconcileOrphanedPaidCaseApprovals(makeSupabase(store));

    expect(summary.flagged_for_review).toBe(1);
    expect(finalizeMock).not.toHaveBeenCalled();
    expect(ensureReviewTaskMock).toHaveBeenCalledTimes(1);
    expect(ensureReviewTaskMock.mock.calls[0][3]).toBe("no_routable_destination");
  });

  it("ambiguous historical orphan handling: a resolve-action query error also creates a durable review task rather than retrying forever", async () => {
    resolveIntendedMock.mockResolvedValue({ ok: false, reason: "error", error: "evidence lookup down" });
    const store: Store = { cases: [paidCase({ id: "c1" })] };
    const summary = await reconcileOrphanedPaidCaseApprovals(makeSupabase(store));

    expect(summary.flagged_for_review).toBe(1);
    expect(ensureReviewTaskMock.mock.calls[0][3]).toBe("evidence lookup down");
  });

  it("excludes archived cases entirely", async () => {
    const store: Store = { cases: [paidCase({ id: "c1", archived_at: new Date().toISOString() })] };
    const summary = await reconcileOrphanedPaidCaseApprovals(makeSupabase(store));

    expect(summary.scanned).toBe(0);
    expect(finalizeMock).not.toHaveBeenCalled();
    expect(ensureReviewTaskMock).not.toHaveBeenCalled();
  });

  it("counts a retryable finalize failure as failed, not flagged — left for the next scheduled run", async () => {
    finalizeMock.mockResolvedValue({ status: "conflict_retries_exhausted" });
    const store: Store = { cases: [paidCase({ id: "c1" })] };
    const summary = await reconcileOrphanedPaidCaseApprovals(makeSupabase(store));

    expect(summary.failed).toBe(1);
    expect(summary.finalized).toBe(0);
    expect(ensureReviewTaskMock).not.toHaveBeenCalled();
  });

  it("paginates via keyset cursor to reach a case beyond the first page", async () => {
    const baseMs = Date.parse("2026-08-01T00:00:00.000Z");
    const cases: CaseRow[] = Array.from({ length: 3 }, (_, i) =>
      paidCase({
        id: `case-${i}`,
        client_state: { prepared_packet_approved: true }, // noise: already approved, no href on file
        updated_at: new Date(baseMs + i * 1000).toISOString(),
      })
    );
    const target = paidCase({ id: "case-target", updated_at: new Date(baseMs + 3 * 1000).toISOString() });
    const store: Store = { cases: [...cases, target] };

    const summary = await reconcileOrphanedPaidCaseApprovals(makeSupabase(store), { limit: 2 });

    expect(summary.already_approved).toBe(3);
    expect(summary.scanned).toBe(1);
    expect(summary.finalized).toBe(1);
    expect(finalizeMock).toHaveBeenCalledTimes(1);
    expect(finalizeMock.mock.calls[0][1]).toMatchObject({ caseId: "case-target" });
  });
});

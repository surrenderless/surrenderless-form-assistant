import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { findDurableIntendedActionForCase } from "@/lib/justice/durablePaymentIntendedAction";

type PaymentRow = {
  case_id: string;
  intended_action_href: string | null;
  intended_action_label: string | null;
  created_at: string;
};

type Store = { payments: PaymentRow[]; failSelect?: boolean };

function makeSupabase(store: Store): SupabaseClient {
  const from = (table: string) => {
    if (table !== "justice_case_payments") throw new Error(`unexpected table ${table}`);

    const state: { caseId?: string; notNullFilters: string[]; orderCol?: string; ascending?: boolean } = {
      notNullFilters: [],
    };

    const resolve = (limit?: number) => {
      if (store.failSelect) return { data: null, error: { message: "payments lookup down" } };
      let rows = store.payments.filter((p) => p.case_id === state.caseId);
      for (const col of state.notNullFilters) {
        rows = rows.filter((p) => (p as unknown as Record<string, unknown>)[col] != null);
      }
      if (state.orderCol) {
        rows = [...rows].sort((a, b) => {
          const av = String((a as unknown as Record<string, unknown>)[state.orderCol as string] ?? "");
          const bv = String((b as unknown as Record<string, unknown>)[state.orderCol as string] ?? "");
          const cmp = av < bv ? -1 : av > bv ? 1 : 0;
          return state.ascending ? cmp : -cmp;
        });
      }
      if (limit != null) rows = rows.slice(0, limit);
      return { data: rows, error: null };
    };

    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: (col: string, val: string) => {
        if (col === "case_id") state.caseId = val;
        return builder;
      },
      not: (col: string, op: string) => {
        if (op === "is") state.notNullFilters.push(col);
        return builder;
      },
      order: (col: string, opts?: { ascending?: boolean }) => {
        state.orderCol = col;
        state.ascending = opts?.ascending !== false;
        return builder;
      },
      limit: async (n: number) => resolve(n),
    };
    return builder as unknown as ReturnType<SupabaseClient["from"]>;
  };
  return { from } as unknown as SupabaseClient;
}

const CASE_ID = "case-1";

describe("findDurableIntendedActionForCase", () => {
  it("returns null when no payment row for this case carries a binding", async () => {
    const store: Store = { payments: [] };
    const result = await findDurableIntendedActionForCase(makeSupabase(store), CASE_ID);
    expect(result).toBeNull();
  });

  it("returns null (legacy fallback) when the only payment row predates the binding (nulls)", async () => {
    const store: Store = {
      payments: [
        {
          case_id: CASE_ID,
          intended_action_href: null,
          intended_action_label: null,
          created_at: "2026-01-01T00:00:00.000Z",
        },
      ],
    };
    const result = await findDurableIntendedActionForCase(makeSupabase(store), CASE_ID);
    expect(result).toBeNull();
  });

  it("returns the bound href/label when present", async () => {
    const store: Store = {
      payments: [
        {
          case_id: CASE_ID,
          intended_action_href: "/justice/state-ag",
          intended_action_label: "State Attorney General (consumer)",
          created_at: "2026-01-01T00:00:00.000Z",
        },
      ],
    };
    const result = await findDurableIntendedActionForCase(makeSupabase(store), CASE_ID);
    expect(result).toEqual({
      href: "/justice/state-ag",
      label: "State Attorney General (consumer)",
    });
  });

  it("prefers the most recent binding when multiple payment rows exist for the case", async () => {
    const store: Store = {
      payments: [
        {
          case_id: CASE_ID,
          intended_action_href: "/justice/merchant",
          intended_action_label: "Merchant contact",
          created_at: "2026-01-01T00:00:00.000Z",
        },
        {
          case_id: CASE_ID,
          intended_action_href: "/justice/state-ag",
          intended_action_label: "State Attorney General (consumer)",
          created_at: "2026-02-01T00:00:00.000Z",
        },
      ],
    };
    const result = await findDurableIntendedActionForCase(makeSupabase(store), CASE_ID);
    expect(result?.href).toBe("/justice/state-ag");
  });

  it("never returns a different case's binding", async () => {
    const store: Store = {
      payments: [
        {
          case_id: "other-case",
          intended_action_href: "/justice/state-ag",
          intended_action_label: "State AG",
          created_at: "2026-01-01T00:00:00.000Z",
        },
      ],
    };
    const result = await findDurableIntendedActionForCase(makeSupabase(store), CASE_ID);
    expect(result).toBeNull();
  });

  it("falls back to href when label is empty", async () => {
    const store: Store = {
      payments: [
        {
          case_id: CASE_ID,
          intended_action_href: "/justice/bbb",
          intended_action_label: "",
          created_at: "2026-01-01T00:00:00.000Z",
        },
      ],
    };
    const result = await findDurableIntendedActionForCase(makeSupabase(store), CASE_ID);
    expect(result).toEqual({ href: "/justice/bbb", label: "/justice/bbb" });
  });

  it("fails safe (returns null, never throws) on a query error", async () => {
    const store: Store = { payments: [], failSelect: true };
    const result = await findDurableIntendedActionForCase(makeSupabase(store), CASE_ID);
    expect(result).toBeNull();
  });
});

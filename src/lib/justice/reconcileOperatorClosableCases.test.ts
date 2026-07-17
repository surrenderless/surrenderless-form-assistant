import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CompleteOperatorCaseArchiveResult,
  OperatorClosableCaseItem,
  OperatorOwnedClosableOutcome,
} from "@/lib/justice/operatorOwnedCaseArchive";

const listOperatorClosableCases = vi.fn();
const completeOperatorCaseArchive = vi.fn();
const resolveCaseOwnerUserIdForOperatorFulfillment = vi.fn();

vi.mock("@/lib/justice/operatorOwnedCaseArchive", () => ({
  listOperatorClosableCases: (...args: unknown[]) => listOperatorClosableCases(...args),
  completeOperatorCaseArchive: (...args: unknown[]) => completeOperatorCaseArchive(...args),
}));

vi.mock("@/lib/justice/operatorFulfillmentQueue", () => ({
  resolveCaseOwnerUserIdForOperatorFulfillment: (...args: unknown[]) =>
    resolveCaseOwnerUserIdForOperatorFulfillment(...args),
}));

import { reconcileOperatorClosableCases } from "@/lib/justice/reconcileOperatorClosableCases";

const SUPABASE = {} as unknown as SupabaseClient;

function closableItem(
  caseId: string,
  outcome: OperatorOwnedClosableOutcome
): OperatorClosableCaseItem {
  return {
    case_id: caseId,
    case_owner_user_id: `owner-${caseId}`,
    company_name: "Acme",
    consumer_us_state: "CA",
    outcome,
    outcome_note: `note-${caseId}`,
  };
}

function archivedResult(
  caseId: string,
  outcome: OperatorOwnedClosableOutcome,
  idempotent = false
): CompleteOperatorCaseArchiveResult {
  return {
    ok: true,
    caseId,
    archived_at: "2026-07-17T15:00:00.000Z",
    timeline: null,
    outcome,
    idempotent,
  };
}

beforeEach(() => {
  listOperatorClosableCases.mockReset();
  completeOperatorCaseArchive.mockReset();
  resolveCaseOwnerUserIdForOperatorFulfillment.mockReset();
  resolveCaseOwnerUserIdForOperatorFulfillment.mockImplementation(
    async (_supabase: SupabaseClient, caseId: string) => ({ ok: true, userId: `owner-${caseId}` })
  );
});

describe("reconcileOperatorClosableCases", () => {
  it("archives both terminal resolved and no_resolution eligible cases", async () => {
    listOperatorClosableCases.mockResolvedValue([
      closableItem("case-resolved", "resolved"),
      closableItem("case-no-res", "no_resolution"),
    ]);
    completeOperatorCaseArchive.mockImplementation(
      async (_s: SupabaseClient, _u: string, input: { caseId: string }) =>
        archivedResult(
          input.caseId,
          input.caseId === "case-resolved" ? "resolved" : "no_resolution"
        )
    );

    const summary = await reconcileOperatorClosableCases(SUPABASE);

    expect(summary).toMatchObject({ attempted: 2, archived: 2, skipped: 0, failed: 0 });
    expect(completeOperatorCaseArchive).toHaveBeenCalledTimes(2);
    // Both closed with explicit operator confirmation.
    for (const call of completeOperatorCaseArchive.mock.calls) {
      expect(call[2]).toMatchObject({ confirmArchive: true });
    }
    expect(summary.results.map((r) => r.kind)).toEqual(["archived", "archived"]);
  });

  it("skips already archived, nonterminal, and open-review cases", async () => {
    listOperatorClosableCases.mockResolvedValue([
      closableItem("case-archived", "resolved"),
      closableItem("case-nonterminal", "resolved"),
      closableItem("case-open-review", "no_resolution"),
    ]);
    completeOperatorCaseArchive.mockImplementation(
      async (_s: SupabaseClient, _u: string, input: { caseId: string }) => {
        if (input.caseId === "case-archived") {
          return archivedResult("case-archived", "resolved", true);
        }
        if (input.caseId === "case-nonterminal") {
          return {
            ok: false as const,
            error:
              "Case is not eligible for operator close (requires recorded resolved or no-resolution outcome)",
            status: 409,
          };
        }
        return {
          ok: false as const,
          error: "Response review is still open; complete it before closing",
          status: 409,
        };
      }
    );

    const summary = await reconcileOperatorClosableCases(SUPABASE);

    expect(summary).toMatchObject({ attempted: 3, archived: 0, skipped: 3, failed: 0 });
    expect(summary.results.every((r) => r.kind === "skipped")).toBe(true);
  });

  it("creates no duplicate archive work on rerun once cases are archived", async () => {
    // First sweep archives the eligible case.
    listOperatorClosableCases.mockResolvedValueOnce([closableItem("case-1", "resolved")]);
    completeOperatorCaseArchive.mockResolvedValueOnce(archivedResult("case-1", "resolved"));

    const first = await reconcileOperatorClosableCases(SUPABASE);
    expect(first).toMatchObject({ attempted: 1, archived: 1, skipped: 0, failed: 0 });

    // Second sweep: listOperatorClosableCases excludes the now-archived case.
    listOperatorClosableCases.mockResolvedValueOnce([]);

    const second = await reconcileOperatorClosableCases(SUPABASE);
    expect(second).toMatchObject({ attempted: 0, archived: 0, skipped: 0, failed: 0 });
    // No additional archive work beyond the first sweep.
    expect(completeOperatorCaseArchive).toHaveBeenCalledTimes(1);
  });

  it("continues the batch when one case fails", async () => {
    listOperatorClosableCases.mockResolvedValue([
      closableItem("case-throws", "resolved"),
      closableItem("case-500", "resolved"),
      closableItem("case-ok", "no_resolution"),
    ]);
    completeOperatorCaseArchive.mockImplementation(
      async (_s: SupabaseClient, _u: string, input: { caseId: string }) => {
        if (input.caseId === "case-throws") {
          throw new Error("supabase down");
        }
        if (input.caseId === "case-500") {
          return { ok: false as const, error: "Could not archive case", status: 500 };
        }
        return archivedResult("case-ok", "no_resolution");
      }
    );

    const summary = await reconcileOperatorClosableCases(SUPABASE);

    expect(summary).toMatchObject({ attempted: 3, archived: 1, skipped: 0, failed: 2 });
    // The later eligible case is still archived despite earlier failures.
    expect(completeOperatorCaseArchive).toHaveBeenCalledTimes(3);
    expect(summary.results.find((r) => r.case_id === "case-ok")?.kind).toBe("archived");
  });

  it("counts owner-resolution failure as a failed case without stopping the batch", async () => {
    listOperatorClosableCases.mockResolvedValue([
      closableItem("case-noowner", "resolved"),
      closableItem("case-ok", "resolved"),
    ]);
    resolveCaseOwnerUserIdForOperatorFulfillment.mockImplementation(
      async (_s: SupabaseClient, caseId: string) =>
        caseId === "case-noowner"
          ? { ok: false, error: "Not found", status: 404 }
          : { ok: true, userId: `owner-${caseId}` }
    );
    completeOperatorCaseArchive.mockResolvedValue(archivedResult("case-ok", "resolved"));

    const summary = await reconcileOperatorClosableCases(SUPABASE);

    expect(summary).toMatchObject({ attempted: 2, archived: 1, failed: 1 });
    expect(completeOperatorCaseArchive).toHaveBeenCalledTimes(1);
  });

  it("returns an empty summary when listing fails", async () => {
    listOperatorClosableCases.mockRejectedValue(new Error("list down"));

    const summary = await reconcileOperatorClosableCases(SUPABASE);

    expect(summary).toEqual({ attempted: 0, archived: 0, skipped: 0, failed: 0, results: [] });
    expect(completeOperatorCaseArchive).not.toHaveBeenCalled();
  });
});

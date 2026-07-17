import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveCaseOwnerUserIdForOperatorFulfillment } from "@/lib/justice/operatorFulfillmentQueue";
import {
  completeOperatorCaseArchive,
  listOperatorClosableCases,
  type OperatorClosableCaseItem,
  type OperatorOwnedClosableOutcome,
} from "@/lib/justice/operatorOwnedCaseArchive";

export type ReconcileOperatorClosableCaseResultKind = "archived" | "skipped" | "failed";

export type ReconcileOperatorClosableCaseResult = {
  case_id: string;
  user_id: string | null;
  kind: ReconcileOperatorClosableCaseResultKind;
  outcome?: OperatorOwnedClosableOutcome;
  reason?: string;
};

export type ReconcileOperatorClosableCasesSummary = {
  attempted: number;
  archived: number;
  skipped: number;
  failed: number;
  results: ReconcileOperatorClosableCaseResult[];
};

function emptySummary(): ReconcileOperatorClosableCasesSummary {
  return { attempted: 0, archived: 0, skipped: 0, failed: 0, results: [] };
}

/**
 * Durable auto-closure for operator-owned closable cases.
 *
 * Sweeps cases with a recorded terminal response-review outcome (resolved or
 * no_resolution) that are ladder-eligible and not yet archived, and archives them
 * via the existing completeOperatorCaseArchive path. The operator has already
 * confirmed the outcome during response review, so both terminal outcomes are
 * closed automatically here.
 *
 * Idempotent and fail-open per case: an already-archived case is skipped, a
 * benign 409 (still open / not eligible) is skipped, and a single case failure
 * never stops the rest of the batch.
 */
export async function reconcileOperatorClosableCases(
  supabase: SupabaseClient,
  options: { limit?: number } = {}
): Promise<ReconcileOperatorClosableCasesSummary> {
  const summary = emptySummary();

  let candidates: OperatorClosableCaseItem[];
  try {
    candidates = await listOperatorClosableCases(supabase, { limit: options.limit ?? 50 });
  } catch (error) {
    console.warn("reconcile owned closable cases: list", error);
    return summary;
  }

  summary.attempted = candidates.length;

  for (const candidate of candidates) {
    const caseId = candidate.case_id?.trim() ?? "";
    if (!caseId) {
      summary.results.push({ case_id: "", user_id: null, kind: "failed", reason: "invalid_case_id" });
      summary.failed += 1;
      continue;
    }

    try {
      const owner = await resolveCaseOwnerUserIdForOperatorFulfillment(supabase, caseId);
      if (!owner.ok) {
        summary.results.push({ case_id: caseId, user_id: null, kind: "failed", reason: owner.error });
        summary.failed += 1;
        continue;
      }

      const result = await completeOperatorCaseArchive(supabase, owner.userId, {
        caseId,
        confirmArchive: true,
      });

      if (result.ok) {
        if (result.idempotent) {
          summary.results.push({
            case_id: caseId,
            user_id: owner.userId,
            kind: "skipped",
            outcome: result.outcome,
            reason: "already_archived",
          });
          summary.skipped += 1;
        } else {
          summary.results.push({
            case_id: caseId,
            user_id: owner.userId,
            kind: "archived",
            outcome: result.outcome,
          });
          summary.archived += 1;
        }
        continue;
      }

      // A 409 means the case is no longer eligible (still-open review, missing
      // terminal outcome, or a race with another closer). That is a benign skip,
      // not a batch failure. Any other error is a real failure.
      if (result.status === 409) {
        summary.results.push({
          case_id: caseId,
          user_id: owner.userId,
          kind: "skipped",
          reason: result.error,
        });
        summary.skipped += 1;
      } else {
        summary.results.push({
          case_id: caseId,
          user_id: owner.userId,
          kind: "failed",
          reason: result.error,
        });
        summary.failed += 1;
      }
    } catch (error) {
      console.warn("reconcile owned closable cases: archive", caseId, error);
      summary.results.push({ case_id: caseId, user_id: null, kind: "failed", reason: "exception" });
      summary.failed += 1;
    }
  }

  return summary;
}

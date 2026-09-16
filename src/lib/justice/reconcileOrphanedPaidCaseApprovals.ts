import type { SupabaseClient } from "@supabase/supabase-js";
import { parseJusticeCaseClientState } from "@/lib/justice/approvedNextActionState";
import { isJusticeIntakePayload } from "@/lib/justice/caseApiValidation";
import { finalizePaidPreparedPacketApproval } from "@/lib/justice/finalizePaidPreparedPacketApproval";
import { ensureOrphanedPaidCaseApprovalTask } from "@/lib/justice/orphanedPaidCaseApprovalTask";
import {
  applyKeysetCursor,
  nextKeysetCursor,
  type KeysetCursor,
} from "@/lib/justice/reconcilerKeysetPagination";
import { resolveIntendedPreparedAction } from "@/lib/justice/resolveIntendedPreparedAction";
import type { JusticeIntake } from "@/lib/justice/types";

const CASE_SELECT =
  "id, user_id, intake, client_state, paid_at, archived_at, updated_at" as const;

export type ReconcileOrphanedPaidCaseApprovalsResultKind =
  | "already_approved"
  | "finalized"
  | "flagged_for_review"
  | "failed";

export type ReconcileOrphanedPaidCaseApprovalsResult = {
  case_id: string;
  user_id: string;
  kind: ReconcileOrphanedPaidCaseApprovalsResultKind;
  reason?: string;
};

export type ReconcileOrphanedPaidCaseApprovalsSummary = {
  scanned: number;
  already_approved: number;
  finalized: number;
  flagged_for_review: number;
  failed: number;
  results: ReconcileOrphanedPaidCaseApprovalsResult[];
};

function emptySummary(): ReconcileOrphanedPaidCaseApprovalsSummary {
  return { scanned: 0, already_approved: 0, finalized: 0, flagged_for_review: 0, failed: 0, results: [] };
}

/**
 * Safety-net recovery for paid cases whose approval was never finalized — the primary path is
 * finalizePaidPreparedPacketApproval running inline from the Stripe webhook itself
 * (processStripeCheckoutCompletedEvent.ts); this reconciler exists for two situations that path
 * cannot cover on its own:
 *
 * 1. A "legacy orphan" — a case paid before the checkout route started binding an intended action
 *    into Stripe metadata (see resolveIntendedPreparedAction.ts / checkout/route.ts). The webhook
 *    has no intended_action_href to finalize with for these.
 * 2. Defense in depth against a webhook-side finalize call that failed for a reason a later retry
 *    could resolve (a transient DB error, a concurrent-write conflict) — safe to reattempt here
 *    since finalizePaidPreparedPacketApproval is itself idempotent.
 *
 * For each open case (paid_at set, not archived, prepared_packet_approved not yet true):
 * prefers any href already sitting on client_state.approved_next_action (e.g. left by a prior
 * partial PATCH) over recomputing; otherwise deterministically recomputes via
 * resolveIntendedPreparedAction from the case's own current intake. Finalizes automatically ONLY
 * when that resolves to a single, unambiguous, currently-routable destination. Never guesses:
 * invalid intake or no routable destination instead creates (idempotently) a durable, operator-
 * visible review task — picked up by the existing operator queue-alert mechanism
 * (operatorFallbackAlertReconciler.ts) exactly like every other destination, with the same
 * immediate/24h/72h/recurring schedule, not a one-shot notice.
 *
 * Paginated via the same keyset scheme as the other reconcilers so growing volume can never
 * strand an old case behind a fixed-size page.
 */
export async function reconcileOrphanedPaidCaseApprovals(
  supabase: SupabaseClient,
  options: { limit?: number } = {}
): Promise<ReconcileOrphanedPaidCaseApprovalsSummary> {
  const summary = emptySummary();
  const limit = options.limit ?? 100;

  let cursor: KeysetCursor = null;
  for (;;) {
    const { data, error } = await applyKeysetCursor(
      supabase
        .from("justice_cases")
        .select(CASE_SELECT)
        .not("paid_at", "is", null)
        .is("archived_at", null),
      cursor
    ).limit(limit);

    if (error) {
      console.warn("orphaned paid case approvals: list cases", error.message);
      break;
    }

    const rows = (data ?? []) as {
      id: string;
      user_id: string;
      intake: unknown;
      client_state: unknown;
      paid_at: string | null;
      archived_at: string | null;
      updated_at: string;
    }[];
    if (rows.length === 0) break;

    for (const row of rows) {
      const caseId = row.id?.trim() ?? "";
      const userId = row.user_id?.trim() ?? "";
      if (!caseId || !userId) continue;

      const state = parseJusticeCaseClientState(row.client_state);
      if (state.prepared_packet_approved === true) {
        summary.already_approved += 1;
        continue;
      }

      summary.scanned += 1;

      if (!isJusticeIntakePayload(row.intake)) {
        await ensureOrphanedPaidCaseApprovalTask(supabase, userId, caseId, "invalid_intake");
        summary.flagged_for_review += 1;
        summary.results.push({ case_id: caseId, user_id: userId, kind: "flagged_for_review", reason: "invalid_intake" });
        continue;
      }
      const intake = row.intake as JusticeIntake;

      // Prefer an href already on file — e.g. a prior PATCH attempt that wrote approved_next_action
      // but failed before prepared_packet_approved flipped to true. That is a stronger signal of
      // actual intent than a fresh recomputation, and must never be silently overridden by one.
      const existingHref = state.approved_next_action?.href?.trim();
      let intendedHref = existingHref || "";
      let intendedLabel = state.approved_next_action?.label?.trim() || "";

      if (!intendedHref) {
        const resolved = await resolveIntendedPreparedAction(supabase, { userId, caseId, intake });
        if (!resolved.ok) {
          const reason = resolved.reason === "error" ? resolved.error : resolved.reason;
          await ensureOrphanedPaidCaseApprovalTask(supabase, userId, caseId, reason);
          summary.flagged_for_review += 1;
          summary.results.push({ case_id: caseId, user_id: userId, kind: "flagged_for_review", reason });
          continue;
        }
        intendedHref = resolved.action.href?.trim() ?? "";
        intendedLabel = resolved.action.label?.trim() ?? "";
        if (!intendedHref) {
          await ensureOrphanedPaidCaseApprovalTask(supabase, userId, caseId, "no_routable_destination");
          summary.flagged_for_review += 1;
          summary.results.push({ case_id: caseId, user_id: userId, kind: "flagged_for_review", reason: "no_routable_destination" });
          continue;
        }
      }

      const finalizeResult = await finalizePaidPreparedPacketApproval(supabase, {
        caseId,
        userId,
        intendedAction: { href: intendedHref, label: intendedLabel || intendedHref },
      });

      if (finalizeResult.status === "finalized" || finalizeResult.status === "already_finalized") {
        summary.finalized += 1;
        summary.results.push({ case_id: caseId, user_id: userId, kind: "finalized" });
      } else {
        // Retryable on the next scheduled run (transient DB error, concurrency conflict, or a
        // race where the case became invalid/archived between the read above and this call).
        summary.failed += 1;
        summary.results.push({ case_id: caseId, user_id: userId, kind: "failed", reason: finalizeResult.status });
      }
    }

    if (rows.length < limit) break;
    cursor = nextKeysetCursor(rows);
  }

  return summary;
}

import type { SupabaseClient } from "@supabase/supabase-js";
import { parseJusticeCaseClientState } from "@/lib/justice/approvedNextActionState";
import { isJusticeIntakePayload } from "@/lib/justice/caseApiValidation";
import { findDurableIntendedActionForCase } from "@/lib/justice/durablePaymentIntendedAction";
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
 * Safety-net recovery for paid cases whose approval was never finalized, or whose approval was
 * finalized but whose fulfillment task creation failed — the primary path is
 * finalizePaidPreparedPacketApproval running inline from the Stripe webhook itself
 * (processStripeCheckoutCompletedEvent.ts); this reconciler exists for three situations that path
 * cannot cover on its own:
 *
 * 1. A "legacy orphan" — a case paid before the checkout route started binding an intended action
 *    into Stripe metadata (see resolveIntendedPreparedAction.ts / checkout/route.ts). The webhook
 *    has no intended_action_href to finalize with for these.
 * 2. Defense in depth against a webhook-side finalize call that failed before ever writing
 *    client_state (a transient DB error, a concurrent-write conflict) — safe to reattempt here
 *    since finalizePaidPreparedPacketApproval is itself idempotent.
 * 3. Approved-but-taskless recovery: a case whose client_state was already durably written
 *    (prepared_packet_approved: true) but whose fulfillment-task creation then failed. This
 *    reconciler revisits EVERY paid, non-archived case every run — not only unapproved ones — and
 *    re-attempts finalizePaidPreparedPacketApproval with the case's own already-approved action,
 *    which idempotently re-ensures the fulfillment task (and closes any now-stale orphan-review
 *    task) without re-deciding what was approved.
 *
 * For a case not yet approved: NEVER trusts client_state.approved_next_action.href as a signal of
 * intent — that field is writable by the consumer's own PATCH independent of any payment, so
 * treating it as authoritative here would let orphan recovery finalize an action nobody actually
 * paid for. Instead compares two independent, trustworthy sources: the durable metadata-bound
 * action recorded on the case's own Stripe payment row at checkout-creation time (what was
 * actually paid for), and a fresh recompute from the case's current intake (what would be
 * approved today). Finalizes automatically ONLY when both exist and agree — an unambiguous match.
 * Any disagreement (intake changed since checkout, so the paid-for action is no longer what
 * today's intake would produce), or the absence of either signal resolving cleanly, is uncertain
 * intent and is never guessed past: it creates (idempotently) a durable, operator-visible review
 * task instead — picked up by the existing operator queue-alert mechanism
 * (operatorFallbackAlertReconciler.ts) exactly like every other destination, and by the operator
 * fulfillment queue for manual resolution (operatorFulfillmentQueue.ts).
 *
 * Paginated via the same keyset scheme as the other reconcilers so growing volume can never
 * strand an old case behind a fixed-size page.
 *
 * Bounded scan, not a forever rescan: the query itself excludes any case with
 * orphan_recovery_confirmed_at already set (see finalizePaidPreparedPacketApproval.ts), so a
 * case that has ever been fully confirmed drops out of this scan permanently at the database
 * level rather than merely being skipped in application code after being fetched.
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
        .is("archived_at", null)
        .is("orphan_recovery_confirmed_at", null),
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
        // Already approved — confirm (idempotently) that its fulfillment task actually exists,
        // and close any now-stale orphan-review task. The href/label here are the SETTLED
        // approval, not a guess: reusing them is completing a decision already made, not
        // reinterpreting one.
        const approvedHref = state.approved_next_action?.href?.trim();
        const approvedLabel = state.approved_next_action?.label?.trim() || approvedHref;
        if (!approvedHref) {
          summary.already_approved += 1;
          continue;
        }
        const confirmResult = await finalizePaidPreparedPacketApproval(supabase, {
          caseId,
          userId,
          intendedAction: { href: approvedHref, label: approvedLabel || approvedHref },
        });
        if (confirmResult.status === "finalized" || confirmResult.status === "already_finalized") {
          summary.already_approved += 1;
        } else {
          summary.failed += 1;
          summary.results.push({
            case_id: caseId,
            user_id: userId,
            kind: "failed",
            reason: confirmResult.status,
          });
        }
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

      const [durable, resolved] = await Promise.all([
        findDurableIntendedActionForCase(supabase, caseId),
        resolveIntendedPreparedAction(supabase, { userId, caseId, intake }),
      ]);

      let intendedHref = "";
      let intendedLabel = "";
      let reviewReason: string | null = null;

      if (durable) {
        const recomputedHref = resolved.ok ? resolved.action.href?.trim() ?? "" : "";
        if (recomputedHref && recomputedHref === durable.href) {
          intendedHref = durable.href;
          intendedLabel = durable.label;
        } else {
          reviewReason = "durable_intent_mismatch";
        }
      } else if (resolved.ok) {
        intendedHref = resolved.action.href?.trim() ?? "";
        intendedLabel = resolved.action.label?.trim() ?? "";
        if (!intendedHref) {
          reviewReason = "no_routable_destination";
        }
      } else {
        reviewReason = resolved.reason === "error" ? resolved.error : resolved.reason;
      }

      if (reviewReason || !intendedHref) {
        const reason = reviewReason ?? "no_routable_destination";
        await ensureOrphanedPaidCaseApprovalTask(supabase, userId, caseId, reason);
        summary.flagged_for_review += 1;
        summary.results.push({ case_id: caseId, user_id: userId, kind: "flagged_for_review", reason });
        continue;
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

import type { SupabaseClient } from "@supabase/supabase-js";
import { parseJusticeCaseClientState } from "@/lib/justice/approvedNextActionState";
import { isJusticeIntakePayload } from "@/lib/justice/caseApiValidation";
import { ensureOwnedFilingTaskAfterClientStateWrite } from "@/lib/justice/ensureOwnedFilingTaskAfterClientStateWrite";
import { attemptAutomatedMerchantContactEmailDelivery } from "@/lib/justice/merchantContactEmailDelivery";
import { completeOrphanedPaidCaseApprovalTaskIfOpen } from "@/lib/justice/orphanedPaidCaseApprovalTask";
import { updateClientStateIfUnchanged } from "@/lib/justice/updateClientStateIfUnchanged";
import type { JusticeApprovedNextAction, JusticeIntake } from "@/lib/justice/types";

const CASE_SELECT =
  "id, user_id, client_state, intake, paid_at, payment_dispute_draft, case_version, orphan_recovery_confirmed_at" as const;

export type FinalizePaidPreparedPacketApprovalResult =
  | { status: "finalized" }
  | { status: "already_finalized" }
  | { status: "not_paid" }
  | { status: "case_not_found" }
  | { status: "invalid_intake" }
  | { status: "invalid_action" }
  | { status: "conflict_retries_exhausted" }
  | { status: "error"; error: string };

/**
 * Server-owned, idempotent finalization of a paid case's prepared-packet approval.
 *
 * This exists because the browser's own approval PATCH (persistPreparedPacketApprovalToCase)
 * requires a second, distinct click AFTER returning from Stripe Checkout — the "Approve prepared
 * packet" button renders the identical label before and after payment confirmation, so a consumer
 * who closes the tab, loses connectivity, or simply assumes payment = done leaves the case charged
 * with no approved_next_action, no fulfillment task, and (since every alerting mechanism in this
 * codebase only ever acts on an EXISTING task) no automated visibility to anyone. Finalizing here,
 * driven by the signed Stripe webhook rather than the browser, closes that gap: it writes
 * prepared_packet_approved + approved_next_action and ensures the resulting fulfillment task exists
 * (and, for merchant_contact, attempts automated outreach) — the exact side effects the browser's
 * PATCH would have triggered — regardless of whether the consumer ever returns to the site.
 *
 * Requires paid_at already set (never grants payment itself — that remains the webhook's own
 * separate, prior step). Safe against duplicate/concurrent invocation: re-reads fresh state and
 * re-checks prepared_packet_approved on every attempt, and writes via updateClientStateIfUnchanged
 * (optimistic concurrency on justice_cases.case_version, a monotonic integer — never updated_at)
 * so a losing concurrent writer — another redelivered webhook, a lagging browser PATCH, a cron
 * reconciler pass — retries against fresh state instead of silently clobbering whichever attempt
 * wins the race.
 *
 * Idempotent task-creation retry: the CAS write (prepared_packet_approved + approved_next_action)
 * and the fulfillment-task ensure are two separate steps, so a prior call can have durably
 * committed the approval write and then failed at the ensure step (a transient DB error inside
 * ensureOwnedFilingTaskAfterClientStateWrite). ensureOwnedFilingTaskAfterClientStateWrite is
 * ALWAYS attempted on every call — including when client_state was already approved by an earlier
 * call — never skipped as a side effect of the CAS write being a no-op this time. It is itself
 * idempotent (marker-based existence check before insert), so re-attempting it on an
 * already-fulfilled case is a cheap, safe no-op; re-attempting it on a case whose task creation
 * previously failed is exactly the retry that closes the gap. Errors from this step always
 * propagate as {status:"error"}, so both the Stripe webhook (which surfaces that as a 5xx and gets
 * redelivered) and the 5-minute orphan-recovery reconciler (which revisits every not-yet-confirmed
 * paid case) keep retrying until it succeeds.
 *
 * Bounded, not a forever rescan: once ensureOwnedFilingTaskAfterClientStateWrite succeeds,
 * justice_cases.orphan_recovery_confirmed_at is set exactly once, and every later call for that
 * case short-circuits immediately (no DB write, no ensure, no email-provider call) before even
 * reaching the intake-parsing step. The reconciler's own scan query additionally excludes
 * confirmed cases at the database level, so a case leaves the hot scan permanently after this.
 */
export async function finalizePaidPreparedPacketApproval(
  supabase: SupabaseClient,
  params: {
    caseId: string;
    userId: string;
    intendedAction: { href: string; label: string };
    maxAttempts?: number;
  }
): Promise<FinalizePaidPreparedPacketApprovalResult> {
  const caseId = params.caseId.trim();
  const userId = params.userId.trim();
  const href = params.intendedAction.href.trim();
  const label = params.intendedAction.label.trim() || href;
  if (!caseId || !userId || !href) {
    return { status: "invalid_action" };
  }

  const maxAttempts = params.maxAttempts ?? 5;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const { data: caseRow, error: caseErr } = await supabase
      .from("justice_cases")
      .select(CASE_SELECT)
      .eq("id", caseId)
      .eq("user_id", userId)
      .maybeSingle();

    if (caseErr) {
      return { status: "error", error: caseErr.message };
    }
    if (!caseRow) {
      return { status: "case_not_found" };
    }
    if (!caseRow.paid_at) {
      return { status: "not_paid" };
    }

    const existingState = parseJusticeCaseClientState(caseRow.client_state);

    // Already confirmed once — the one thing this function exists to guarantee (approval +
    // fulfillment task) is already durably true, and re-verifying it on every redelivery/cron
    // pass forever is exactly the unbounded rescan and repeated email-provider calls this check
    // exists to prevent. No further DB calls, no email-provider calls, nothing to retry.
    if (existingState.prepared_packet_approved === true && caseRow.orphan_recovery_confirmed_at) {
      return { status: "already_finalized" };
    }

    if (!isJusticeIntakePayload(caseRow.intake)) {
      return { status: "invalid_intake" };
    }

    let clientStateForEnsure: Record<string, unknown> = existingState;
    let justApproved = false;

    if (existingState.prepared_packet_approved !== true) {
      const nextAction: JusticeApprovedNextAction = {
        label,
        href,
        status: "approved",
        approved_at: new Date().toISOString(),
      };
      const nextClientState: Record<string, unknown> = {
        ...existingState,
        prepared_packet_approved: true,
        approved_next_action: nextAction,
      };

      const writeResult = await updateClientStateIfUnchanged(supabase, {
        caseId,
        userId,
        expectedCaseVersion: caseRow.case_version as number,
        clientState: nextClientState,
      });

      if (!writeResult.ok) {
        if (writeResult.status === 409) {
          // Someone else wrote client_state between our read and write (another concurrent
          // finalize attempt, or an unrelated case update) — re-read fresh state and retry rather
          // than giving up or overwriting.
          continue;
        }
        return { status: "error", error: writeResult.error };
      }

      clientStateForEnsure = nextClientState;
      justApproved = true;
    }

    const ownedEnsure = await ensureOwnedFilingTaskAfterClientStateWrite(supabase, {
      userId,
      caseId,
      clientState: clientStateForEnsure,
      intake: caseRow.intake as JusticeIntake,
      paymentDisputeDraft: caseRow.payment_dispute_draft,
    });
    if (!ownedEnsure.ok) {
      // The approval write (if this call just made one) is already durably committed — but the
      // fulfillment-task invariant is not yet satisfied, so this must surface as a retryable
      // error rather than a success, precisely so the next webhook redelivery or 5-minute orphan
      // pass re-attempts ensureOwnedFilingTaskAfterClientStateWrite instead of treating the case
      // as done.
      return { status: "error", error: ownedEnsure.error };
    }
    if (ownedEnsure.kind === "merchant_contact") {
      // Idempotent (reuses a stable per-case provider idempotency key and skips once already
      // accepted) — safe to attempt unconditionally on every call, matching the PATCH route's own
      // unconditional call pattern, so a prior delivery failure is retried too.
      await attemptAutomatedMerchantContactEmailDelivery(supabase, userId, caseId);
    }

    // Mark this case confirmed so every later call (webhook redelivery, reconciler pass) takes
    // the fast short-circuit above instead of repeating this work — and so the reconciler's own
    // scan query can exclude it outright. Guarded by .is(...,null) so it's a cheap, at-most-once
    // write; best-effort, since a failure here just means one more (still-idempotent) pass later.
    await supabase
      .from("justice_cases")
      .update({ orphan_recovery_confirmed_at: new Date().toISOString() })
      .eq("id", caseId)
      .eq("user_id", userId)
      .is("orphan_recovery_confirmed_at", null);

    // The case is now definitively approved (whether this call just approved it, or found it
    // already approved) with its fulfillment task confirmed present — any lingering orphan-review
    // task is now stale. Closing it is best-effort: a failure here does not fail this call, since
    // the invariant that matters (approval + fulfillment task) is already satisfied, and this same
    // cleanup is retried on the next call (webhook redelivery or 5-minute orphan pass) regardless.
    await completeOrphanedPaidCaseApprovalTaskIfOpen(supabase, userId, caseId);

    return { status: justApproved ? "finalized" : "already_finalized" };
  }

  return { status: "conflict_retries_exhausted" };
}

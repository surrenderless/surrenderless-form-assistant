import type { SupabaseClient } from "@supabase/supabase-js";
import { parseJusticeCaseClientState } from "@/lib/justice/approvedNextActionState";
import { isJusticeIntakePayload } from "@/lib/justice/caseApiValidation";
import { ensureOwnedFilingTaskAfterClientStateWrite } from "@/lib/justice/ensureOwnedFilingTaskAfterClientStateWrite";
import { attemptAutomatedMerchantContactEmailDelivery } from "@/lib/justice/merchantContactEmailDelivery";
import { updateClientStateIfUnchanged } from "@/lib/justice/updateClientStateIfUnchanged";
import type { JusticeApprovedNextAction, JusticeIntake } from "@/lib/justice/types";

const CASE_SELECT =
  "id, user_id, client_state, intake, paid_at, payment_dispute_draft, updated_at" as const;

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
 * (optimistic concurrency on justice_cases.updated_at) so a losing concurrent writer — another
 * redelivered webhook, a lagging browser PATCH, a cron reconciler pass — retries against fresh
 * state instead of silently clobbering whichever attempt wins the race. Once
 * prepared_packet_approved is true, every subsequent call (however it arrives) is a genuine no-op.
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
    if (existingState.prepared_packet_approved === true) {
      // Already finalized — by an earlier call to this same function, or by the consumer's own
      // browser PATCH landing first. Either way, nothing left to do.
      return { status: "already_finalized" };
    }
    if (!isJusticeIntakePayload(caseRow.intake)) {
      return { status: "invalid_intake" };
    }

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
      expectedUpdatedAt: caseRow.updated_at as string,
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

    const ownedEnsure = await ensureOwnedFilingTaskAfterClientStateWrite(supabase, {
      userId,
      caseId,
      clientState: nextClientState,
      intake: caseRow.intake as JusticeIntake,
      paymentDisputeDraft: caseRow.payment_dispute_draft,
    });
    if (!ownedEnsure.ok) {
      // client_state (the durable "this case is approved" record) is already written — the
      // invariant that matters most is satisfied. A missing task is retried automatically by
      // reconcileMissingOwnedFilingTasks's own cron pass, which re-derives the required task kind
      // from this same client_state and is itself idempotent.
      return { status: "error", error: ownedEnsure.error };
    }
    if (ownedEnsure.kind === "merchant_contact") {
      await attemptAutomatedMerchantContactEmailDelivery(supabase, userId, caseId);
    }

    return { status: "finalized" };
  }

  return { status: "conflict_retries_exhausted" };
}

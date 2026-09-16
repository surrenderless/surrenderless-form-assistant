import type { SupabaseClient } from "@supabase/supabase-js";

export type DurableIntendedAction = { href: string; label: string };

/**
 * The most recent durably-recorded intended action a real Stripe payment for this case was bound
 * to (see resolveIntendedPreparedAction.ts / checkout/route.ts, persisted onto
 * justice_case_payments by processStripeCheckoutCompletedEvent.ts). This is the ONLY source of
 * "what did the consumer actually pay for" orphan recovery is allowed to trust — never
 * client_state.approved_next_action, which a consumer's own PATCH can set to any string
 * independent of any payment. Returns null when no payment row carries a binding — either a
 * genuinely legacy case (paid before this binding existed) or a lookup error, both of which the
 * caller must treat identically: fall back to recomputing from current intake, or flag for
 * review, never fabricate a value.
 */
export async function findDurableIntendedActionForCase(
  supabase: SupabaseClient,
  caseId: string
): Promise<DurableIntendedAction | null> {
  const trimmedCaseId = caseId.trim();
  if (!trimmedCaseId) return null;

  const { data, error } = await supabase
    .from("justice_case_payments")
    .select("intended_action_href, intended_action_label, created_at")
    .eq("case_id", trimmedCaseId)
    .not("intended_action_href", "is", null)
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) {
    console.warn("durable intended action: select payments", error.message);
    return null;
  }

  const row = data?.[0] as
    | { intended_action_href: string | null; intended_action_label: string | null }
    | undefined;
  const href = row?.intended_action_href?.trim();
  if (!href) return null;

  return { href, label: row?.intended_action_label?.trim() || href };
}

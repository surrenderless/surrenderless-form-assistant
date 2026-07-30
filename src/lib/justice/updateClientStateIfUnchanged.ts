import type { SupabaseClient } from "@supabase/supabase-js";

export const CLIENT_STATE_UPDATE_CONFLICT_ERROR =
  "Case was updated concurrently. Reload and retry.";

export type UpdateClientStateIfUnchangedResult =
  | { ok: true }
  | { ok: false; error: string; status: number };

/**
 * Writes justice_cases.client_state only if the row's updated_at still matches
 * expectedUpdatedAt (the value read alongside client_state before this write was computed).
 * justice_cases has a BEFORE UPDATE trigger that stamps updated_at on every write, so any
 * concurrent writer (a chat PATCH racing an operator filing completion, or two operator
 * completions racing each other) changes updated_at first — the loser's compare-and-swap
 * matches zero rows instead of silently clobbering the winner's client_state.
 */
export async function updateClientStateIfUnchanged(
  supabase: SupabaseClient,
  params: {
    caseId: string;
    userId: string;
    expectedUpdatedAt: string;
    clientState: Record<string, unknown>;
  }
): Promise<UpdateClientStateIfUnchangedResult> {
  const { data, error } = await supabase
    .from("justice_cases")
    .update({ client_state: params.clientState })
    .eq("id", params.caseId)
    .eq("user_id", params.userId)
    .eq("updated_at", params.expectedUpdatedAt)
    .select("id")
    .maybeSingle();

  if (error) {
    return { ok: false, error: error.message, status: 500 };
  }
  if (!data) {
    return { ok: false, error: CLIENT_STATE_UPDATE_CONFLICT_ERROR, status: 409 };
  }
  return { ok: true };
}

import type { SupabaseClient } from "@supabase/supabase-js";

export const CLIENT_STATE_UPDATE_CONFLICT_ERROR =
  "Case was updated concurrently. Reload and retry.";

export type UpdateClientStateIfUnchangedResult =
  | { ok: true }
  | { ok: false; error: string; status: number };

/**
 * Writes justice_cases.client_state only if the row's case_version still matches
 * expectedCaseVersion (the value read alongside client_state before this write was computed).
 * case_version is a monotonic integer, incremented by exactly 1 on every UPDATE by a BEFORE
 * UPDATE trigger (bump_justice_cases_case_version) — never updated_at, a wall-clock timestamp a
 * release audit proved can repeat across genuinely sequential writes (empirically producing a
 * silent lost update in roughly a third to half of racing-writer trials against real Postgres,
 * with no sleep involved). Any concurrent writer (a chat PATCH racing an operator filing
 * completion, or two operator completions racing each other) advances case_version first — the
 * loser's compare-and-swap matches zero rows instead of silently clobbering the winner's
 * client_state.
 */
export async function updateClientStateIfUnchanged(
  supabase: SupabaseClient,
  params: {
    caseId: string;
    userId: string;
    expectedCaseVersion: number;
    clientState: Record<string, unknown>;
  }
): Promise<UpdateClientStateIfUnchangedResult> {
  const { data, error } = await supabase
    .from("justice_cases")
    .update({ client_state: params.clientState })
    .eq("id", params.caseId)
    .eq("user_id", params.userId)
    .eq("case_version", params.expectedCaseVersion)
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

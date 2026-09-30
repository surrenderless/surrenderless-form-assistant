import type { SupabaseClient } from "@supabase/supabase-js";
import { justiceEvidenceRowHasUploadedFile } from "@/lib/justice/evidence";
import { buildApprovedNextActionTarget, pickPreparedNextAction } from "@/lib/justice/preparedNextAction";
import {
  cfpbLikelyRelevant,
  computeJusticeDestinations,
  dotLikelyRelevant,
  fccLikelyRelevant,
} from "@/lib/justice/rules";
import type { JusticeApprovedNextAction, JusticeIntake } from "@/lib/justice/types";

export type ResolveIntendedPreparedActionResult =
  | { ok: true; action: JusticeApprovedNextAction }
  | { ok: false; reason: "no_routable_destination" }
  | { ok: false; reason: "error"; error: string };

/**
 * Deterministically computes the SAME "prepared next action" the chat-ai packet-approval UI would
 * compute for this case right now — the server's own authoritative recomputation, never trusted
 * from client input. Used both to bind a Checkout session's payment to a specific intended action
 * at creation time (so a signed webhook can finalize approval later without ever needing the
 * browser back), and to attempt best-effort recovery for a legacy orphaned paid case that has no
 * such binding on file.
 *
 * `manualFtc` is the one genuinely ephemeral (client-only, never persisted) input to this
 * computation — everything else is a pure function of the case's own stored intake and its saved
 * evidence. Omitting it (the orphan-recovery path can never know a since-cleared session flag)
 * only ever narrows which destinations are considered eligible; it can never fabricate a routable
 * destination that would not otherwise exist.
 */
export async function resolveIntendedPreparedAction(
  supabase: SupabaseClient,
  params: {
    userId: string;
    caseId: string;
    intake: JusticeIntake;
    manualFtc?: boolean;
  }
): Promise<ResolveIntendedPreparedActionResult> {
  const { data: evidenceRows, error } = await supabase
    .from("justice_case_evidence")
    .select("file_name, mime_type, file_size_bytes")
    .eq("case_id", params.caseId)
    .eq("user_id", params.userId)
    .limit(200);

  if (error) {
    return { ok: false, reason: "error", error: error.message };
  }

  const hasUploadedEvidenceFile = (evidenceRows ?? []).some(justiceEvidenceRowHasUploadedFile);
  const intake = params.intake;
  const contacted = intake.already_contacted === "yes";
  const useCompanyContactLabels =
    cfpbLikelyRelevant(intake) || fccLikelyRelevant(intake) || dotLikelyRelevant(intake);
  const destinations = computeJusticeDestinations(intake, {
    manualFtc: params.manualFtc === true,
    useCompanyContactLabels,
    hasUploadedEvidenceFile,
  });
  const prepared = pickPreparedNextAction({ contacted, useCompanyContactLabels, destinations });
  if (!prepared.detailHref) {
    return { ok: false, reason: "no_routable_destination" };
  }
  return { ok: true, action: buildApprovedNextActionTarget(prepared) };
}

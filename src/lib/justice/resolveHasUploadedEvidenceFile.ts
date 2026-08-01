import type { SupabaseClient } from "@supabase/supabase-js";
import { justiceEvidenceRowHasUploadedFile } from "@/lib/justice/evidence";

/**
 * Whether the case has at least one justice_case_evidence row with a real uploaded file attached
 * — the server-authoritative signal for verifying "upload"/"screenshot" contact-proof claims.
 * Bounded query, server-only. Fails closed (false) on a query error rather than risking a false
 * "documented" result for a real government/institution filing.
 */
export async function resolveHasUploadedEvidenceFile(
  supabase: SupabaseClient,
  caseId: string,
  userId: string
): Promise<boolean> {
  const { data: evidenceRows, error } = await supabase
    .from("justice_case_evidence")
    .select("file_name, mime_type, file_size_bytes")
    .eq("case_id", caseId)
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(200);
  if (error) return false;
  return (evidenceRows ?? []).some(justiceEvidenceRowHasUploadedFile);
}

import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/server/getSupabaseAdmin";

/** Resolves the owning Clerk user id for a justice case (service-role lookup). */
export async function resolveJusticeCaseOwnerUserId(
  supabase: SupabaseClient,
  caseId: string
): Promise<string | null> {
  const trimmed = caseId.trim();
  if (!trimmed) return null;

  const { data, error } = await supabase
    .from("justice_cases")
    .select("user_id")
    .eq("id", trimmed)
    .maybeSingle();

  if (error || !data) return null;
  const userId = typeof data.user_id === "string" ? data.user_id.trim() : "";
  return userId || null;
}

/** True when `caseId` exists and belongs to `userId` (Clerk user id). */
export async function userOwnsJusticeCase(userId: string, caseId: string): Promise<boolean> {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    console.warn("justice_case ownership check: Supabase is not configured");
    return false;
  }

  const { data, error } = await supabase
    .from("justice_cases")
    .select("id")
    .eq("id", caseId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.warn("justice_case ownership check:", error.message);
    return false;
  }
  return !!data;
}

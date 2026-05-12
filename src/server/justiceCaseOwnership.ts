import { supabaseAdmin } from "@/utils/supabaseClient";

/** True when `caseId` exists and belongs to `userId` (Clerk user id). */
export async function userOwnsJusticeCase(userId: string, caseId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
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

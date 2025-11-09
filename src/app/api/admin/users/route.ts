// (admin users route)
import { NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/utils/supabaseClient";
import { assertAdmin } from "../_lib/isAdmin";
import { getUserOr401 } from "@/server/requireUser";
import { rateLimit } from "@/utils/rateLimiter";

export async function GET(req: Request) {
  // auth + admin
  const userId = getUserOr401();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    if (await rateLimit(userId)) {
      return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
    }
  } catch {}
  await assertAdmin(); // keeps your existing admin check

  // query
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") || "";
  const { data, error } = await supabase
    .from("user_profiles")
    .select("*")
    .ilike("email", q ? `%${q}%` : "%")
    .limit(25);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ users: data });
}

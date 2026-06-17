// src/app/api/profile/get/route.ts
import { NextResponse, type NextRequest } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { rateLimit } from "@/utils/rateLimiter";
import { getUserOr401 } from "@/server/requireUser";

function getSupabaseAdmin(): SupabaseClient | null {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !supabaseServiceRoleKey) return null;

  return createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch },
  });
}

function supabaseUnavailableResponse() {
  return NextResponse.json(
    { error: "Supabase is not configured on this server." },
    { status: 503 }
  );
}

export async function POST(req: NextRequest) {
  try {
    const userId = getUserOr401(req);
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    try {
      if (await rateLimit(userId)) {
        return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
      }
    } catch (e: any) {
      console.warn("rateLimit failed, allowing:", e?.message);
    }

    const { email } = await req.json();
    if (!email || typeof email !== "string") {
      return NextResponse.json({ error: "Missing or invalid email" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    if (!supabase) return supabaseUnavailableResponse();

    const { data: profile, error } = await supabase
      .from("user_profiles")
      .select("*")
      .eq("email", email)
      .maybeSingle();

    if (error || !profile) {
      return NextResponse.json({ error: error?.message || "User not found" }, { status: 404 });
    }

    return NextResponse.json({ profile });
  } catch (error: any) {
    console.error("Error in /api/profile/get:", error);
    return NextResponse.json({ error: error?.message || "Internal error" }, { status: 500 });
  }
}

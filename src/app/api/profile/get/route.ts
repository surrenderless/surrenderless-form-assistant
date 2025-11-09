// src/app/api/profile/get/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/utils/supabaseClient";
import { rateLimit } from "@/utils/rateLimiter";
import { getUserOr401 } from "@/server/requireUser";

export async function POST(req: Request) {
  try {
    const userId = getUserOr401();
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

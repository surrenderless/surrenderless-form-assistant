import { NextResponse, type NextRequest } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
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

/** Minimal MVP analytics: append-only rows in `history` when authenticated. */
export async function POST(req: NextRequest) {
  const userId = getUserOr401(req);
  if (!userId) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase is not configured on this server." },
      { status: 503 }
    );
  }

  try {
    const body = await req.json();
    const event_name = typeof body?.event_name === "string" ? body.event_name : "unknown";
    const payload = body?.payload && typeof body.payload === "object" ? body.payload : {};

    const { error } = await supabase.from("history").insert({
      user_id: userId,
      action: event_name,
      result: payload,
    });

    if (error) {
      console.warn("justice events insert:", error.message);
    }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    console.warn("justice events:", message);
  }

  return NextResponse.json({ ok: true });
}

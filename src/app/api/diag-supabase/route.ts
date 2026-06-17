// src/app/api/diag-supabase/route.ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

function getSupabaseAdmin(): SupabaseClient | null {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !supabaseServiceRoleKey) return null;

  return createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch },
  });
}

export async function GET() {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
    const supabase = getSupabaseAdmin();
    if (!url || !supabase) {
      return NextResponse.json(
        { error: "Supabase is not configured on this server." },
        { status: 503 }
      );
    }

    // 1) Network ping (no keys required beyond URL)
    let pingOk = false;
    try {
      const ping = await fetch(`${url}/auth/v1/health`, { cache: "no-store" });
      pingOk = ping.ok;
    } catch {
      pingOk = false;
    }

    // 2) Simple DB query using service role
    const { data, error } = await supabase
      .from("user_profiles")
      .select("id")
      .limit(1);

    return NextResponse.json({
      supabaseUrl: url,
      network_ok: pingOk,
      db_ok: !error,
      db_error: error?.message ?? null,
      sample_count: (data ?? []).length,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { network_ok: false, db_ok: false, error: message },
      { status: 500 }
    );
  }
}

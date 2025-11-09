// src/app/api/diag-supabase/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/utils/supabaseClient";

export async function GET() {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!url) {
      return NextResponse.json(
        { network_ok: false, db_ok: false, error: "SUPABASE_URL missing" },
        { status: 500 }
      );
    }

    // 1) Network ping (no keys required)
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
  } catch (e: any) {
    return NextResponse.json(
      { network_ok: false, db_ok: false, error: e?.message || String(e) },
      { status: 500 }
    );
  }
}

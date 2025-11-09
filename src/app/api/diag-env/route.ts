// src/app/api/diag-env/route.ts
import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ? "✅ found" : "❌ missing",
    // ✅ your project uses SUPABASE_ANON_KEY (not NEXT_PUBLIC_SUPABASE_ANON_KEY)
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY ? "✅ found" : "❌ missing",
    supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY ? "✅ found" : "❌ missing",
  });
}

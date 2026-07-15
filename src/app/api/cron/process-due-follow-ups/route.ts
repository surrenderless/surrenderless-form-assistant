import { NextResponse, type NextRequest } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { processDueFollowUps } from "@/lib/justice/processDueFollowUps";
import { requireCronSecret } from "@/server/requireCronSecret";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function getSupabaseAdmin(): SupabaseClient | null {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !supabaseServiceRoleKey) return null;

  return createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch },
  });
}

async function handleCron(req: NextRequest): Promise<NextResponse> {
  const denied = requireCronSecret(req);
  if (denied) return denied;

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase is not configured on this server." }, { status: 503 });
  }

  const summary = await processDueFollowUps(supabase);
  return NextResponse.json({
    ok: true,
    ...summary,
  });
}

/** Vercel Cron invokes GET. */
export async function GET(req: NextRequest) {
  return handleCron(req);
}

/** Allow manual/operator-triggered POST with the same secret. */
export async function POST(req: NextRequest) {
  return handleCron(req);
}

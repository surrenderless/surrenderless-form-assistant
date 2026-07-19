import { NextResponse, type NextRequest } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { reconcileOperatorFallbackAlerts } from "@/lib/justice/operatorFallbackAlertReconciler";
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

/**
 * Proactive operator alerting for owned BBB/FTC filings that fell back to manual fulfillment.
 * Runs entirely off consumer request paths; emails a configurable OPERATOR_ALERT_EMAIL exactly
 * once per fallback event via the existing Resend infrastructure. Cheap enough to run every 5
 * minutes so the needs-operator handoff SLA is measurable in minutes rather than a daily poll.
 */
async function handleCron(req: NextRequest): Promise<NextResponse> {
  const denied = requireCronSecret(req);
  if (denied) return denied;

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase is not configured on this server." }, { status: 503 });
  }

  const alerts = await reconcileOperatorFallbackAlerts(supabase);
  return NextResponse.json({ ok: true, alerts });
}

/** Vercel Cron invokes GET. */
export async function GET(req: NextRequest) {
  return handleCron(req);
}

/** Allow manual/operator-triggered POST with the same secret. */
export async function POST(req: NextRequest) {
  return handleCron(req);
}

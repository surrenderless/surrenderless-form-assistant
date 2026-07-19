import { NextResponse, type NextRequest } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { findAndClaimNextQueuedOwnedFiling } from "@/lib/justice/claimQueuedOwnedFiling";
import { executeClaimedBbbFiling } from "@/lib/justice/bbbOwnedFilingExecute";
import { executeClaimedFtcFiling } from "@/lib/justice/ftcOwnedFilingExecute";
import { requireCronSecret } from "@/server/requireCronSecret";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Long timeout for the real Browserless bounded-submit; one filing per invocation cannot overrun it. */
export const maxDuration = 800;

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
 * Durable worker for owned BBB/FTC filings. Atomically claims the oldest queued task
 * (queued → submitting CAS) and runs the real Browserless bounded-submit off the request path.
 * Processes at most one filing per invocation so a single run cannot overrun the function duration.
 */
async function handleCron(req: NextRequest): Promise<NextResponse> {
  const denied = requireCronSecret(req);
  if (denied) return denied;

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase is not configured on this server." }, { status: 503 });
  }

  const claimed = await findAndClaimNextQueuedOwnedFiling(supabase);
  if (!claimed) {
    return NextResponse.json({ ok: true, processed: 0 });
  }

  const result =
    claimed.kind === "ftc"
      ? await executeClaimedFtcFiling(supabase, claimed.userId, claimed.caseId, claimed.task)
      : await executeClaimedBbbFiling(supabase, claimed.userId, claimed.caseId, claimed.task);

  return NextResponse.json({
    ok: true,
    processed: 1,
    kind: claimed.kind,
    case_id: claimed.caseId,
    status: result.status,
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

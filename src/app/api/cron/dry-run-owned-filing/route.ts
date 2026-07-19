import { NextResponse, type NextRequest } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  runOwnedFilingDryRun,
  type OwnedFilingDryRunDestination,
} from "@/lib/justice/ownedFilingDryRun";
import { requireCronSecret } from "@/server/requireCronSecret";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Long timeout for Browserless dry-run (same budget as live worker; never scheduled). */
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

function parseDestination(raw: unknown): OwnedFilingDryRunDestination | null {
  if (raw === "bbb" || raw === "ftc") return raw;
  if (typeof raw === "string") {
    const lower = raw.trim().toLowerCase();
    if (lower === "bbb" || lower === "ftc") return lower;
  }
  return null;
}

/**
 * Operator-only dry-run for a selected owned BBB/FTC filing.
 * Uses real case data, Browserless, live portal, decide-action, and field fills.
 * Stops before irreversible/unknown clicks. Never marks filed, never completes the task,
 * never advances the ladder. Not registered in vercel.json minute cron.
 *
 * Body: { case_id: string, destination: "bbb"|"ftc", user_id?: string }
 * When user_id is omitted, resolved from justice_cases.
 */
async function handleDryRun(req: NextRequest): Promise<NextResponse> {
  const denied = requireCronSecret(req);
  if (denied) return denied;

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase is not configured on this server." }, { status: 503 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "JSON body required" }, { status: 400 });
  }

  const caseId = typeof body.case_id === "string" ? body.case_id.trim() : "";
  const destination = parseDestination(body.destination);
  let userId = typeof body.user_id === "string" ? body.user_id.trim() : "";

  if (!caseId || !destination) {
    return NextResponse.json(
      { error: 'case_id and destination ("bbb"|"ftc") are required' },
      { status: 400 }
    );
  }

  if (!userId) {
    const { data: caseRow, error } = await supabase
      .from("justice_cases")
      .select("user_id")
      .eq("id", caseId)
      .maybeSingle();
    if (error || !caseRow?.user_id) {
      return NextResponse.json({ error: "case not found" }, { status: 404 });
    }
    userId = String(caseRow.user_id).trim();
  }

  const result = await runOwnedFilingDryRun(supabase, userId, caseId, destination);
  return NextResponse.json(result, { status: result.ok ? 200 : 422 });
}

/** Operator POST only — never scheduled. */
export async function POST(req: NextRequest) {
  return handleDryRun(req);
}

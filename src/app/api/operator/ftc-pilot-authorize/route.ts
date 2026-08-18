import { NextResponse, type NextRequest } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { validate as isUuid } from "uuid";
import { authorizeFtcPilotCase } from "@/lib/justice/authorizeFtcPilotCase";
import { requireOperatorApiAccess } from "@/server/requireOperatorApiAccess";

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
 * Operator-only: authorize a single case for the FTC live pilot. Never touches
 * OWNED_FILING_SUBMIT_ARMED or OWNED_FILING_LIVE_CASE_ALLOWLIST — both remain independently
 * required at claim and execute time; this only records that an operator verified the case is
 * genuinely consumer-approved and eligible. Body: { case_id: string }.
 */
export async function POST(req: NextRequest) {
  const auth = await requireOperatorApiAccess(req);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const b = body as Record<string, unknown>;
  const caseId = typeof b.case_id === "string" ? b.case_id.trim() : "";
  if (!isUuid(caseId)) {
    return NextResponse.json({ error: "Invalid case_id" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase is not configured on this server." },
      { status: 503 }
    );
  }

  const result = await authorizeFtcPilotCase(supabase, auth.operatorUserId, caseId);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  // No case content, no consumer identity — only the fact of authorization.
  return NextResponse.json({
    ok: true,
    case_id: caseId,
    authorized_at: result.authorizedAt,
    idempotent: result.idempotent,
  });
}

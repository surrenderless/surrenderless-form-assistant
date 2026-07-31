import { NextResponse, type NextRequest } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { validate as isUuid } from "uuid";
import { completeFollowUpResponseReview } from "@/lib/justice/completeFollowUpResponseReview";
import { getUserOr401 } from "@/server/requireUser";

/**
 * Consumer-facing counterpart to /api/justice/follow-up-response-review/complete (operator-only).
 * Lets the signed-in case owner report whether their issue was resolved directly from chat,
 * instead of that outcome only ever being recorded by an operator who has no way to learn it.
 * Reuses completeFollowUpResponseReview unchanged — only the auth/outcome surface differs.
 */

const CONSUMER_OUTCOMES = new Set(["resolved", "no_resolution"]);

function getSupabaseAdmin(): SupabaseClient | null {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !supabaseServiceRoleKey) return null;

  return createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch },
  });
}

function supabaseUnavailableResponse() {
  return NextResponse.json(
    { error: "Supabase is not configured on this server." },
    { status: 503 }
  );
}

export async function POST(req: NextRequest) {
  const userId = getUserOr401(req);
  if (!userId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

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
  const taskId = typeof b.task_id === "string" ? b.task_id.trim() : "";

  if (!isUuid(caseId)) {
    return NextResponse.json({ error: "Invalid case_id" }, { status: 400 });
  }
  if (!isUuid(taskId)) {
    return NextResponse.json({ error: "Invalid task_id" }, { status: 400 });
  }
  if (typeof b.outcome !== "string" || !CONSUMER_OUTCOMES.has(b.outcome)) {
    return NextResponse.json(
      { error: "outcome must be resolved or no_resolution" },
      { status: 400 }
    );
  }
  const outcome = b.outcome as "resolved" | "no_resolution";

  const notes =
    b.notes === undefined || b.notes === null
      ? null
      : typeof b.notes === "string"
        ? b.notes
        : undefined;
  if (notes === undefined) {
    return NextResponse.json({ error: "Invalid notes" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) return supabaseUnavailableResponse();

  // completeFollowUpResponseReview scopes every query by user_id, so passing the
  // authenticated consumer's own userId (not an operator-resolved case-owner lookup)
  // is both correct and the whole of the authorization check here.
  const result = await completeFollowUpResponseReview(supabase, userId, {
    caseId,
    taskId,
    outcome,
    notes,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    task: result.task,
    client_state: result.clientState,
    intake: result.intake,
    timeline: result.timeline,
    outcome: result.outcome,
    advanced: result.advanced,
    ...(result.advanced_href ? { advanced_href: result.advanced_href } : {}),
    idempotent: result.idempotent,
    archived: false,
  });
}

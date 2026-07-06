import { NextResponse, type NextRequest } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { validate as isUuid } from "uuid";
import { completeStateAgOperatorFiling } from "@/lib/justice/completeStateAgOperatorFiling";
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

function supabaseUnavailableResponse() {
  return NextResponse.json(
    { error: "Supabase is not configured on this server." },
    { status: 503 }
  );
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
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
  if (!nonEmptyString(b.destination)) {
    return NextResponse.json({ error: "destination is required" }, { status: 400 });
  }
  if (!nonEmptyString(b.filed_at)) {
    return NextResponse.json({ error: "filed_at is required" }, { status: 400 });
  }
  if (!nonEmptyString(b.confirmation_number)) {
    return NextResponse.json({ error: "confirmation_number is required" }, { status: 400 });
  }

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

  const result = await completeStateAgOperatorFiling(supabase, userId, {
    caseId,
    taskId,
    destination: b.destination.trim(),
    filedAt: b.filed_at.trim(),
    confirmationNumber: b.confirmation_number.trim(),
    notes,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    filing: result.filing,
    task: result.task,
    client_state: result.clientState,
    timeline: result.timeline,
    advanced: result.advanced,
    idempotent: result.idempotent,
  });
}

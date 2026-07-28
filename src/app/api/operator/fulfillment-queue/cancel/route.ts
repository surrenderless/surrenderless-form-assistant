import { NextResponse, type NextRequest } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { validate as isUuid } from "uuid";
import { cancelOperatorFulfillmentTask } from "@/lib/justice/cancelOperatorFulfillmentTask";
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

function supabaseUnavailableResponse() {
  return NextResponse.json(
    { error: "Supabase is not configured on this server." },
    { status: 503 }
  );
}

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
  const taskId = typeof b.task_id === "string" ? b.task_id.trim() : "";
  if (!taskId || !isUuid(taskId)) {
    return NextResponse.json({ error: "Invalid task_id" }, { status: 400 });
  }
  const operatorNote = typeof b.note === "string" ? b.note : null;

  const supabase = getSupabaseAdmin();
  if (!supabase) return supabaseUnavailableResponse();

  const result = await cancelOperatorFulfillmentTask(supabase, { taskId, operatorNote });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ ok: true, task: result.task });
}

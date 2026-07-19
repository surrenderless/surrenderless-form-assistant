import { NextResponse, type NextRequest } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  listOperatorFulfillmentQueue,
  summarizeOperatorFulfillmentQueue,
} from "@/lib/justice/operatorFulfillmentQueue";
import { listOperatorClosableCases } from "@/lib/justice/operatorOwnedCaseArchive";
import {
  buildPlaywrightMockOperatorFulfillmentQueue,
  isPlaywrightMockHumanFulfillmentOperatorFilingEnabled,
} from "@/lib/testing/playwrightMockHumanFulfillmentLadderPipeline";
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

export async function GET(req: NextRequest) {
  const auth = await requireOperatorApiAccess(req);
  if (!auth.ok) return auth.response;

  if (isPlaywrightMockHumanFulfillmentOperatorFilingEnabled()) {
    const items = buildPlaywrightMockOperatorFulfillmentQueue();
    return NextResponse.json({
      items,
      closable_cases: [],
      queue_metrics: summarizeOperatorFulfillmentQueue(items),
    });
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) return supabaseUnavailableResponse();

  const [items, closable_cases] = await Promise.all([
    listOperatorFulfillmentQueue(supabase),
    listOperatorClosableCases(supabase),
  ]);
  return NextResponse.json({
    items,
    closable_cases,
    queue_metrics: summarizeOperatorFulfillmentQueue(items),
  });
}

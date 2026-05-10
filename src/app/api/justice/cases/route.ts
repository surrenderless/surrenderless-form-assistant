import { NextResponse, type NextRequest } from "next/server";
import { getUserOr401 } from "@/server/requireUser";
import { supabaseAdmin } from "@/utils/supabaseClient";
import { isJusticeIntakePayload, isTimelineArray } from "@/lib/justice/caseApiValidation";

type CaseResponse = {
  id: string;
  intake: unknown;
  timeline: unknown;
  payment_dispute_draft: unknown;
  client_state: unknown;
  created_at: string;
  updated_at: string;
};

export async function GET(req: NextRequest) {
  const userId = getUserOr401(req);
  if (!userId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { data, error } = await supabaseAdmin
    .from("justice_cases")
    .select("id, intake, timeline, payment_dispute_draft, client_state, created_at, updated_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(10);

  if (error) {
    console.warn("justice_cases list:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json((data ?? []) as CaseResponse[]);
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
  if (!isJusticeIntakePayload(b.intake)) {
    return NextResponse.json({ error: "Invalid intake" }, { status: 400 });
  }

  let timeline: unknown = [];
  if (b.timeline !== undefined) {
    if (!isTimelineArray(b.timeline)) {
      return NextResponse.json({ error: "Invalid timeline" }, { status: 400 });
    }
    timeline = b.timeline;
  }

  const payment_dispute_draft =
    b.payment_dispute_draft !== undefined ? b.payment_dispute_draft : null;
  const client_state = b.client_state !== undefined ? b.client_state : null;

  const { data, error } = await supabaseAdmin
    .from("justice_cases")
    .insert({
      user_id: userId,
      intake: b.intake,
      timeline,
      payment_dispute_draft,
      client_state,
    })
    .select("id, intake, timeline, payment_dispute_draft, client_state, created_at, updated_at")
    .single();

  if (error) {
    console.warn("justice_cases insert:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data as CaseResponse);
}

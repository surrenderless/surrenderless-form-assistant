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
  archived_at: string | null;
  case_label: string | null;
};

const DEFAULT_LIST_LIMIT = 10;
const MAX_LIST_LIMIT = 50;
const MAX_LIST_OFFSET = 50_000;

function parseListLimitOffset(searchParams: URLSearchParams): { limit: number; offset: number } {
  let limit = DEFAULT_LIST_LIMIT;
  let offset = 0;
  const rawLimit = searchParams.get("limit");
  const rawOffset = searchParams.get("offset");
  if (rawLimit !== null && rawLimit.trim() !== "") {
    const n = Number.parseInt(rawLimit, 10);
    if (Number.isFinite(n)) {
      limit = Math.min(Math.max(n, 1), MAX_LIST_LIMIT);
    }
  }
  if (rawOffset !== null && rawOffset.trim() !== "") {
    const n = Number.parseInt(rawOffset, 10);
    if (Number.isFinite(n) && n >= 0) {
      offset = Math.min(n, MAX_LIST_OFFSET);
    }
  }
  return { limit, offset };
}

export async function GET(req: NextRequest) {
  const userId = getUserOr401(req);
  if (!userId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const archivedOnly = req.nextUrl.searchParams.get("archived") === "1";
  const { limit, offset } = parseListLimitOffset(req.nextUrl.searchParams);
  const fetchWindow = limit + 1;
  const rangeEnd = offset + fetchWindow - 1;

  let listQuery = supabaseAdmin
    .from("justice_cases")
    .select(
      "id, intake, timeline, payment_dispute_draft, client_state, created_at, updated_at, archived_at, case_label"
    )
    .eq("user_id", userId);

  listQuery = archivedOnly
    ? listQuery.not("archived_at", "is", null)
    : listQuery.is("archived_at", null);

  const { data, error } = await listQuery.order("updated_at", { ascending: false }).range(offset, rangeEnd);

  if (error) {
    console.warn("justice_cases list:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as CaseResponse[];
  const has_more = rows.length > limit;
  const cases = has_more ? rows.slice(0, limit) : rows;

  return NextResponse.json({
    cases,
    has_more,
    offset,
    limit,
  });
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
    .select(
      "id, intake, timeline, payment_dispute_draft, client_state, created_at, updated_at, archived_at, case_label"
    )
    .single();

  if (error) {
    console.warn("justice_cases insert:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data as CaseResponse);
}

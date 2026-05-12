import { NextResponse, type NextRequest } from "next/server";
import { validate as isUuid } from "uuid";
import { getUserOr401 } from "@/server/requireUser";
import { userOwnsJusticeCase } from "@/server/justiceCaseOwnership";
import { supabaseAdmin } from "@/utils/supabaseClient";

const MAX_DEST = 500;
const MAX_FILED_AT = 200;
const MAX_CONFIRM = 200;
const MAX_URL = 2000;
const MAX_NOTES = 8000;

function nonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function optionalStringOrNull(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length === 0 ? null : t;
}

function clampLen(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max);
}

export async function GET(req: NextRequest) {
  const userId = getUserOr401(req);
  if (!userId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const caseId = req.nextUrl.searchParams.get("case_id") ?? "";
  if (!isUuid(caseId)) {
    return NextResponse.json({ error: "Invalid case_id" }, { status: 400 });
  }

  if (!(await userOwnsJusticeCase(userId, caseId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data, error } = await supabaseAdmin
    .from("justice_case_filings")
    .select(
      "id, user_id, case_id, destination, filed_at, confirmation_number, filing_url, notes, created_at, updated_at"
    )
    .eq("case_id", caseId)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    console.warn("justice_case_filings list:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data ?? []);
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
  const caseId = typeof b.case_id === "string" ? b.case_id : "";
  if (!isUuid(caseId)) {
    return NextResponse.json({ error: "Invalid case_id" }, { status: 400 });
  }

  if (!(await userOwnsJusticeCase(userId, caseId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (!nonEmptyString(b.destination)) {
    return NextResponse.json({ error: "destination is required" }, { status: 400 });
  }
  const destination = clampLen(b.destination.trim(), MAX_DEST);

  const filedAt = optionalStringOrNull(b.filed_at);
  if (filedAt === undefined && b.filed_at !== undefined && b.filed_at !== null) {
    return NextResponse.json({ error: "Invalid filed_at" }, { status: 400 });
  }
  const filedAtVal = filedAt != null ? clampLen(filedAt, MAX_FILED_AT) : filedAt;

  const confirmation = optionalStringOrNull(b.confirmation_number);
  if (confirmation === undefined && b.confirmation_number !== undefined && b.confirmation_number !== null) {
    return NextResponse.json({ error: "Invalid confirmation_number" }, { status: 400 });
  }
  const confirmationVal = confirmation != null ? clampLen(confirmation, MAX_CONFIRM) : confirmation;

  const filingUrl = optionalStringOrNull(b.filing_url);
  if (filingUrl === undefined && b.filing_url !== undefined && b.filing_url !== null) {
    return NextResponse.json({ error: "Invalid filing_url" }, { status: 400 });
  }
  const filingUrlVal = filingUrl != null ? clampLen(filingUrl, MAX_URL) : filingUrl;

  const notes = optionalStringOrNull(b.notes);
  if (notes === undefined && b.notes !== undefined && b.notes !== null) {
    return NextResponse.json({ error: "Invalid notes" }, { status: 400 });
  }
  const notesVal = notes != null ? clampLen(notes, MAX_NOTES) : notes;

  const insertRow: Record<string, unknown> = {
    user_id: userId,
    case_id: caseId,
    destination,
  };
  if (filedAtVal !== undefined) insertRow.filed_at = filedAtVal;
  if (confirmationVal !== undefined) insertRow.confirmation_number = confirmationVal;
  if (filingUrlVal !== undefined) insertRow.filing_url = filingUrlVal;
  if (notesVal !== undefined) insertRow.notes = notesVal;

  const { data, error } = await supabaseAdmin
    .from("justice_case_filings")
    .insert(insertRow)
    .select(
      "id, user_id, case_id, destination, filed_at, confirmation_number, filing_url, notes, created_at, updated_at"
    )
    .single();

  if (error) {
    console.warn("justice_case_filings insert:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

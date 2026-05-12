import { NextResponse, type NextRequest } from "next/server";
import { validate as isUuid } from "uuid";
import { isJusticeEvidenceType } from "@/lib/justice/evidence";
import { getUserOr401 } from "@/server/requireUser";
import { userOwnsJusticeCase } from "@/server/justiceCaseOwnership";
import { supabaseAdmin } from "@/utils/supabaseClient";

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
    .from("justice_case_evidence")
    .select("id, user_id, case_id, title, evidence_type, evidence_date, description, created_at, updated_at")
    .eq("case_id", caseId)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    console.warn("justice_case_evidence list:", error.message);
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

  if (!nonEmptyString(b.title)) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }
  const title = b.title.trim();

  if (typeof b.evidence_type !== "string" || !isJusticeEvidenceType(b.evidence_type)) {
    return NextResponse.json({ error: "Invalid evidence_type" }, { status: 400 });
  }

  const evidenceDate = optionalStringOrNull(b.evidence_date);
  if (evidenceDate === undefined && b.evidence_date !== undefined && b.evidence_date !== null) {
    return NextResponse.json({ error: "Invalid evidence_date" }, { status: 400 });
  }

  const description = optionalStringOrNull(b.description);
  if (description === undefined && b.description !== undefined && b.description !== null) {
    return NextResponse.json({ error: "Invalid description" }, { status: 400 });
  }

  const insertRow: Record<string, unknown> = {
    user_id: userId,
    case_id: caseId,
    title,
    evidence_type: b.evidence_type,
  };
  if (evidenceDate !== undefined) insertRow.evidence_date = evidenceDate;
  if (description !== undefined) insertRow.description = description;

  const { data, error } = await supabaseAdmin
    .from("justice_case_evidence")
    .insert(insertRow)
    .select("id, user_id, case_id, title, evidence_type, evidence_date, description, created_at, updated_at")
    .single();

  if (error) {
    console.warn("justice_case_evidence insert:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

import { NextResponse, type NextRequest } from "next/server";
import { validate as isUuid } from "uuid";
import { isJusticeEvidenceType } from "@/lib/justice/evidence";
import { getUserOr401 } from "@/server/requireUser";
import { supabaseAdmin } from "@/utils/supabaseClient";

const SELECT =
  "id, user_id, case_id, title, evidence_type, evidence_date, description, created_at, updated_at" as const;

function optionalStringOrNull(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length === 0 ? null : t;
}

type RouteCtx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, context: RouteCtx) {
  const userId = getUserOr401(req);
  if (!userId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { id } = await context.params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
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
  const patch: Record<string, unknown> = {};

  if (Object.prototype.hasOwnProperty.call(b, "title")) {
    if (typeof b.title !== "string" || !b.title.trim()) {
      return NextResponse.json({ error: "Invalid title" }, { status: 400 });
    }
    patch.title = b.title.trim();
  }

  if (Object.prototype.hasOwnProperty.call(b, "evidence_type")) {
    if (typeof b.evidence_type !== "string" || !isJusticeEvidenceType(b.evidence_type)) {
      return NextResponse.json({ error: "Invalid evidence_type" }, { status: 400 });
    }
    patch.evidence_type = b.evidence_type;
  }

  if (Object.prototype.hasOwnProperty.call(b, "evidence_date")) {
    const v = optionalStringOrNull(b.evidence_date);
    if (v === undefined && b.evidence_date !== null) {
      return NextResponse.json({ error: "Invalid evidence_date" }, { status: 400 });
    }
    patch.evidence_date = v === undefined ? null : v;
  }

  if (Object.prototype.hasOwnProperty.call(b, "description")) {
    const v = optionalStringOrNull(b.description);
    if (v === undefined && b.description !== null) {
      return NextResponse.json({ error: "Invalid description" }, { status: 400 });
    }
    patch.description = v === undefined ? null : v;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("justice_case_evidence")
    .update(patch)
    .eq("id", id)
    .eq("user_id", userId)
    .select(SELECT)
    .maybeSingle();

  if (error) {
    console.warn("justice_case_evidence update:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(data);
}

export async function DELETE(req: NextRequest, context: RouteCtx) {
  const userId = getUserOr401(req);
  if (!userId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { id } = await context.params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("justice_case_evidence")
    .delete()
    .eq("id", id)
    .eq("user_id", userId)
    .select("id");

  if (error) {
    console.warn("justice_case_evidence delete:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data?.length) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}

import { NextResponse, type NextRequest } from "next/server";
import { validate as isUuid } from "uuid";
import { getUserOr401 } from "@/server/requireUser";
import { supabaseAdmin } from "@/utils/supabaseClient";

const SELECT =
  "id, user_id, case_id, destination, filed_at, confirmation_number, filing_url, notes, created_at, updated_at" as const;

const MAX_DEST = 500;
const MAX_FILED_AT = 200;
const MAX_CONFIRM = 200;
const MAX_URL = 2000;
const MAX_NOTES = 8000;

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

  if (Object.prototype.hasOwnProperty.call(b, "destination")) {
    if (typeof b.destination !== "string" || !b.destination.trim()) {
      return NextResponse.json({ error: "Invalid destination" }, { status: 400 });
    }
    patch.destination = clampLen(b.destination.trim(), MAX_DEST);
  }

  if (Object.prototype.hasOwnProperty.call(b, "filed_at")) {
    const v = optionalStringOrNull(b.filed_at);
    if (v === undefined && b.filed_at !== null) {
      return NextResponse.json({ error: "Invalid filed_at" }, { status: 400 });
    }
    patch.filed_at = v == null ? null : clampLen(v, MAX_FILED_AT);
  }

  if (Object.prototype.hasOwnProperty.call(b, "confirmation_number")) {
    const v = optionalStringOrNull(b.confirmation_number);
    if (v === undefined && b.confirmation_number !== null) {
      return NextResponse.json({ error: "Invalid confirmation_number" }, { status: 400 });
    }
    patch.confirmation_number = v == null ? null : clampLen(v, MAX_CONFIRM);
  }

  if (Object.prototype.hasOwnProperty.call(b, "filing_url")) {
    const v = optionalStringOrNull(b.filing_url);
    if (v === undefined && b.filing_url !== null) {
      return NextResponse.json({ error: "Invalid filing_url" }, { status: 400 });
    }
    patch.filing_url = v == null ? null : clampLen(v, MAX_URL);
  }

  if (Object.prototype.hasOwnProperty.call(b, "notes")) {
    const v = optionalStringOrNull(b.notes);
    if (v === undefined && b.notes !== null) {
      return NextResponse.json({ error: "Invalid notes" }, { status: 400 });
    }
    patch.notes = v == null ? null : clampLen(v, MAX_NOTES);
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("justice_case_filings")
    .update(patch)
    .eq("id", id)
    .eq("user_id", userId)
    .select(SELECT)
    .maybeSingle();

  if (error) {
    console.warn("justice_case_filings update:", error.message);
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
    .from("justice_case_filings")
    .delete()
    .eq("id", id)
    .eq("user_id", userId)
    .select("id");

  if (error) {
    console.warn("justice_case_filings delete:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data?.length) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}

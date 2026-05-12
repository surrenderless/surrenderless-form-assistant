import { NextResponse, type NextRequest } from "next/server";
import { validate as isUuid } from "uuid";
import { getUserOr401 } from "@/server/requireUser";
import { supabaseAdmin } from "@/utils/supabaseClient";

const SELECT =
  "id, user_id, case_id, title, due_date, notes, completed_at, created_at, updated_at" as const;

const MAX_TITLE = 500;
const MAX_DUE = 200;
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

  if (Object.prototype.hasOwnProperty.call(b, "title")) {
    if (typeof b.title !== "string" || !b.title.trim()) {
      return NextResponse.json({ error: "Invalid title" }, { status: 400 });
    }
    patch.title = clampLen(b.title.trim(), MAX_TITLE);
  }

  if (Object.prototype.hasOwnProperty.call(b, "due_date")) {
    const v = optionalStringOrNull(b.due_date);
    if (v === undefined && b.due_date !== null) {
      return NextResponse.json({ error: "Invalid due_date" }, { status: 400 });
    }
    patch.due_date = v == null ? null : clampLen(v, MAX_DUE);
  }

  if (Object.prototype.hasOwnProperty.call(b, "notes")) {
    const v = optionalStringOrNull(b.notes);
    if (v === undefined && b.notes !== null) {
      return NextResponse.json({ error: "Invalid notes" }, { status: 400 });
    }
    patch.notes = v == null ? null : clampLen(v, MAX_NOTES);
  }

  if (Object.prototype.hasOwnProperty.call(b, "completed_at")) {
    if (b.completed_at === null) {
      patch.completed_at = null;
    } else if (typeof b.completed_at === "string" && b.completed_at.trim()) {
      const t = b.completed_at.trim();
      const d = new Date(t);
      if (Number.isNaN(d.getTime())) {
        return NextResponse.json({ error: "Invalid completed_at" }, { status: 400 });
      }
      patch.completed_at = d.toISOString();
    } else {
      return NextResponse.json({ error: "Invalid completed_at" }, { status: 400 });
    }
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("justice_case_tasks")
    .update(patch)
    .eq("id", id)
    .eq("user_id", userId)
    .select(SELECT)
    .maybeSingle();

  if (error) {
    console.warn("justice_case_tasks update:", error.message);
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
    .from("justice_case_tasks")
    .delete()
    .eq("id", id)
    .eq("user_id", userId)
    .select("id");

  if (error) {
    console.warn("justice_case_tasks delete:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data?.length) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}

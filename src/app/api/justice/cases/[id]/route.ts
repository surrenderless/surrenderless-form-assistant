import { NextResponse, type NextRequest } from "next/server";
import { validate as isUuid } from "uuid";
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

const SELECT =
  "id, intake, timeline, payment_dispute_draft, client_state, created_at, updated_at, archived_at, case_label" as const;

function isValidArchivedAt(value: unknown): value is string | null {
  if (value === null) return true;
  if (typeof value !== "string") return false;
  return !Number.isNaN(Date.parse(value));
}

function isValidCaseLabel(value: unknown): value is string | null {
  if (value === null) return true;
  if (typeof value !== "string") return false;
  return value.length <= 500;
}

type RouteCtx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, context: RouteCtx) {
  const userId = getUserOr401(req);
  if (!userId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { id } = await context.params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "Invalid case id" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("justice_cases")
    .select(SELECT)
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.warn("justice_cases select:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(data as CaseResponse);
}

export async function PATCH(req: NextRequest, context: RouteCtx) {
  const userId = getUserOr401(req);
  if (!userId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { id } = await context.params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "Invalid case id" }, { status: 400 });
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
  const allowed = [
    "intake",
    "timeline",
    "payment_dispute_draft",
    "client_state",
    "archived_at",
    "case_label",
  ] as const;
  const patch: Record<string, unknown> = {};

  for (const key of allowed) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) continue;
    if (key === "intake") {
      if (!isJusticeIntakePayload(b.intake)) {
        return NextResponse.json({ error: "Invalid intake" }, { status: 400 });
      }
      patch.intake = b.intake;
    } else if (key === "timeline") {
      if (!isTimelineArray(b.timeline)) {
        return NextResponse.json({ error: "Invalid timeline" }, { status: 400 });
      }
      patch.timeline = b.timeline;
    } else if (key === "payment_dispute_draft") {
      patch.payment_dispute_draft = b.payment_dispute_draft;
    } else if (key === "client_state") {
      patch.client_state = b.client_state;
    } else if (key === "archived_at") {
      if (!isValidArchivedAt(b.archived_at)) {
        return NextResponse.json({ error: "Invalid archived_at" }, { status: 400 });
      }
      patch.archived_at = b.archived_at;
    } else if (key === "case_label") {
      if (!isValidCaseLabel(b.case_label)) {
        return NextResponse.json({ error: "Invalid case_label" }, { status: 400 });
      }
      const v = b.case_label;
      patch.case_label = v === null || v.trim() === "" ? null : v.trim();
    }
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("justice_cases")
    .update(patch)
    .eq("id", id)
    .eq("user_id", userId)
    .select(SELECT)
    .maybeSingle();

  if (error) {
    console.warn("justice_cases update:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(data as CaseResponse);
}

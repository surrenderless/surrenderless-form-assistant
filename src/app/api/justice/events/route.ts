import { NextResponse, type NextRequest } from "next/server";
import { getUserOr401 } from "@/server/requireUser";
import { supabaseAdmin } from "@/utils/supabaseClient";

/** Minimal MVP analytics: append-only rows in `history` when authenticated. */
export async function POST(req: NextRequest) {
  const userId = getUserOr401(req);
  if (!userId) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  try {
    const body = await req.json();
    const event_name = typeof body?.event_name === "string" ? body.event_name : "unknown";
    const payload = body?.payload && typeof body.payload === "object" ? body.payload : {};

    const { error } = await supabaseAdmin.from("history").insert({
      user_id: userId,
      action: event_name,
      result: payload,
    });

    if (error) {
      console.warn("justice events insert:", error.message);
    }
  } catch (e: any) {
    console.warn("justice events:", e?.message || e);
  }

  return NextResponse.json({ ok: true });
}

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/utils/supabaseClient";
import { getUserOr401 } from "@/server/requireUser";

export async function GET() {
  const userId = getUserOr401();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabaseAdmin
    .from("form_templates")
    .select("*")
    .eq("is_active", true)
    .order("name", { ascending: true });

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ templates: data });
}

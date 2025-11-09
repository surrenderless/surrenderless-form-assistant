import { NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/utils/supabaseClient";
import { assertAdmin } from "../_lib/isAdmin";

export async function GET() {
  await assertAdmin();
  const { data, error } = await supabase
    .from("task_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ logs: data });
}

import { NextResponse, type NextRequest } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getAuth } from "@clerk/nextjs/server";

function getSupabaseAdmin(): SupabaseClient | null {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !supabaseServiceRoleKey) return null;

  return createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch },
  });
}

function supabaseUnavailableResponse() {
  return NextResponse.json(
    { error: "Supabase is not configured on this server." },
    { status: 503 }
  );
}

export async function POST(req: NextRequest) {
  console.log("🔄 /api/profile/init");
  const { userId, sessionClaims } = getAuth(req);
  if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  // accept body or fall back to Clerk session
  let body: any = {};
  try { body = await req.json(); } catch {}
  const name = body?.name ?? sessionClaims?.name ?? "No Name";
  const email = body?.email ?? sessionClaims?.email ?? "No Email";
  console.log("👤", { userId, name, email });

  const supabase = getSupabaseAdmin();
  if (!supabase) return supabaseUnavailableResponse();

  const { error } = await supabase
    .from("users")
    .upsert([{ id: userId, name, email }]);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ status: "created or exists" });
}

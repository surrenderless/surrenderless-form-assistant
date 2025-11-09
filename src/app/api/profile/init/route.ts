import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/utils/supabaseClient";
import { getAuth } from "@clerk/nextjs/server";

export async function POST(req: Request) {
  console.log("🔄 /api/profile/init");
  const { userId, sessionClaims } = getAuth(req);
  if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  // accept body or fall back to Clerk session
  let body: any = {};
  try { body = await req.json(); } catch {}
  const name = body?.name ?? sessionClaims?.name ?? "No Name";
  const email = body?.email ?? sessionClaims?.email ?? "No Email";
  console.log("👤", { userId, name, email });

  const { error } = await supabaseAdmin
    .from("users")
    .upsert([{ id: userId, name, email }]);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ status: "created or exists" });
}

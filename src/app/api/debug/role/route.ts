// keep runtime
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { currentUser } from "@clerk/nextjs/server";
import { getUserOr401 } from "@/server/requireUser";

export async function GET(req: Request) {
  const userId = getUserOr401();
  if (!userId) return NextResponse.json({ error: "unauth" }, { status: 401 });

  const u = await currentUser();
  return NextResponse.json({
    userId,
    role: (u?.publicMetadata as any)?.role ?? null,
  });
}

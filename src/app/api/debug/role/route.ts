// keep runtime
export const runtime = "nodejs";

import { NextResponse, type NextRequest } from "next/server";
import { currentUser } from "@clerk/nextjs/server";
import { getUserOr401 } from "@/server/requireUser";

export async function GET(req: NextRequest) {
  const userId = getUserOr401(req);
  if (!userId) return NextResponse.json({ error: "unauth" }, { status: 401 });

  const u = await currentUser();
  return NextResponse.json({
    userId,
    role: (u?.publicMetadata as any)?.role ?? null,
  });
}

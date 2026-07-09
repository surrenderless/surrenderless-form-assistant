import { NextResponse, type NextRequest } from "next/server";
import { assertOperatorRole } from "@/server/clerkRoles";
import { getUserOr401 } from "@/server/requireUser";

export async function requireOperatorApiAccess(req: NextRequest) {
  const userId = getUserOr401(req);
  if (!userId) {
    return { ok: false as const, response: NextResponse.json({ error: "Not signed in" }, { status: 401 }) };
  }
  try {
    const operator = await assertOperatorRole();
    return { ok: true as const, operatorUserId: operator.userId };
  } catch (e) {
    if (e instanceof Response) {
      const status = e.status;
      const message = status === 401 ? "Not signed in" : "Forbidden";
      return { ok: false as const, response: NextResponse.json({ error: message }, { status }) };
    }
    return { ok: false as const, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
}

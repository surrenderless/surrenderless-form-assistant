import { NextResponse, type NextRequest } from "next/server";

/**
 * Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`.
 * Fail closed when the secret is missing or the header does not match.
 */
export function requireCronSecret(req: NextRequest): NextResponse | null {
  const secret = process.env.CRON_SECRET?.trim() ?? "";
  if (!secret) {
    return NextResponse.json({ error: "Cron is not configured" }, { status: 503 });
  }
  const auth = req.headers.get("authorization")?.trim() ?? "";
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

export function isCronAuthorizationValid(
  authorizationHeader: string | null | undefined,
  cronSecret: string | null | undefined
): boolean {
  const secret = cronSecret?.trim() ?? "";
  if (!secret) return false;
  const auth = authorizationHeader?.trim() ?? "";
  return auth === `Bearer ${secret}`;
}

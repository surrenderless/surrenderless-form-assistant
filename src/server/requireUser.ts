import { getAuth } from "@clerk/nextjs/server";
import type { NextRequest } from "next/server";

export function getUserOr401(request: NextRequest): string | null {
  const { userId } = getAuth(request);
  return userId ?? null;
}

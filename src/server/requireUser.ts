import { auth, getAuth } from "@clerk/nextjs/server";

export function getUserOr401(request: Request): string | null;
export function getUserOr401(): string | null;
export function getUserOr401(request?: Request): string | null {
  if (request) {
    const { userId } = getAuth(request);
    return userId ?? null;
  }
  const { userId } = auth();
  return userId ?? null;
}

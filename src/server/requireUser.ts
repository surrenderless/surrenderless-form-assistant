import { auth } from "@clerk/nextjs/server";

export function getUserOr401() {
  const { userId } = auth();
  return userId ?? null;
}

import { currentUser } from "@clerk/nextjs/server";
import {
  isAdminRole,
  isOperatorRole,
  readClerkRole,
  type ClerkAppRole,
} from "@/lib/clerkRoles";

export { readClerkRole, isAdminRole, isOperatorRole } from "@/lib/clerkRoles";
export type { ClerkAppRole } from "@/lib/clerkRoles";

export async function assertAdminRole() {
  const u = await currentUser();
  if (!u) throw new Response("Unauthorized", { status: 401 });

  const role = readClerkRole(u.publicMetadata);
  if (!isAdminRole(role)) throw new Response("Forbidden", { status: 403 });

  return { userId: u.id, role: role as ClerkAppRole };
}

/** Operators and admins may perform Surrenderless-owned human fulfillment actions. */
export async function assertOperatorRole() {
  const u = await currentUser();
  if (!u) throw new Response("Unauthorized", { status: 401 });

  const role = readClerkRole(u.publicMetadata);
  if (!isOperatorRole(role)) throw new Response("Forbidden", { status: 403 });

  return { userId: u.id, role: role as ClerkAppRole };
}

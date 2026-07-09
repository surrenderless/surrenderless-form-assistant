import { assertAdminRole } from "@/server/clerkRoles";

/** @deprecated Use assertAdminRole from @/server/clerkRoles */
export async function assertAdmin() {
  return assertAdminRole();
}

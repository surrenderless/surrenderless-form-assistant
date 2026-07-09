export const CLERK_ROLE_ADMIN = "admin" as const;
export const CLERK_ROLE_OPERATOR = "operator" as const;

export type ClerkAppRole = typeof CLERK_ROLE_ADMIN | typeof CLERK_ROLE_OPERATOR;

export function readClerkRole(publicMetadata: unknown): string | null {
  if (publicMetadata === null || typeof publicMetadata !== "object" || Array.isArray(publicMetadata)) {
    return null;
  }
  const role = (publicMetadata as { role?: unknown }).role;
  return typeof role === "string" && role.trim() ? role.trim() : null;
}

export function isAdminRole(role: string | null | undefined): boolean {
  return role === CLERK_ROLE_ADMIN;
}

export function isOperatorRole(role: string | null | undefined): boolean {
  return role === CLERK_ROLE_OPERATOR || role === CLERK_ROLE_ADMIN;
}

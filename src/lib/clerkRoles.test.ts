import { describe, expect, it } from "vitest";
import { isAdminRole, isOperatorRole, readClerkRole } from "@/lib/clerkRoles";

describe("clerkRoles", () => {
  it("reads role from Clerk publicMetadata", () => {
    expect(readClerkRole({ role: "operator" })).toBe("operator");
    expect(readClerkRole({ role: "admin" })).toBe("admin");
    expect(readClerkRole({})).toBeNull();
    expect(readClerkRole(null)).toBeNull();
  });

  it("treats admin as operator-capable", () => {
    expect(isOperatorRole("operator")).toBe(true);
    expect(isOperatorRole("admin")).toBe(true);
    expect(isOperatorRole("consumer")).toBe(false);
    expect(isOperatorRole(null)).toBe(false);
  });

  it("restricts admin-only surfaces to admin", () => {
    expect(isAdminRole("admin")).toBe(true);
    expect(isAdminRole("operator")).toBe(false);
  });
});

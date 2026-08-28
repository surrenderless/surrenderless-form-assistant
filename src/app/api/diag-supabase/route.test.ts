import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * This route was removed: it had zero legitimate callers anywhere in the codebase (verified via
 * a full-repo search before deletion) but shipped as an unauthenticated GET that ran a live
 * Supabase service-role query (`justice_cases`'s sibling `user_profiles` table) and an outbound
 * network ping, and returned the configured Supabase URL — reachable by anyone who could get an
 * anonymous request past the deploy-password gate (or if that gate were ever misconfigured,
 * reachable by anyone at all). No app code, test, or CI workflow referenced "diag-supabase" in
 * any form.
 *
 * This guard fails if a route.ts (or any other route file) reappears in this directory without
 * an operator/admin authorization check, so an unauthenticated Supabase diagnostic endpoint
 * can't silently come back.
 */
describe("removed diag-supabase route", () => {
  it("has no route handler file — must not come back as an unauthenticated endpoint", () => {
    const dir = path.join(process.cwd(), "src", "app", "api", "diag-supabase");
    const entries = fs.existsSync(dir)
      ? fs.readdirSync(dir).filter((name) => name !== "route.test.ts")
      : [];
    expect(entries).toEqual([]);
  });
});

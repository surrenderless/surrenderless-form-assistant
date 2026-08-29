import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Regression coverage for a real CI failure: the dedicated smoke config was missing the
 * `server-only` -> no-op alias that the main vitest.config.ts already has, so collecting
 * justiceSupabaseSmoke.test.ts (which imports server-only-guarded API route handlers, e.g.
 * src/app/api/justice/cases/route.ts -> src/lib/justice/authorizeFtcPilotCase.ts) threw
 * "This module cannot be imported from a Client Component module" before any test ran, and the
 * strict global setup's teardown then correctly failed since no integration test executed.
 *
 * `@next/env`'s loadEnvConfig is mocked before importing the config module because the real
 * config file calls it at module scope; the real implementation mutates process.env as a side
 * effect, which must not leak into the rest of this process's test run.
 */
vi.mock("@next/env", () => ({ loadEnvConfig: vi.fn() }));

beforeEach(() => {
  vi.resetModules();
});

describe("vitest.justice-supabase-smoke.config.ts", () => {
  it("aliases server-only to the same no-op shim as the main Vitest config", async () => {
    const [{ default: smokeConfig }, { default: mainConfig }] = await Promise.all([
      import("./vitest.justice-supabase-smoke.config"),
      import("./vitest.config"),
    ]);

    const smokeAlias = smokeConfig.resolve?.alias as Record<string, string>;
    const mainAlias = mainConfig.resolve?.alias as Record<string, string>;

    expect(mainAlias["server-only"]).toBeTruthy();
    expect(smokeAlias["server-only"]).toBe(mainAlias["server-only"]);
  });
});

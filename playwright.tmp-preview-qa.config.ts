import { defineConfig, devices } from "@playwright/test";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

// Throwaway config for one-off signed-in visual QA against a live Vercel Preview deployment
// (PR #1021). Deliberately has no `webServer` — the target is the already-deployed URL, not a
// locally built server — and no baked-in storageState, since the Preview is a different origin
// than the localhost session captured by e2e/global.setup.ts. Never merged to cursor-dev/main.
export default defineConfig({
  testDir: "./e2e",
  testMatch: /_tmp-cancelled-checkout-preview-visual-qa\.spec\.ts/,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    trace: "on",
    ...devices["Desktop Chrome"],
  },
});

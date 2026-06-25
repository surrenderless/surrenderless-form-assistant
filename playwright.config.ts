import { defineConfig, devices } from "@playwright/test";
import { loadEnvConfig } from "@next/env";
import { CLERK_STORAGE_STATE_PATH } from "./e2e/helpers/clerk-e2e";

loadEnvConfig(process.cwd());

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "global setup",
      testMatch: /global\.setup\.ts/,
    },
    {
      name: "chromium",
      dependencies: ["global setup"],
      use: { ...devices["Desktop Chrome"] },
      testIgnore: [/global\.setup\.ts/, /signed-in-.*\.smoke\.spec\.ts/],
    },
    {
      name: "authenticated",
      testMatch: /signed-in-.*\.smoke\.spec\.ts/,
      dependencies: ["global setup"],
      fullyParallel: false,
      use: {
        ...devices["Desktop Chrome"],
        storageState: CLERK_STORAGE_STATE_PATH,
      },
    },
  ],
  webServer: {
    command: process.env.CI ? "npm run start" : "npm run dev",
    url: "http://127.0.0.1:3000/mock/ftc-complaint",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      PLAYWRIGHT_MOCK_ASSISTED_SUBMIT_PIPELINE: "1",
      PLAYWRIGHT_MOCK_INTAKE_CHAT_PIPELINE: "1",
      PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_PIPELINE: "1",
      PLAYWRIGHT_MOCK_SUBMISSION_DRAFT_REVIEWED_PIPELINE: "1",
      PLAYWRIGHT_MOCK_INTAKE_CASE_HYDRATION_PIPELINE: "1",
    },
  },
});

import { defineConfig, devices } from "@playwright/test";
import { loadEnvConfig } from "@next/env";
import {
  CLERK_STORAGE_STATE_PATH,
  OPERATOR_CLERK_STORAGE_STATE_PATH,
} from "./e2e/helpers/clerk-e2e";

loadEnvConfig(process.cwd());

export default defineConfig({
  testDir: "./e2e",
  // Single worker avoids dev-server contention between chromium mocks and the long signed-in roundtrip.
  workers: 1,
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
      testIgnore: [/global\.setup\.ts/, /signed-in-.*\.smoke\.spec\.ts/, /operator-.*\.smoke\.spec\.ts/],
    },
    {
      name: "authenticated",
      testMatch: /signed-in-.*\.smoke\.spec\.ts/,
      testIgnore: /signed-in-chat-ai-roundtrip\.smoke\.spec\.ts/,
      dependencies: ["global setup"],
      fullyParallel: false,
      use: {
        ...devices["Desktop Chrome"],
        storageState: CLERK_STORAGE_STATE_PATH,
      },
    },
    {
      name: "operator authenticated",
      testMatch: "**/operator-*.smoke.spec.ts",
      dependencies: ["global setup"],
      fullyParallel: false,
      use: {
        ...devices["Desktop Chrome"],
        storageState: OPERATOR_CLERK_STORAGE_STATE_PATH,
      },
    },
    {
      name: "authenticated roundtrip",
      testMatch: /signed-in-chat-ai-roundtrip\.smoke\.spec\.ts/,
      dependencies: ["authenticated", "operator authenticated"],
      fullyParallel: false,
      use: {
        ...devices["Desktop Chrome"],
        storageState: CLERK_STORAGE_STATE_PATH,
      },
    },
  ],
  webServer: {
    // Production server for E2E — avoids Next dev compile/contention. Override via PLAYWRIGHT_WEB_SERVER_COMMAND.
    command: process.env.PLAYWRIGHT_WEB_SERVER_COMMAND?.trim() || "npm run start",
    url: "http://127.0.0.1:3000/mock/ftc-complaint",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      PLAYWRIGHT_MOCK_ASSISTED_SUBMIT_PIPELINE: "1",
      PLAYWRIGHT_MOCK_INTAKE_CHAT_PIPELINE: "1",
      PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_PIPELINE: "1",
      PLAYWRIGHT_MOCK_SUBMISSION_DRAFT_REVIEWED_PIPELINE: "1",
      PLAYWRIGHT_MOCK_INTAKE_CASE_HYDRATION_PIPELINE: "1",
      PLAYWRIGHT_MOCK_JUSTICE_FILINGS_PIPELINE: "1",
      PLAYWRIGHT_MOCK_JUSTICE_EVIDENCE_PIPELINE: "1",
      JUSTICE_EVIDENCE_BUCKET: "justice-evidence-private",
      PLAYWRIGHT_MOCK_JUSTICE_ARCHIVED_CASES_LIST_PIPELINE: "1",
      PLAYWRIGHT_MOCK_JUSTICE_SAVED_CASES_LIST_PIPELINE: "1",
      PLAYWRIGHT_MOCK_JUSTICE_TASKS_PIPELINE: "1",
      PLAYWRIGHT_MOCK_JUSTICE_CHAT_MESSAGES_PIPELINE: "1",
      PLAYWRIGHT_MOCK_MERCHANT_OUTREACH_EMAIL: "1",
      PLAYWRIGHT_MOCK_PAYMENT_DISPUTE_OUTREACH_EMAIL: "1",
      MERCHANT_OUTREACH_FROM_EMAIL: "outreach@surrenderless.test",
      PAYMENT_DISPUTE_OUTREACH_FROM_EMAIL: "disputes@surrenderless.test",
      NEXT_PUBLIC_JUSTICE_REAL_BBB_AUTOFILL_ENABLED: "true",
      PLAYWRIGHT_MOCK_REAL_BBB_BOUNDED_SUBMIT_LOOP: "1",
    },
  },
});

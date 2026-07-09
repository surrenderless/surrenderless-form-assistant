import { afterEach, describe, expect, it, vi } from "vitest";
import { isPlaywrightMockHumanFulfillmentOperatorFilingEnabled } from "@/lib/testing/playwrightMockHumanFulfillmentLadderPipeline";

describe("isPlaywrightMockHumanFulfillmentOperatorFilingEnabled", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is enabled outside production when PLAYWRIGHT_MOCK_JUSTICE_TASKS_PIPELINE=1", () => {
    vi.stubEnv("PLAYWRIGHT_MOCK_JUSTICE_TASKS_PIPELINE", "1");
    expect(isPlaywrightMockHumanFulfillmentOperatorFilingEnabled()).toBe(true);
  });

  it("is disabled in production even when the mock env flag is set", () => {
    vi.stubEnv("PLAYWRIGHT_MOCK_JUSTICE_TASKS_PIPELINE", "1");
    vi.stubEnv("VERCEL_ENV", "production");
    expect(isPlaywrightMockHumanFulfillmentOperatorFilingEnabled()).toBe(false);
  });
});

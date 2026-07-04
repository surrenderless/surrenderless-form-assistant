import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildPlaywrightMockMatchFieldInstructions,
  buildPlaywrightMockRealBbbBoundedSubmitFillResult,
  isPlaywrightLocalMockAssistedSubmissionUrl,
  isPlaywrightMockAssistedSubmitPipelineEnabled,
} from "@/lib/testing/playwrightMockAssistedSubmitPipeline";

describe("playwrightMockAssistedSubmitPipeline", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is disabled unless PLAYWRIGHT_MOCK_ASSISTED_SUBMIT_PIPELINE=1", () => {
    expect(isPlaywrightMockAssistedSubmitPipelineEnabled()).toBe(false);
    vi.stubEnv("PLAYWRIGHT_MOCK_ASSISTED_SUBMIT_PIPELINE", "1");
    expect(isPlaywrightMockAssistedSubmitPipelineEnabled()).toBe(true);
  });

  it("is disabled on deployed production even when the flag is set", () => {
    vi.stubEnv("PLAYWRIGHT_MOCK_ASSISTED_SUBMIT_PIPELINE", "1");
    vi.stubEnv("VERCEL_ENV", "production");
    expect(isPlaywrightMockAssistedSubmitPipelineEnabled()).toBe(false);
  });

  it("allows localhost mock paths when flag is set and request origin is loopback", () => {
    vi.stubEnv("PLAYWRIGHT_MOCK_ASSISTED_SUBMIT_PIPELINE", "1");
    expect(
      isPlaywrightLocalMockAssistedSubmissionUrl(
        "http://127.0.0.1:3000/mock/ftc-complaint",
        "http://localhost:3000"
      )
    ).toBe(true);
    expect(
      isPlaywrightLocalMockAssistedSubmissionUrl(
        "http://localhost:3000/mock/bbb-complaint",
        "http://127.0.0.1:3000"
      )
    ).toBe(true);
  });

  it("rejects mock paths when the flag is off or hosts are not loopback", () => {
    expect(
      isPlaywrightLocalMockAssistedSubmissionUrl(
        "http://127.0.0.1:3000/mock/ftc-complaint",
        "http://127.0.0.1:3000"
      )
    ).toBe(false);

    vi.stubEnv("PLAYWRIGHT_MOCK_ASSISTED_SUBMIT_PIPELINE", "1");
    expect(
      isPlaywrightLocalMockAssistedSubmissionUrl(
        "https://example.com/mock/ftc-complaint",
        "https://example.com"
      )
    ).toBe(false);
    expect(
      isPlaywrightLocalMockAssistedSubmissionUrl(
        "http://127.0.0.1:3000/mock/ftc-complaint",
        "https://example.com"
      )
    ).toBe(false);
    expect(
      isPlaywrightLocalMockAssistedSubmissionUrl(
        "http://127.0.0.1:3000/justice/bbb",
        "http://127.0.0.1:3000"
      )
    ).toBe(false);
  });

  it("maps mock FTC field names from userData aliases", () => {
    const instructions = buildPlaywrightMockMatchFieldInstructions(
      [
        { name: "company_name", id: "company_name" },
        { name: "contact_email", id: "contact_email" },
        { name: "complaint_description", id: "complaint_description" },
      ],
      {
        business_name: "E2E Co",
        email: "e2e@example.com",
        story: "Practice complaint for E2E.",
      }
    );

    expect(instructions).toEqual([
      { selector: "company_name", value: "E2E Co" },
      { selector: "contact_email", value: "e2e@example.com" },
      { selector: "complaint_description", value: "Practice complaint for E2E." },
    ]);
  });

  it("builds deterministic bounded real-BBB success for Playwright E2E", () => {
    const fillResult = buildPlaywrightMockRealBbbBoundedSubmitFillResult(
      "https://www.bbb.org/complain/"
    );

    expect(fillResult).toEqual(
      expect.objectContaining({
        status: "success",
        stopReason: "terminal_confirmation",
        storageSkipped: true,
        stepsExecuted: 0,
        stepLog: [
          expect.objectContaining({
            action: "terminal_detected",
            url: "https://www.bbb.org/complain/",
          }),
        ],
      })
    );
    expect(fillResult.pageData?.pageText).toContain("successfully submitted");
  });
});

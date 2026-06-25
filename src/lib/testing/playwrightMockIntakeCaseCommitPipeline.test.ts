import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildPlaywrightMockCaseCreateResponse,
  isPlaywrightMockIntakeCaseCommitPipelineEnabled,
  PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID,
} from "@/lib/testing/playwrightMockIntakeCaseCommitPipeline";

describe("playwrightMockIntakeCaseCommitPipeline", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is disabled unless PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_PIPELINE=1", () => {
    expect(isPlaywrightMockIntakeCaseCommitPipelineEnabled()).toBe(false);
    vi.stubEnv("PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_PIPELINE", "1");
    expect(isPlaywrightMockIntakeCaseCommitPipelineEnabled()).toBe(true);
  });

  it("is disabled on deployed production even when the flag is set", () => {
    vi.stubEnv("PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_PIPELINE", "1");
    vi.stubEnv("VERCEL_ENV", "production");
    expect(isPlaywrightMockIntakeCaseCommitPipelineEnabled()).toBe(false);
  });

  it("returns production POST /api/justice/cases contract with deterministic id", () => {
    const intake = {
      problem_category: "online_purchase",
      company_name: "Acme Retail",
      reply_email: "e2e-chat@example.com",
    };
    const timeline = [{ type: "case_started", label: "Case started" }];

    const result = buildPlaywrightMockCaseCreateResponse(intake, timeline);

    expect(result.id).toBe(PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID);
    expect(result.intake).toBe(intake);
    expect(result.timeline).toBe(timeline);
    expect(result.payment_dispute_draft).toBeNull();
    expect(result.client_state).toBeNull();
    expect(result.archived_at).toBeNull();
    expect(result.case_label).toBeNull();
    expect(result.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

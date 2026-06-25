import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildPlaywrightMockCaseGetResponse,
  buildPlaywrightMockCasePatchResponse,
  buildPlaywrightMockE2eCaseIntake,
  isPlaywrightMockIntakeCaseHydrationCaseId,
  isPlaywrightMockIntakeCaseHydrationPipelineEnabled,
} from "@/lib/testing/playwrightMockIntakeCaseHydrationPipeline";
import { PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID } from "@/lib/testing/playwrightMockIntakeCaseCommitPipeline";

describe("playwrightMockIntakeCaseHydrationPipeline", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is disabled unless PLAYWRIGHT_MOCK_INTAKE_CASE_HYDRATION_PIPELINE=1", () => {
    expect(isPlaywrightMockIntakeCaseHydrationPipelineEnabled()).toBe(false);
    vi.stubEnv("PLAYWRIGHT_MOCK_INTAKE_CASE_HYDRATION_PIPELINE", "1");
    expect(isPlaywrightMockIntakeCaseHydrationPipelineEnabled()).toBe(true);
  });

  it("is disabled on deployed production even when the flag is set", () => {
    vi.stubEnv("PLAYWRIGHT_MOCK_INTAKE_CASE_HYDRATION_PIPELINE", "1");
    vi.stubEnv("VERCEL_ENV", "production");
    expect(isPlaywrightMockIntakeCaseHydrationPipelineEnabled()).toBe(false);
  });

  it("matches only the deterministic E2E case id", () => {
    expect(isPlaywrightMockIntakeCaseHydrationCaseId(PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID)).toBe(
      true
    );
    expect(isPlaywrightMockIntakeCaseHydrationCaseId("00000000-0000-4000-8000-000000000001")).toBe(false);
  });

  it("returns production GET /api/justice/cases/[id] contract with case_started timeline only", () => {
    const result = buildPlaywrightMockCaseGetResponse(PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID);

    expect(result.id).toBe(PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID);
    expect(result.intake).toEqual(buildPlaywrightMockE2eCaseIntake());
    expect(result.payment_dispute_draft).toBeNull();
    expect(result.client_state).toBeNull();
    expect(result.archived_at).toBeNull();
    expect(result.case_label).toBeNull();
    expect(result.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.timeline).toHaveLength(1);
    expect(result.timeline).toEqual([
      expect.objectContaining({ type: "case_started", id: "playwright_e2e_case_started" }),
    ]);
  });

  it("returns production PATCH /api/justice/cases/[id] contract echoing client_state", () => {
    const clientState = {
      prepared_packet_approved: true,
      approved_next_action: {
        label: "Merchant contact",
        href: "/justice/merchant",
        status: "approved",
        approved_at: "2026-06-21T00:00:01.000Z",
      },
    };

    const result = buildPlaywrightMockCasePatchResponse(
      PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID,
      { client_state: clientState }
    );

    expect(result.id).toBe(PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID);
    expect(result.client_state).toEqual(clientState);
    expect(result.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.intake).toEqual(buildPlaywrightMockE2eCaseIntake());
  });
});

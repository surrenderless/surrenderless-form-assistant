import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID } from "@/lib/testing/playwrightMockIntakeCaseCommitPipeline";
import {
  buildPlaywrightMockJusticeEvidenceGetResponse,
  isPlaywrightMockJusticeEvidenceCaseId,
  isPlaywrightMockJusticeEvidencePipelineEnabled,
  resetPlaywrightMockJusticeEvidenceForCase,
  resetPlaywrightMockJusticeEvidenceForTests,
} from "@/lib/testing/playwrightMockJusticeEvidencePipeline";

describe("playwrightMockJusticeEvidencePipeline", () => {
  const caseId = PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID;
  const userId = "playwright_e2e_user";

  beforeEach(() => {
    resetPlaywrightMockJusticeEvidenceForTests();
    vi.stubEnv("PLAYWRIGHT_MOCK_JUSTICE_EVIDENCE_PIPELINE", "1");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetPlaywrightMockJusticeEvidenceForTests();
  });

  it("is disabled unless PLAYWRIGHT_MOCK_JUSTICE_EVIDENCE_PIPELINE=1", () => {
    vi.unstubAllEnvs();
    expect(isPlaywrightMockJusticeEvidencePipelineEnabled()).toBe(false);
    vi.stubEnv("PLAYWRIGHT_MOCK_JUSTICE_EVIDENCE_PIPELINE", "1");
    expect(isPlaywrightMockJusticeEvidencePipelineEnabled()).toBe(true);
  });

  it("is disabled on deployed production even when the flag is set", () => {
    vi.unstubAllEnvs();
    vi.stubEnv("PLAYWRIGHT_MOCK_JUSTICE_EVIDENCE_PIPELINE", "1");
    vi.stubEnv("VERCEL_ENV", "production");
    expect(isPlaywrightMockJusticeEvidencePipelineEnabled()).toBe(false);
  });

  it("matches only the deterministic E2E case id", () => {
    expect(isPlaywrightMockJusticeEvidenceCaseId(caseId)).toBe(true);
    expect(isPlaywrightMockJusticeEvidenceCaseId("00000000-0000-4000-8000-000000000001")).toBe(false);
  });

  it("returns production GET /api/justice/evidence shape with at least one realistic row", () => {
    const rows = buildPlaywrightMockJusticeEvidenceGetResponse(caseId, userId);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "playwright_e2e_merchant_refund_email",
      user_id: userId,
      case_id: caseId,
      title: "Acme Retail refund denial email",
      evidence_type: "email",
      evidence_date: "2026-01-15",
    });
    expect(rows[0]?.description).toContain("Acme Retail refused a refund");
  });

  it("re-seeds default evidence rows after reset for the fixed E2E case id", () => {
    const first = buildPlaywrightMockJusticeEvidenceGetResponse(caseId, userId);
    expect(first).toHaveLength(1);

    resetPlaywrightMockJusticeEvidenceForCase(caseId);
    const afterReset = buildPlaywrightMockJusticeEvidenceGetResponse(caseId, userId);
    expect(afterReset).toHaveLength(1);
    expect(afterReset[0]?.id).toBe(first[0]?.id);

    resetPlaywrightMockJusticeEvidenceForCase("00000000-0000-4000-8000-000000000001");
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { omitEvidenceFilePathFromApiRow } from "@/lib/justice/evidenceFileAccess";
import { PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID } from "@/lib/testing/playwrightMockIntakeCaseCommitPipeline";
import {
  appendPlaywrightMockJusticeEvidenceUpload,
  buildPlaywrightMockJusticeEvidenceGetResponse,
  findPlaywrightMockJusticeEvidenceById,
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
      file_path: null,
      file_name: null,
      mime_type: null,
      file_size_bytes: null,
    });
    expect(rows[0]?.description).toContain("Acme Retail refused a refund");
    expect(
      omitEvidenceFilePathFromApiRow(rows[0] as unknown as Record<string, unknown>)
    ).not.toHaveProperty("file_path");
  });

  it("appends uploaded file metadata into the mock evidence list", () => {
    buildPlaywrightMockJusticeEvidenceGetResponse(caseId, userId);
    const uploaded = appendPlaywrightMockJusticeEvidenceUpload({
      userId,
      caseId,
      title: "Denial screenshot",
      evidenceType: "screenshot",
      filePath: "justice-evidence/u/c/obj-denial.png",
      fileName: "denial.png",
      mimeType: "image/png",
      fileSizeBytes: 2048,
      storageNote: "Uploaded file: denial.png",
    });
    expect(uploaded.file_name).toBe("denial.png");
    expect(uploaded.source_url).toBeNull();
    expect(uploaded.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
    const rows = buildPlaywrightMockJusticeEvidenceGetResponse(caseId, userId);
    expect(rows[0]?.id).toBe(uploaded.id);
    expect(rows).toHaveLength(2);
  });

  it("finds uploaded rows by id for private file-access ownership checks", () => {
    buildPlaywrightMockJusticeEvidenceGetResponse(caseId, userId);
    const uploaded = appendPlaywrightMockJusticeEvidenceUpload({
      userId,
      caseId,
      title: "Denial screenshot",
      evidenceType: "screenshot",
      filePath: "justice-evidence/u/c/obj-denial.png",
      fileName: "denial.png",
      mimeType: "image/png",
      fileSizeBytes: 2048,
    });
    expect(findPlaywrightMockJusticeEvidenceById(uploaded.id)?.user_id).toBe(userId);
    expect(findPlaywrightMockJusticeEvidenceById(uploaded.id)?.file_path).toBe(
      "justice-evidence/u/c/obj-denial.png"
    );
    expect(findPlaywrightMockJusticeEvidenceById("00000000-0000-4000-8000-000000000099")).toBeNull();
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

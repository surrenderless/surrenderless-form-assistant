import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/server/requireUser", () => ({
  getUserOr401: vi.fn(),
}));

import { GET } from "@/app/api/justice/evidence/[id]/file/route";
import { getUserOr401 } from "@/server/requireUser";
import { JUSTICE_EVIDENCE_BUCKET_MISSING_ERROR } from "@/lib/justice/evidenceFileAccess";
import { PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID } from "@/lib/testing/playwrightMockIntakeCaseCommitPipeline";
import {
  appendPlaywrightMockJusticeEvidenceUpload,
  buildPlaywrightMockJusticeEvidenceGetResponse,
  resetPlaywrightMockJusticeEvidenceForTests,
} from "@/lib/testing/playwrightMockJusticeEvidencePipeline";

const OWNER_ID = "playwright_e2e_user";
const OTHER_USER_ID = "other_user_not_owner";
const CASE_ID = PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID;

function buildRequest(evidenceId: string, formatJson = false) {
  const url = new URL(`http://localhost/api/justice/evidence/${evidenceId}/file`);
  if (formatJson) url.searchParams.set("format", "json");
  return new NextRequest(url, { method: "GET" });
}

describe("GET /api/justice/evidence/[id]/file", () => {
  beforeEach(() => {
    resetPlaywrightMockJusticeEvidenceForTests();
    vi.stubEnv("PLAYWRIGHT_MOCK_JUSTICE_EVIDENCE_PIPELINE", "1");
    vi.stubEnv("JUSTICE_EVIDENCE_BUCKET", "justice-evidence-private");
    vi.mocked(getUserOr401).mockReturnValue(OWNER_ID);
    buildPlaywrightMockJusticeEvidenceGetResponse(CASE_ID, OWNER_ID);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    resetPlaywrightMockJusticeEvidenceForTests();
  });

  it("returns 503 when JUSTICE_EVIDENCE_BUCKET is missing even if SUPABASE_BUCKET is set", async () => {
    vi.stubEnv("JUSTICE_EVIDENCE_BUCKET", "");
    vi.stubEnv("SUPABASE_BUCKET", "public-screenshots");
    const uploaded = appendPlaywrightMockJusticeEvidenceUpload({
      userId: OWNER_ID,
      caseId: CASE_ID,
      title: "Denial",
      evidenceType: "screenshot",
      filePath: "justice-evidence/u/c/obj.png",
      fileName: "denial.png",
      mimeType: "image/png",
      fileSizeBytes: 100,
    });
    const res = await GET(buildRequest(uploaded.id, true), {
      params: Promise.resolve({ id: uploaded.id }),
    });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: JUSTICE_EVIDENCE_BUCKET_MISSING_ERROR });
  });

  it("returns 401 when not signed in", async () => {
    vi.mocked(getUserOr401).mockReturnValue(null);
    const uploaded = appendPlaywrightMockJusticeEvidenceUpload({
      userId: OWNER_ID,
      caseId: CASE_ID,
      title: "Denial",
      evidenceType: "screenshot",
      filePath: "justice-evidence/u/c/obj.png",
      fileName: "denial.png",
      mimeType: "image/png",
      fileSizeBytes: 100,
    });
    const res = await GET(buildRequest(uploaded.id), {
      params: Promise.resolve({ id: uploaded.id }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 404 when a different user requests the file", async () => {
    const uploaded = appendPlaywrightMockJusticeEvidenceUpload({
      userId: OWNER_ID,
      caseId: CASE_ID,
      title: "Denial",
      evidenceType: "screenshot",
      filePath: "justice-evidence/u/c/obj.png",
      fileName: "denial.png",
      mimeType: "image/png",
      fileSizeBytes: 100,
    });
    vi.mocked(getUserOr401).mockReturnValue(OTHER_USER_ID);
    const res = await GET(buildRequest(uploaded.id, true), {
      params: Promise.resolve({ id: uploaded.id }),
    });
    expect(res.status).toBe(404);
  });

  it("lets the owner obtain a non-public signed URL without file_path leakage", async () => {
    const uploaded = appendPlaywrightMockJusticeEvidenceUpload({
      userId: OWNER_ID,
      caseId: CASE_ID,
      title: "Denial",
      evidenceType: "screenshot",
      filePath: "justice-evidence/u/c/obj.png",
      fileName: "denial.png",
      mimeType: "image/png",
      fileSizeBytes: 100,
    });
    const res = await GET(buildRequest(uploaded.id, true), {
      params: Promise.resolve({ id: uploaded.id }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.file_name).toBe("denial.png");
    expect(body.signed_url).toBeTruthy();
    expect(String(body.signed_url)).not.toMatch(/\/storage\/v1\/object\/public\//i);
    expect(body).not.toHaveProperty("file_path");
    expect(JSON.stringify(body)).not.toContain("justice-evidence/u/c/obj.png");
    expect(typeof body.expires_in).toBe("number");
  });
});

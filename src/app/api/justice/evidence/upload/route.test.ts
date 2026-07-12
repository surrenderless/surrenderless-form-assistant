import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/server/requireUser", () => ({
  getUserOr401: vi.fn(),
}));

import { POST } from "@/app/api/justice/evidence/upload/route";
import { getUserOr401 } from "@/server/requireUser";
import { JUSTICE_EVIDENCE_BUCKET_MISSING_ERROR } from "@/lib/justice/evidenceFileAccess";
import { PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID } from "@/lib/testing/playwrightMockIntakeCaseCommitPipeline";
import { resetPlaywrightMockJusticeEvidenceForTests } from "@/lib/testing/playwrightMockJusticeEvidencePipeline";

const OWNER_ID = "playwright_e2e_user";
const CASE_ID = PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID;

function buildUploadRequest() {
  const form = new FormData();
  form.set("case_id", CASE_ID);
  form.set(
    "file",
    new File([Uint8Array.from([137, 80, 78, 71])], "denial.png", { type: "image/png" })
  );
  return new NextRequest("http://localhost/api/justice/evidence/upload", {
    method: "POST",
    body: form,
  });
}

describe("POST /api/justice/evidence/upload", () => {
  beforeEach(() => {
    resetPlaywrightMockJusticeEvidenceForTests();
    vi.stubEnv("PLAYWRIGHT_MOCK_JUSTICE_EVIDENCE_PIPELINE", "1");
    vi.stubEnv("JUSTICE_EVIDENCE_BUCKET", "justice-evidence-private");
    vi.mocked(getUserOr401).mockReturnValue(OWNER_ID);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    resetPlaywrightMockJusticeEvidenceForTests();
  });

  it("fails closed when JUSTICE_EVIDENCE_BUCKET is missing and does not use SUPABASE_BUCKET", async () => {
    vi.stubEnv("JUSTICE_EVIDENCE_BUCKET", "");
    vi.stubEnv("SUPABASE_BUCKET", "public-screenshots");
    const res = await POST(buildUploadRequest());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: JUSTICE_EVIDENCE_BUCKET_MISSING_ERROR });
  });

  it("returns upload metadata without file_path or public URLs", async () => {
    const res = await POST(buildUploadRequest());
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.file_name).toBe("denial.png");
    expect(body.mime_type).toBe("image/png");
    expect(body.source_url).toBeNull();
    expect(body).not.toHaveProperty("file_path");
    expect(JSON.stringify(body)).not.toMatch(/\/storage\/v1\/object\/public\//i);
    expect(JSON.stringify(body)).not.toMatch(/justice-evidence\//i);
  });
});

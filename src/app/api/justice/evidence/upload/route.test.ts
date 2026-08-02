import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/server/requireUser", () => ({
  getUserOr401: vi.fn(),
}));

vi.mock("@/utils/rateLimiter", () => ({
  rateLimit: vi.fn(),
}));

import { POST } from "@/app/api/justice/evidence/upload/route";
import { getUserOr401 } from "@/server/requireUser";
import { rateLimit } from "@/utils/rateLimiter";
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
    vi.mocked(rateLimit).mockResolvedValue(false);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    resetPlaywrightMockJusticeEvidenceForTests();
  });

  it("returns 429 and never reaches upload processing when rate-limited", async () => {
    vi.mocked(rateLimit).mockResolvedValue(true);
    // Bucket deliberately left unconfigured: if the request reached the storage/upload logic at
    // all, it would 503 (see the sibling test below) rather than 429 — proving the rate-limit
    // gate short-circuits before form parsing, validation, or storage are ever touched.
    vi.stubEnv("JUSTICE_EVIDENCE_BUCKET", "");

    const res = await POST(buildUploadRequest());

    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "Rate limit exceeded" });
    expect(getUserOr401).toHaveBeenCalled();
    expect(rateLimit).toHaveBeenCalledWith(OWNER_ID);
  });

  it("preserves fail-open behavior: proceeds with upload when the limiter itself throws", async () => {
    vi.mocked(rateLimit).mockRejectedValue(new Error("redis unreachable"));

    const res = await POST(buildUploadRequest());

    expect(res.status).toBe(200);
    expect(rateLimit).toHaveBeenCalledWith(OWNER_ID);
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

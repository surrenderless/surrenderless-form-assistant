import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { NextResponse } from "next/server";

vi.mock("@/server/requireOperatorApiAccess", () => ({
  requireOperatorApiAccess: vi.fn(),
}));

vi.mock("@/lib/testing/playwrightMockHumanFulfillmentLadderPipeline", () => ({
  isPlaywrightMockHumanFulfillmentOperatorFilingEnabled: vi.fn(() => true),
  buildPlaywrightMockOperatorFulfillmentQueue: vi.fn(() => []),
}));

import { GET } from "@/app/api/operator/evidence/[id]/file/route";
import { requireOperatorApiAccess } from "@/server/requireOperatorApiAccess";
import { JUSTICE_EVIDENCE_BUCKET_MISSING_ERROR } from "@/lib/justice/evidenceFileAccess";
import { PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID } from "@/lib/testing/playwrightMockIntakeCaseCommitPipeline";
import {
  appendPlaywrightMockJusticeEvidenceUpload,
  buildPlaywrightMockJusticeEvidenceGetResponse,
  resetPlaywrightMockJusticeEvidenceForTests,
} from "@/lib/testing/playwrightMockJusticeEvidencePipeline";
import {
  buildPlaywrightMockOperatorFulfillmentQueue,
  isPlaywrightMockHumanFulfillmentOperatorFilingEnabled,
} from "@/lib/testing/playwrightMockHumanFulfillmentLadderPipeline";

const OPERATOR_ID = "operator_user";
const CASE_ID = PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID;
const OWNER_ID = "playwright_e2e_user";

function buildRequest(evidenceId: string, formatJson = false) {
  const url = new URL(`http://localhost/api/operator/evidence/${evidenceId}/file`);
  if (formatJson) url.searchParams.set("format", "json");
  return new NextRequest(url, { method: "GET" });
}

describe("GET /api/operator/evidence/[id]/file", () => {
  beforeEach(() => {
    resetPlaywrightMockJusticeEvidenceForTests();
    vi.stubEnv("PLAYWRIGHT_MOCK_JUSTICE_EVIDENCE_PIPELINE", "1");
    vi.stubEnv("JUSTICE_EVIDENCE_BUCKET", "justice-evidence-private");
    vi.mocked(requireOperatorApiAccess).mockResolvedValue({
      ok: true,
      operatorUserId: OPERATOR_ID,
    });
    vi.mocked(isPlaywrightMockHumanFulfillmentOperatorFilingEnabled).mockReturnValue(true);
    vi.mocked(buildPlaywrightMockOperatorFulfillmentQueue).mockReturnValue([
      {
        task_id: "task-1",
        case_id: CASE_ID,
        step: "cfpb",
        title: "CFPB filing",
        created_at: "2026-07-01T00:00:00.000Z",
      } as never,
    ]);
    buildPlaywrightMockJusticeEvidenceGetResponse(CASE_ID, OWNER_ID);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    resetPlaywrightMockJusticeEvidenceForTests();
  });

  it("returns 401/403 when requireOperatorApiAccess rejects", async () => {
    vi.mocked(requireOperatorApiAccess).mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    });
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
    expect(res.status).toBe(403);
  });

  it("returns 503 when JUSTICE_EVIDENCE_BUCKET is missing", async () => {
    vi.stubEnv("JUSTICE_EVIDENCE_BUCKET", "");
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

  it("returns a short-lived signed URL JSON when the case has an open operator task", async () => {
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
    const body = await res.json();
    expect(body.file_name).toBe("denial.png");
    expect(body.expires_in).toBe(60);
    expect(body.signed_url).toContain("mock-signed-evidence");
    expect(JSON.stringify(body)).not.toMatch(/file_path|justice-evidence\/u\/c/);
  });

  it("returns 404 when evidence belongs to a case without an open operator fulfillment task", async () => {
    vi.mocked(buildPlaywrightMockOperatorFulfillmentQueue).mockReturnValue([]);
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
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
  });
});

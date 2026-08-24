import { NextResponse, type NextRequest } from "next/server";
import { getUserOr401 } from "@/server/requireUser";
import { PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID } from "@/lib/testing/playwrightMockIntakeCaseCommitPipeline";
import {
  isPlaywrightMockIntakeCaseHydrationCaseId,
  isPlaywrightMockIntakeCaseHydrationPipelineEnabled,
  resetPlaywrightMockCaseHydrationSnapshotForCase,
} from "@/lib/testing/playwrightMockIntakeCaseHydrationPipeline";
import {
  isPlaywrightMockJusticeChatMessagesPipelineEnabled,
  resetPlaywrightMockJusticeChatMessagesForCase,
} from "@/lib/testing/playwrightMockJusticeChatMessagesPipeline";
import {
  isPlaywrightMockJusticeEvidencePipelineEnabled,
  resetPlaywrightMockJusticeEvidenceForCase,
} from "@/lib/testing/playwrightMockJusticeEvidencePipeline";
import {
  isPlaywrightMockJusticeFilingsPipelineEnabled,
  resetPlaywrightMockJusticeFilingsForCase,
} from "@/lib/testing/playwrightMockJusticeFilingsPipeline";
import {
  isPlaywrightMockJusticeTasksPipelineEnabled,
  resetPlaywrightMockJusticeTasksForCase,
} from "@/lib/testing/playwrightMockJusticeTasksPipeline";

/**
 * Test-only: fully remove a deterministic Playwright mock case from every in-memory mock
 * store it lives in (case snapshot, chat transcript, evidence, filings, tasks/human-fulfillment
 * ladder) — not just the case snapshot — so a follow-up GET /api/justice/cases has no trace of
 * it and chat-ai's resume-on-mount fallback finds nothing to resume. Mirrors exactly the reset
 * calls POST /api/justice/cases already runs before reseeding on a real create; this endpoint
 * just stops after the reset instead of reseeding.
 *
 * Fails closed (404) unless the Playwright mock case-hydration pipeline is enabled, which
 * itself refuses to report enabled on deployed production regardless of env var state. Never
 * touches Supabase — every store here is an in-memory Map used only by the mock pipelines.
 */
export async function POST(req: NextRequest) {
  if (!isPlaywrightMockIntakeCaseHydrationPipelineEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const userId = getUserOr401(req);
  if (!userId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    // Empty/absent body is fine — defaults to the primary E2E case id below.
  }
  const requestedCaseId =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>).case_id
      : undefined;
  const caseId =
    typeof requestedCaseId === "string" && requestedCaseId.trim()
      ? requestedCaseId.trim()
      : PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID;

  if (!isPlaywrightMockIntakeCaseHydrationCaseId(caseId)) {
    return NextResponse.json({ error: "Unknown mock case id" }, { status: 400 });
  }

  resetPlaywrightMockCaseHydrationSnapshotForCase(caseId);
  if (isPlaywrightMockJusticeChatMessagesPipelineEnabled()) {
    resetPlaywrightMockJusticeChatMessagesForCase(caseId);
  }
  if (isPlaywrightMockJusticeEvidencePipelineEnabled()) {
    resetPlaywrightMockJusticeEvidenceForCase(caseId);
  }
  if (isPlaywrightMockJusticeFilingsPipelineEnabled()) {
    resetPlaywrightMockJusticeFilingsForCase(caseId);
  }
  if (isPlaywrightMockJusticeTasksPipelineEnabled()) {
    // Also clears the human-fulfillment ladder/owner map for this case id (see
    // resetPlaywrightMockJusticeTasksForCase's own delegation).
    resetPlaywrightMockJusticeTasksForCase(caseId);
  }

  return NextResponse.json({ ok: true, case_id: caseId });
}

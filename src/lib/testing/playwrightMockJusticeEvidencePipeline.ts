import { v4 as uuidv4 } from "uuid";
import { PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID } from "@/lib/testing/playwrightMockIntakeCaseCommitPipeline";
import { PLAYWRIGHT_MOCK_SECOND_CASE_ID } from "@/lib/testing/playwrightMockJusticeChatMessagesOwnership";

const PLAYWRIGHT_MOCK_EVIDENCE_TIMESTAMP = "2026-06-21T00:00:01.000Z";
const PLAYWRIGHT_MOCK_EVIDENCE_ROW_ID = "playwright_e2e_merchant_refund_email";
export const PLAYWRIGHT_MOCK_EVIDENCE_UPLOAD_ROW_ID_PREFIX = "playwright_e2e_evidence_upload_";

export type PlaywrightMockJusticeEvidenceRow = {
  id: string;
  user_id: string;
  case_id: string;
  title: string;
  evidence_type: string;
  evidence_date: string | null;
  description: string | null;
  source_url: string | null;
  storage_note: string | null;
  file_path: string | null;
  file_name: string | null;
  mime_type: string | null;
  file_size_bytes: number | null;
  created_at: string;
  updated_at: string;
};

/** In-process mock evidence rows for Playwright E2E case ids. */
const playwrightMockJusticeEvidenceByCaseId = new Map<string, PlaywrightMockJusticeEvidenceRow[]>();

function buildDefaultEvidenceRows(caseId: string, userId: string): PlaywrightMockJusticeEvidenceRow[] {
  return [
    {
      id: PLAYWRIGHT_MOCK_EVIDENCE_ROW_ID,
      user_id: userId,
      case_id: caseId,
      title: "Acme Retail refund denial email",
      evidence_type: "email",
      evidence_date: "2026-01-15",
      description:
        "E2E: Acme Retail refused a refund by email on 2026-01-15. Merchant cited final sale policy.",
      source_url: null,
      storage_note: null,
      file_path: null,
      file_name: null,
      mime_type: null,
      file_size_bytes: null,
      created_at: PLAYWRIGHT_MOCK_EVIDENCE_TIMESTAMP,
      updated_at: PLAYWRIGHT_MOCK_EVIDENCE_TIMESTAMP,
    },
  ];
}

/** Enabled only when Playwright webServer sets PLAYWRIGHT_MOCK_JUSTICE_EVIDENCE_PIPELINE=1. */
export function isPlaywrightMockJusticeEvidencePipelineEnabled(): boolean {
  if (process.env.PLAYWRIGHT_MOCK_JUSTICE_EVIDENCE_PIPELINE !== "1") {
    return false;
  }
  // Never allow on deployed production, even if the env var is set.
  if (process.env.VERCEL_ENV === "production") {
    return false;
  }
  return true;
}

/** True when GET /api/justice/evidence should use the deterministic Playwright mock. */
export function isPlaywrightMockJusticeEvidenceCaseId(caseId: string): boolean {
  const trimmed = caseId.trim();
  return (
    trimmed === PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID ||
    trimmed === PLAYWRIGHT_MOCK_SECOND_CASE_ID
  );
}

/** Clears mock evidence snapshots — for unit tests only. */
export function resetPlaywrightMockJusticeEvidenceForTests(): void {
  playwrightMockJusticeEvidenceByCaseId.clear();
}

/** Clears mock evidence for one case — re-seeds defaults on the next GET. */
export function resetPlaywrightMockJusticeEvidenceForCase(caseId: string): void {
  if (!isPlaywrightMockJusticeEvidenceCaseId(caseId)) return;
  playwrightMockJusticeEvidenceByCaseId.delete(caseId.trim());
}

function ensureMockRows(caseId: string, userId: string): PlaywrightMockJusticeEvidenceRow[] {
  const existing = playwrightMockJusticeEvidenceByCaseId.get(caseId);
  if (existing) return existing;
  if (caseId.trim() === PLAYWRIGHT_MOCK_SECOND_CASE_ID) {
    const empty: PlaywrightMockJusticeEvidenceRow[] = [];
    playwrightMockJusticeEvidenceByCaseId.set(caseId, empty);
    return empty;
  }
  const seeded = buildDefaultEvidenceRows(caseId, userId);
  playwrightMockJusticeEvidenceByCaseId.set(caseId, seeded);
  return seeded;
}

/**
 * Deterministic GET /api/justice/evidence response for Playwright E2E.
 * Returns at least one realistic evidence row for the fixed case id.
 */
export function buildPlaywrightMockJusticeEvidenceGetResponse(
  caseId: string,
  userId: string
): PlaywrightMockJusticeEvidenceRow[] {
  return ensureMockRows(caseId, userId).map((row) => ({ ...row }));
}

/** Persist a chat-native evidence file upload into the in-memory mock list. */
export function appendPlaywrightMockJusticeEvidenceUpload(input: {
  userId: string;
  caseId: string;
  title: string;
  evidenceType: string;
  filePath: string;
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
  storageNote?: string | null;
}): PlaywrightMockJusticeEvidenceRow {
  const caseId = input.caseId.trim();
  const rows = ensureMockRows(caseId, input.userId);
  const createdAt = new Date().toISOString();
  const row: PlaywrightMockJusticeEvidenceRow = {
    // UUID so private file-access routes share production id validation.
    id: uuidv4(),
    user_id: input.userId,
    case_id: caseId,
    title: input.title,
    evidence_type: input.evidenceType,
    evidence_date: null,
    description: null,
    // Private attachments never store public object URLs.
    source_url: null,
    storage_note: input.storageNote ?? null,
    file_path: input.filePath,
    file_name: input.fileName,
    mime_type: input.mimeType,
    file_size_bytes: input.fileSizeBytes,
    created_at: createdAt,
    updated_at: createdAt,
  };
  rows.unshift(row);
  playwrightMockJusticeEvidenceByCaseId.set(caseId, rows);
  return { ...row };
}

/** Look up a mock evidence row by id across all seeded cases (ownership checked by caller). */
export function findPlaywrightMockJusticeEvidenceById(
  evidenceId: string
): PlaywrightMockJusticeEvidenceRow | null {
  const id = evidenceId.trim();
  if (!id) return null;
  for (const rows of playwrightMockJusticeEvidenceByCaseId.values()) {
    const found = rows.find((row) => row.id === id);
    if (found) return { ...found };
  }
  return null;
}

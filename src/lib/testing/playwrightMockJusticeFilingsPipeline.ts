import { PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID } from "@/lib/testing/playwrightMockIntakeCaseCommitPipeline";
import {
  buildPlaywrightMockCaseGetResponse,
  buildPlaywrightMockCasePatchResponse,
  isPlaywrightMockIntakeCaseHydrationCaseId,
} from "@/lib/testing/playwrightMockIntakeCaseHydrationPipeline";
import type { TimelineEntry } from "@/lib/justice/types";

const PLAYWRIGHT_MOCK_FILING_TIMESTAMP = "2026-06-21T00:00:02.000Z";
const PLAYWRIGHT_MOCK_FILING_UPDATED_TIMESTAMP = "2026-06-21T00:00:03.000Z";
const PLAYWRIGHT_MOCK_FILING_ROW_ID = "playwright_e2e_ftc_practice_filing";

export type PlaywrightMockJusticeFilingRow = {
  id: string;
  user_id: string;
  case_id: string;
  destination: string;
  filed_at: string | null;
  confirmation_number: string | null;
  filing_url: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

/** In-process mock filing rows for the fixed Playwright E2E case id only. */
const playwrightMockJusticeFilingsByCaseId = new Map<string, PlaywrightMockJusticeFilingRow[]>();

export type PlaywrightMockJusticeFilingPostBody = {
  destination: string;
  filed_at?: string | null;
  confirmation_number?: string | null;
  filing_url?: string | null;
  notes?: string | null;
};

/** Enabled only when Playwright webServer sets PLAYWRIGHT_MOCK_JUSTICE_FILINGS_PIPELINE=1. */
export function isPlaywrightMockJusticeFilingsPipelineEnabled(): boolean {
  if (process.env.PLAYWRIGHT_MOCK_JUSTICE_FILINGS_PIPELINE !== "1") {
    return false;
  }
  // Never allow on deployed production, even if the env var is set.
  if (process.env.VERCEL_ENV === "production") {
    return false;
  }
  return true;
}

/** True when /api/justice/filings should use the deterministic Playwright mock. */
export function isPlaywrightMockJusticeFilingsCaseId(caseId: string): boolean {
  return caseId.trim() === PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID;
}

/** Clears cumulative mock filing rows — for unit tests only. */
export function resetPlaywrightMockJusticeFilingsForTests(): void {
  playwrightMockJusticeFilingsByCaseId.clear();
}

/** Clears mock filings for one case — used when Playwright E2E recommits the fixed case. */
export function resetPlaywrightMockJusticeFilingsForCase(caseId: string): void {
  if (!isPlaywrightMockJusticeFilingsCaseId(caseId)) return;
  playwrightMockJusticeFilingsByCaseId.delete(caseId.trim());
}

function normalizeTimeline(v: unknown): TimelineEntry[] {
  if (!Array.isArray(v)) return [];
  return v.filter((item) => item !== null && typeof item === "object" && !Array.isArray(item)) as TimelineEntry[];
}

function sortByTs(entries: TimelineEntry[]): TimelineEntry[] {
  return [...entries].sort((a, b) => a.ts.localeCompare(b.ts));
}

function appendFilingRecordedTimelineEntry(
  caseId: string,
  timeline: TimelineEntry[],
  filing: PlaywrightMockJusticeFilingRow
): TimelineEntry[] {
  const entryId = `justice_fil:${filing.id}`;
  if (timeline.some((entry) => entry.id === entryId)) {
    return sortByTs(timeline);
  }
  const conf = filing.confirmation_number?.trim();
  const detail = conf ? `${filing.destination} filed — ${conf}` : `${filing.destination} filed`;
  const newEntry: TimelineEntry = {
    id: entryId,
    case_id: caseId,
    type: "filing_recorded",
    label: "Filing recorded",
    detail,
    ts: PLAYWRIGHT_MOCK_FILING_UPDATED_TIMESTAMP,
  };
  return sortByTs([...timeline, newEntry]);
}

/**
 * Deterministic GET /api/justice/filings response for Playwright E2E.
 * Returns cumulative in-process filing rows for the fixed case id.
 */
export function buildPlaywrightMockJusticeFilingsGetResponse(caseId: string): PlaywrightMockJusticeFilingRow[] {
  const rows = playwrightMockJusticeFilingsByCaseId.get(caseId);
  if (!rows) return [];
  return rows.map((row) => ({ ...row }));
}

/**
 * Deterministic POST /api/justice/filings response for Playwright E2E.
 * Appends a filing row, merges filing_recorded into the hydration timeline snapshot,
 * and returns the production filing row shape plus timeline when present.
 */
export function buildPlaywrightMockJusticeFilingPostResponse(
  caseId: string,
  userId: string,
  body: PlaywrightMockJusticeFilingPostBody
): PlaywrightMockJusticeFilingRow & { timeline?: TimelineEntry[] } {
  const filing: PlaywrightMockJusticeFilingRow = {
    id: PLAYWRIGHT_MOCK_FILING_ROW_ID,
    user_id: userId,
    case_id: caseId,
    destination: body.destination.trim(),
    filed_at: body.filed_at ?? null,
    confirmation_number: body.confirmation_number ?? null,
    filing_url: body.filing_url ?? null,
    notes: body.notes ?? null,
    created_at: PLAYWRIGHT_MOCK_FILING_TIMESTAMP,
    updated_at: PLAYWRIGHT_MOCK_FILING_UPDATED_TIMESTAMP,
  };

  const existing = playwrightMockJusticeFilingsByCaseId.get(caseId) ?? [];
  playwrightMockJusticeFilingsByCaseId.set(caseId, [...existing, filing]);

  if (!isPlaywrightMockIntakeCaseHydrationCaseId(caseId)) {
    return filing;
  }

  const caseSnapshot = buildPlaywrightMockCaseGetResponse(caseId);
  const mergedTimeline = appendFilingRecordedTimelineEntry(
    caseId,
    normalizeTimeline(caseSnapshot.timeline),
    filing
  );
  buildPlaywrightMockCasePatchResponse(caseId, { timeline: mergedTimeline });

  return { ...filing, timeline: mergedTimeline };
}

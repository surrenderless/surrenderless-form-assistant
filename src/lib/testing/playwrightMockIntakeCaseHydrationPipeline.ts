import {
  PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID,
  type PlaywrightMockCaseCreateResponse,
} from "@/lib/testing/playwrightMockIntakeCaseCommitPipeline";
import { PLAYWRIGHT_MOCK_INTAKE_CHAT_E2E_USER_MESSAGE } from "@/lib/testing/playwrightMockIntakeChatPipeline";
import { PLAYWRIGHT_MOCK_SECOND_CASE_ID } from "@/lib/testing/playwrightMockJusticeChatMessagesOwnership";
import type { TimelineEntry } from "@/lib/justice/types";
import { sanitizeClientStateForEscalationLadder } from "@/lib/justice/escalationLadderResolution";
import { syncPlaywrightMockHumanFulfillmentLadderFromCasePatch } from "@/lib/testing/playwrightMockHumanFulfillmentLadderPipeline";

const PLAYWRIGHT_MOCK_CASE_HYDRATION_TIMESTAMP = "2026-06-21T00:00:00.000Z";
const PLAYWRIGHT_MOCK_CASE_HYDRATION_UPDATED_TIMESTAMP = "2026-06-21T00:00:01.000Z";
const PLAYWRIGHT_MOCK_CASE_STARTED_TIMELINE_ID = "playwright_e2e_case_started";
const PLAYWRIGHT_MOCK_CASE_HYDRATION_SNAPSHOTS_GLOBAL_KEY =
  "__playwrightMockCaseHydrationSnapshots__";

type HydrationSnapshotMap = Map<string, PlaywrightMockCaseCreateResponse>;

function getPlaywrightMockCaseHydrationSnapshots(): HydrationSnapshotMap {
  const globalStore = globalThis as typeof globalThis & {
    [PLAYWRIGHT_MOCK_CASE_HYDRATION_SNAPSHOTS_GLOBAL_KEY]?: HydrationSnapshotMap;
  };
  if (!globalStore[PLAYWRIGHT_MOCK_CASE_HYDRATION_SNAPSHOTS_GLOBAL_KEY]) {
    globalStore[PLAYWRIGHT_MOCK_CASE_HYDRATION_SNAPSHOTS_GLOBAL_KEY] = new Map();
  }
  return globalStore[PLAYWRIGHT_MOCK_CASE_HYDRATION_SNAPSHOTS_GLOBAL_KEY]!;
}

/** In-process cumulative mock case snapshots for the fixed Playwright E2E case id only. */

export type PlaywrightMockCaseHydrationPatch = {
  intake?: unknown;
  timeline?: unknown;
  payment_dispute_draft?: unknown;
  client_state?: unknown;
  archived_at?: string | null;
  case_label?: string | null;
};

/** Enabled only when Playwright webServer sets PLAYWRIGHT_MOCK_INTAKE_CASE_HYDRATION_PIPELINE=1. */
export function isPlaywrightMockIntakeCaseHydrationPipelineEnabled(): boolean {
  if (process.env.PLAYWRIGHT_MOCK_INTAKE_CASE_HYDRATION_PIPELINE !== "1") {
    return false;
  }
  // Never allow on deployed production, even if the env var is set.
  if (process.env.VERCEL_ENV === "production") {
    return false;
  }
  return true;
}

/** True when GET/PATCH /api/justice/cases/[id] should use the deterministic Playwright mock. */
export function isPlaywrightMockIntakeCaseHydrationCaseId(caseId: string): boolean {
  const trimmed = caseId.trim();
  return (
    trimmed === PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID ||
    trimmed === PLAYWRIGHT_MOCK_SECOND_CASE_ID
  );
}

/** Clears cumulative mock snapshots — for unit tests only. */
export function resetPlaywrightMockCaseHydrationSnapshotsForTests(): void {
  getPlaywrightMockCaseHydrationSnapshots().clear();
}

/** Clears cumulative mock snapshot for one case — used when Playwright E2E recommits the fixed case. */
export function resetPlaywrightMockCaseHydrationSnapshotForCase(caseId: string): void {
  if (!isPlaywrightMockIntakeCaseHydrationCaseId(caseId)) return;
  getPlaywrightMockCaseHydrationSnapshots().delete(caseId.trim());
}

/** Snapshot rows currently held by the hydration mock (for multi-case list E2E). */
export function listPlaywrightMockCaseHydrationSnapshots(): PlaywrightMockCaseCreateResponse[] {
  return Array.from(getPlaywrightMockCaseHydrationSnapshots().values()).map((row) => ({ ...row }));
}

/** True when the primary E2E case snapshot is present and archived. */
export function isPlaywrightMockPrimaryCaseArchived(): boolean {
  const snapshot = getPlaywrightMockCaseHydrationSnapshots().get(
    PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID
  );
  return Boolean(snapshot?.archived_at?.trim());
}

/** Deterministic intake snapshot for the signed-in chat roundtrip E2E case. */
export function buildPlaywrightMockE2eCaseIntake(): Record<string, string> {
  return {
    problem_category: "online_purchase",
    company_name: "Acme Retail",
    company_website: "",
    purchase_or_signup: "widget order",
    story: PLAYWRIGHT_MOCK_INTAKE_CHAT_E2E_USER_MESSAGE,
    money_involved: "$49.99",
    pay_or_order_date: "",
    order_confirmation_details: "",
    user_display_name: "Jordan Lee",
    reply_email: "e2e-chat@example.com",
    already_contacted: "no",
  };
}

/** Pre-draft-review timeline for GET hydration — draft reviewed is added by POST mock only. */
export function buildPlaywrightMockCaseStartedTimeline(caseId: string): TimelineEntry[] {
  return [
    {
      id: PLAYWRIGHT_MOCK_CASE_STARTED_TIMELINE_ID,
      case_id: caseId,
      type: "case_started",
      label: "Case started",
      ts: PLAYWRIGHT_MOCK_CASE_HYDRATION_TIMESTAMP,
    },
  ];
}

function buildPlaywrightMockCaseBaseline(caseId: string): PlaywrightMockCaseCreateResponse {
  return {
    id: caseId,
    intake: buildPlaywrightMockE2eCaseIntake(),
    timeline: buildPlaywrightMockCaseStartedTimeline(caseId),
    payment_dispute_draft: null,
    client_state: null,
    created_at: PLAYWRIGHT_MOCK_CASE_HYDRATION_TIMESTAMP,
    updated_at: PLAYWRIGHT_MOCK_CASE_HYDRATION_TIMESTAMP,
    archived_at: null,
    case_label: null,
  };
}

function getOrCreatePlaywrightMockCaseSnapshot(caseId: string): PlaywrightMockCaseCreateResponse {
  const snapshots = getPlaywrightMockCaseHydrationSnapshots();
  const existing = snapshots.get(caseId);
  if (existing) {
    return existing;
  }
  const baseline = buildPlaywrightMockCaseBaseline(caseId);
  snapshots.set(caseId, baseline);
  return baseline;
}

function applyPlaywrightMockCaseHydrationPatch(
  current: PlaywrightMockCaseCreateResponse,
  patch: PlaywrightMockCaseHydrationPatch
): PlaywrightMockCaseCreateResponse {
  return {
    ...current,
    ...(Object.prototype.hasOwnProperty.call(patch, "intake") ? { intake: patch.intake } : {}),
    ...(Object.prototype.hasOwnProperty.call(patch, "timeline") ? { timeline: patch.timeline } : {}),
    ...(Object.prototype.hasOwnProperty.call(patch, "payment_dispute_draft")
      ? { payment_dispute_draft: patch.payment_dispute_draft }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(patch, "client_state")
      ? { client_state: patch.client_state }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(patch, "archived_at")
      ? { archived_at: patch.archived_at ?? null }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(patch, "case_label")
      ? { case_label: patch.case_label ?? null }
      : {}),
    updated_at: PLAYWRIGHT_MOCK_CASE_HYDRATION_UPDATED_TIMESTAMP,
  };
}

/**
 * Deterministic GET /api/justice/cases/[id] response for Playwright E2E.
 * Returns the cumulative in-process snapshot when present.
 */
export function buildPlaywrightMockCaseGetResponse(caseId: string): PlaywrightMockCaseCreateResponse {
  const snapshot = getOrCreatePlaywrightMockCaseSnapshot(caseId);
  const sanitized = {
    ...snapshot,
    client_state:
      snapshot.client_state === null || snapshot.client_state === undefined
        ? snapshot.client_state
        : sanitizeClientStateForEscalationLadder(snapshot.client_state),
  };
  if (sanitized.client_state !== snapshot.client_state) {
    getPlaywrightMockCaseHydrationSnapshots().set(caseId, sanitized);
  }
  syncPlaywrightMockHumanFulfillmentLadderFromCasePatch(
    caseId,
    "playwright_e2e_user",
    sanitized.client_state,
    sanitized.intake
  );
  return { ...sanitized };
}

/**
 * Deterministic PATCH /api/justice/cases/[id] response for Playwright E2E.
 * Merges validated patch fields onto the cumulative mock snapshot.
 */
export function buildPlaywrightMockCasePatchResponse(
  caseId: string,
  patch: PlaywrightMockCaseHydrationPatch
): PlaywrightMockCaseCreateResponse {
  const current = getOrCreatePlaywrightMockCaseSnapshot(caseId);
  const merged = applyPlaywrightMockCaseHydrationPatch(current, patch);
  const sanitizedClientState =
    merged.client_state === null || merged.client_state === undefined
      ? merged.client_state
      : sanitizeClientStateForEscalationLadder(merged.client_state);
  const finalSnapshot =
    sanitizedClientState === merged.client_state
      ? merged
      : { ...merged, client_state: sanitizedClientState };
  getPlaywrightMockCaseHydrationSnapshots().set(caseId, finalSnapshot);
  if (Object.prototype.hasOwnProperty.call(patch, "client_state")) {
    syncPlaywrightMockHumanFulfillmentLadderFromCasePatch(
      caseId,
      "playwright_e2e_user",
      finalSnapshot.client_state,
      finalSnapshot.intake
    );
  }
  return { ...finalSnapshot };
}

/**
 * Seeds the cumulative hydration snapshot from POST /api/justice/cases create.
 * Call after resetPlaywrightMockCaseHydrationSnapshotForCase so archived/saved list
 * mocks read the committed case (including archive PATCH state) in E2E.
 */
export function seedPlaywrightMockCaseHydrationFromCreate(
  created: PlaywrightMockCaseCreateResponse
): PlaywrightMockCaseCreateResponse {
  const caseId = created.id.trim();
  if (!isPlaywrightMockIntakeCaseHydrationCaseId(caseId)) {
    return created;
  }
  const snapshot: PlaywrightMockCaseCreateResponse = {
    ...created,
    archived_at: created.archived_at ?? null,
    case_label: created.case_label ?? null,
  };
  getPlaywrightMockCaseHydrationSnapshots().set(caseId, snapshot);
  return { ...snapshot };
}

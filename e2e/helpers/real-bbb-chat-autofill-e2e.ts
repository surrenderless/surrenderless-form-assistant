import type { Page } from "@playwright/test";
import { ASSISTED_SUBMISSION_REAL_BBB_PREP_HREF } from "@/lib/justice/assistedSubmissionLane";
import { STORAGE_APPROVED_NEXT_ACTION_V1 } from "@/lib/justice/approvedNextActionState";
import { REAL_BBB_COMPLAINT_FILING_CONFIRMATION } from "@/lib/justice/recordRealBbbComplaintFiling";
import { SUBMISSION_DRAFT_REVIEWED_TIMELINE_ID } from "@/lib/justice/timeline";
import type { JusticeApprovedNextAction, TimelineEntry } from "@/lib/justice/types";
import { STORAGE_CASE_ID, STORAGE_INTAKE } from "@/lib/justice/types";
import { PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID } from "@/lib/testing/playwrightMockIntakeCaseCommitPipeline";
import { buildPlaywrightMockE2eCaseIntake } from "@/lib/testing/playwrightMockIntakeCaseHydrationPipeline";

const STORAGE_PREPARED_PACKET_APPROVED_V1 = "justice_prepared_packet_approved_v1";
const STORAGE_SUBMISSION_DRAFT_REVIEWED_V1 = "justice_submission_draft_reviewed_v1";
const PLAYWRIGHT_MOCK_CASE_STARTED_TIMELINE_ID = "playwright_e2e_case_started";
const PLAYWRIGHT_MOCK_SUBMISSION_DRAFT_REVIEWED_TS = "2026-06-21T00:00:05.000Z";

export const REAL_BBB_CHAT_AUTOFILL_E2E_CASE_ID = PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID;

export const REAL_BBB_CHAT_AUTOFILL_E2E_APPROVED_AT = "2026-06-21T00:00:10.000Z";

export { REAL_BBB_COMPLAINT_FILING_CONFIRMATION };

export function buildRealBbbChatAutofillE2eClientState(): {
  prepared_packet_approved: true;
  approved_next_action: JusticeApprovedNextAction;
} {
  return {
    prepared_packet_approved: true,
    approved_next_action: {
      label: "Better Business Bureau",
      href: ASSISTED_SUBMISSION_REAL_BBB_PREP_HREF,
      status: "approved",
      approved_at: REAL_BBB_CHAT_AUTOFILL_E2E_APPROVED_AT,
    },
  };
}

function buildRealBbbChatAutofillE2eTimeline(caseId: string): TimelineEntry[] {
  return [
    {
      id: PLAYWRIGHT_MOCK_CASE_STARTED_TIMELINE_ID,
      case_id: caseId,
      type: "case_started",
      label: "Case started",
      ts: "2026-06-21T00:00:00.000Z",
    },
    {
      id: SUBMISSION_DRAFT_REVIEWED_TIMELINE_ID,
      case_id: caseId,
      type: "submission_draft_reviewed",
      label: "Submission draft reviewed",
      ts: PLAYWRIGHT_MOCK_SUBMISSION_DRAFT_REVIEWED_TS,
    },
  ];
}

/** Reset cumulative Playwright mock justice state for the fixed E2E case id. */
export async function resetPlaywrightMockCaseForRealBbbChatAutofill(page: Page): Promise<void> {
  const intake = buildPlaywrightMockE2eCaseIntake();
  const resetRes = await page.request.post("/api/justice/cases", {
    data: { intake, timeline: [] },
  });
  if (!resetRes.ok()) {
    throw new Error(
      `Failed to reset mock case for real BBB chat autofill (${resetRes.status()}): ${await resetRes.text()}`
    );
  }
}

/** Seed the Playwright mock case snapshot to the real BBB approved-action state. */
export async function seedPlaywrightMockCaseForRealBbbChatAutofill(
  page: Page
): Promise<{ caseId: string; intake: ReturnType<typeof buildPlaywrightMockE2eCaseIntake> }> {
  const caseId = REAL_BBB_CHAT_AUTOFILL_E2E_CASE_ID;
  const intake = buildPlaywrightMockE2eCaseIntake();

  await resetPlaywrightMockCaseForRealBbbChatAutofill(page);

  const patchRes = await page.request.patch(`/api/justice/cases/${encodeURIComponent(caseId)}`, {
    data: {
      intake,
      timeline: buildRealBbbChatAutofillE2eTimeline(caseId),
      client_state: buildRealBbbChatAutofillE2eClientState(),
    },
  });
  if (!patchRes.ok()) {
    throw new Error(
      `Failed to seed mock case for real BBB chat autofill (${patchRes.status()}): ${await patchRes.text()}`
    );
  }
  return { caseId, intake };
}

/** Hydrate sessionStorage so chat-ai loads the seeded mock case as an active update flow. */
export async function hydrateChatAiSessionForRealBbbAutofill(
  page: Page,
  params: {
    caseId: string;
    intake: ReturnType<typeof buildPlaywrightMockE2eCaseIntake>;
  }
): Promise<void> {
  const approvedNextAction = buildRealBbbChatAutofillE2eClientState().approved_next_action;

  await page.goto("/justice/chat-ai");
  await page.evaluate(() => sessionStorage.clear());
  await page.evaluate(
    ({
      caseId,
      intake,
      approvedAction,
      storageCaseIdKey,
      storageIntakeKey,
      preparedPacketKey,
      submissionDraftReviewedKey,
      approvedActionKey,
    }) => {
      sessionStorage.setItem(storageCaseIdKey, caseId);
      sessionStorage.setItem(storageIntakeKey, JSON.stringify(intake));
      sessionStorage.setItem(preparedPacketKey, JSON.stringify({ [caseId]: true }));
      sessionStorage.setItem(submissionDraftReviewedKey, JSON.stringify({ [caseId]: true }));
      sessionStorage.setItem(approvedActionKey, JSON.stringify({ [caseId]: approvedAction }));
    },
    {
      caseId: params.caseId,
      intake: params.intake,
      approvedAction: approvedNextAction,
      storageCaseIdKey: STORAGE_CASE_ID,
      storageIntakeKey: STORAGE_INTAKE,
      preparedPacketKey: STORAGE_PREPARED_PACKET_APPROVED_V1,
      submissionDraftReviewedKey: STORAGE_SUBMISSION_DRAFT_REVIEWED_V1,
      approvedActionKey: STORAGE_APPROVED_NEXT_ACTION_V1,
    }
  );
  await page.reload();
  await page.getByRole("button", { name: "Open user menu" }).waitFor({
    state: "visible",
    timeout: 30_000,
  });
}

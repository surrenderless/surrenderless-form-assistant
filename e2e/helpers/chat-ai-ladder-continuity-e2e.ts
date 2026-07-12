import { expect, type Locator, type Page } from "@playwright/test";
import { STORAGE_APPROVED_NEXT_ACTION_V1 } from "@/lib/justice/approvedNextActionState";
import { MANUAL_ACTION_TRACKING_REAL_STATE_AG_PREP_HREF } from "@/lib/justice/handlingTrackingProgress";
import { CHAT_INLINE_MERCHANT_PREP_HREF } from "@/lib/justice/chatInlineApprovedPrep";
import { SUBMISSION_DRAFT_REVIEWED_TIMELINE_ID } from "@/lib/justice/timeline";
import type { JusticeApprovedNextAction, TimelineEntry } from "@/lib/justice/types";
import { STORAGE_CASE_ID, STORAGE_INTAKE } from "@/lib/justice/types";
import { PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID } from "@/lib/testing/playwrightMockIntakeCaseCommitPipeline";
import { buildPlaywrightMockE2eCaseIntake } from "@/lib/testing/playwrightMockIntakeCaseHydrationPipeline";
import { waitForClerkBrowserApiSession } from "./clerk-e2e";

export const CHAT_AI_LADDER_CONTINUITY_E2E_CASE_ID = PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID;

const STORAGE_PREPARED_PACKET_APPROVED_V1 = "justice_prepared_packet_approved_v1";
const STORAGE_SUBMISSION_DRAFT_REVIEWED_V1 = "justice_submission_draft_reviewed_v1";
const PLAYWRIGHT_MOCK_CASE_STARTED_TIMELINE_ID = "playwright_e2e_case_started";
const PLAYWRIGHT_MOCK_SUBMISSION_DRAFT_REVIEWED_TS = "2026-06-21T00:00:05.000Z";

export const CHAT_AI_MAIN_LADDER_OFF_CHAT_PATHS = [
  "/justice/preview",
  "/justice/packet",
  "/justice/handling",
] as const;

export const CHAT_AI_OPTIONAL_HUB_ESCAPE_PATHS = [
  "/justice/evidence",
  "/justice/merchant",
  "/justice/cfpb",
  "/justice/fcc",
  "/justice/bbb",
  "/justice/state-ag",
  "/justice/dot",
  "/justice/demand-letter",
  "/justice/payment-dispute",
  "/justice/ftc-review",
] as const;

function buildCaseStartedTimeline(caseId: string): TimelineEntry[] {
  return [
    {
      id: PLAYWRIGHT_MOCK_CASE_STARTED_TIMELINE_ID,
      case_id: caseId,
      type: "case_started",
      label: "Case started",
      ts: "2026-06-21T00:00:00.000Z",
    },
  ];
}

function buildDraftReviewedTimeline(caseId: string): TimelineEntry[] {
  return [
    ...buildCaseStartedTimeline(caseId),
    {
      id: SUBMISSION_DRAFT_REVIEWED_TIMELINE_ID,
      case_id: caseId,
      type: "submission_draft_reviewed",
      label: "Submission draft reviewed",
      ts: PLAYWRIGHT_MOCK_SUBMISSION_DRAFT_REVIEWED_TS,
    },
  ];
}

async function resetMockCase(page: Page): Promise<void> {
  // Ensure the browser has a live Clerk session before authenticated API seeding.
  await page.goto("/justice/chat-ai");
  await waitForClerkBrowserApiSession(page);
  const intake = buildPlaywrightMockE2eCaseIntake();
  const resetRes = await page.request.post("/api/justice/cases", {
    data: { intake, timeline: [] },
  });
  if (!resetRes.ok()) {
    throw new Error(`Failed to reset mock case (${resetRes.status()}): ${await resetRes.text()}`);
  }
}

async function patchMockCase(
  page: Page,
  data: {
    intake?: ReturnType<typeof buildPlaywrightMockE2eCaseIntake>;
    timeline?: TimelineEntry[];
    client_state?: Record<string, unknown>;
  }
): Promise<void> {
  const caseId = CHAT_AI_LADDER_CONTINUITY_E2E_CASE_ID;
  const patchRes = await page.request.patch(`/api/justice/cases/${encodeURIComponent(caseId)}`, {
    data: {
      intake: data.intake ?? buildPlaywrightMockE2eCaseIntake(),
      timeline: data.timeline ?? buildCaseStartedTimeline(caseId),
      ...(data.client_state ? { client_state: data.client_state } : {}),
    },
  });
  if (!patchRes.ok()) {
    throw new Error(`Failed to patch mock case (${patchRes.status()}): ${await patchRes.text()}`);
  }
}

export async function hydrateChatAiSession(
  page: Page,
  params: {
    caseId: string;
    intake: ReturnType<typeof buildPlaywrightMockE2eCaseIntake>;
    preparedPacketApproved?: boolean;
    submissionDraftReviewed?: boolean;
    approvedNextAction?: JusticeApprovedNextAction;
  }
): Promise<void> {
  await page.goto("/justice/chat-ai");
  await page.evaluate(() => sessionStorage.clear());
  await page.evaluate(
    ({
      caseId,
      intake,
      preparedPacketApproved,
      submissionDraftReviewed,
      approvedAction,
      storageCaseIdKey,
      storageIntakeKey,
      preparedPacketKey,
      submissionDraftReviewedKey,
      approvedActionKey,
    }) => {
      sessionStorage.setItem(storageCaseIdKey, caseId);
      sessionStorage.setItem(storageIntakeKey, JSON.stringify(intake));
      if (preparedPacketApproved) {
        sessionStorage.setItem(preparedPacketKey, JSON.stringify({ [caseId]: true }));
      }
      if (submissionDraftReviewed) {
        sessionStorage.setItem(
          submissionDraftReviewedKey,
          JSON.stringify({ [caseId]: true })
        );
      }
      if (approvedAction) {
        sessionStorage.setItem(approvedActionKey, JSON.stringify({ [caseId]: approvedAction }));
      }
    },
    {
      caseId: params.caseId,
      intake: params.intake,
      preparedPacketApproved: params.preparedPacketApproved ?? false,
      submissionDraftReviewed: params.submissionDraftReviewed ?? false,
      approvedAction: params.approvedNextAction,
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

export async function seedActiveCaseDraftNotReviewed(page: Page): Promise<void> {
  const caseId = CHAT_AI_LADDER_CONTINUITY_E2E_CASE_ID;
  const intake = buildPlaywrightMockE2eCaseIntake();
  await resetMockCase(page);
  await patchMockCase(page, { intake, timeline: buildCaseStartedTimeline(caseId) });
  await hydrateChatAiSession(page, { caseId, intake });
}

export async function seedActiveCasePacketNotApproved(page: Page): Promise<void> {
  const caseId = CHAT_AI_LADDER_CONTINUITY_E2E_CASE_ID;
  const intake = buildPlaywrightMockE2eCaseIntake();
  await resetMockCase(page);
  await patchMockCase(page, {
    intake,
    timeline: buildDraftReviewedTimeline(caseId),
    client_state: { prepared_packet_approved: false },
  });
  await hydrateChatAiSession(page, {
    caseId,
    intake,
    submissionDraftReviewed: true,
  });
}

export async function seedActiveCaseMerchantFilingStep(page: Page): Promise<void> {
  const caseId = CHAT_AI_LADDER_CONTINUITY_E2E_CASE_ID;
  const intake = buildPlaywrightMockE2eCaseIntake();
  const approvedNextAction: JusticeApprovedNextAction = {
    label: "Contact merchant",
    href: CHAT_INLINE_MERCHANT_PREP_HREF,
    status: "started",
    approved_at: "2026-06-21T00:00:10.000Z",
    started_at: "2026-06-21T00:00:11.000Z",
  };
  await resetMockCase(page);
  await patchMockCase(page, {
    intake,
    timeline: buildDraftReviewedTimeline(caseId),
    client_state: {
      prepared_packet_approved: true,
      approved_next_action: approvedNextAction,
    },
  });
  await hydrateChatAiSession(page, {
    caseId,
    intake,
    preparedPacketApproved: true,
    submissionDraftReviewed: true,
    approvedNextAction,
  });
}

export async function seedActiveCaseStateAgQueued(page: Page): Promise<void> {
  const caseId = CHAT_AI_LADDER_CONTINUITY_E2E_CASE_ID;
  const intake = { ...buildPlaywrightMockE2eCaseIntake(), already_contacted: "yes" as const };
  const approvedNextAction: JusticeApprovedNextAction = {
    label: "State Attorney General (consumer)",
    href: MANUAL_ACTION_TRACKING_REAL_STATE_AG_PREP_HREF,
    status: "approved",
    approved_at: "2026-06-21T00:00:12.000Z",
  };
  await resetMockCase(page);
  await patchMockCase(page, {
    intake,
    timeline: buildDraftReviewedTimeline(caseId),
    client_state: {
      prepared_packet_approved: true,
      approved_next_action: approvedNextAction,
    },
  });
  await hydrateChatAiSession(page, {
    caseId,
    intake,
    preparedPacketApproved: true,
    submissionDraftReviewed: true,
    approvedNextAction,
  });
}

export function activeCaseBanner(page: Page): Locator {
  return page.getByRole("status", { name: "Active case" });
}

export function activeCaseChecklist(page: Page): Locator {
  return activeCaseBanner(page).locator("ul").first();
}

/** Assert required ladder checklist UI has no main off-chat detour links. */
export async function expectNoRequiredMainLadderOffChatLinks(scope: Locator): Promise<void> {
  for (const href of CHAT_AI_MAIN_LADDER_OFF_CHAT_PATHS) {
    await expect(scope.locator(`a[href="${href}"]`)).toHaveCount(0);
  }
  await expect(scope.getByRole("link", { name: "Handling workbench" })).toHaveCount(0);
  await expect(
    scope.getByRole("link", { name: /Review submission draft|Review prepared case packet/i })
  ).toHaveCount(0);
}

/** Assert keep-in-chat UI offers no evidence or destination-prep hub escapes. */
export async function expectNoOptionalDestinationPrepOrEvidenceHubLinks(
  scope: Locator
): Promise<void> {
  for (const href of CHAT_AI_OPTIONAL_HUB_ESCAPE_PATHS) {
    await expect(scope.locator(`a[href="${href}"]`)).toHaveCount(0);
  }
  await expect(scope.getByRole("link", { name: "Organize evidence" })).toHaveCount(0);
  await expect(scope.getByRole("link", { name: /Open full .+ page/i })).toHaveCount(0);
  await expect(scope.getByRole("link", { name: /Open approved step/i })).toHaveCount(0);
}

export async function expectUrlStaysOnChatAi(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/justice\/chat-ai/);
  for (const path of CHAT_AI_MAIN_LADDER_OFF_CHAT_PATHS) {
    expect(page.url()).not.toContain(path);
  }
  for (const path of CHAT_AI_OPTIONAL_HUB_ESCAPE_PATHS) {
    expect(page.url()).not.toContain(path);
  }
}

export async function clickAndAssertStaysOnChatAi(
  page: Page,
  click: () => Promise<void>
): Promise<void> {
  await click();
  await page.waitForTimeout(300);
  await expectUrlStaysOnChatAi(page);
}

export function hubCurrentCaseChecklist(page: Page): Locator {
  return page
    .locator("main")
    .getByText("Current case", { exact: true })
    .locator("xpath=ancestor::div[contains(@class,'mt-8')][1]")
    .locator("ul")
    .first();
}

export function casesSavedRowChecklist(page: Page, companyName: string): Locator {
  return page
    .locator("main > ul > li")
    .filter({ hasText: companyName })
    .locator("ul")
    .filter({ hasText: "Basic case info" });
}

export async function seedActiveCaseForHubResume(page: Page): Promise<void> {
  await seedActiveCaseDraftNotReviewed(page);
  await page.goto("/justice");
  await page.getByText("Current case", { exact: true }).waitFor({
    state: "visible",
    timeout: 30_000,
  });
}

export async function seedActiveCaseForCasesListResume(page: Page): Promise<void> {
  await seedActiveCaseDraftNotReviewed(page);
  await page.goto("/justice/cases");
  await page.getByRole("heading", { name: "Saved cases" }).waitFor({
    state: "visible",
    timeout: 30_000,
  });
}

export function packetReadinessChecklist(page: Page): Locator {
  return page
    .getByText("Before you approve, finish readiness:", { exact: false })
    .locator("xpath=ancestor::p[1]");
}

export async function seedActiveCaseForPacketNotApprovedResume(page: Page): Promise<void> {
  await seedActiveCasePacketNotApproved(page);
  await page.goto("/justice/packet");
  // Signed-in consumers with a resumable case are redirected into chat for inline approval.
  await page.waitForURL(/\/justice\/chat-ai/, { timeout: 30_000 });
  await page.locator("#chat-ai-inline-prepared-packet-approval").waitFor({
    state: "visible",
    timeout: 30_000,
  });
}

export async function seedActiveCaseForPacketHandlingResume(page: Page): Promise<void> {
  await seedActiveCaseStateAgQueued(page);
  await page.goto("/justice/packet");
  await page.waitForURL(/\/justice\/chat-ai/, { timeout: 30_000 });
  await page.locator("#chat-ai-approved-action-tracking").waitFor({
    state: "visible",
    timeout: 30_000,
  });
}

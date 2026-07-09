import { PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID } from "@/lib/testing/playwrightMockIntakeCaseCommitPipeline";
import { resolvePlaywrightMockCaseOwnerUserId } from "@/lib/testing/playwrightMockHumanFulfillmentLadderPipeline";

/** Second deterministic case id for Playwright transcript switch E2E. */
export const PLAYWRIGHT_MOCK_SECOND_CASE_ID = "00000000-0000-4000-8000-000000000746";

const playwrightMockSecondCaseChatOwnerUserId = new Map<string, string>();

export function resetPlaywrightMockSecondCaseChatOwnerForTests(): void {
  playwrightMockSecondCaseChatOwnerUserId.clear();
}

export function resetPlaywrightMockSecondCaseChatOwnerForCase(caseId: string): void {
  if (caseId.trim() === PLAYWRIGHT_MOCK_SECOND_CASE_ID) {
    playwrightMockSecondCaseChatOwnerUserId.delete(caseId.trim());
  }
}

/** Mock ownership for deterministic Playwright chat transcript cases. */
export function userOwnsMockJusticeChatMessagesCase(caseId: string, userId: string): boolean {
  const trimmedCaseId = caseId.trim();
  const trimmedUserId = userId.trim();
  if (!trimmedUserId) return false;

  if (trimmedCaseId === PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID) {
    const owner = resolvePlaywrightMockCaseOwnerUserId(trimmedCaseId);
    return owner === trimmedUserId;
  }

  if (trimmedCaseId === PLAYWRIGHT_MOCK_SECOND_CASE_ID) {
    const owner = playwrightMockSecondCaseChatOwnerUserId.get(trimmedCaseId);
    if (!owner) {
      playwrightMockSecondCaseChatOwnerUserId.set(trimmedCaseId, trimmedUserId);
      return true;
    }
    return owner === trimmedUserId;
  }

  return false;
}

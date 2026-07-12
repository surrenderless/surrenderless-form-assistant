import { PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID } from "@/lib/testing/playwrightMockIntakeCaseCommitPipeline";
import { resolvePlaywrightMockCaseOwnerUserId } from "@/lib/testing/playwrightMockHumanFulfillmentLadderPipeline";

/** Second deterministic case id for Playwright multi-case chat selection E2E. */
export const PLAYWRIGHT_MOCK_SECOND_CASE_ID = "00000000-0000-4000-8000-000000000748";

const PLAYWRIGHT_MOCK_SECOND_CASE_CHAT_OWNER_GLOBAL_KEY =
  "__playwrightMockSecondCaseChatOwnerUserId__";

type SecondCaseOwnerMap = Map<string, string>;

function getPlaywrightMockSecondCaseChatOwnerUserId(): SecondCaseOwnerMap {
  const globalStore = globalThis as typeof globalThis & {
    [PLAYWRIGHT_MOCK_SECOND_CASE_CHAT_OWNER_GLOBAL_KEY]?: SecondCaseOwnerMap;
  };
  if (!globalStore[PLAYWRIGHT_MOCK_SECOND_CASE_CHAT_OWNER_GLOBAL_KEY]) {
    globalStore[PLAYWRIGHT_MOCK_SECOND_CASE_CHAT_OWNER_GLOBAL_KEY] = new Map();
  }
  return globalStore[PLAYWRIGHT_MOCK_SECOND_CASE_CHAT_OWNER_GLOBAL_KEY]!;
}

export function resetPlaywrightMockSecondCaseChatOwnerForTests(): void {
  getPlaywrightMockSecondCaseChatOwnerUserId().clear();
}

export function resetPlaywrightMockSecondCaseChatOwnerForCase(caseId: string): void {
  if (caseId.trim() === PLAYWRIGHT_MOCK_SECOND_CASE_ID) {
    getPlaywrightMockSecondCaseChatOwnerUserId().delete(caseId.trim());
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
    const ownerMap = getPlaywrightMockSecondCaseChatOwnerUserId();
    const owner = ownerMap.get(trimmedCaseId);
    if (!owner) {
      ownerMap.set(trimmedCaseId, trimmedUserId);
      return true;
    }
    return owner === trimmedUserId;
  }

  return false;
}

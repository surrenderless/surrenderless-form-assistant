import { REAL_BBB_COMPLAINT_SUBMISSION_URL } from "@/lib/justice/assistedSubmissionLane";
import {
  detectRealBbbTerminalConfirmation,
  hasBbbSubmissionConfirmationBodyText,
  type AssistedFormPageData,
  type FormDecision,
} from "@/lib/justice/realBbbBoundedSubmitLoop";
import { isPlaywrightMockAssistedSubmitPipelineEnabled } from "@/lib/testing/playwrightMockAssistedSubmitPipeline";

export const PLAYWRIGHT_MOCK_REAL_BBB_BOUNDED_SUBMIT_LOOP_ENTRY_PATH = "/mock/real-bbb-complain";
export const PLAYWRIGHT_MOCK_REAL_BBB_BOUNDED_SUBMIT_LOOP_CONFIRMATION_PATH =
  "/mock/real-bbb-complain/confirmation";

const USER_DATA_BUSINESS_NAME_KEYS = ["business_name", "company_name"] as const;

/** Enabled when Playwright webServer sets PLAYWRIGHT_MOCK_REAL_BBB_BOUNDED_SUBMIT_LOOP=1. */
export function isPlaywrightMockRealBbbBoundedSubmitLoopEnabled(): boolean {
  if (process.env.PLAYWRIGHT_MOCK_REAL_BBB_BOUNDED_SUBMIT_LOOP !== "1") {
    return false;
  }
  return isPlaywrightMockAssistedSubmitPipelineEnabled();
}

function normalizePathname(url: string): string | null {
  try {
    return new URL(url).pathname.replace(/\/$/, "") || "/";
  } catch {
    return null;
  }
}

export function isPlaywrightMockRealBbbBoundedSubmitEntryUrl(url: string): boolean {
  return normalizePathname(url) === PLAYWRIGHT_MOCK_REAL_BBB_BOUNDED_SUBMIT_LOOP_ENTRY_PATH;
}

export function isPlaywrightMockRealBbbBoundedSubmitTerminalUrl(url: string): boolean {
  return normalizePathname(url) === PLAYWRIGHT_MOCK_REAL_BBB_BOUNDED_SUBMIT_LOOP_CONFIRMATION_PATH;
}

export function isPlaywrightMockRealBbbBoundedSubmitPageUrl(url: string): boolean {
  return (
    isPlaywrightMockRealBbbBoundedSubmitEntryUrl(url) ||
    isPlaywrightMockRealBbbBoundedSubmitTerminalUrl(url)
  );
}

/** Playwright E2E only: terminal detection for loopback mock real-BBB confirmation pages. */
export function detectPlaywrightMockRealBbbBoundedSubmitTerminalConfirmation(
  pageData: AssistedFormPageData
): boolean {
  const url = pageData.url ?? "";
  if (!isPlaywrightMockRealBbbBoundedSubmitTerminalUrl(url)) {
    return false;
  }
  return hasBbbSubmissionConfirmationBodyText(pageData.pageText ?? "");
}

/** Terminal detection used by runRealBbbBoundedSubmit (production logic + Playwright mock branch). */
export function detectBoundedSubmitTerminalConfirmation(pageData: AssistedFormPageData): boolean {
  if (isPlaywrightMockRealBbbBoundedSubmitLoopEnabled()) {
    return detectPlaywrightMockRealBbbBoundedSubmitTerminalConfirmation(pageData);
  }
  return detectRealBbbTerminalConfirmation(pageData);
}

/** Rewrite the official BBB complain URL to the loopback mock entry page during Playwright E2E. */
export function resolvePlaywrightMockRealBbbBoundedSubmitNavigationUrl(
  officialUrl: string,
  base: string
): string {
  if (!isPlaywrightMockRealBbbBoundedSubmitLoopEnabled()) {
    return officialUrl;
  }

  try {
    const parsed = new URL(officialUrl.trim());
    const allowed = new URL(REAL_BBB_COMPLAINT_SUBMISSION_URL);
    if (parsed.origin === allowed.origin && parsed.pathname === allowed.pathname) {
      return `${base.replace(/\/$/, "")}${PLAYWRIGHT_MOCK_REAL_BBB_BOUNDED_SUBMIT_LOOP_ENTRY_PATH}`;
    }
  } catch {
    /* keep official URL */
  }

  return officialUrl;
}

function readUserDataString(userData: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = userData[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

/** Deterministic decide-action output for the loopback mock real-BBB complain wizard. */
export function buildPlaywrightMockRealBbbDecideActionDecision(
  pageData: AssistedFormPageData,
  userData: Record<string, unknown>
): FormDecision | null {
  if (!isPlaywrightMockRealBbbBoundedSubmitPageUrl(pageData.url ?? "")) {
    return null;
  }
  if (isPlaywrightMockRealBbbBoundedSubmitTerminalUrl(pageData.url ?? "")) {
    return { fieldsToFill: [] };
  }

  const businessName = readUserDataString(userData, USER_DATA_BUSINESS_NAME_KEYS);
  return {
    fieldsToFill: businessName ? [{ selector: "company_name", value: businessName }] : [],
    nextButton: { selectorType: "id", value: "continue_btn" },
    waitForNavigation: true,
  };
}

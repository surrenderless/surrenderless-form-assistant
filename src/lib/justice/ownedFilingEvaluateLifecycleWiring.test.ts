import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const BOUNDED_SUBMIT_FILES = [
  "src/lib/justice/runRealFtcBoundedSubmit.ts",
  "src/lib/justice/runRealBbbBoundedSubmit.ts",
] as const;

function read(rel: string): string {
  return readFileSync(path.resolve(process.cwd(), rel), "utf8");
}

describe("owned-filing bounded submit evaluate paths use lifecycle enrichment", () => {
  for (const rel of BOUNDED_SUBMIT_FILES) {
    it(`${rel} wraps collectPageData evaluate with withOwnedFilingEvaluateLifecycle`, () => {
      const source = read(rel);
      expect(source).toContain("withOwnedFilingEvaluateLifecycle");
      expect(source).toMatch(
        /collectPageData\([\s\S]*?withOwnedFilingEvaluateLifecycle\([\s\S]*?page\.evaluate/
      );
      expect(source).toContain("collectPageData(page, playwrightSession, browser)");
      // Loop + post-cap paths both pass session/browser into collectPageData.
      const collectCalls = source.match(
        /collectPageData\(page!?, playwrightSession!?, browser!?\)/g
      );
      expect(collectCalls?.length).toBeGreaterThanOrEqual(2);
    });

    it(`${rel} bounds collectPageData evaluate with withOwnedFilingEvaluateTimeout`, () => {
      const source = read(rel);
      expect(source).toContain("withOwnedFilingEvaluateTimeout");
      expect(source).toMatch(
        /withOwnedFilingEvaluateLifecycle\([\s\S]*?withOwnedFilingEvaluateTimeout\([\s\S]*?page\.evaluate/
      );
    });

    it(`${rel} aborts in-flight evaluate on timeout via page close`, () => {
      const source = read(rel);
      expect(source).toContain("abortOwnedFilingPageEvaluate");
      expect(source).toMatch(
        /withOwnedFilingEvaluateTimeout\(\s*\(\)\s*=>[\s\S]*?page\.evaluate[\s\S]*?OWNED_FILING_PAGE_EVALUATE_TIMEOUT_MS\s*,\s*\(\)\s*=>\s*abortOwnedFilingPageEvaluate\(page\)/
      );
    });
  }
});

describe("FTC navigation avoids blind settle delay under Browserless budget", () => {
  it("uses gotoOwnedFilingPage (wall-clock bound) and has no fixed 2s pre-evaluate delay", () => {
    const source = read("src/lib/justice/runRealFtcBoundedSubmit.ts");
    expect(source).toContain("gotoOwnedFilingPage");
    expect(source).toContain("withOwnedFilingSessionBudget");
    expect(source).toMatch(/gotoOwnedFilingPage\(\s*page!?,\s*url\s*\)/);
    expect(source).not.toMatch(/page!?\.goto\(\s*url,\s*\{\s*timeout:\s*60000/);
    expect(source).not.toMatch(/waitForLoadState\(\s*["']domcontentloaded["']\s*\)/);
    expect(source).not.toMatch(/waitForTimeout\(\s*2000\s*\)/);
    expect(source).toContain("assertOwnedFilingPageAliveBeforeEvaluate(playwrightSession, browser");
  });

  it("bounds every FTC collectPageData evaluate and retries once on first evaluate_timeout", () => {
    const source = read("src/lib/justice/runRealFtcBoundedSubmit.ts");
    expect(source).toContain("withOwnedFilingEvaluateTimeout");
    expect(source).toContain("abortOwnedFilingPageEvaluate");
    expect(source).toContain("closeOwnedFilingBrowserFailClosed");
    expect(source).toContain("waitForFtcReportFraudInteractiveReady");
    expect(source).toContain("replaceOwnedFilingPlaywrightSessionPage");
    // Every iteration is staged (evaluate_n / decide_n / apply_n), not only the first.
    expect(source).toContain("`evaluate_${iteration}`");
    expect(source).toContain("`decide_${iteration}`");
    expect(source).toContain("`apply_${iteration}`");
    expect(source).toContain("iteration += 1");
    // The single fresh-page retry uses distinct *_retry stages so it never collides with iteration 2.
    expect(source).toContain('"retry_replace"');
    expect(source).toContain('"goto_retry"');
    expect(source).toContain('"ready_retry"');
    expect(source).toContain('stageTiming.run("evaluate_retry"');
    expect(source).toContain("createOwnedFilingFtcStageTiming");
    expect(source).toContain("OWNED_FILING_FTC_ACTION_TIMEOUT_MS");
    expect(source).toContain("propagateCriticalErrors: true");
    expect(source).toContain("collectOwnedFilingFtcPageDataInBrowser");
    expect(source).toContain("useExactTextButtonLocator: true");
    expect(source).toContain("currentPageUrl: pageData.url");
    expect(source).toContain("enableFtcChoiceControls: true");
    expect(source).toContain("actionableButtonLabels: pageData.buttons.map");
    expect(source).toContain("choiceControls: pageData.choiceControls ?? []");
    // A bounded action timeout preserves progress as an incomplete result instead of throwing.
    expect(source).toContain("parseOwnedFilingActionTimeoutOperation");
    expect(source).toContain('"action_timeout"');
    expect(source).toContain("isOwnedFilingEvaluateTimeoutError");
    expect(source).toMatch(
      /withOwnedFilingEvaluateLifecycle\([\s\S]*?withOwnedFilingEvaluateTimeout\([\s\S]*?page\.evaluate/
    );
    expect(source).toMatch(
      /withOwnedFilingEvaluateTimeout\(\s*\(\)\s*=>[\s\S]*?page\.evaluate[\s\S]*?OWNED_FILING_PAGE_EVALUATE_TIMEOUT_MS\s*,\s*\(\)\s*=>\s*abortOwnedFilingPageEvaluate\(page\)/
    );
  });

  it("passes waitForFunction timeout as options (selector arg, then options object)", () => {
    const source = read("src/lib/justice/ownedFilingPlaywrightSession.ts");
    expect(source).toMatch(
      /waitForFunction\(\s*\(selector:\s*string\)\s*=>\s*\{[\s\S]*?\},\s*OWNED_FILING_FTC_READY_SELECTOR,\s*\{\s*timeout:\s*timeoutMs\s*\}\s*\)/
    );
    // Regression: must not pass `{ timeout }` as the pageFunction arg (2nd position).
    expect(source).not.toMatch(
      /waitForFunction\(\s*\([\s\S]*?\),\s*\{\s*timeout:\s*timeoutMs\s*\}\s*\)/
    );
  });

  it("evaluate timeout rejects before awaiting abort and never forever-parks", () => {
    const source = read("src/lib/justice/ownedFilingPlaywrightSession.ts");
    expect(source).toContain("race_winner");
    expect(source).toContain("abort_timer_fired_at_ms");
    expect(source).toContain("abort_close_ms");
    // Reject OwnedFilingEvaluateTimeoutError first; abort is fire-and-forget after.
    expect(source).toMatch(
      /reject\(\s*new OwnedFilingEvaluateTimeoutError[\s\S]*?\)\s*;\s*void \(async \(\) => \{[\s\S]*?await onTimeoutAbort/
    );
    expect(source).not.toContain("new Promise<T>(() => {})");
  });

  it("navigation timeout rejects before awaiting abort with nav diagnostics", () => {
    const source = read("src/lib/justice/ownedFilingPlaywrightSession.ts");
    expect(source).toContain("nav_timer_fired_at_ms");
    expect(source).toContain("OWNED_FILING_NAVIGATION_TIMEOUT_REASON");
    expect(source).toContain("withOwnedFilingNavigationTimeout");
    expect(source).toContain("gotoOwnedFilingPage");
    expect(source).toMatch(
      /reject\(\s*new OwnedFilingNavigationTimeoutError[\s\S]*?\)\s*;\s*void \(async \(\) => \{[\s\S]*?await onTimeoutAbort/
    );
  });

  it("session budget rejects before awaiting abort with budget diagnostics", () => {
    const source = read("src/lib/justice/ownedFilingPlaywrightSession.ts");
    expect(source).toContain("budget_fired_at_ms");
    expect(source).toContain("OWNED_FILING_SESSION_TIMEOUT_REASON");
    expect(source).toContain("withOwnedFilingSessionBudget");
    expect(source).toContain("destroyOwnedFilingBrowserBestEffort");
    expect(source).toContain("provider_session_kill");
    expect(source).toContain("session_bound_ms=");
    expect(source).toMatch(
      /reject\(\s*new OwnedFilingSessionTimeoutError[\s\S]*?\)\s*;\s*void \(async \(\) => \{[\s\S]*?await onTimeoutAbort/
    );
  });

  it("Browserless session timeout is forced to the 60s Node session budget", () => {
    const source = read("src/lib/justice/bbbOwnedFilingProduction.ts");
    expect(source).toContain("OWNED_FILING_SESSION_BUDGET_MS");
    expect(source).toMatch(
      /OWNED_FILING_BROWSERLESS_SESSION_TIMEOUT_MS\s*=\s*OWNED_FILING_SESSION_BUDGET_MS/
    );
    expect(source).toContain('parsed.searchParams.set("timeout"');
    expect(source).toContain('parsed.searchParams.delete("timeout")');
  });

  it("BBB bounds collectPageData evaluate and wall-clock-bounds goto before first evaluate", () => {
    const source = read("src/lib/justice/runRealBbbBoundedSubmit.ts");
    expect(source).toContain("withOwnedFilingEvaluateTimeout");
    expect(source).toContain("abortOwnedFilingPageEvaluate");
    expect(source).toContain("closeOwnedFilingBrowserFailClosed");
    expect(source).toContain("gotoOwnedFilingPage");
    expect(source).toContain("withOwnedFilingSessionBudget");
    expect(source).toContain("destroyOwnedFilingBrowserBestEffort");
    expect(source).toContain("OWNED_FILING_SESSION_BUDGET_MS");
    // Session budget must wrap connect before first evaluate.
    expect(source).toMatch(
      /withOwnedFilingSessionBudget\([\s\S]*?setPhase\(\s*["']connect["']\s*\)[\s\S]*?connectOverCDP[\s\S]*?setPhase\(\s*["']evaluate["']\s*\)[\s\S]*?collectPageData/
    );
    expect(source).toMatch(
      /withOwnedFilingEvaluateLifecycle\([\s\S]*?withOwnedFilingEvaluateTimeout\([\s\S]*?page\.evaluate/
    );
    expect(source).toMatch(
      /withOwnedFilingEvaluateTimeout\(\s*\(\)\s*=>[\s\S]*?page\.evaluate[\s\S]*?OWNED_FILING_PAGE_EVALUATE_TIMEOUT_MS\s*,\s*\(\)\s*=>\s*abortOwnedFilingPageEvaluate\(page\)/
    );
    // Navigation must use Node-local wall-clock bound before first evaluate — not bare page.goto.
    expect(source).toMatch(/gotoOwnedFilingPage\(\s*page,\s*navigationUrl\s*\)/);
    expect(source).not.toMatch(/page\.goto\(\s*navigationUrl/);
    expect(source).not.toMatch(/waitForLoadState\(\s*["']domcontentloaded["']\s*\)/);
    expect(source).not.toMatch(/waitForTimeout\(\s*2000\s*\)/);
    expect(source).toContain("assertOwnedFilingPageAliveBeforeEvaluate(playwrightSession, browser)");
    // BBB requires post-goto interactive readiness before first collectPageData evaluate.
    expect(source).toContain("waitForBbbComplainPortalInteractiveReady");
    expect(source).toContain('setPhase("ready")');
    expect(source).toContain("setReadySignal");
    expect(source).toMatch(
      /waitForBbbComplainPortalInteractiveReady\(page\)[\s\S]*?setReadySignal\(ready\.ready_signal\)[\s\S]*?setPhase\(\s*["']evaluate["']\s*\)[\s\S]*?collectPageData/
    );
    expect(source).toContain("collectOwnedFilingBbbPostNavDiagnostics");
    expect(source).toContain("formatOwnedFilingBbbPostNavDiagnostics");
    // BBB does not adopt FTC-only ready/retry/stage machinery in this slice.
    expect(source).not.toContain("withOwnedFilingFirstEvaluateRetry");
    expect(source).not.toContain("waitForFtcReportFraudInteractiveReady");
    expect(source).not.toContain("createOwnedFilingFtcStageTiming");
    expect(source).not.toContain("OWNED_FILING_FTC_ACTION_TIMEOUT_MS");
    expect(source).not.toContain("propagateCriticalErrors");
    expect(source).not.toContain("collectOwnedFilingFtcPageDataInBrowser");
    expect(source).not.toContain("useExactTextButtonLocator");
  });

  it("BBB live readiness requires visible Start Complaint after optional goal reveal", () => {
    const source = read("src/lib/justice/ownedFilingPlaywrightSession.ts");
    expect(source).toContain("start_complaint_visible_count");
    expect(source).toContain("complaint_goal_visible_count");
    expect(source).toContain("shouldRevealBbbStartComplaintViaGoal");
    expect(source).toContain("OWNED_FILING_BBB_COMPLAINT_GOAL_RE");
    expect(source).toContain("/file-a-complaint");
    // Live ready must not weaken to presence-only Start Complaint or generic chrome.
    expect(source).toMatch(
      /startComplaintVisibleCount\s*===\s*1[\s\S]*?ready_signal:\s*["']start_complaint["']/
    );
    expect(source).toContain("mock_form_controls");
  });
});

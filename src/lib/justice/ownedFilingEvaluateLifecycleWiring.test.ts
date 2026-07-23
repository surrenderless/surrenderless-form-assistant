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
  it("uses goto waitUntil domcontentloaded and has no fixed 2s pre-evaluate delay", () => {
    const source = read("src/lib/justice/runRealFtcBoundedSubmit.ts");
    expect(source).toMatch(
      /page!?\.goto\(\s*url,\s*\{\s*timeout:\s*60000,\s*waitUntil:\s*"domcontentloaded"\s*\}\s*\)/
    );
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

  it("BBB bounds collectPageData evaluate and uses domcontentloaded goto without fixed 2s delay", () => {
    const source = read("src/lib/justice/runRealBbbBoundedSubmit.ts");
    expect(source).toContain("withOwnedFilingEvaluateTimeout");
    expect(source).toContain("abortOwnedFilingPageEvaluate");
    expect(source).toContain("closeOwnedFilingBrowserFailClosed");
    expect(source).toMatch(
      /withOwnedFilingEvaluateLifecycle\([\s\S]*?withOwnedFilingEvaluateTimeout\([\s\S]*?page\.evaluate/
    );
    expect(source).toMatch(
      /withOwnedFilingEvaluateTimeout\(\s*\(\)\s*=>[\s\S]*?page\.evaluate[\s\S]*?OWNED_FILING_PAGE_EVALUATE_TIMEOUT_MS\s*,\s*\(\)\s*=>\s*abortOwnedFilingPageEvaluate\(page\)/
    );
    expect(source).toMatch(
      /page\.goto\(\s*navigationUrl,\s*\{\s*timeout:\s*60000,\s*waitUntil:\s*"domcontentloaded"\s*\}\s*\)/
    );
    expect(source).not.toMatch(/waitForLoadState\(\s*["']domcontentloaded["']\s*\)/);
    expect(source).not.toMatch(/waitForTimeout\(\s*2000\s*\)/);
    expect(source).toContain("assertOwnedFilingPageAliveBeforeEvaluate(playwrightSession, browser)");
    // BBB does not adopt FTC-only ready/retry/stage machinery in this slice.
    expect(source).not.toContain("withOwnedFilingFirstEvaluateRetry");
    expect(source).not.toContain("waitForFtcReportFraudInteractiveReady");
    expect(source).not.toContain("createOwnedFilingFtcStageTiming");
    expect(source).not.toContain("OWNED_FILING_FTC_ACTION_TIMEOUT_MS");
    expect(source).not.toContain("propagateCriticalErrors");
    expect(source).not.toContain("collectOwnedFilingFtcPageDataInBrowser");
    expect(source).not.toContain("useExactTextButtonLocator");
  });
});

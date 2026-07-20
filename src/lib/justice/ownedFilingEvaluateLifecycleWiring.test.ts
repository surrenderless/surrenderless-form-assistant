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
        /collectPageData\(page, playwrightSession, browser\)/g
      );
      expect(collectCalls?.length).toBeGreaterThanOrEqual(2);
    });
  }
});

describe("FTC navigation avoids blind settle delay under Browserless budget", () => {
  it("uses goto waitUntil domcontentloaded and has no fixed 2s pre-evaluate delay", () => {
    const source = read("src/lib/justice/runRealFtcBoundedSubmit.ts");
    expect(source).toMatch(
      /page\.goto\(\s*url,\s*\{\s*timeout:\s*60000,\s*waitUntil:\s*"domcontentloaded"\s*\}\s*\)/
    );
    expect(source).not.toMatch(/waitForLoadState\(\s*["']domcontentloaded["']\s*\)/);
    expect(source).not.toMatch(/waitForTimeout\(\s*2000\s*\)/);
    expect(source).toContain("assertOwnedFilingPageAliveBeforeEvaluate(playwrightSession, browser)");
  });

  it("BBB navigation sequence remains unchanged in this slice", () => {
    const source = read("src/lib/justice/runRealBbbBoundedSubmit.ts");
    expect(source).toContain('await page.goto(navigationUrl, { timeout: 60000 })');
    expect(source).toContain('await page.waitForLoadState("domcontentloaded")');
    expect(source).toContain("await page.waitForTimeout(2000)");
  });
});

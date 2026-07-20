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

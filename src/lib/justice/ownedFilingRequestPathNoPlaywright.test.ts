import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The consumer-facing request path (dispatch modules + PATCH/completion routes) must enqueue only.
 * It must never statically import Playwright, the bounded-submit runners, or the worker-only
 * execute modules — those run exclusively inside /api/cron/run-queued-owned-filings.
 */
const REQUEST_PATH_FILES = [
  "src/lib/justice/bbbOwnedFilingDelivery.ts",
  "src/lib/justice/ftcOwnedFilingDelivery.ts",
  "src/lib/justice/claimQueuedOwnedFiling.ts",
  "src/app/api/justice/cases/[id]/route.ts",
  "src/app/api/justice/cfpb-filing/complete/route.ts",
  "src/app/api/justice/fcc-filing/complete/route.ts",
  "src/app/api/justice/dot-filing/complete/route.ts",
  "src/app/api/justice/payment-dispute-filing/complete/route.ts",
  "src/app/api/justice/merchant-contact/complete/route.ts",
];

// Real Playwright module specifiers and the worker-only bounded-submit/execute modules.
// (The `@/lib/testing/playwrightMock*` pipelines are pure TS test doubles and are allowed.)
const FORBIDDEN = [
  "runRealBbbBoundedSubmit",
  "runRealFtcBoundedSubmit",
  "bbbOwnedFilingExecute",
  "ftcOwnedFilingExecute",
  '"playwright"',
  '"playwright-core"',
];

function read(rel: string): string {
  return readFileSync(path.resolve(process.cwd(), rel), "utf8");
}

describe("owned-filing request path stays Playwright-free (enqueue only)", () => {
  for (const rel of REQUEST_PATH_FILES) {
    it(`${rel} does not statically import Playwright or the bounded-submit/execute modules`, () => {
      const source = read(rel);
      for (const needle of FORBIDDEN) {
        expect(source.includes(needle), `${rel} must not reference "${needle}"`).toBe(false);
      }
    });
  }

  it("the worker endpoint is the module that imports the execute paths", () => {
    const worker = read("src/app/api/cron/run-queued-owned-filings/route.ts");
    expect(worker.includes("executeClaimedBbbFiling")).toBe(true);
    expect(worker.includes("executeClaimedFtcFiling")).toBe(true);
    expect(worker.includes("isOwnedFilingSubmitArmed")).toBe(true);
  });

  it("dry-run endpoint is separate from the minute worker and never imports execute claim paths for live submit", () => {
    const dryRun = read("src/app/api/cron/dry-run-owned-filing/route.ts");
    expect(dryRun.includes("runOwnedFilingDryRun")).toBe(true);
    expect(dryRun.includes("executeClaimedBbbFiling")).toBe(false);
    expect(dryRun.includes("executeClaimedFtcFiling")).toBe(false);
    expect(dryRun.includes("findAndClaimNextQueuedOwnedFiling")).toBe(false);
  });
});

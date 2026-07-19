import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

type CronEntry = { path: string; schedule: string };

function loadCrons(): CronEntry[] {
  const raw = readFileSync(path.resolve(process.cwd(), "vercel.json"), "utf8");
  const parsed = JSON.parse(raw) as { crons?: CronEntry[] };
  return parsed.crons ?? [];
}

describe("vercel.json queued owned-filing worker schedule", () => {
  it("registers the queued owned-filing worker every minute", () => {
    const crons = loadCrons();
    const worker = crons.find((c) => c.path === "/api/cron/run-queued-owned-filings");
    expect(worker).toBeDefined();
    expect(worker?.schedule).toBe("* * * * *");
  });

  it("keeps the 15-minute stale-submitting recovery cron unchanged", () => {
    const crons = loadCrons();
    const stale = crons.find((c) => c.path === "/api/cron/reconcile-stale-submitting-filings");
    expect(stale).toBeDefined();
    expect(stale?.schedule).toBe("*/15 * * * *");
  });

  it("does not schedule the operator dry-run endpoint on the minute cron", () => {
    const crons = loadCrons();
    expect(crons.some((c) => c.path.includes("dry-run-owned-filing"))).toBe(false);
    const worker = readFileSync(
      path.resolve(process.cwd(), "src/app/api/cron/run-queued-owned-filings/route.ts"),
      "utf8"
    );
    expect(worker.includes("runOwnedFilingDryRun")).toBe(false);
    expect(worker.includes("dry_run")).toBe(false);
  });
});

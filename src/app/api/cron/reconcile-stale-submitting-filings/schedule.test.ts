import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

type CronEntry = { path: string; schedule: string };

function loadCrons(): CronEntry[] {
  const raw = readFileSync(path.resolve(process.cwd(), "vercel.json"), "utf8");
  const parsed = JSON.parse(raw) as { crons?: CronEntry[] };
  return parsed.crons ?? [];
}

describe("vercel.json cron schedules", () => {
  it("registers the stale-submitting recovery cron every 15 minutes", () => {
    const crons = loadCrons();
    const stale = crons.find(
      (c) => c.path === "/api/cron/reconcile-stale-submitting-filings"
    );
    expect(stale).toBeDefined();
    expect(stale?.schedule).toBe("*/15 * * * *");
  });

  it("keeps the existing daily reconcile-owned-filing-tasks cron unchanged", () => {
    const crons = loadCrons();
    const daily = crons.find((c) => c.path === "/api/cron/reconcile-owned-filing-tasks");
    expect(daily).toBeDefined();
    expect(daily?.schedule).toBe("0 13 * * *");
  });
});

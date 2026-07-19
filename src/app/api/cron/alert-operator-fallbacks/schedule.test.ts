import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

type CronEntry = { path: string; schedule: string };

function loadCrons(): CronEntry[] {
  const raw = readFileSync(path.resolve(process.cwd(), "vercel.json"), "utf8");
  const parsed = JSON.parse(raw) as { crons?: CronEntry[] };
  return parsed.crons ?? [];
}

describe("vercel.json operator fallback alert schedule", () => {
  it("registers the operator fallback alert cron every 5 minutes", () => {
    const crons = loadCrons();
    const alert = crons.find((c) => c.path === "/api/cron/alert-operator-fallbacks");
    expect(alert).toBeDefined();
    expect(alert?.schedule).toBe("*/5 * * * *");
  });

  it("keeps the queued owned-filing worker and stale-submitting recovery crons unchanged", () => {
    const crons = loadCrons();
    expect(crons.find((c) => c.path === "/api/cron/run-queued-owned-filings")?.schedule).toBe(
      "* * * * *"
    );
    expect(
      crons.find((c) => c.path === "/api/cron/reconcile-stale-submitting-filings")?.schedule
    ).toBe("*/15 * * * *");
  });
});

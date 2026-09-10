import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Regression coverage for a real bug: the justice_case_payment_events migration's alert_status
 * check constraint originally allowed only ('pending', 'sent'), but
 * processStripeRefundDisputeEvent.ts's claim step writes a third value, 'sending', before
 * sending the alert (the pending -> sending -> sent compare-and-swap lifecycle documented in the
 * migration's own comments). Every unit test mocked the table and never enforced the real check
 * constraint, so this passed 44 tests while the actual UPDATE that claims a row for sending
 * would have been rejected by Postgres on first contact with a real database. This parses the
 * migration SQL and the handler source directly (no live DB needed) so it fails the moment either
 * one drifts from the other again, in either direction.
 */

const MIGRATIONS_DIR = path.join(process.cwd(), "supabase", "migrations");
const HANDLER_PATH = path.join(
  process.cwd(),
  "src",
  "lib",
  "stripe",
  "processStripeRefundDisputeEvent.ts"
);

function readAllMigrationSql(): string {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((file) => fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"))
    .join("\n");
}

const migrationSql = readAllMigrationSql();
const handlerSource = fs.readFileSync(HANDLER_PATH, "utf8");

const constraintMatch = migrationSql.match(
  /alert_status\s+text\s+not\s+null\s+default\s+'pending'\s+check\s*\(\s*alert_status\s+in\s*\(([^)]+)\)\s*\)/i
);

const allowedByMigration = new Set(
  (constraintMatch?.[1] ?? "")
    .split(",")
    .map((s) => s.trim().replace(/^'|'$/g, ""))
    .filter(Boolean)
);

const writtenStatuses = new Set(
  Array.from(handlerSource.matchAll(/alert_status:\s*"([a-z]+)"/g)).map((m) => m[1])
);

describe("justice_case_payment_events.alert_status migration matches processStripeRefundDisputeEvent's runtime lifecycle", () => {
  it("finds the alert_status check constraint in the migration (sanity check)", () => {
    expect(constraintMatch).not.toBeNull();
  });

  it("discovers the expected runtime statuses in the handler (sanity check so the assertions below can't silently cover zero values)", () => {
    expect(Array.from(writtenStatuses).sort()).toEqual(["pending", "sending", "sent"]);
  });

  it.each(["pending", "sending", "sent"])(
    "migration's alert_status check constraint allows the runtime value %s",
    (status) => {
      expect(allowedByMigration.has(status)).toBe(true);
    }
  );

  it("the migration allows exactly the handler's declared union — no drift in either direction", () => {
    const typeMatch = handlerSource.match(
      /alert_status:\s*"pending"\s*\|\s*"sending"\s*\|\s*"sent"/
    );
    expect(typeMatch).not.toBeNull();
    expect(allowedByMigration).toEqual(new Set(["pending", "sending", "sent"]));
  });
});

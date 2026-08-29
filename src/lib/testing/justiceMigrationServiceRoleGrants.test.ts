import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Regression coverage for a real CI failure: staging was created with Supabase's "Automatically
 * expose new tables" setting disabled, so none of the justice_* tables ever received their
 * service_role table-level GRANTs (that automation is what every prior migration silently relied
 * on) even though RLS itself was configured correctly — service_role still needs an ordinary
 * GRANT to pass Postgres's privilege check before RLS is even evaluated. This asserts every
 * justice_* table created by a tracked migration has an explicit `grant ... to service_role`
 * somewhere in the migration set, so a brand-new project with that setting disabled (staging's
 * actual configuration) still works, and that nothing here ever grants anon/authenticated access
 * or disables RLS.
 */

const MIGRATIONS_DIR = path.join(process.cwd(), "supabase", "migrations");

function readAllMigrationSql(): string {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((file) => fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"))
    .join("\n");
}

const combined = readAllMigrationSql();

const discoveredJusticeTables = Array.from(
  new Set(
    Array.from(
      combined.matchAll(/create table if not exists public\.(justice_case_\w+|justice_cases)\b/gi)
    ).map((match) => match[1]!.toLowerCase())
  )
).sort();

describe("justice Supabase migrations grant service_role explicit table privileges", () => {
  it("discovers the expected justice_* tables (sanity check so the audit below can't silently cover zero tables)", () => {
    expect(discoveredJusticeTables).toEqual(
      [
        "justice_cases",
        "justice_case_chat_messages",
        "justice_case_evidence",
        "justice_case_filings",
        "justice_case_payments",
        "justice_case_tasks",
      ].sort()
    );
  });

  it.each(discoveredJusticeTables)(
    "grants service_role explicit privileges on public.%s",
    (table) => {
      const grantPattern = new RegExp(
        `grant[^;]*\\bon\\s+public\\.${table}\\b[^;]*\\bto\\s+service_role\\b`,
        "i"
      );
      expect(combined).toMatch(grantPattern);
    }
  );

  it("never grants anon or authenticated access on any justice_* table", () => {
    const justiceTableGrants = (combined.match(/grant[^;]*;/gi) ?? []).filter((statement) =>
      /\bpublic\.justice_/i.test(statement)
    );
    expect(justiceTableGrants.length).toBeGreaterThan(0);
    for (const statement of justiceTableGrants) {
      expect(statement).not.toMatch(/\bto\s+anon\b/i);
      expect(statement).not.toMatch(/\bto\s+authenticated\b/i);
    }
  });

  it("never disables row level security on any table", () => {
    expect(combined).not.toMatch(/disable row level security/i);
  });
});

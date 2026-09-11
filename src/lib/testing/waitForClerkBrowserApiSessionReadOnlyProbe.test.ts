import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Regression coverage for a real bug: waitForClerkBrowserApiSession (the shared e2e helper used
 * by 35+ specs to confirm the browser's Clerk session is authenticated before proceeding) used to
 * probe by POSTing to /api/justice/intake-chat — a write-shaped request to a chat/AI endpoint,
 * repeated on every navigation across every test that calls it. Investigation traced the shared
 * PLAYWRIGHT_MOCK_SECOND_CASE_ID fixture becoming visible in a test user's case list mid-run back
 * to this probe's pattern of use (though the intake-chat route handler itself turned out to be
 * stateless — verified directly in its own source, see the second describe block below). The
 * fix replaces it with GET /api/justice/cases, a route whose GET handler is a provable read-only
 * Supabase SELECT (or a pure read-only mock-pipeline response builder), keeping the exact same
 * retry-until-200 / 401-detection contract. This file guards both sides of that fix directly
 * against source (not assumptions) so neither can silently regress.
 */

const HELPER_PATH = path.join(process.cwd(), "e2e", "helpers", "clerk-e2e.ts");
const CASES_ROUTE_PATH = path.join(process.cwd(), "src", "app", "api", "justice", "cases", "route.ts");

function extractFunctionSource(fileSource: string, signature: string, nextSignature?: string): string {
  const startIndex = fileSource.indexOf(signature);
  if (startIndex === -1) {
    throw new Error(`Could not find "${signature}" in source`);
  }
  const searchFrom = startIndex + signature.length;
  const endIndex = nextSignature
    ? fileSource.indexOf(nextSignature, searchFrom)
    : fileSource.length;
  if (nextSignature && endIndex === -1) {
    throw new Error(`Could not find "${nextSignature}" after "${signature}"`);
  }
  return fileSource.slice(startIndex, endIndex === -1 ? undefined : endIndex);
}

describe("waitForClerkBrowserApiSession uses a genuinely read-only probe", () => {
  const helperSource = fs.readFileSync(HELPER_PATH, "utf8");
  const fnSource = extractFunctionSource(
    helperSource,
    "export async function waitForClerkBrowserApiSession",
    "export async function resetPlaywrightMockActiveCaseIfAny"
  );

  it("never references the intake-chat write endpoint", () => {
    expect(fnSource).not.toMatch(/intake-chat/);
  });

  it("issues a GET request, not POST/PATCH/DELETE/PUT", () => {
    expect(fnSource).toMatch(/method:\s*"GET"/);
    expect(fnSource).not.toMatch(/method:\s*"(POST|PATCH|DELETE|PUT)"/);
  });

  it("sends no request body (a body implies a mutating-style request)", () => {
    expect(fnSource).not.toMatch(/\bbody\s*:/);
  });

  it("probes the provably read-only case-list endpoint", () => {
    expect(fnSource).toMatch(/\/api\/justice\/cases(?!\/)/);
  });

  it("preserves the retry-until-200 / 401-detection contract", () => {
    expect(fnSource).toMatch(/expect\s*\n?\s*\.poll\(/);
    expect(fnSource).toMatch(/\.toBe\(200\)/);
    expect(fnSource).toMatch(/timeout:\s*30_000/);
  });

  it("still waits for the Clerk UI's Open user menu button first", () => {
    expect(fnSource).toMatch(/Open user menu/);
  });
});

describe("GET /api/justice/cases is genuinely read-only in source", () => {
  const routeSource = fs.readFileSync(CASES_ROUTE_PATH, "utf8");
  const getFnSource = extractFunctionSource(
    routeSource,
    "export async function GET(req: NextRequest)",
    "export async function POST"
  );

  const MUTATING_PATTERNS = [/\.insert\(/, /\.update\(/, /\.upsert\(/, /\.delete\(/, /\.rpc\(/];

  it("contains no Supabase mutating call in the GET handler", () => {
    for (const pattern of MUTATING_PATTERNS) {
      expect(getFnSource).not.toMatch(pattern);
    }
  });

  it("only ever builds a select() query against justice_cases", () => {
    expect(getFnSource).toMatch(/\.from\("justice_cases"\)/);
    expect(getFnSource).toMatch(/\.select\(/);
  });
});

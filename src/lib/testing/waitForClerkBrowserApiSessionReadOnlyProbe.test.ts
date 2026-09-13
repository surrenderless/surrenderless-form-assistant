import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Regression coverage for a real bug: waitForClerkBrowserApiSession (the shared e2e helper used
 * by 35+ specs to confirm the browser's Clerk session is authenticated before proceeding) used to
 * probe by POSTing to /api/justice/intake-chat — a write-shaped request to a chat/AI endpoint,
 * repeated on every navigation across every test that calls it. Direct source inspection proved
 * that route handler is actually stateless (no case_id accepted, no persistence), so it was never
 * an active mutator — but it was still the wrong kind of endpoint for a pure auth check.
 *
 * The fix replaces it with GET /api/justice/cases?e2eSessionProbe=1, a route whose GET handler is
 * a provable read-only Supabase SELECT (or a pure read-only mock-pipeline response builder). The
 * query param matters: a first attempt at this fix probed the bare, unparameterized
 * /api/justice/cases and broke signed-in-chat-ai-resume-latest-case-after-session-clear specs,
 * which deliberately intercept that exact bare URL with page.route to test race conditions around
 * the app's own resume-on-mount fetch — this probe's traffic was getting caught in their
 * held/delayed responses. The inert query param keeps this probe's requests structurally distinct
 * from that URL so they can never be caught by a `$`-anchored interception again. This file guards
 * all of this directly against source (not assumptions) so none of it can silently regress.
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

  it("never probes the bare, unparameterized cases URL — other specs intercept exactly that with a $-anchored page.route to test resume-on-mount race conditions, and this probe's traffic would get caught in their held/delayed responses", () => {
    expect(fnSource).not.toMatch(/["'`]\/api\/justice\/cases["'`]/);
    expect(fnSource).toMatch(/\/api\/justice\/cases\?e2eSessionProbe=1/);
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

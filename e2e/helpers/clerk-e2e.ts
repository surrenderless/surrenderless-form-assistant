import { expect, type Page } from "@playwright/test";
import fs from "fs";
import path from "path";
import { PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID } from "@/lib/testing/playwrightMockIntakeCaseCommitPipeline";

export const CLERK_STORAGE_STATE_PATH = path.join("playwright", ".clerk", "user.json");
export const OPERATOR_CLERK_STORAGE_STATE_PATH = path.join("playwright", ".clerk", "operator.json");

export const MOCK_FTC_PRACTICE_SUBMIT_URL = "http://127.0.0.1:3000/mock/ftc-complaint";

/** Official BBB.org complaint entry URL (assisted autofill lane; mocked in Playwright E2E). */
export const REAL_BBB_COMPLAINT_SUBMIT_URL = "https://www.bbb.org/complain/";

function isRealClerkKey(value: string | undefined, prefix: "pk" | "sk"): boolean {
  const key = value?.trim();
  if (!key) return false;
  if (/placeholder/i.test(key)) return false;
  const pattern = prefix === "pk" ? /^pk_(test|live)_/ : /^sk_(test|live)_/;
  if (!pattern.test(key)) return false;
  return key.replace(pattern, "").length >= 20;
}

/** True when real Clerk test keys and E2E user credentials are available. */
export function isClerkE2eConfigured(): boolean {
  const identifier =
    process.env.E2E_CLERK_USER_EMAIL?.trim() || process.env.E2E_CLERK_USER_USERNAME?.trim() || "";
  return (
    isRealClerkKey(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY, "pk") &&
    isRealClerkKey(process.env.CLERK_SECRET_KEY, "sk") &&
    identifier.length > 0 &&
    Boolean(process.env.E2E_CLERK_USER_PASSWORD?.trim())
  );
}

export function clerkE2eUserIdentifier(): string {
  return (
    process.env.E2E_CLERK_USER_EMAIL?.trim() || process.env.E2E_CLERK_USER_USERNAME?.trim() || ""
  );
}

function isRealClerkKeyForE2e(value: string | undefined, prefix: "pk" | "sk"): boolean {
  return isRealClerkKey(value, prefix);
}

export function operatorClerkE2eUserIdentifier(): string {
  return (
    process.env.E2E_OPERATOR_CLERK_USER_EMAIL?.trim() ||
    process.env.E2E_OPERATOR_CLERK_USER_USERNAME?.trim() ||
    ""
  );
}

/** True when a separate operator Clerk test user is configured for role-boundary E2E. */
export function isOperatorClerkE2eConfigured(): boolean {
  const identifier = operatorClerkE2eUserIdentifier();
  return (
    isRealClerkKeyForE2e(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY, "pk") &&
    isRealClerkKeyForE2e(process.env.CLERK_SECRET_KEY, "sk") &&
    identifier.length > 0 &&
    Boolean(process.env.E2E_OPERATOR_CLERK_USER_PASSWORD?.trim())
  );
}

export function operatorClerkStorageStateExists(): boolean {
  return fs.existsSync(OPERATOR_CLERK_STORAGE_STATE_PATH);
}

export function operatorClerkE2eSkipReason(): string {
  const missing: string[] = [];
  if (!isRealClerkKey(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY, "pk")) {
    missing.push("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY");
  }
  if (!isRealClerkKey(process.env.CLERK_SECRET_KEY, "sk")) {
    missing.push("CLERK_SECRET_KEY");
  }
  const identifier = operatorClerkE2eUserIdentifier();
  if (!identifier) {
    missing.push("E2E_OPERATOR_CLERK_USER_EMAIL or E2E_OPERATOR_CLERK_USER_USERNAME");
  }
  if (!process.env.E2E_OPERATOR_CLERK_USER_PASSWORD?.trim()) {
    missing.push("E2E_OPERATOR_CLERK_USER_PASSWORD");
  }
  if (missing.length > 0) {
    return `Skipped: missing operator Clerk E2E credentials — ${missing.join(", ")}.`;
  }
  if (!operatorClerkStorageStateExists()) {
    return "Skipped: operator Clerk E2E storageState missing — run Playwright global setup.";
  }
  return "Skipped: operator Clerk E2E prerequisites not met.";
}

export function clerkStorageStateExists(): boolean {
  return fs.existsSync(CLERK_STORAGE_STATE_PATH);
}

/** Lists env vars that are missing or invalid for Clerk E2E sign-in. */
export function clerkE2eMissingEnvVars(): string[] {
  const missing: string[] = [];
  if (!isRealClerkKey(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY, "pk")) {
    missing.push("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY (real pk_test_* or pk_live_*, not placeholder)");
  }
  if (!isRealClerkKey(process.env.CLERK_SECRET_KEY, "sk")) {
    missing.push("CLERK_SECRET_KEY (real sk_test_* or sk_live_*, not placeholder)");
  }
  const identifier =
    process.env.E2E_CLERK_USER_EMAIL?.trim() || process.env.E2E_CLERK_USER_USERNAME?.trim() || "";
  if (!identifier) {
    missing.push("E2E_CLERK_USER_EMAIL or E2E_CLERK_USER_USERNAME");
  }
  if (!process.env.E2E_CLERK_USER_PASSWORD?.trim()) {
    missing.push("E2E_CLERK_USER_PASSWORD");
  }
  return missing;
}

export function clerkE2eSkipReason(): string {
  const missing = clerkE2eMissingEnvVars();
  if (missing.length > 0) {
    return `Skipped: missing Clerk E2E credentials — ${missing.join(", ")}. Add them to .env.local (or CI secrets) and re-run Playwright.`;
  }
  if (!clerkStorageStateExists()) {
    return "Skipped: Clerk E2E storageState missing — run Playwright global setup after configuring credentials.";
  }
  return "Skipped: Clerk E2E prerequisites not met.";
}

export const CLERK_E2E_SKIP_REASON =
  "Skipped: set real Clerk test credentials — NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY, CLERK_SECRET_KEY, E2E_CLERK_USER_EMAIL (or E2E_CLERK_USER_USERNAME), and E2E_CLERK_USER_PASSWORD — then re-run Playwright global setup.";

/** Wait until Clerk UI and browser `fetch` share an authenticated API session. */
export async function waitForClerkBrowserApiSession(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Open user menu" }).waitFor({
    state: "visible",
    timeout: 30_000,
  });
  await expect
    .poll(
      async () =>
        page.evaluate(async () => {
          const res = await fetch("/api/justice/intake-chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({
              user_message: "E2E browser auth probe.",
              parts: {},
              conversation_history: [],
            }),
          });
          return res.status;
        }),
      { timeout: 30_000 }
    )
    .toBe(200);
}

/**
 * Fully remove the deterministic mock Acme case (if any) before a setup that intends a
 * genuinely blank new intake. Archiving via PATCH /api/justice/cases/[id] was tried first, but
 * production's own escalation-ladder rules (canArchiveCaseForEscalationLadder) reject archiving
 * any case that hasn't already reached a fully-resolved end state — which a fresh or
 * mid-escalation leftover case, the exact case this needs to clear, never has. This instead
 * calls the mock-only POST /api/testing/playwright-mock-case-reset, which removes the case from
 * every in-memory mock store it lives in (not just one), so it stops existing entirely rather
 * than being archived. It does not touch or bypass production resume/archive logic — see that
 * route's own doc comment. Call this ONLY from setups that must not inherit a case left active
 * by an earlier test; never call it where resumption is the point (e.g. the modal sign-in
 * flow), or it will remove the very case being resumed.
 */
export async function resetPlaywrightMockActiveCaseIfAny(page: Page): Promise<void> {
  // The caller has typically just navigated to an authenticated page to establish the Clerk
  // session (page.request calls need a real page load first — storageState cookies alone are not
  // reliably usable by page.request before one). That same navigation can trigger chat-ai's own
  // resume-on-mount effect against the very case this is about to remove, which is a one-time,
  // bounded async chain (transcript + case-context refresh) that can still be in flight when the
  // reset POST and postcondition GET below run — occasionally re-writing the case back in between
  // them. Retrying the full reset+check a few times lets that one-time chain finish and lose the
  // race deterministically, instead of failing the caller on a transient overlap.
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const res = await page.request.post("/api/testing/playwright-mock-case-reset", {
        data: { case_id: PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID },
      });
      if (!res.ok()) {
        throw new Error(
          `resetPlaywrightMockActiveCaseIfAny: reset POST failed (${res.status()}): ${await res.text()}`
        );
      }

      // Assert the exact postcondition chat-ai's resume-on-mount fallback depends on:
      // fetchLatestActiveJusticeCaseRow() reads GET /api/justice/cases (no query) and resumes
      // list[0], so the deterministic case must be genuinely absent from that list — not merely
      // archived — or a "blank intake" setup would silently resume it anyway.
      const listRes = await page.request.get("/api/justice/cases");
      if (!listRes.ok()) {
        throw new Error(
          `resetPlaywrightMockActiveCaseIfAny: postcondition check GET /api/justice/cases failed (${listRes.status()}): ${await listRes.text()}`
        );
      }
      const listBody = (await listRes.json()) as { cases?: Array<{ id: string }> };
      const stillResumable = (listBody.cases ?? []).some(
        (row) => row.id === PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID
      );
      if (stillResumable) {
        throw new Error(
          "resetPlaywrightMockActiveCaseIfAny: postcondition failed — the deterministic mock case is still present in GET /api/justice/cases after reset, so chat-ai would still auto-resume it."
        );
      }
      return;
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      if (attempt < 4) {
        await new Promise((resolve) => setTimeout(resolve, 750));
      }
    }
  }
  throw lastError ?? new Error("resetPlaywrightMockActiveCaseIfAny: reset failed after retries");
}

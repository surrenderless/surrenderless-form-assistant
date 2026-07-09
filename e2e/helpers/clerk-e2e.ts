import { expect, type Page } from "@playwright/test";
import fs from "fs";
import path from "path";

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

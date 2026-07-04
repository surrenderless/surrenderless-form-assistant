import { clerk, clerkSetup } from "@clerk/testing/playwright";
import { test as setup, type APIResponse, type Page } from "@playwright/test";
import fs from "fs";
import path from "path";
import {
  CLERK_STORAGE_STATE_PATH,
  clerkE2eUserIdentifier,
  isClerkE2eConfigured,
} from "./helpers/clerk-e2e";

setup.describe.configure({ mode: "serial" });

const CLERK_E2E_SUBMIT_FORM_AUTH_CHECK = {
  url: "http://127.0.0.1:3000/mock/ftc-complaint",
  userData: {
    email: "e2e-global-setup@example.com",
    business_name: "E2E Setup Co",
    issue_type: "billing",
    complaint_description: "Clerk global setup auth verification.",
    incident_date: "2026-01-01",
    contact_full_name: "E2E Setup",
  },
} as const;

const CLERK_SESSION_PROPAGATION_TIMEOUT_MS = 30_000;
const CLERK_SESSION_PROPAGATION_POLL_MS = 250;

function isMiddlewareBasicAuth401(response: APIResponse, body: string): boolean {
  if (body.trim() === "Auth required") return true;
  const wwwAuthenticate = response.headers()["www-authenticate"] ?? "";
  return wwwAuthenticate.includes("Basic");
}

function isClerkUnauthorized401(body: string): boolean {
  try {
    const parsed = JSON.parse(body) as { error?: unknown };
    return parsed.error === "Unauthorized";
  } catch {
    return false;
  }
}

type SubmitFormAuthCheckBody = {
  result?: string;
  fillResult?: { status?: string };
};

async function waitForAuthenticatedSubmitFormSession(
  page: Page
): Promise<SubmitFormAuthCheckBody> {
  const deadline = Date.now() + CLERK_SESSION_PROPAGATION_TIMEOUT_MS;
  let lastStatus = 0;
  let lastBody = "";

  while (Date.now() < deadline) {
    const response = await page.request.post("/api/submit-form", {
      data: CLERK_E2E_SUBMIT_FORM_AUTH_CHECK,
    });
    lastStatus = response.status();
    lastBody = await response.text();

    if (lastStatus === 200) {
      try {
        return JSON.parse(lastBody) as SubmitFormAuthCheckBody;
      } catch {
        throw new Error(
          `Clerk E2E sign-in auth check returned invalid JSON: ${lastBody.slice(0, 400)}`
        );
      }
    }

    if (lastStatus === 401) {
      if (isMiddlewareBasicAuth401(response, lastBody)) {
        throw new Error(
          "Clerk E2E global setup hit middleware Basic Auth (401). Set DEPLOY_PASSWORD credentials on Playwright requests or unset DEPLOY_PASSWORD for local E2E."
        );
      }
      if (!isClerkUnauthorized401(lastBody)) {
        throw new Error(
          `Clerk E2E sign-in auth check returned unexpected 401 body: ${lastBody.slice(0, 400)}`
        );
      }
    } else {
      throw new Error(
        `Clerk E2E sign-in auth check failed (${lastStatus}): ${lastBody.slice(0, 400)}`
      );
    }

    await page.waitForTimeout(CLERK_SESSION_PROPAGATION_POLL_MS);
  }

  throw new Error(
    `Clerk E2E sign-in did not produce an authenticated API session within ${CLERK_SESSION_PROPAGATION_TIMEOUT_MS}ms (last status ${lastStatus}: ${lastBody.slice(0, 400)}).`
  );
}

setup("configure clerk testing token", async () => {
  fs.mkdirSync(path.dirname(CLERK_STORAGE_STATE_PATH), { recursive: true });
  if (!isClerkE2eConfigured()) {
    return;
  }
  await clerkSetup();
});

setup("sign in and persist storageState", async ({ page }) => {
  if (!isClerkE2eConfigured()) {
    if (fs.existsSync(CLERK_STORAGE_STATE_PATH)) {
      fs.unlinkSync(CLERK_STORAGE_STATE_PATH);
    }
    return;
  }

  await page.goto("/");
  await clerk.signIn({
    page,
    signInParams: {
      strategy: "password",
      identifier: clerkE2eUserIdentifier(),
      password: process.env.E2E_CLERK_USER_PASSWORD!.trim(),
    },
  });

  const authBody = await waitForAuthenticatedSubmitFormSession(page);
  if (authBody?.result !== "Success" || authBody?.fillResult?.status !== "success") {
    throw new Error(
      `Clerk E2E mock submit-form auth check returned unexpected body: ${JSON.stringify(authBody).slice(0, 400)}`
    );
  }

  await page.context().storageState({ path: CLERK_STORAGE_STATE_PATH });
});

import { clerk, clerkSetup } from "@clerk/testing/playwright";
import { test as setup } from "@playwright/test";
import fs from "fs";
import path from "path";
import {
  CLERK_STORAGE_STATE_PATH,
  clerkE2eUserIdentifier,
  isClerkE2eConfigured,
} from "./helpers/clerk-e2e";

setup.describe.configure({ mode: "serial" });

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

  const authCheck = await page.request.post("/api/submit-form", {
    data: {
      url: "http://127.0.0.1:3000/mock/ftc-complaint",
      userData: {
        email: "e2e-global-setup@example.com",
        business_name: "E2E Setup Co",
        issue_type: "billing",
        complaint_description: "Clerk global setup auth verification.",
        incident_date: "2026-01-01",
        contact_full_name: "E2E Setup",
      },
    },
  });
  if (authCheck.status() === 401) {
    throw new Error("Clerk E2E sign-in did not produce an authenticated API session.");
  }
  if (authCheck.status() !== 200) {
    const body = await authCheck.text();
    throw new Error(`Clerk E2E sign-in auth check failed (${authCheck.status()}): ${body.slice(0, 400)}`);
  }
  const authBody = await authCheck.json();
  if (authBody?.result !== "Success" || authBody?.fillResult?.status !== "success") {
    throw new Error(
      `Clerk E2E mock submit-form auth check returned unexpected body: ${JSON.stringify(authBody).slice(0, 400)}`
    );
  }

  await page.context().storageState({ path: CLERK_STORAGE_STATE_PATH });
});

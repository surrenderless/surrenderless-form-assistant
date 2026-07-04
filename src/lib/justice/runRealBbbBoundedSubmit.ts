import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { chromium, type Browser, type Page } from "playwright";
import { v4 as uuidv4 } from "uuid";
import fs from "fs";
import os from "os";
import path from "path";
import {
  REAL_BBB_MAX_SUBMIT_STEPS,
  buildButtonSelector,
  buildRealBbbIncompleteError,
  hasReachedStepCap,
  isEmptyFormDecision,
  normalizeFormDecision,
  type AssistedFormPageData,
  type FormDecision,
  type RealBbbSubmitStopReason,
} from "@/lib/justice/realBbbBoundedSubmitLoop";
import {
  detectBoundedSubmitTerminalConfirmation,
  isPlaywrightMockRealBbbBoundedSubmitLoopEnabled,
  resolvePlaywrightMockRealBbbBoundedSubmitNavigationUrl,
} from "@/lib/testing/playwrightMockRealBbbBoundedSubmitLoop";

export type RealBbbBoundedSubmitFillResult = {
  status: "success";
  screenshot: string | null;
  pageData: AssistedFormPageData | null;
  storageSkipped?: boolean;
  storageReason?: string;
  stepsExecuted: number;
  stopReason: "terminal_confirmation";
  stepLog: RealBbbBoundedSubmitStepLogEntry[];
};

export type RealBbbBoundedSubmitIncompleteResult = {
  ok: false;
  error: string;
  stopReason: Exclude<RealBbbSubmitStopReason, "terminal_confirmation">;
  stepsExecuted: number;
  fillResult: {
    screenshot: string | null;
    pageData: AssistedFormPageData | null;
    storageSkipped?: boolean;
    storageReason?: string;
    stepsExecuted: number;
    stopReason: RealBbbSubmitStopReason;
    stepLog: RealBbbBoundedSubmitStepLogEntry[];
  };
  technicalDetails: Record<string, unknown>;
};

export type RealBbbBoundedSubmitSuccessResult = {
  ok: true;
  fillResult: RealBbbBoundedSubmitFillResult;
};

export type RealBbbBoundedSubmitResult =
  | RealBbbBoundedSubmitSuccessResult
  | RealBbbBoundedSubmitIncompleteResult;

export type RealBbbBoundedSubmitStepLogEntry = {
  step: number;
  url: string;
  action: "terminal_detected" | "decide" | "apply" | "decide_failed" | "invalid_decision" | "empty_decision";
  detail?: string;
};

export type RunRealBbbBoundedSubmitParams = {
  url: string;
  userData: Record<string, unknown>;
  base: string;
  forwardedHeaders: Record<string, string>;
};

function getSupabaseAdmin(): SupabaseClient | null {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !supabaseServiceRoleKey) return null;

  return createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch },
  });
}

function contextOptions() {
  const pw = process.env.DEPLOY_PASSWORD;
  if (!pw) return {};
  return {
    httpCredentials: { username: "admin", password: pw } as const,
  };
}

async function collectPageData(page: Page): Promise<AssistedFormPageData> {
  return page.evaluate(() => {
    const fields = Array.from(document.querySelectorAll("input, textarea, select")).map((field) => {
      const label = (field as HTMLInputElement).labels?.[0]?.innerText || "";
      return {
        tag: field.tagName.toLowerCase(),
        type: (field as HTMLInputElement).type || "",
        name: field.getAttribute("name") || "",
        id: (field as HTMLInputElement).id || "",
        placeholder: field.getAttribute("placeholder") || "",
        label,
      };
    });

    const buttons = Array.from(document.querySelectorAll("button, input[type='submit']")).map((btn) => ({
      text: btn.textContent?.trim() || "",
      id: (btn as HTMLElement).id || "",
      name: btn.getAttribute("name") || "",
      type: btn.getAttribute("type") || "",
    }));

    return {
      fields,
      buttons,
      url: window.location.href,
      pageText: document.body?.innerText?.slice(0, 8000) || "",
    };
  });
}

async function applyFormDecision(page: Page, decision: FormDecision): Promise<void> {
  const fieldsToFill = decision.fieldsToFill ?? [];
  for (const field of fieldsToFill) {
    if (!field.selector?.trim()) continue;
    try {
      await page.fill(
        `input[name="${field.selector}"], input#${field.selector}, textarea[name="${field.selector}"], textarea#${field.selector}, select[name="${field.selector}"], select#${field.selector}`,
        String(field.value ?? "")
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`real-bbb-submit: could not fill "${field.selector}":`, message);
    }
  }

  if (decision.nextButton?.value?.trim()) {
    const buttonSelector = buildButtonSelector(decision.nextButton);
    try {
      if (decision.waitForNavigation) {
        await Promise.all([
          page.waitForNavigation({ timeout: 10000 }).catch(() => {
            console.warn("real-bbb-submit: navigation timeout after button click");
          }),
          page.click(buttonSelector),
        ]);
      } else {
        await page.click(buttonSelector);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn("real-bbb-submit: could not click button:", message);
    }
  }
}

async function fetchFormDecision(
  base: string,
  forwardedHeaders: Record<string, string>,
  pageData: AssistedFormPageData,
  userData: Record<string, unknown>
): Promise<
  | { ok: true; decision: FormDecision }
  | { ok: false; stopReason: "decide_action_failed" | "invalid_decision"; detail: string }
> {
  const res = await fetch(`${base}/api/decide-action`, {
    method: "POST",
    headers: forwardedHeaders,
    body: JSON.stringify({ pageData, userProfile: userData, userData }),
  });
  const payload = (await res.json().catch(() => ({}))) as {
    decision?: unknown;
    error?: string;
    raw?: string;
  };
  if (!res.ok) {
    return {
      ok: false,
      stopReason: "decide_action_failed",
      detail: [payload.error, payload.raw].filter(Boolean).join(" — ") || `decide-action failed (${res.status})`,
    };
  }
  const normalized = normalizeFormDecision(payload.decision);
  if (!normalized) {
    return {
      ok: false,
      stopReason: "invalid_decision",
      detail: "decide-action returned an invalid decision shape",
    };
  }
  return { ok: true, decision: normalized };
}

async function captureScreenshot(
  page: Page,
  supabase: SupabaseClient | null,
  storageConfigured: boolean
): Promise<{ screenshot: string | null; storageSkipped: boolean; storageReason?: string }> {
  if (!storageConfigured || !supabase) {
    return {
      screenshot: null,
      storageSkipped: true,
      storageReason: "Missing Supabase storage env vars",
    };
  }

  const screenshotName = `${uuidv4()}.png`;
  const screenshotPath = path.join(os.tmpdir(), screenshotName);
  await page.screenshot({ path: screenshotPath, fullPage: true, timeout: 60000 });
  const fileBuffer = fs.readFileSync(screenshotPath);
  const bucket = process.env.SUPABASE_BUCKET!;
  const { data: uploaded, error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(`screenshots/${screenshotName}`, fileBuffer, {
      contentType: "image/png",
      upsert: true,
    });
  if (uploadError) {
    throw new Error("Screenshot upload failed: " + uploadError.message);
  }
  return {
    screenshot: `${process.env.SUPABASE_URL}/storage/v1/object/public/${uploaded?.path}`,
    storageSkipped: false,
  };
}

async function persistSuccessfulSubmission(
  supabase: SupabaseClient,
  formUrl: string,
  pageData: AssistedFormPageData | null,
  screenshotUrl: string | null,
  stepLog: RealBbbBoundedSubmitStepLogEntry[]
): Promise<void> {
  const { error: dbError } = await supabase.from("submissions").insert({
    form_url: formUrl,
    submitted_data: { realBbbBoundedSubmit: true, stepLog },
    screenshot_url: screenshotUrl,
    full_page_context: pageData,
  });
  if (dbError) {
    throw new Error("Database insert failed: " + dbError.message);
  }
}

function buildIncompleteResult(
  stopReason: Exclude<RealBbbSubmitStopReason, "terminal_confirmation">,
  stepsExecuted: number,
  stepLog: RealBbbBoundedSubmitStepLogEntry[],
  pageData: AssistedFormPageData | null,
  screenshot: string | null,
  storageSkipped: boolean,
  storageReason?: string
): RealBbbBoundedSubmitIncompleteResult {
  const fillResult = {
    screenshot,
    pageData,
    stepsExecuted,
    stopReason,
    stepLog,
    ...(storageSkipped ? { storageSkipped: true, storageReason } : {}),
  };
  return {
    ok: false,
    error: buildRealBbbIncompleteError(stopReason, stepsExecuted),
    stopReason,
    stepsExecuted,
    fillResult,
    technicalDetails: {
      realBbbBoundedSubmit: true,
      stopReason,
      stepsExecuted,
      stepLog,
      finalUrl: pageData?.url ?? null,
      pageData,
    },
  };
}

/** Real BBB complaint: one browser session, bounded decide-action loop until terminal confirmation. */
export async function runRealBbbBoundedSubmit(
  params: RunRealBbbBoundedSubmitParams
): Promise<RealBbbBoundedSubmitResult> {
  const { url, userData, base, forwardedHeaders } = params;
  const playwrightMockLoop = isPlaywrightMockRealBbbBoundedSubmitLoopEnabled();
  const supabase = getSupabaseAdmin();
  if (!supabase && !playwrightMockLoop) {
    throw new Error("Supabase is not configured on this server.");
  }

  const storageConfigured =
    !playwrightMockLoop && !!(process.env.SUPABASE_BUCKET && process.env.SUPABASE_URL);
  const stepLog: RealBbbBoundedSubmitStepLogEntry[] = [];
  let stepsExecuted = 0;
  let browser: Browser | null = null;
  let page: Page | null = null;

  try {
    const browserlessUrl = process.env.BROWSERLESS_URL;
    if (browserlessUrl) {
      browser = await chromium.connectOverCDP(browserlessUrl);
    } else {
      browser = await chromium.launch({ headless: true });
    }

    const context = await browser.newContext(contextOptions());
    page = await context.newPage();
    const navigationUrl = resolvePlaywrightMockRealBbbBoundedSubmitNavigationUrl(url, base);
    await page.goto(navigationUrl, { timeout: 60000 });
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2000);

    while (!hasReachedStepCap(stepsExecuted)) {
      const pageData = await collectPageData(page);
      if (detectBoundedSubmitTerminalConfirmation(pageData)) {
        stepLog.push({
          step: stepsExecuted,
          url: pageData.url,
          action: "terminal_detected",
        });
        const capture = await captureScreenshot(page, supabase, storageConfigured);
        if (supabase && !playwrightMockLoop) {
          await persistSuccessfulSubmission(
            supabase,
            url,
            pageData,
            capture.screenshot,
            stepLog
          );
        }
        return {
          ok: true,
          fillResult: {
            status: "success",
            screenshot: capture.screenshot,
            pageData,
            stepsExecuted,
            stopReason: "terminal_confirmation",
            stepLog,
            ...(capture.storageSkipped || playwrightMockLoop
              ? {
                  storageSkipped: true,
                  storageReason:
                    capture.storageReason ??
                    "Playwright mock real BBB bounded submit loop (local E2E only)",
                }
              : {}),
          },
        };
      }

      const decisionResult = await fetchFormDecision(base, forwardedHeaders, pageData, userData);
      if (!decisionResult.ok) {
        stepLog.push({
          step: stepsExecuted,
          url: pageData.url,
          action: decisionResult.stopReason === "invalid_decision" ? "invalid_decision" : "decide_failed",
          detail: decisionResult.detail,
        });
        const capture = await captureScreenshot(page, supabase, storageConfigured).catch(() => ({
          screenshot: null,
          storageSkipped: true,
          storageReason: "Screenshot capture failed",
        }));
        return buildIncompleteResult(
          decisionResult.stopReason,
          stepsExecuted,
          stepLog,
          pageData,
          capture.screenshot,
          capture.storageSkipped,
          capture.storageReason
        );
      }

      const decision = decisionResult.decision;
      if (isEmptyFormDecision(decision)) {
        stepLog.push({ step: stepsExecuted, url: pageData.url, action: "empty_decision" });
        const capture = await captureScreenshot(page, supabase, storageConfigured).catch(() => ({
          screenshot: null,
          storageSkipped: true,
          storageReason: "Screenshot capture failed",
        }));
        return buildIncompleteResult(
          "empty_decision",
          stepsExecuted,
          stepLog,
          pageData,
          capture.screenshot,
          capture.storageSkipped,
          capture.storageReason
        );
      }

      stepLog.push({ step: stepsExecuted, url: pageData.url, action: "decide" });
      await applyFormDecision(page, decision);
      stepsExecuted += 1;
      stepLog.push({ step: stepsExecuted, url: page.url(), action: "apply" });
    }

    const finalPageData = await collectPageData(page);
    if (detectBoundedSubmitTerminalConfirmation(finalPageData)) {
      stepLog.push({
        step: stepsExecuted,
        url: finalPageData.url,
        action: "terminal_detected",
      });
      const capture = await captureScreenshot(page, supabase, storageConfigured);
      if (supabase && !playwrightMockLoop) {
        await persistSuccessfulSubmission(
          supabase,
          url,
          finalPageData,
          capture.screenshot,
          stepLog
        );
      }
      return {
        ok: true,
        fillResult: {
          status: "success",
          screenshot: capture.screenshot,
          pageData: finalPageData,
          stepsExecuted,
          stopReason: "terminal_confirmation",
          stepLog,
          ...(capture.storageSkipped || playwrightMockLoop
            ? {
                storageSkipped: true,
                storageReason:
                  capture.storageReason ??
                  "Playwright mock real BBB bounded submit loop (local E2E only)",
              }
            : {}),
        },
      };
    }

    const capture = await captureScreenshot(page, supabase, storageConfigured).catch(() => ({
      screenshot: null,
      storageSkipped: true,
      storageReason: "Screenshot capture failed",
    }));
    return buildIncompleteResult(
      "max_steps_reached",
      stepsExecuted,
      stepLog,
      finalPageData,
      capture.screenshot,
      capture.storageSkipped,
      capture.storageReason
    );
  } finally {
    try {
      if (browser) await browser.close();
    } catch (closeErr: unknown) {
      const message = closeErr instanceof Error ? closeErr.message : String(closeErr);
      console.warn("real-bbb-submit: browser close error:", message);
    }
  }
}

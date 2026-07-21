import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { chromium, type Browser, type Page } from "playwright";
import { v4 as uuidv4 } from "uuid";
import fs from "fs";
import os from "os";
import path from "path";
import {
  hasReachedStepCap,
  isEmptyFormDecision,
  type AssistedFormPageData,
} from "@/lib/justice/realBbbBoundedSubmitLoop";
import {
  buildRealFtcIncompleteError,
  detectRealFtcTerminalConfirmation,
  extractFtcConfirmationReference,
  REAL_FTC_MAX_SUBMIT_STEPS,
  type RealFtcSubmitStopReason,
} from "@/lib/justice/realFtcBoundedSubmitLoop";
import { resolveChromiumConnectionForRealBbbSubmit } from "@/lib/justice/bbbOwnedFilingProduction";
import {
  applyOwnedFilingFormDecision,
  parseOwnedFilingActionTimeoutOperation,
  OWNED_FILING_FTC_ACTION_TIMEOUT_MS,
} from "@/lib/justice/ownedFilingApplyDecision";
import {
  assertOwnedFilingPageAliveBeforeEvaluate,
  isOwnedFilingEvaluateTimeoutError,
  openOwnedFilingPlaywrightSession,
  replaceOwnedFilingPlaywrightSessionPage,
  waitForFtcReportFraudInteractiveReady,
  withOwnedFilingEvaluateLifecycle,
  withOwnedFilingEvaluateTimeout,
  type OwnedFilingPlaywrightSession,
} from "@/lib/justice/ownedFilingPlaywrightSession";
import { createOwnedFilingFtcStageTiming } from "@/lib/justice/ownedFilingFtcStageTiming";
import { fetchOwnedFilingFtcFormDecision } from "@/lib/justice/ownedFilingFtcDecision";
import { collectOwnedFilingFtcPageDataInBrowser } from "@/lib/justice/ownedFilingFtcPageData";

export type RealFtcBoundedSubmitStepLogEntry = {
  step: number;
  url: string;
  action:
    | "terminal_detected"
    | "decide"
    | "apply"
    | "decide_failed"
    | "invalid_decision"
    | "empty_decision"
    | "blocked_irreversible_click"
    | "blocked_unknown_click"
    | "submit_unarmed"
    | "exact_target_diagnostic"
    | "action_timeout";
  detail?: string;
};

export type RealFtcBoundedSubmitFillResult = {
  status: "success";
  screenshot: string | null;
  pageData: AssistedFormPageData | null;
  confirmationReference: string | null;
  storageSkipped?: boolean;
  storageReason?: string;
  stepsExecuted: number;
  stopReason: "terminal_confirmation";
  stepLog: RealFtcBoundedSubmitStepLogEntry[];
};

export type RealFtcBoundedSubmitIncompleteResult = {
  ok: false;
  error: string;
  stopReason: Exclude<RealFtcSubmitStopReason, "terminal_confirmation">;
  stepsExecuted: number;
  fillResult: {
    screenshot: string | null;
    pageData: AssistedFormPageData | null;
    storageSkipped?: boolean;
    storageReason?: string;
    stepsExecuted: number;
    stopReason: RealFtcSubmitStopReason;
    stepLog: RealFtcBoundedSubmitStepLogEntry[];
  };
  technicalDetails: Record<string, unknown>;
};

export type RealFtcBoundedSubmitSuccessResult = {
  ok: true;
  fillResult: RealFtcBoundedSubmitFillResult;
};

export type RealFtcBoundedSubmitResult =
  | RealFtcBoundedSubmitSuccessResult
  | RealFtcBoundedSubmitIncompleteResult;

export type RunRealFtcBoundedSubmitParams = {
  url: string;
  userData: Record<string, unknown>;
  base: string;
  forwardedHeaders: Record<string, string>;
  /**
   * `live` (default): irreversible clicks require OWNED_FILING_SUBMIT_ARMED.
   * `dry_run`: fills + safe navigation only; stops before irreversible/unknown clicks.
   */
  mode?: "live" | "dry_run";
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

/** Reads the live page URL without throwing if the target is mid-timeout; falls back to `fallback`. */
function readCurrentPageUrl(page: Page | null, fallback: string): string {
  try {
    return page?.url() ?? fallback;
  } catch {
    return fallback;
  }
}

async function collectPageData(
  page: Page,
  session: OwnedFilingPlaywrightSession,
  browser: Browser
): Promise<AssistedFormPageData> {
  return withOwnedFilingEvaluateLifecycle(session, browser, () =>
    withOwnedFilingEvaluateTimeout(() =>
      page.evaluate(collectOwnedFilingFtcPageDataInBrowser)
    )
  );
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
  confirmationReference: string | null,
  stepLog: RealFtcBoundedSubmitStepLogEntry[]
): Promise<void> {
  const { error: dbError } = await supabase.from("submissions").insert({
    form_url: formUrl,
    submitted_data: { realFtcBoundedSubmit: true, confirmationReference, stepLog },
    screenshot_url: screenshotUrl,
    full_page_context: pageData,
  });
  if (dbError) {
    throw new Error("Database insert failed: " + dbError.message);
  }
}

function buildIncompleteResult(
  stopReason: Exclude<RealFtcSubmitStopReason, "terminal_confirmation">,
  stepsExecuted: number,
  stepLog: RealFtcBoundedSubmitStepLogEntry[],
  pageData: AssistedFormPageData | null,
  screenshot: string | null,
  storageSkipped: boolean,
  storageReason?: string
): RealFtcBoundedSubmitIncompleteResult {
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
    error: buildRealFtcIncompleteError(stopReason, stepsExecuted),
    stopReason,
    stepsExecuted,
    fillResult,
    technicalDetails: {
      realFtcBoundedSubmit: true,
      stopReason,
      stepsExecuted,
      stepLog,
      finalUrl: pageData?.url ?? null,
      pageData,
    },
  };
}

/** Real FTC complaint: one browser session, bounded decide-action loop until terminal confirmation. */
export async function runRealFtcBoundedSubmit(
  params: RunRealFtcBoundedSubmitParams
): Promise<RealFtcBoundedSubmitResult> {
  const { url, userData, base, forwardedHeaders } = params;
  const mode = params.mode ?? "live";
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    throw new Error("Supabase is not configured on this server.");
  }

  const storageConfigured = !!(process.env.SUPABASE_BUCKET && process.env.SUPABASE_URL);
  const stepLog: RealFtcBoundedSubmitStepLogEntry[] = [];
  let stepsExecuted = 0;
  let browser: Browser | null = null;
  let page: Page | null = null;
  let playwrightSession: OwnedFilingPlaywrightSession | null = null;
  const stageTiming = createOwnedFilingFtcStageTiming();
  const getCloseSnapshot = () => {
    try {
      return playwrightSession?.snapshot() ?? null;
    } catch {
      return null;
    }
  };
  const withStageTimeline = (error: string): string => {
    const timeline = stageTiming.formatTimeline();
    if (!timeline || error.includes("stages=")) return error;
    return `${error} | ${timeline}`;
  };
  const finalizeIncomplete = (
    result: RealFtcBoundedSubmitIncompleteResult
  ): RealFtcBoundedSubmitIncompleteResult => {
    const timeline = stageTiming.formatTimeline();
    return {
      ...result,
      error: withStageTimeline(result.error),
      technicalDetails: {
        ...result.technicalDetails,
        ...(timeline ? { stage_timeline: timeline } : {}),
      },
    };
  };

  try {
    const chromiumConnection = resolveChromiumConnectionForRealBbbSubmit();
    if (chromiumConnection.mode === "unavailable") {
      throw new Error(chromiumConnection.error);
    }
    if (chromiumConnection.mode === "browserless") {
      browser = await stageTiming.run("connect_cdp", () =>
        chromium.connectOverCDP(chromiumConnection.url)
      );
    } else {
      browser = await stageTiming.run("connect_cdp", () => chromium.launch({ headless: true }));
    }

    playwrightSession = await stageTiming.run("open_session", () =>
      openOwnedFilingPlaywrightSession(browser!, {
        chromiumMode: chromiumConnection.mode,
        contextOptions: contextOptions(),
      })
    );
    page = playwrightSession.page;
    await stageTiming.run(
      "goto_1",
      () => page!.goto(url, { timeout: 60000, waitUntil: "domcontentloaded" }),
      getCloseSnapshot
    );

    assertOwnedFilingPageAliveBeforeEvaluate(playwrightSession, browser);
    await stageTiming.run(
      "ready_1",
      () => waitForFtcReportFraudInteractiveReady(page!),
      getCloseSnapshot
    );

    let firstEvaluateCompleted = false;
    let iteration = 0;

    while (!hasReachedStepCap(stepsExecuted, REAL_FTC_MAX_SUBMIT_STEPS)) {
      iteration += 1;
      const collect = () => collectPageData(page!, playwrightSession!, browser!);
      let pageData: AssistedFormPageData;
      if (firstEvaluateCompleted) {
        pageData = await stageTiming.run(`evaluate_${iteration}`, collect, getCloseSnapshot);
      } else {
        try {
          pageData = await stageTiming.run(`evaluate_${iteration}`, collect, getCloseSnapshot);
        } catch (err: unknown) {
          if (!isOwnedFilingEvaluateTimeoutError(err)) throw err;
          await stageTiming.run(
            "retry_replace",
            async () => {
              playwrightSession = await replaceOwnedFilingPlaywrightSessionPage(
                playwrightSession!,
                browser!
              );
              page = playwrightSession.page;
            },
            getCloseSnapshot
          );
          await stageTiming.run(
            "goto_retry",
            () => page!.goto(url, { timeout: 60000, waitUntil: "domcontentloaded" }),
            getCloseSnapshot
          );
          assertOwnedFilingPageAliveBeforeEvaluate(playwrightSession, browser!);
          await stageTiming.run(
            "ready_retry",
            () => waitForFtcReportFraudInteractiveReady(page!),
            getCloseSnapshot
          );
          pageData = await stageTiming.run("evaluate_retry", collect, getCloseSnapshot);
        }
        firstEvaluateCompleted = true;
      }
      if (detectRealFtcTerminalConfirmation(pageData)) {
        stepLog.push({ step: stepsExecuted, url: pageData.url, action: "terminal_detected" });
        const confirmationReference = extractFtcConfirmationReference(pageData.pageText);
        const capture = await captureScreenshot(page, supabase, storageConfigured);
        if (mode !== "dry_run") {
          await persistSuccessfulSubmission(
            supabase,
            url,
            pageData,
            capture.screenshot,
            confirmationReference,
            stepLog
          );
        }
        return {
          ok: true,
          fillResult: {
            status: "success",
            screenshot: capture.screenshot,
            pageData,
            confirmationReference,
            stepsExecuted,
            stopReason: "terminal_confirmation",
            stepLog,
            ...(capture.storageSkipped
              ? { storageSkipped: true, storageReason: capture.storageReason }
              : {}),
          },
        };
      }

      const fetchDecision = () =>
        fetchOwnedFilingFtcFormDecision(base, forwardedHeaders, pageData, userData);
      const decisionResult = await stageTiming.run(
        `decide_${iteration}`,
        fetchDecision,
        getCloseSnapshot
      );
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
        return finalizeIncomplete(
          buildIncompleteResult(
            decisionResult.stopReason,
            stepsExecuted,
            stepLog,
            pageData,
            capture.screenshot,
            capture.storageSkipped,
            capture.storageReason
          )
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
        return finalizeIncomplete(
          buildIncompleteResult(
            "empty_decision",
            stepsExecuted,
            stepLog,
            pageData,
            capture.screenshot,
            capture.storageSkipped,
            capture.storageReason
          )
        );
      }

      const buttonCorpus = decision.nextButton?.value?.trim()
        ? `${decision.nextButton.selectorType}:${decision.nextButton.value}`.slice(0, 200)
        : undefined;
      stepLog.push({
        step: stepsExecuted,
        url: pageData.url,
        action: "decide",
        ...(buttonCorpus ? { detail: buttonCorpus } : {}),
      });
      const applyDecision = () =>
        applyOwnedFilingFormDecision(page!, decision, {
          mode,
          logPrefix: "real-ftc-submit",
          actionTimeoutMs: OWNED_FILING_FTC_ACTION_TIMEOUT_MS,
          propagateCriticalErrors: true,
          useExactTextButtonLocator: true,
          currentPageUrl: pageData.url,
          enableFtcChoiceControls: true,
          actionableButtonLabels: pageData.buttons.map((button) => button.text),
        });
      let applyResult: Awaited<ReturnType<typeof applyDecision>>;
      try {
        applyResult = await stageTiming.run(`apply_${iteration}`, applyDecision, getCloseSnapshot);
      } catch (err: unknown) {
        const timedOutOperation = parseOwnedFilingActionTimeoutOperation(err);
        if (!timedOutOperation) throw err;
        // A bounded fill/check/click exceeded its limit. Preserve any earlier completed steps and
        // sanitized step log instead of discarding progress via an unattributed provider throw.
        const currentUrl = readCurrentPageUrl(page, pageData.url);
        stepLog.push({
          step: stepsExecuted,
          url: currentUrl,
          action: "action_timeout",
          detail: timedOutOperation,
        });
        const capture = await captureScreenshot(page, supabase, storageConfigured).catch(() => ({
          screenshot: null,
          storageSkipped: true,
          storageReason: "Screenshot capture failed",
        }));
        return finalizeIncomplete(
          buildIncompleteResult(
            "action_timeout",
            stepsExecuted,
            stepLog,
            { ...pageData, url: currentUrl },
            capture.screenshot,
            capture.storageSkipped,
            capture.storageReason
          )
        );
      }
      if (!applyResult.ok) {
        if (applyResult.diagnostic) {
          stepLog.push({
            step: stepsExecuted,
            url: pageData.url,
            action: "exact_target_diagnostic",
            detail: applyResult.diagnostic,
          });
        }
        const stopReason =
          applyResult.reason === "unknown_fail_closed"
            ? "blocked_unknown_click"
            : applyResult.reason === "unarmed_live"
              ? "submit_unarmed"
              : "blocked_irreversible_click";
        stepLog.push({
          step: stepsExecuted,
          url: pageData.url,
          action: stopReason,
          detail: applyResult.buttonLabel,
        });
        const capture = await captureScreenshot(page, supabase, storageConfigured).catch(() => ({
          screenshot: null,
          storageSkipped: true,
          storageReason: "Screenshot capture failed",
        }));
        return finalizeIncomplete(
          buildIncompleteResult(
            stopReason,
            stepsExecuted,
            stepLog,
            pageData,
            capture.screenshot,
            capture.storageSkipped,
            capture.storageReason
          )
        );
      }
      stepsExecuted += 1;
      stepLog.push({
        step: stepsExecuted,
        url: page.url(),
        action: "apply",
        ...(buttonCorpus ? { detail: buttonCorpus } : {}),
      });
    }

    const finalPageData = await collectPageData(page, playwrightSession, browser);
    if (detectRealFtcTerminalConfirmation(finalPageData)) {
      stepLog.push({ step: stepsExecuted, url: finalPageData.url, action: "terminal_detected" });
      const confirmationReference = extractFtcConfirmationReference(finalPageData.pageText);
      const capture = await captureScreenshot(page, supabase, storageConfigured);
      if (mode !== "dry_run") {
        await persistSuccessfulSubmission(
          supabase,
          url,
          finalPageData,
          capture.screenshot,
          confirmationReference,
          stepLog
        );
      }
      return {
        ok: true,
        fillResult: {
          status: "success",
          screenshot: capture.screenshot,
          pageData: finalPageData,
          confirmationReference,
          stepsExecuted,
          stopReason: "terminal_confirmation",
          stepLog,
          ...(capture.storageSkipped
            ? { storageSkipped: true, storageReason: capture.storageReason }
            : {}),
        },
      };
    }

    const capture = await captureScreenshot(page, supabase, storageConfigured).catch(() => ({
      screenshot: null,
      storageSkipped: true,
      storageReason: "Screenshot capture failed",
    }));
    return finalizeIncomplete(
      buildIncompleteResult(
        "max_steps_reached",
        stepsExecuted,
        stepLog,
        finalPageData,
        capture.screenshot,
        capture.storageSkipped,
        capture.storageReason
      )
    );
  } catch (err: unknown) {
    throw stageTiming.attachToError(err);
  } finally {
    playwrightSession?.disposeListeners();
    try {
      if (browser) await browser.close();
    } catch (closeErr: unknown) {
      const message = closeErr instanceof Error ? closeErr.message : String(closeErr);
      console.warn("real-ftc-submit: browser close error:", message);
    }
  }
}

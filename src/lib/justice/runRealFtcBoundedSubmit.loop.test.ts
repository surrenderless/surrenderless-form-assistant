import { beforeEach, describe, expect, it, vi } from "vitest";
import { formatOwnedFilingDryRunStepLog } from "@/lib/justice/ownedFilingDryRunState";

/**
 * Integration coverage for the FTC bounded-submit loop persistence behavior. Playwright, the
 * session helpers, decide-action, Supabase, and the apply gate are mocked so the test drives the
 * loop's staging + progress-preservation logic deterministically. Stage timing is intentionally
 * real so the timeline attribution is exercised end to end.
 */
const h = vi.hoisted(() => {
  const state = {
    evaluateQueue: [] as unknown[],
    decideQueue: [] as unknown[],
    applyQueue: [] as Array<{ error?: Error; result?: unknown }>,
    currentUrl: "https://reportfraud.ftc.gov/#/form",
  };
  const page = {
    url: () => state.currentUrl,
    evaluate: async () => state.evaluateQueue.shift(),
    goto: async () => undefined,
    screenshot: async () => undefined,
    fill: async () => undefined,
    click: async () => undefined,
    waitForNavigation: async () => undefined,
  };
  const session = {
    page,
    context: {},
    snapshot: () => ({
      first_close_event: "none",
      browser_connected: true,
      page_closed: false,
      elapsed_ms: 1,
    }),
    disposeListeners: vi.fn(),
  };
  const browser = { close: vi.fn(async () => undefined) };
  return { state, page, session, browser };
});

vi.mock("playwright", () => ({
  chromium: {
    connectOverCDP: vi.fn(async () => h.browser),
    launch: vi.fn(async () => h.browser),
  },
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    from: () => ({ insert: async () => ({ error: null }) }),
  })),
}));

vi.mock("@/lib/justice/bbbOwnedFilingProduction", () => ({
  resolveChromiumConnectionForRealBbbSubmit: () => ({ mode: "browserless", url: "ws://fake" }),
}));

vi.mock("@/lib/justice/ownedFilingPlaywrightSession", () => ({
  openOwnedFilingPlaywrightSession: vi.fn(async () => h.session),
  assertOwnedFilingPageAliveBeforeEvaluate: vi.fn(),
  waitForFtcReportFraudInteractiveReady: vi.fn(async () => undefined),
  withOwnedFilingEvaluateLifecycle: vi.fn(
    async (_s: unknown, _b: unknown, fn: () => Promise<unknown>) => fn()
  ),
  withOwnedFilingEvaluateTimeout: vi.fn(async (fn: () => Promise<unknown>) => fn()),
  replaceOwnedFilingPlaywrightSessionPage: vi.fn(async (s: unknown) => s),
  isOwnedFilingEvaluateTimeoutError: vi.fn(() => false),
}));

vi.mock("@/lib/justice/ownedFilingFtcDecision", () => ({
  fetchOwnedFilingFtcFormDecision: vi.fn(async () => h.state.decideQueue.shift()),
}));

vi.mock("@/lib/justice/ownedFilingApplyDecision", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/justice/ownedFilingApplyDecision")>();
  return {
    ...actual,
    applyOwnedFilingFormDecision: vi.fn(async () => {
      const next = h.state.applyQueue.shift();
      if (next?.error) throw next.error;
      return next?.result;
    }),
  };
});

import { runRealFtcBoundedSubmit } from "@/lib/justice/runRealFtcBoundedSubmit";

const SECRET = "SENSITIVE_CASE_SECRET";

function pageData(url = "https://reportfraud.ftc.gov/#/form") {
  return { fields: [], buttons: [], url, pageText: "" };
}
function decideContinue() {
  return {
    ok: true,
    decision: { fieldsToFill: [], nextButton: { selectorType: "text", value: "Continue" } },
  };
}
function applyOk() {
  return { ok: true, clicked: true, risk: "safe" };
}
function runParams(userDataExtra: Record<string, unknown> = {}) {
  return {
    url: "https://reportfraud.ftc.gov/",
    userData: { reply_email: "pat@example.com", ...userDataExtra },
    base: "http://localhost:3000",
    forwardedHeaders: {},
    mode: "dry_run" as const,
  };
}

describe("runRealFtcBoundedSubmit loop persistence", () => {
  beforeEach(() => {
    h.state.evaluateQueue = [];
    h.state.decideQueue = [];
    h.state.applyQueue = [];
    h.state.currentUrl = "https://reportfraud.ftc.gov/#/form";
    vi.unstubAllEnvs();
    // Supabase admin must construct; storage stays unconfigured so screenshots are skipped.
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://supabase.example");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role");
    vi.stubEnv("SUPABASE_BUCKET", "");
    vi.stubEnv("SUPABASE_URL", "");
  });

  it("returns steps_executed=1 when the first safe apply succeeds and the second fill times out", async () => {
    h.state.evaluateQueue = [pageData(), pageData()];
    h.state.decideQueue = [decideContinue(), decideContinue()];
    h.state.applyQueue = [
      { result: applyOk() },
      { error: new Error("owned-filing action_timeout:fill after 20000ms") },
    ];

    const result = await runRealFtcBoundedSubmit(runParams());

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected incomplete result");
    expect(result.stopReason).toBe("action_timeout");
    expect(result.stepsExecuted).toBe(1);
    expect(result.fillResult.stepsExecuted).toBe(1);
  });

  it("attributes a second-iteration click timeout to apply_2:action_timeout:click", async () => {
    h.state.evaluateQueue = [pageData(), pageData()];
    h.state.decideQueue = [decideContinue(), decideContinue()];
    h.state.applyQueue = [
      { result: applyOk() },
      { error: new Error("owned-filing action_timeout:click after 20000ms") },
    ];

    const result = await runRealFtcBoundedSubmit(runParams());

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected incomplete result");
    expect(result.error).toMatch(/apply_1:\d+ms:ok/);
    expect(result.error).toMatch(/apply_2:\d+ms:fail:action_timeout:click/);
    expect(result.technicalDetails.stage_timeline).toMatch(
      /apply_2:\d+ms:fail:action_timeout:click/
    );
    const timeoutEntry = result.fillResult.stepLog.find((e) => e.action === "action_timeout");
    expect(timeoutEntry?.detail).toBe("click");
  });

  it("attributes a bounded choice timeout to apply_1:action_timeout:check", async () => {
    h.state.evaluateQueue = [pageData()];
    h.state.decideQueue = [decideContinue()];
    h.state.applyQueue = [
      { error: new Error("owned-filing action_timeout:check after 20000ms") },
    ];

    const result = await runRealFtcBoundedSubmit(runParams());

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected incomplete result");
    expect(result.technicalDetails.stage_timeline).toMatch(
      /apply_1:\d+ms:fail:action_timeout:check/
    );
    expect(result.fillResult.stepLog.find((entry) => entry.action === "action_timeout")?.detail)
      .toBe("check");
  });

  it("preserves the completed first-step log across an incomplete timeout return", async () => {
    h.state.evaluateQueue = [pageData(), pageData()];
    h.state.decideQueue = [decideContinue(), decideContinue()];
    h.state.applyQueue = [
      { result: applyOk() },
      { error: new Error("owned-filing action_timeout:fill after 20000ms") },
    ];

    const result = await runRealFtcBoundedSubmit(runParams());
    if (result.ok) throw new Error("expected incomplete result");

    const actions = result.fillResult.stepLog.map((e) => e.action);
    expect(actions).toContain("decide");
    expect(actions).toContain("apply");
    expect(actions).toContain("action_timeout");
    const applyEntry = result.fillResult.stepLog.find((e) => e.action === "apply");
    expect(applyEntry?.detail).toBe("text:Continue");
  });

  it("still blocks an irreversible Submit in dry-run without counting a step", async () => {
    h.state.evaluateQueue = [pageData()];
    h.state.decideQueue = [
      { ok: true, decision: { nextButton: { selectorType: "text", value: "Submit complaint" } } },
    ];
    h.state.applyQueue = [
      {
        result: {
          ok: false,
          blocked: true,
          risk: "irreversible",
          buttonLabel: "text:Submit complaint",
          reason: "dry_run_stop",
        },
      },
    ];

    const result = await runRealFtcBoundedSubmit(runParams());

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected incomplete result");
    expect(result.stopReason).toBe("blocked_irreversible_click");
    expect(result.stepsExecuted).toBe(0);
  });

  it("persists only sanitized exact-target diagnostics before failing closed", async () => {
    h.state.evaluateQueue = [
      {
        ...pageData("https://reportfraud.ftc.gov/assistant"),
        buttons: [{ text: "Continue", id: "", name: "", type: "button" }],
      },
    ];
    h.state.decideQueue = [decideContinue()];
    h.state.applyQueue = [
      {
        result: {
          ok: false,
          blocked: true,
          risk: "unknown",
          buttonLabel: "text:Continue",
          reason: "unknown_fail_closed",
          diagnostic: "target=continue,count=0,visible=na,enabled=na,labels=Continue",
        },
      },
    ];

    const result = await runRealFtcBoundedSubmit(runParams({ story: SECRET }));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected incomplete result");
    const diagnostic = result.fillResult.stepLog.find(
      (entry) => entry.action === "exact_target_diagnostic"
    );
    expect(diagnostic?.detail).toBe(
      "target=continue,count=0,visible=na,enabled=na,labels=Continue"
    );
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it("keeps sensitive field values and case content out of diagnostics", async () => {
    h.state.evaluateQueue = [pageData(), pageData()];
    h.state.decideQueue = [
      {
        ok: true,
        decision: {
          fieldsToFill: [{ selector: "story", value: SECRET }],
          nextButton: { selectorType: "text", value: "Continue" },
        },
      },
      decideContinue(),
    ];
    h.state.applyQueue = [
      { result: applyOk() },
      { error: new Error("owned-filing action_timeout:click after 20000ms") },
    ];

    const result = await runRealFtcBoundedSubmit(runParams({ story: SECRET }));
    if (result.ok) throw new Error("expected incomplete result");

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(SECRET);
    const persistedStepLog = formatOwnedFilingDryRunStepLog(result.fillResult.stepLog);
    expect(persistedStepLog).not.toContain(SECRET);
    expect(persistedStepLog).toContain("action_timeout|click|");
  });
});

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

import { fetchOwnedFilingFtcFormDecision } from "@/lib/justice/ownedFilingFtcDecision";
import { applyOwnedFilingFormDecision } from "@/lib/justice/ownedFilingApplyDecision";
import { runRealFtcBoundedSubmit } from "@/lib/justice/runRealFtcBoundedSubmit";

const SECRET = "SENSITIVE_CASE_SECRET";
const mockedFetchDecision = vi.mocked(fetchOwnedFilingFtcFormDecision);
const mockedApplyDecision = vi.mocked(applyOwnedFilingFormDecision);

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
    mockedFetchDecision.mockClear();
    mockedApplyDecision.mockClear();
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
        ...pageData("https://reportfraud.ftc.gov/form/main"),
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
          diagnostic:
            "target=continue,count=0,visible=na,enabled=na,phase=precheck_ambiguous,labels=Continue",
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
      "target=continue,count=0,visible=na,enabled=na,phase=precheck_ambiguous,labels=Continue"
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

  it("bypasses decide-action on the FTC entry URL and applies Report Now", async () => {
    h.state.evaluateQueue = [
      pageData("https://reportfraud.ftc.gov/"),
      {
        ...pageData("https://reportfraud.ftc.gov/assistant"),
        choiceControls: [
          {
            source: "native",
            kind: "radio",
            name: "category",
            id: "cat-radio-2",
            optionValue: "Online shopping",
            accessibleName: "Online shopping",
            visible: false,
            enabled: true,
          },
        ],
      },
    ];
    h.state.decideQueue = [];
    h.state.applyQueue = [
      { result: applyOk() },
      {
        result: {
          ok: false,
          blocked: true,
          risk: "unknown",
          buttonLabel: "text:Continue",
          reason: "unknown_fail_closed",
        },
      },
    ];
    h.state.currentUrl = "https://reportfraud.ftc.gov/";

    const result = await runRealFtcBoundedSubmit(
      runParams({ issue_type: "online purchase" })
    );

    // Entry and assistant both skip decide-action.
    expect(mockedFetchDecision).not.toHaveBeenCalled();
    expect(mockedApplyDecision.mock.calls[0]?.[1]).toEqual({
      nextButton: { selectorType: "text", value: "Report Now" },
      waitForNavigation: true,
    });
    expect(mockedApplyDecision.mock.calls[1]?.[1]).toEqual({
      fieldsToFill: [
        {
          selector: "cat-radio-2",
          value: "Online shopping",
          controlKind: "radio",
          choiceSelectorType: "id",
        },
      ],
      nextButton: { selectorType: "text", value: "Continue" },
      waitForNavigation: true,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected incomplete after second step");
    expect(result.stepsExecuted).toBe(1);
    expect(result.fillResult.stepLog.find((e) => e.action === "decide")?.detail).toBe(
      "text:Report Now"
    );
  });

  it("bypasses decide-action on /assistant and applies the matched choice", async () => {
    h.state.evaluateQueue = [
      {
        ...pageData("https://reportfraud.ftc.gov/assistant"),
        choiceControls: [
          {
            source: "native",
            kind: "radio",
            name: "category",
            id: "cat-radio-11",
            optionValue: "Something else",
            accessibleName: "Something else",
            visible: false,
            enabled: true,
          },
        ],
      },
      pageData("https://reportfraud.ftc.gov/form/main"),
    ];
    h.state.decideQueue = [
      {
        ok: false,
        stopReason: "decide_action_failed",
        detail: "decide-action failed (500)",
      },
    ];
    h.state.applyQueue = [{ result: applyOk() }];

    const result = await runRealFtcBoundedSubmit(
      runParams({ issue_type: "something else" })
    );

    expect(mockedFetchDecision).toHaveBeenCalledTimes(1);
    expect(mockedApplyDecision.mock.calls[0]?.[1]).toMatchObject({
      fieldsToFill: [
        {
          selector: "cat-radio-11",
          value: "Something else",
          controlKind: "radio",
          choiceSelectorType: "id",
        },
      ],
      nextButton: { selectorType: "text", value: "Continue" },
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected incomplete");
    expect(result.stepsExecuted).toBe(1);
    expect(result.stopReason).toBe("decide_action_failed");
  });

  it("fails closed on /assistant when no unique choice matches issue_type", async () => {
    h.state.evaluateQueue = [
      {
        ...pageData("https://reportfraud.ftc.gov/assistant"),
        choiceControls: [
          {
            source: "native",
            kind: "radio",
            name: "category",
            id: "cat-radio-2",
            optionValue: "Online shopping",
            accessibleName: "Online shopping",
            visible: false,
            enabled: true,
          },
        ],
      },
    ];
    h.state.decideQueue = [decideContinue()];
    h.state.applyQueue = [{ result: applyOk() }];

    const result = await runRealFtcBoundedSubmit(
      runParams({ issue_type: "charge dispute" })
    );

    expect(mockedFetchDecision).not.toHaveBeenCalled();
    expect(mockedApplyDecision).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected incomplete");
    expect(result.stopReason).toBe("invalid_decision");
    expect(result.stepsExecuted).toBe(0);
  });

  it("still calls decide-action on FTC form/main", async () => {
    h.state.evaluateQueue = [
      pageData("https://reportfraud.ftc.gov/form/main"),
      pageData("https://reportfraud.ftc.gov/form/main"),
    ];
    h.state.decideQueue = [
      decideContinue(),
      {
        ok: false,
        stopReason: "decide_action_failed",
        detail: "decide-action failed (500)",
      },
    ];
    h.state.applyQueue = [{ result: applyOk() }];

    const result = await runRealFtcBoundedSubmit(runParams());

    expect(mockedFetchDecision).toHaveBeenCalled();
    expect(mockedApplyDecision.mock.calls[0]?.[1]).toEqual({
      fieldsToFill: [],
      nextButton: { selectorType: "text", value: "Continue" },
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected incomplete");
    expect(result.stepsExecuted).toBe(1);
  });

  it("does not inject Report Now for a non-FTC URL pageData", async () => {
    h.state.evaluateQueue = [pageData("https://example.com/")];
    h.state.decideQueue = [decideContinue()];
    h.state.applyQueue = [
      {
        result: {
          ok: false,
          blocked: true,
          risk: "unknown",
          buttonLabel: "text:Continue",
          reason: "unknown_fail_closed",
        },
      },
    ];

    await runRealFtcBoundedSubmit(runParams());

    expect(mockedFetchDecision).toHaveBeenCalled();
    expect(mockedApplyDecision.mock.calls[0]?.[1]).toEqual({
      fieldsToFill: [],
      nextButton: { selectorType: "text", value: "Continue" },
    });
    expect(JSON.stringify(mockedApplyDecision.mock.calls[0]?.[1])).not.toContain("Report Now");
  });

  it("keeps dry-run Submit blocking after entry and assistant deterministic steps", async () => {
    h.state.evaluateQueue = [
      pageData("https://reportfraud.ftc.gov/"),
      {
        ...pageData("https://reportfraud.ftc.gov/assistant"),
        choiceControls: [
          {
            source: "native",
            kind: "radio",
            name: "category",
            id: "cat-radio-2",
            optionValue: "Online shopping",
            accessibleName: "Online shopping",
            visible: false,
            enabled: true,
            checked: false,
          },
        ],
      },
      pageData("https://reportfraud.ftc.gov/form/main"),
    ];
    h.state.decideQueue = [
      {
        ok: true,
        decision: { nextButton: { selectorType: "text", value: "Submit complaint" } },
      },
    ];
    h.state.applyQueue = [
      { result: applyOk() },
      { result: applyOk() },
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

    const result = await runRealFtcBoundedSubmit(
      runParams({ issue_type: "online purchase" })
    );

    expect(mockedFetchDecision).toHaveBeenCalledTimes(1);
    expect(mockedApplyDecision.mock.calls[0]?.[1]).toMatchObject({
      nextButton: { value: "Report Now" },
    });
    expect(mockedApplyDecision.mock.calls[1]?.[1]).toMatchObject({
      fieldsToFill: [{ selector: "cat-radio-2", controlKind: "radio" }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected incomplete");
    expect(result.stopReason).toBe("blocked_irreversible_click");
    expect(result.stepsExecuted).toBe(2);
  });

  it("progresses root Report Now → parent once → Continue-only → /form/main without re-selecting", async () => {
    h.state.evaluateQueue = [
      pageData("https://reportfraud.ftc.gov/"),
      {
        ...pageData("https://reportfraud.ftc.gov/assistant"),
        choiceControls: [
          {
            source: "native",
            kind: "radio",
            name: "category",
            id: "cat-radio-2",
            optionValue: "Online shopping",
            accessibleName: "Online shopping",
            visible: false,
            enabled: true,
            checked: false,
          },
        ],
      },
      {
        ...pageData("https://reportfraud.ftc.gov/assistant"),
        buttons: [{ text: "Continue", id: "", name: "", type: "button" }],
        choiceControls: [
          {
            source: "native",
            kind: "radio",
            name: "category",
            id: "cat-radio-2",
            optionValue: "Online shopping",
            accessibleName: "Online shopping",
            visible: false,
            enabled: true,
            checked: true,
          },
        ],
      },
      pageData("https://reportfraud.ftc.gov/form/main"),
    ];
    h.state.decideQueue = [
      {
        ok: false,
        stopReason: "decide_action_failed",
        detail: "decide-action failed (500)",
      },
    ];
    h.state.applyQueue = [{ result: applyOk() }, { result: applyOk() }, { result: applyOk() }];

    const result = await runRealFtcBoundedSubmit(
      runParams({ issue_type: "online purchase" })
    );

    expect(mockedFetchDecision).toHaveBeenCalledTimes(1);
    expect(mockedApplyDecision.mock.calls.map((call) => call[1])).toEqual([
      {
        nextButton: { selectorType: "text", value: "Report Now" },
        waitForNavigation: true,
      },
      {
        fieldsToFill: [
          {
            selector: "cat-radio-2",
            value: "Online shopping",
            controlKind: "radio",
            choiceSelectorType: "id",
          },
        ],
        nextButton: { selectorType: "text", value: "Continue" },
        waitForNavigation: true,
      },
      {
        nextButton: { selectorType: "text", value: "Continue" },
        waitForNavigation: true,
      },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected incomplete");
    expect(result.stepsExecuted).toBe(3);
    expect(result.stopReason).toBe("decide_action_failed");
  });

  it("progresses parent → unique subcategory when Continue is disabled, then reaches /form/main", async () => {
    h.state.evaluateQueue = [
      {
        ...pageData("https://reportfraud.ftc.gov/assistant"),
        buttons: [],
        choiceControls: [
          {
            source: "native",
            kind: "radio",
            name: "category",
            id: "cat-radio-2",
            optionValue: "Online shopping",
            accessibleName: "Online shopping",
            visible: false,
            enabled: true,
            checked: true,
          },
          {
            source: "native",
            kind: "radio",
            name: "subcategory",
            id: "sub-radio-1",
            optionValue: "Item never arrived",
            accessibleName: "Item never arrived",
            visible: true,
            enabled: true,
            checked: false,
          },
        ],
      },
      {
        ...pageData("https://reportfraud.ftc.gov/assistant"),
        buttons: [{ text: "Continue", id: "", name: "", type: "button" }],
        choiceControls: [
          {
            source: "native",
            kind: "radio",
            name: "category",
            id: "cat-radio-2",
            optionValue: "Online shopping",
            accessibleName: "Online shopping",
            visible: false,
            enabled: true,
            checked: true,
          },
          {
            source: "native",
            kind: "radio",
            name: "subcategory",
            id: "sub-radio-1",
            optionValue: "Item never arrived",
            accessibleName: "Item never arrived",
            visible: true,
            enabled: true,
            checked: true,
          },
        ],
      },
      pageData("https://reportfraud.ftc.gov/form/main"),
    ];
    h.state.decideQueue = [
      {
        ok: false,
        stopReason: "decide_action_failed",
        detail: "decide-action failed (500)",
      },
    ];
    h.state.applyQueue = [{ result: applyOk() }, { result: applyOk() }];

    const result = await runRealFtcBoundedSubmit(
      runParams({ issue_type: "online purchase" })
    );

    expect(mockedFetchDecision).toHaveBeenCalledTimes(1);
    expect(mockedApplyDecision.mock.calls[0]?.[1]).toMatchObject({
      fieldsToFill: [{ selector: "sub-radio-1", controlKind: "radio" }],
    });
    expect(mockedApplyDecision.mock.calls[1]?.[1]).toEqual({
      nextButton: { selectorType: "text", value: "Continue" },
      waitForNavigation: true,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected incomplete");
    expect(result.stepsExecuted).toBe(2);
    expect(result.stopReason).toBe("decide_action_failed");
  });
});

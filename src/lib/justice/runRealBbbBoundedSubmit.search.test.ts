import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Loop coverage for the deterministic BBB business-search step. Playwright, the session helpers,
 * Supabase, and the apply gate are mocked; decide-action is a stubbed fetch so the test can prove
 * the search step never consults the model and still fails closed before any click.
 */
const h = vi.hoisted(() => {
  const state = {
    evaluateQueue: [] as unknown[],
    applyQueue: [] as Array<{ error?: Error; result?: unknown }>,
    currentUrl: "https://www.bbb.org/file-a-complaint",
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

vi.mock("@/lib/justice/ownedFilingPlaywrightSession", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/justice/ownedFilingPlaywrightSession")>();
  return {
    ...actual,
    openOwnedFilingPlaywrightSession: vi.fn(async () => h.session),
    assertOwnedFilingPageAliveBeforeEvaluate: vi.fn(),
    gotoOwnedFilingPage: vi.fn(async () => undefined),
    waitForBbbComplainPortalInteractiveReady: vi.fn(async () => ({ ready_signal: "start_complaint" })),
    withOwnedFilingEvaluateLifecycle: vi.fn(
      async (_s: unknown, _b: unknown, fn: () => Promise<unknown>) => fn()
    ),
    withOwnedFilingEvaluateTimeout: vi.fn(async (fn: () => Promise<unknown>) => fn()),
    closeOwnedFilingBrowserFailClosed: vi.fn(async () => undefined),
    destroyOwnedFilingBrowserBestEffort: vi.fn(async () => undefined),
  };
});

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

import { applyOwnedFilingFormDecision } from "@/lib/justice/ownedFilingApplyDecision";
import { runRealBbbBoundedSubmit } from "@/lib/justice/runRealBbbBoundedSubmit";

const SEARCH_URL =
  "https://www.bbb.org/file-a-complaint/search?find_country=USA&find_text=Fictional%20Digital%20Services&page=1&touched=1";
const mockedApply = vi.mocked(applyOwnedFilingFormDecision);

function searchPage(results: unknown[]) {
  return { fields: [], buttons: [], url: SEARCH_URL, pageText: "", bbbSearchResults: results };
}

function resultCard(overrides: Record<string, unknown> = {}) {
  return {
    kind: "link",
    text: "",
    headingText: "",
    id: "",
    name: "",
    visible: true,
    enabled: true,
    ...overrides,
  };
}

function runParams(userDataExtra: Record<string, unknown> = {}) {
  return {
    url: "https://www.bbb.org/complain",
    userData: { business_name: "Fictional Digital Services", ...userDataExtra },
    base: "http://localhost:3000",
    forwardedHeaders: {},
    mode: "dry_run" as const,
  };
}

function stubDecideAction(...bodies: unknown[]) {
  const queue = [...bodies];
  const fetchMock = vi.fn(async () => {
    const body = queue.shift() ?? {};
    return {
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("runRealBbbBoundedSubmit business-search step", () => {
  beforeEach(() => {
    h.state.evaluateQueue = [];
    h.state.applyQueue = [];
    h.state.currentUrl = SEARCH_URL;
    mockedApply.mockClear();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://supabase.example");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role");
    vi.stubEnv("SUPABASE_BUCKET", "");
    vi.stubEnv("SUPABASE_URL", "");
  });

  it("reproduces the production zero-result run: fails closed without calling decide-action", async () => {
    const fetchMock = stubDecideAction({ decision: { nextButton: { selectorType: "text", value: "x" } } });
    h.state.evaluateQueue = [searchPage([])];

    const result = await runRealBbbBoundedSubmit(runParams());

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected incomplete result");
    expect(result.stopReason).toBe("blocked_unknown_click");
    expect(result.stepsExecuted).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockedApply).not.toHaveBeenCalled();
    expect(result.fillResult.stepLog.at(-1)).toMatchObject({
      action: "blocked_unknown_click",
      url: SEARCH_URL,
      detail: "search_no_results_identity_incomplete results=0 matches=0",
    });
  });

  it("fails closed on ambiguous results with sanitized counts and no click", async () => {
    stubDecideAction({});
    h.state.evaluateQueue = [
      searchPage([
        resultCard({ id: "r1", headingText: "Fictional Digital Services" }),
        resultCard({ id: "r2", headingText: "Fictional Digital Services" }),
      ]),
    ];

    const result = await runRealBbbBoundedSubmit(runParams());

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected incomplete result");
    expect(result.stopReason).toBe("blocked_unknown_click");
    expect(mockedApply).not.toHaveBeenCalled();
    expect(result.fillResult.stepLog.at(-1)?.detail).toBe(
      "search_result_ambiguous results=2 matches=2"
    );
  });

  it("selects the single exact match, then stops at the true Submit without clicking it", async () => {
    stubDecideAction({
      decision: { fieldsToFill: [], nextButton: { selectorType: "text", value: "Submit Complaint" } },
    });
    const wizardUrl = "https://www.bbb.org/file-a-complaint/wizard/review";
    h.state.evaluateQueue = [
      searchPage([
        resultCard({ id: "r1", headingText: "Fictional Digital Services" }),
        resultCard({ id: "r2", headingText: "Another Business" }),
      ]),
      { fields: [], buttons: [{ text: "Submit Complaint", id: "", name: "", type: "submit" }], url: wizardUrl, pageText: "" },
    ];
    h.state.applyQueue = [
      { result: { ok: true, clicked: true, risk: "safe" } },
      {
        result: {
          ok: false,
          blocked: true,
          risk: "irreversible",
          buttonLabel: "text:Submit Complaint",
          reason: "dry_run_stop",
        },
      },
    ];

    const result = await runRealBbbBoundedSubmit(runParams());

    expect(mockedApply.mock.calls[0]?.[1]).toEqual({
      fieldsToFill: [],
      nextButton: { selectorType: "id", value: "r1" },
      waitForNavigation: true,
    });
    expect(mockedApply.mock.calls[0]?.[2]).toMatchObject({ currentPageUrl: SEARCH_URL });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected incomplete result");
    expect(result.stopReason).toBe("blocked_irreversible_click");
    expect(result.stepsExecuted).toBe(1);
    expect(result.fillResult.stepLog.at(-1)).toMatchObject({
      action: "blocked_irreversible_click",
      detail: "text:Submit Complaint",
    });
  });

  it("still uses generic decide-action off the search step, and rejects malformed decisions", async () => {
    const fetchMock = stubDecideAction({ action: "click_result", target: "first" });
    h.state.currentUrl = "https://www.bbb.org/file-a-complaint";
    h.state.evaluateQueue = [
      { fields: [], buttons: [], url: "https://www.bbb.org/file-a-complaint", pageText: "" },
    ];

    const result = await runRealBbbBoundedSubmit(runParams());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected incomplete result");
    expect(result.stopReason).toBe("invalid_decision");
    expect(mockedApply).not.toHaveBeenCalled();
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import type { Browser, BrowserContext, Page } from "playwright";
import {
  abortOwnedFilingPageEvaluate,
  assertOwnedFilingPageAliveBeforeEvaluate,
  closeOwnedFilingBrowserFailClosed,
  enrichOwnedFilingTargetClosedError,
  formatOwnedFilingLifecycleDetail,
  gotoOwnedFilingPage,
  isOwnedFilingClosedTargetProviderError,
  isOwnedFilingEvaluateTimeoutError,
  isOwnedFilingNavigationTimeoutError,
  isOwnedFilingBbbReadyTimeoutError,
  isOwnedFilingBbbComplainPortalPath,
  evaluateOwnedFilingBbbPortalReady,
  shouldRevealBbbStartComplaintViaGoal,
  collectOwnedFilingBbbReadyDomInBrowser,
  OWNED_FILING_BBB_COMPLAINT_GOAL_RE,
  openOwnedFilingPlaywrightSession,
  OWNED_FILING_BROWSER_CLOSE_TIMEOUT_MS,
  OWNED_FILING_BBB_READY_WAIT_MS,
  OWNED_FILING_FTC_READY_SELECTOR,
  OWNED_FILING_FTC_READY_WAIT_MS,
  OWNED_FILING_PAGE_EVALUATE_TIMEOUT_MS,
  OWNED_FILING_PAGE_NAVIGATION_TIMEOUT_MS,
  OwnedFilingEvaluateTimeoutError,
  OwnedFilingNavigationTimeoutError,
  OwnedFilingBbbReadyTimeoutError,
  replaceOwnedFilingPlaywrightSessionPage,
  waitForBbbComplainPortalInteractiveReady,
  waitForFtcReportFraudInteractiveReady,
  collectOwnedFilingBbbPostNavDiagnostics,
  formatOwnedFilingBbbPostNavDiagnostics,
  withOwnedFilingEvaluateLifecycle,
  withOwnedFilingEvaluateTimeout,
  withOwnedFilingFirstEvaluateRetry,
  withOwnedFilingNavigationTimeout,
  withOwnedFilingSessionBudget,
  destroyOwnedFilingBrowserBestEffort,
  OWNED_FILING_SESSION_BUDGET_MS,
  OwnedFilingSessionTimeoutError,
  isOwnedFilingSessionTimeoutError,
} from "@/lib/justice/ownedFilingPlaywrightSession";
import { PLAYWRIGHT_MOCK_REAL_BBB_BOUNDED_SUBMIT_LOOP_ENTRY_PATH } from "@/lib/testing/playwrightMockRealBbbBoundedSubmitLoop";

function mockPage(overrides: Partial<Page> & { urlValue?: string } = {}): Page {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const urlValue = overrides.urlValue ?? "about:blank";
  return {
    isClosed: vi.fn(() => false),
    url: vi.fn(() => urlValue),
    close: vi.fn(async () => undefined),
    waitForFunction: vi.fn(async () => undefined),
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      const set = listeners.get(event) ?? new Set();
      set.add(handler);
      listeners.set(event, set);
    }),
    off: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      listeners.get(event)?.delete(handler);
    }),
    emit(event: string) {
      for (const handler of listeners.get(event) ?? []) handler();
    },
    ...overrides,
  } as unknown as Page & { emit: (event: string) => void };
}

function mockContext(pages: Page[] = []): BrowserContext & {
  newPage: ReturnType<typeof vi.fn>;
  emit: (event: string) => void;
} {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const newPage = vi.fn(async () => mockPage({ urlValue: "about:blank" }));
  return {
    pages: vi.fn(() => pages),
    newPage,
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      const set = listeners.get(event) ?? new Set();
      set.add(handler);
      listeners.set(event, set);
    }),
    off: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      listeners.get(event)?.delete(handler);
    }),
    emit(event: string) {
      for (const handler of listeners.get(event) ?? []) handler();
    },
  } as unknown as BrowserContext & {
    newPage: ReturnType<typeof vi.fn>;
    emit: (event: string) => void;
  };
}

function mockBrowser(options: {
  contexts: BrowserContext[];
  newContext?: ReturnType<typeof vi.fn>;
  connected?: boolean;
}): Browser & {
  newContext: ReturnType<typeof vi.fn>;
  emit: (event: string) => void;
} {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const newContext =
    options.newContext ??
    vi.fn(async () => mockContext([]));
  let connected = options.connected ?? true;
  return {
    contexts: vi.fn(() => options.contexts),
    newContext,
    isConnected: vi.fn(() => connected),
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      const set = listeners.get(event) ?? new Set();
      set.add(handler);
      listeners.set(event, set);
    }),
    off: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      listeners.get(event)?.delete(handler);
    }),
    emit(event: string) {
      if (event === "disconnected") connected = false;
      for (const handler of listeners.get(event) ?? []) handler();
    },
  } as unknown as Browser & {
    newContext: ReturnType<typeof vi.fn>;
    emit: (event: string) => void;
  };
}

describe("openOwnedFilingPlaywrightSession", () => {
  it("Browserless reuses the default context and does not call newContext when one exists", async () => {
    const blank = mockPage({ urlValue: "about:blank" });
    const defaultContext = mockContext([blank]);
    const browser = mockBrowser({ contexts: [defaultContext] });

    const session = await openOwnedFilingPlaywrightSession(browser, {
      chromiumMode: "browserless",
      contextOptions: { httpCredentials: { username: "admin", password: "x" } },
    });

    expect(browser.newContext).not.toHaveBeenCalled();
    expect(defaultContext.newPage).not.toHaveBeenCalled();
    expect(session.context).toBe(defaultContext);
    expect(session.page).toBe(blank);
    session.disposeListeners();
  });

  it("Browserless creates a page in the default context when no blank page exists", async () => {
    const occupied = mockPage({ urlValue: "https://example.com" });
    const defaultContext = mockContext([occupied]);
    const created = mockPage({ urlValue: "about:blank" });
    defaultContext.newPage.mockResolvedValue(created);
    const browser = mockBrowser({ contexts: [defaultContext] });

    const session = await openOwnedFilingPlaywrightSession(browser, {
      chromiumMode: "browserless",
    });

    expect(browser.newContext).not.toHaveBeenCalled();
    expect(defaultContext.newPage).toHaveBeenCalledTimes(1);
    expect(session.page).toBe(created);
    session.disposeListeners();
  });

  it("local Chromium still creates a new context", async () => {
    const createdContext = mockContext([]);
    const createdPage = mockPage({ urlValue: "about:blank" });
    createdContext.newPage.mockResolvedValue(createdPage);
    const newContext = vi.fn(async () => createdContext);
    const browser = mockBrowser({ contexts: [], newContext });

    const session = await openOwnedFilingPlaywrightSession(browser, {
      chromiumMode: "local",
      contextOptions: { httpCredentials: { username: "admin", password: "pw" } },
    });

    expect(newContext).toHaveBeenCalledWith({
      httpCredentials: { username: "admin", password: "pw" },
    });
    expect(session.context).toBe(createdContext);
    expect(session.page).toBe(createdPage);
    session.disposeListeners();
  });
});

describe("assertOwnedFilingPageAliveBeforeEvaluate", () => {
  it("lifecycle failure detail identifies the closed layer and elapsed time", async () => {
    const blank = mockPage({ urlValue: "about:blank" });
    const defaultContext = mockContext([blank]);
    const browser = mockBrowser({ contexts: [defaultContext] });
    const session = await openOwnedFilingPlaywrightSession(browser, {
      chromiumMode: "browserless",
    });

    await new Promise((r) => setTimeout(r, 5));
    (blank.isClosed as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (blank as unknown as { emit: (e: string) => void }).emit("close");

    expect(() => assertOwnedFilingPageAliveBeforeEvaluate(session, browser)).toThrow(
      /owned-filing playwright target closed before first evaluate \(page_close\):/
    );
    try {
      assertOwnedFilingPageAliveBeforeEvaluate(session, browser);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      expect(message).toMatch(/elapsed_ms=\d+/);
      expect(message).toContain("browser_connected=true");
      expect(message).toContain("page_closed=true");
      expect(message).toContain("first_close_event=page_close");
      const elapsed = Number(/elapsed_ms=(\d+)/.exec(message)?.[1]);
      expect(elapsed).toBeGreaterThanOrEqual(5);
    }
    session.disposeListeners();
  });

  it("does not throw when browser and page are still alive", async () => {
    const blank = mockPage({ urlValue: "about:blank" });
    const defaultContext = mockContext([blank]);
    const browser = mockBrowser({ contexts: [defaultContext] });
    const session = await openOwnedFilingPlaywrightSession(browser, {
      chromiumMode: "browserless",
    });
    expect(() => assertOwnedFilingPageAliveBeforeEvaluate(session, browser)).not.toThrow();
    session.disposeListeners();
  });
});

describe("formatOwnedFilingLifecycleDetail", () => {
  it("formats snapshot fields for provider error detail", () => {
    expect(
      formatOwnedFilingLifecycleDetail({
        elapsed_ms: 42,
        browser_connected: false,
        page_closed: true,
        first_close_event: "browser_disconnected",
      })
    ).toBe(
      "elapsed_ms=42 browser_connected=false page_closed=true first_close_event=browser_disconnected"
    );
  });
});

describe("withOwnedFilingEvaluateLifecycle / enrichOwnedFilingTargetClosedError", () => {
  it("raw target-closed evaluate errors become enriched with lifecycle fields and URL", async () => {
    const blank = mockPage({ urlValue: "https://reportfraud.ftc.gov/" });
    const defaultContext = mockContext([blank]);
    const browser = mockBrowser({ contexts: [defaultContext] });
    const session = await openOwnedFilingPlaywrightSession(browser, {
      chromiumMode: "browserless",
    });
    // Re-point session page URL for enrichment (reuse blank was about:blank; use occupied style).
    (session.page.url as ReturnType<typeof vi.fn>).mockReturnValue("https://reportfraud.ftc.gov/");

    await expect(
      withOwnedFilingEvaluateLifecycle(session, browser, async () => {
        throw new Error("page.evaluate: Target page, context or browser has been closed");
      })
    ).rejects.toThrow(/owned-filing playwright evaluate target closed:/);

    try {
      await withOwnedFilingEvaluateLifecycle(session, browser, async () => {
        throw new Error("page.evaluate: Target page, context or browser has been closed");
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      expect(message).toMatch(/elapsed_ms=\d+/);
      expect(message).toContain("browser_connected=true");
      expect(message).toContain("page_closed=false");
      expect(message).toContain("first_close_event=none");
      expect(message).toContain("context_count=1");
      expect(message).toContain("page_count=1");
      expect(message).toContain("page_url=https://reportfraud.ftc.gov/");
      expect(message).toContain(
        "original_error=page.evaluate: Target page, context or browser has been closed"
      );
    }
    session.disposeListeners();
  });

  it("browser/context/page API failures while collecting diagnostics do not hide the original failure", async () => {
    const blank = mockPage({ urlValue: "about:blank" });
    (blank.isClosed as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error("isClosed blew up");
    });
    (blank.url as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error("url blew up");
    });
    const defaultContext = mockContext([blank]);
    (defaultContext.pages as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error("pages blew up");
    });
    const browser = mockBrowser({ contexts: [defaultContext] });
    (browser.isConnected as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error("isConnected blew up");
    });
    (browser.contexts as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error("contexts blew up");
    });

    const session = {
      context: defaultContext,
      page: blank,
      snapshot: () => {
        throw new Error("snapshot blew up");
      },
      disposeListeners: () => {},
    };

    try {
      enrichOwnedFilingTargetClosedError(
        new Error("page.evaluate: Target page, context or browser has been closed"),
        session,
        browser
      );
      expect.unreachable();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      expect(message).toContain("owned-filing playwright evaluate target closed:");
      expect(message).toContain("elapsed_ms=unavailable");
      expect(message).toContain("browser_connected=unavailable");
      expect(message).toContain("page_closed=unavailable");
      expect(message).toContain("first_close_event=unavailable");
      expect(message).toContain("context_count=unavailable");
      expect(message).toContain("page_count=unavailable");
      expect(message).toContain("page_url=unavailable");
      expect(message).toContain(
        "original_error=page.evaluate: Target page, context or browser has been closed"
      );
    }
  });

  it("non-target-closed errors remain unchanged", async () => {
    const blank = mockPage({ urlValue: "about:blank" });
    const defaultContext = mockContext([blank]);
    const browser = mockBrowser({ contexts: [defaultContext] });
    const session = await openOwnedFilingPlaywrightSession(browser, {
      chromiumMode: "browserless",
    });

    const original = new Error("decide-action returned an invalid decision shape");
    await expect(
      withOwnedFilingEvaluateLifecycle(session, browser, async () => {
        throw original;
      })
    ).rejects.toBe(original);
    session.disposeListeners();
  });
});

describe("withOwnedFilingEvaluateTimeout", () => {
  it("fails within the wall-clock bound when evaluate never settles", async () => {
    const started = Date.now();
    await expect(
      withOwnedFilingEvaluateTimeout(() => new Promise(() => {}), 40)
    ).rejects.toBeInstanceOf(OwnedFilingEvaluateTimeoutError);
    const elapsed = Date.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(35);
    expect(elapsed).toBeLessThan(2_000);
  });

  it("resolves when evaluate finishes before the bound", async () => {
    await expect(
      withOwnedFilingEvaluateTimeout(async () => "ok", 500)
    ).resolves.toBe("ok");
  });

  it("exports the production 45s evaluate bound", () => {
    expect(OWNED_FILING_PAGE_EVALUATE_TIMEOUT_MS).toBe(45_000);
  });

  it("rejects evaluate_timeout immediately without waiting for hung abort/page.close", async () => {
    const abort = vi.fn(() => new Promise<void>(() => {}));
    const started = Date.now();
    let caught: unknown;
    try {
      await withOwnedFilingEvaluateTimeout(() => new Promise(() => {}), 40, abort);
    } catch (err) {
      caught = err;
    }
    const elapsed = Date.now() - started;
    expect(caught).toBeInstanceOf(OwnedFilingEvaluateTimeoutError);
    expect((caught as OwnedFilingEvaluateTimeoutError).message).toContain(
      "race_winner=evaluate_timeout"
    );
    expect((caught as OwnedFilingEvaluateTimeoutError).message).toMatch(
      /abort_timer_fired_at_ms=\d+/
    );
    expect(abort).toHaveBeenCalledTimes(1);
    expect(elapsed).toBeGreaterThanOrEqual(35);
    expect(elapsed).toBeLessThan(500);
  });

  it("keeps evaluate_timeout as race winner when abort later surfaces target-closed", async () => {
    const page = mockPage();
    let rejectEvaluate: ((err: Error) => void) | undefined;
    const hungEvaluate = new Promise<string>((_, reject) => {
      rejectEvaluate = reject;
    });

    const abort = vi.fn(async () => {
      rejectEvaluate?.(new Error("page.evaluate: Target page, context or browser has been closed"));
      await abortOwnedFilingPageEvaluate(page);
    });

    await expect(
      withOwnedFilingEvaluateTimeout(() => hungEvaluate, 30, abort)
    ).rejects.toMatchObject({
      name: "OwnedFilingEvaluateTimeoutError",
      message: expect.stringContaining("race_winner=evaluate_timeout"),
    });

    expect(abort).toHaveBeenCalledTimes(1);
    expect(page.close).toHaveBeenCalled();
  });

  it("annotates pre-abort target-closed with race_winner diagnostics", async () => {
    await expect(
      withOwnedFilingEvaluateTimeout(async () => {
        throw new Error("page.evaluate: Target page, context or browser has been closed");
      }, 500)
    ).rejects.toThrow(/race_winner=evaluate_target_closed/);
  });
});

describe("withOwnedFilingNavigationTimeout", () => {
  it("exports the production 60s navigation bound", () => {
    expect(OWNED_FILING_PAGE_NAVIGATION_TIMEOUT_MS).toBe(60_000);
  });

  it("fails within the wall-clock bound when navigation never settles", async () => {
    const started = Date.now();
    await expect(
      withOwnedFilingNavigationTimeout(() => new Promise(() => {}), 40)
    ).rejects.toBeInstanceOf(OwnedFilingNavigationTimeoutError);
    const elapsed = Date.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(35);
    expect(elapsed).toBeLessThan(2_000);
  });

  it("rejects navigation_timeout immediately without waiting for hung abort/page.close", async () => {
    const abort = vi.fn(() => new Promise<void>(() => {}));
    const started = Date.now();
    let caught: unknown;
    try {
      await withOwnedFilingNavigationTimeout(() => new Promise(() => {}), 40, abort);
    } catch (err) {
      caught = err;
    }
    const elapsed = Date.now() - started;
    expect(caught).toBeInstanceOf(OwnedFilingNavigationTimeoutError);
    expect(isOwnedFilingNavigationTimeoutError(caught)).toBe(true);
    expect((caught as OwnedFilingNavigationTimeoutError).message).toContain(
      "race_winner=navigation_timeout"
    );
    expect((caught as OwnedFilingNavigationTimeoutError).message).toMatch(
      /nav_timer_fired_at_ms=\d+/
    );
    expect(abort).toHaveBeenCalledTimes(1);
    expect(elapsed).toBeGreaterThanOrEqual(35);
    expect(elapsed).toBeLessThan(500);
  });

  it("keeps navigation_timeout as race winner when abort later surfaces target-closed", async () => {
    let rejectNav: ((err: Error) => void) | undefined;
    const hungNav = new Promise<void>((_, reject) => {
      rejectNav = reject;
    });
    const abort = vi.fn(async () => {
      rejectNav?.(new Error("page.goto: Target page, context or browser has been closed"));
    });

    await expect(
      withOwnedFilingNavigationTimeout(() => hungNav, 30, abort)
    ).rejects.toMatchObject({
      name: "OwnedFilingNavigationTimeoutError",
      message: expect.stringContaining("race_winner=navigation_timeout"),
    });
    expect(abort).toHaveBeenCalledTimes(1);
  });
});

describe("gotoOwnedFilingPage", () => {
  it("rejects on wall-clock bound when page.goto never settles (does not wait for CDP)", async () => {
    const page = mockPage() as Page & { goto: ReturnType<typeof vi.fn> };
    page.goto = vi.fn((): Promise<null> => new Promise(() => {}));
    const started = Date.now();
    await expect(gotoOwnedFilingPage(page, "https://example.test/complain", { timeoutMs: 40 })).rejects.toBeInstanceOf(
      OwnedFilingNavigationTimeoutError
    );
    expect(Date.now() - started).toBeLessThan(500);
    expect(page.close).toHaveBeenCalled();
  });

  it("resolves when page.goto finishes before the bound", async () => {
    const page = mockPage() as Page & { goto: ReturnType<typeof vi.fn> };
    page.goto = vi.fn(async (): Promise<null> => null);
    await expect(gotoOwnedFilingPage(page, "https://example.test/complain", { timeoutMs: 500 })).resolves.toBeUndefined();
    expect(page.goto).toHaveBeenCalledWith(
      "https://example.test/complain",
      expect.objectContaining({ waitUntil: "domcontentloaded" })
    );
  });
});

describe("withOwnedFilingSessionBudget", () => {
  it("exports the production 60s session budget", () => {
    expect(OWNED_FILING_SESSION_BUDGET_MS).toBe(60_000);
  });

  it("rejects session_timeout immediately without waiting for hung browser.close", async () => {
    const abort = vi.fn(() => new Promise<void>(() => {}));
    const started = Date.now();
    let caught: unknown;
    try {
      await withOwnedFilingSessionBudget(
        async (budget) => {
          budget.setPhase("evaluate");
          await new Promise(() => {});
        },
        40,
        abort
      );
    } catch (err) {
      caught = err;
    }
    const elapsed = Date.now() - started;
    expect(caught).toBeInstanceOf(OwnedFilingSessionTimeoutError);
    expect(isOwnedFilingSessionTimeoutError(caught)).toBe(true);
    expect((caught as OwnedFilingSessionTimeoutError).message).toContain(
      "race_winner=session_timeout"
    );
    expect((caught as OwnedFilingSessionTimeoutError).message).toMatch(/budget_fired_at_ms=\d+/);
    expect((caught as OwnedFilingSessionTimeoutError).message).toContain("phase=evaluate");
    expect(abort).toHaveBeenCalledTimes(1);
    expect(elapsed).toBeGreaterThanOrEqual(35);
    expect(elapsed).toBeLessThan(500);
  });

  it("still surfaces session_timeout when hung goto never settles", async () => {
    const started = Date.now();
    await expect(
      withOwnedFilingSessionBudget(async (budget) => {
        budget.setPhase("goto");
        await new Promise(() => {});
      }, 40)
    ).rejects.toBeInstanceOf(OwnedFilingSessionTimeoutError);
    expect(Date.now() - started).toBeLessThan(500);
  });

  it("clears budget after progress so later work is not cut off", async () => {
    const result = await withOwnedFilingSessionBudget(async (budget) => {
      budget.setPhase("evaluate");
      budget.clear();
      await new Promise((r) => setTimeout(r, 60));
      return "ok";
    }, 40);
    expect(result).toBe("ok");
  });

  it("annotates target-closed while budget still armed as provider_session_kill with session_bound_ms", async () => {
    await expect(
      withOwnedFilingSessionBudget(async (budget) => {
        budget.setPhase("evaluate");
        throw new Error("page.evaluate: Target page, context or browser has been closed");
      }, 500)
    ).rejects.toThrow(/race_winner=provider_session_kill/);
    await expect(
      withOwnedFilingSessionBudget(async (budget) => {
        budget.setPhase("evaluate");
        budget.setReadySignal("start_complaint");
        throw new Error("page.evaluate: Target page, context or browser has been closed");
      }, 500)
    ).rejects.toThrow(/session_bound_ms=500/);
    await expect(
      withOwnedFilingSessionBudget(async (budget) => {
        budget.setPhase("evaluate");
        budget.setReadySignal("start_complaint");
        throw new Error("page.evaluate: Target page, context or browser has been closed");
      }, 500)
    ).rejects.toThrow(/ready_signal=start_complaint/);
  });

  it("destroyOwnedFilingBrowserBestEffort terminates underlying ws without awaiting hung close", () => {
    const terminate = vi.fn();
    const browser = mockBrowser({ contexts: [] }) as unknown as Browser & {
      close: ReturnType<typeof vi.fn>;
      _connection: { _ws: { terminate: ReturnType<typeof vi.fn> } };
    };
    browser.close = vi.fn((): Promise<void> => new Promise(() => {}));
    browser._connection = { _ws: { terminate } };
    const started = Date.now();
    destroyOwnedFilingBrowserBestEffort(browser);
    expect(Date.now() - started).toBeLessThan(100);
    expect(terminate).toHaveBeenCalled();
    expect(browser.close).toHaveBeenCalled();
  });
});

describe("closeOwnedFilingBrowserFailClosed", () => {
  it("exports a short fail-closed close bound", () => {
    expect(OWNED_FILING_BROWSER_CLOSE_TIMEOUT_MS).toBe(5_000);
  });

  it("returns when browser.close settles before the bound", async () => {
    const browser = mockBrowser({ contexts: [] }) as unknown as Browser & {
      close: ReturnType<typeof vi.fn>;
    };
    browser.close = vi.fn(async (): Promise<void> => undefined);
    await closeOwnedFilingBrowserFailClosed(browser, { timeoutMs: 200, logLabel: "test" });
    expect(browser.close).toHaveBeenCalledTimes(1);
  });

  it("does not hang when browser.close never settles", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const browser = mockBrowser({ contexts: [] }) as unknown as Browser & {
      close: ReturnType<typeof vi.fn>;
    };
    browser.close = vi.fn((): Promise<void> => new Promise<void>(() => {}));
    const started = Date.now();
    await closeOwnedFilingBrowserFailClosed(browser, { timeoutMs: 40, logLabel: "test" });
    expect(Date.now() - started).toBeLessThan(1_500);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("withOwnedFilingFirstEvaluateRetry", () => {
  it("on first evaluate_timeout runs retry setup once then resumes on success", async () => {
    let attempts = 0;
    const retrySetup = vi.fn(async () => undefined);
    const result = await withOwnedFilingFirstEvaluateRetry(async () => {
      attempts += 1;
      if (attempts === 1) throw new OwnedFilingEvaluateTimeoutError(45);
      return { steps: attempts, page: "fresh" };
    }, retrySetup);

    expect(retrySetup).toHaveBeenCalledTimes(1);
    expect(attempts).toBe(2);
    expect(result).toEqual({ steps: 2, page: "fresh" });
  });

  it("fails closed when the retry evaluate also times out", async () => {
    const retrySetup = vi.fn(async () => undefined);
    await expect(
      withOwnedFilingFirstEvaluateRetry(async () => {
        throw new OwnedFilingEvaluateTimeoutError(45);
      }, retrySetup)
    ).rejects.toBeInstanceOf(OwnedFilingEvaluateTimeoutError);
    expect(retrySetup).toHaveBeenCalledTimes(1);
  });

  it("does not retry non-timeout errors", async () => {
    const retrySetup = vi.fn(async () => undefined);
    const original = new Error("boom");
    await expect(
      withOwnedFilingFirstEvaluateRetry(async () => {
        throw original;
      }, retrySetup)
    ).rejects.toBe(original);
    expect(retrySetup).not.toHaveBeenCalled();
  });

  it("recognizes evaluate_timeout errors by message", () => {
    expect(
      isOwnedFilingEvaluateTimeoutError(
        new Error("owned-filing playwright evaluate_timeout after 45000ms (provider/evaluate_timeout)")
      )
    ).toBe(true);
    expect(isOwnedFilingEvaluateTimeoutError(new Error("target closed"))).toBe(false);
  });
});

describe("replaceOwnedFilingPlaywrightSessionPage", () => {
  it("closes the old page and opens a fresh page in the same context", async () => {
    const blank = mockPage({ urlValue: "about:blank" });
    const defaultContext = mockContext([blank]);
    const fresh = mockPage({ urlValue: "about:blank" });
    defaultContext.newPage.mockResolvedValue(fresh);
    const browser = mockBrowser({ contexts: [defaultContext] });
    const session = await openOwnedFilingPlaywrightSession(browser, {
      chromiumMode: "browserless",
    });

    const replaced = await replaceOwnedFilingPlaywrightSessionPage(session, browser);
    expect(blank.close).toHaveBeenCalledTimes(1);
    expect(defaultContext.newPage).toHaveBeenCalled();
    expect(replaced.page).toBe(fresh);
    expect(replaced.context).toBe(defaultContext);
    replaced.disposeListeners();
  });
});

describe("waitForFtcReportFraudInteractiveReady", () => {
  function pageWithWaitForFunction(
    waitForFunction: ReturnType<typeof vi.fn<(...args: unknown[]) => Promise<unknown>>>
  ): Page {
    return mockPage({ waitForFunction } as unknown as Partial<Page>);
  }

  it("passes timeout as waitForFunction options (3rd arg), not as pageFunction arg", async () => {
    const waitForFunction = vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => undefined);
    const page = pageWithWaitForFunction(waitForFunction);

    await waitForFtcReportFraudInteractiveReady(page, OWNED_FILING_FTC_READY_WAIT_MS);

    expect(waitForFunction).toHaveBeenCalledTimes(1);
    const call = waitForFunction.mock.calls[0] as unknown[];
    expect(typeof call[0]).toBe("function");
    expect(call[1]).toBe(OWNED_FILING_FTC_READY_SELECTOR);
    expect(call[2]).toEqual({ timeout: OWNED_FILING_FTC_READY_WAIT_MS });
    expect(OWNED_FILING_FTC_READY_WAIT_MS).toBe(15_000);
  });

  it("soft-resolves on a normal readiness TimeoutError so bounded evaluate can proceed", async () => {
    const timeoutErr = new Error("page.waitForFunction: Timeout 15000ms exceeded.");
    timeoutErr.name = "TimeoutError";
    const waitForFunction = vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => {
      throw timeoutErr;
    });
    const page = pageWithWaitForFunction(waitForFunction);

    await expect(waitForFtcReportFraudInteractiveReady(page, 15_000)).resolves.toBeUndefined();
  });

  it("propagates target-closed / disconnected errors as provider failures", async () => {
    const closed = new Error("Target page, context or browser has been closed");
    const waitForFunction = vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => {
      throw closed;
    });
    const page = pageWithWaitForFunction(waitForFunction);

    await expect(waitForFtcReportFraudInteractiveReady(page)).rejects.toBe(closed);
    expect(isOwnedFilingClosedTargetProviderError(closed)).toBe(true);
    expect(
      isOwnedFilingClosedTargetProviderError(new Error("browser has been disconnected"))
    ).toBe(true);
  });

  it("enforces the Playwright timeout option value of 15 seconds", async () => {
    const waitForFunction = vi.fn<(...args: unknown[]) => Promise<unknown>>(
      async (_fn, _arg, options) => {
        expect((options as { timeout?: number } | undefined)?.timeout).toBe(15_000);
        throw Object.assign(new Error("Timeout 15000ms exceeded."), { name: "TimeoutError" });
      }
    );
    const page = pageWithWaitForFunction(waitForFunction);
    await waitForFtcReportFraudInteractiveReady(page);
    expect(waitForFunction.mock.calls[0]?.[2]).toEqual({ timeout: 15_000 });
  });
});

describe("waitForBbbComplainPortalInteractiveReady", () => {
  function mockBbbProbe(partial: Record<string, unknown> = {}) {
    return {
      pathname: "/file-a-complaint",
      startComplaintFound: 0,
      startComplaintVisibleCount: 0,
      complaintGoalFound: 0,
      complaintGoalVisibleCount: 0,
      complaintGoalSelector: "",
      cookieAcceptVisibleCount: 0,
      fieldCount: 0,
      interactiveControlCount: 0,
      haystack: "",
      ...partial,
    };
  }

  function pageWithBbbProbe(options: {
    urlValue?: string;
    title?: string;
    frames?: number;
    probe?: Record<string, unknown> | (() => Record<string, unknown>);
    onGoalClick?: (selector: string) => void;
    locatorCount?: number;
    evaluateHang?: boolean;
    closed?: boolean;
  }): Page & { locatorSelectors: string[] } {
    const locatorSelectors: string[] = [];
    const textClick = vi.fn(async () => undefined);
    const page = mockPage({
      urlValue: options.urlValue ?? "https://www.bbb.org/file-a-complaint",
      isClosed: vi.fn(() => !!options.closed),
      title: vi.fn(async () => options.title ?? "File a Complaint | BBB"),
      frames: vi.fn(() => Array.from({ length: options.frames ?? 1 }, () => ({}))),
      evaluate: options.evaluateHang
        ? vi.fn(() => new Promise(() => undefined))
        : vi.fn(async () =>
            typeof options.probe === "function" ? options.probe() : options.probe ?? mockBbbProbe()
          ),
      getByText: vi.fn(() => ({ first: () => ({ click: textClick }) })),
      locator: vi.fn((selector: string) => {
        locatorSelectors.push(selector);
        return {
          count: async () => options.locatorCount ?? 1,
          click: async () => {
            options.onGoalClick?.(selector);
          },
        };
      }),
    } as unknown as Partial<Page>);
    return Object.assign(page, { locatorSelectors });
  }

  it("treats official /complain, /file-a-complaint, and Playwright mock entry as complain-portal paths", () => {
    expect(isOwnedFilingBbbComplainPortalPath("/complain")).toBe(true);
    expect(isOwnedFilingBbbComplainPortalPath("/complain/")).toBe(true);
    expect(isOwnedFilingBbbComplainPortalPath("/complain/business-details")).toBe(true);
    expect(isOwnedFilingBbbComplainPortalPath("/file-a-complaint")).toBe(true);
    expect(isOwnedFilingBbbComplainPortalPath("/file-a-complaint/search")).toBe(true);
    expect(isOwnedFilingBbbComplainPortalPath(PLAYWRIGHT_MOCK_REAL_BBB_BOUNDED_SUBMIT_LOOP_ENTRY_PATH)).toBe(
      true
    );
    expect(
      isOwnedFilingBbbComplainPortalPath(`${PLAYWRIGHT_MOCK_REAL_BBB_BOUNDED_SUBMIT_LOOP_ENTRY_PATH}/`)
    ).toBe(true);
    // Hyphenated mock segment must not rely solely on /\/complain/ (regression for PR #932 CI).
    expect(/\/complain/i.test(PLAYWRIGHT_MOCK_REAL_BBB_BOUNDED_SUBMIT_LOOP_ENTRY_PATH)).toBe(false);
    expect(isOwnedFilingBbbComplainPortalPath("/mock/unrelated")).toBe(false);
    expect(isOwnedFilingBbbComplainPortalPath("/")).toBe(false);
  });

  it("rejects challenge-like /complain chrome (links + generic input, no Start Complaint)", () => {
    const decision = evaluateOwnedFilingBbbPortalReady({
      pathname: "/complain/",
      startComplaintVisibleCount: 0,
      fieldCount: 2,
      interactiveControlCount: 8,
    });
    expect(decision).toEqual({ ready: false, ready_signal: null });
  });

  it("treats collapsed Start Complaint (present, not visible) as not ready", () => {
    expect(
      evaluateOwnedFilingBbbPortalReady({
        pathname: "/file-a-complaint",
        startComplaintVisibleCount: 0,
        fieldCount: 0,
        interactiveControlCount: 4,
      })
    ).toEqual({ ready: false, ready_signal: null });
    expect(
      shouldRevealBbbStartComplaintViaGoal({
        startComplaintVisibleCount: 0,
        complaintGoalVisibleCount: 1,
      })
    ).toBe(true);
    expect(
      shouldRevealBbbStartComplaintViaGoal({
        startComplaintVisibleCount: 1,
        complaintGoalVisibleCount: 1,
      })
    ).toBe(false);
  });

  it("accepts unique visible Start Complaint on live /file-a-complaint", () => {
    expect(
      evaluateOwnedFilingBbbPortalReady({
        pathname: "/file-a-complaint",
        startComplaintVisibleCount: 1,
        fieldCount: 0,
        interactiveControlCount: 1,
      })
    ).toEqual({ ready: true, ready_signal: "start_complaint" });
  });

  it("rejects ambiguous duplicate Start Complaint CTAs", () => {
    expect(
      evaluateOwnedFilingBbbPortalReady({
        pathname: "/complain/",
        startComplaintVisibleCount: 2,
        fieldCount: 0,
        interactiveControlCount: 2,
      })
    ).toEqual({ ready: false, ready_signal: null });
  });

  it("accepts mock entry form+controls only on the Playwright mock path", () => {
    expect(
      evaluateOwnedFilingBbbPortalReady({
        pathname: PLAYWRIGHT_MOCK_REAL_BBB_BOUNDED_SUBMIT_LOOP_ENTRY_PATH,
        startComplaintVisibleCount: 0,
        fieldCount: 1,
        interactiveControlCount: 1,
      })
    ).toEqual({ ready: true, ready_signal: "mock_form_controls" });
    expect(
      evaluateOwnedFilingBbbPortalReady({
        pathname: "/complain/",
        startComplaintVisibleCount: 0,
        fieldCount: 1,
        interactiveControlCount: 1,
      })
    ).toEqual({ ready: false, ready_signal: null });
  });

  it("resolves when unique visible Start Complaint is already interactive", async () => {
    const page = pageWithBbbProbe({
      probe: mockBbbProbe({
        pathname: "/file-a-complaint",
        startComplaintFound: 1,
        startComplaintVisibleCount: 1,
        interactiveControlCount: 1,
        haystack: "Start Complaint",
      }),
    });

    await expect(waitForBbbComplainPortalInteractiveReady(page, 500)).resolves.toEqual({
      ready_signal: "start_complaint",
    });
    expect(OWNED_FILING_BBB_READY_WAIT_MS).toBe(15_000);
  });

  it("clicks the scoped unique complaint goal then becomes ready when Start Complaint turns visible", async () => {
    let revealed = false;
    const goalSelector = "body > main > ul > li:nth-of-type(1) > button";
    const page = pageWithBbbProbe({
      probe: () =>
        revealed
          ? mockBbbProbe({
              pathname: "/file-a-complaint",
              startComplaintFound: 1,
              startComplaintVisibleCount: 1,
              complaintGoalFound: 1,
              complaintGoalVisibleCount: 1,
              interactiveControlCount: 2,
              haystack: "Start Complaint",
            })
          : mockBbbProbe({
              pathname: "/file-a-complaint",
              startComplaintFound: 1,
              startComplaintVisibleCount: 0,
              complaintGoalFound: 1,
              complaintGoalVisibleCount: 1,
              complaintGoalSelector: goalSelector,
              interactiveControlCount: 1,
              haystack: "I want help resolving a problem with a business",
            }),
      onGoalClick: () => {
        revealed = true;
      },
    });

    await expect(waitForBbbComplainPortalInteractiveReady(page, 2_000)).resolves.toEqual({
      ready_signal: "start_complaint",
    });
    expect(revealed).toBe(true);
    expect(page.locatorSelectors).toContain(goalSelector);
  });

  it("never clicks a goal when two semantic goals remain visible after dedupe", async () => {
    let clicked = false;
    const page = pageWithBbbProbe({
      probe: mockBbbProbe({
        pathname: "/file-a-complaint",
        startComplaintFound: 1,
        startComplaintVisibleCount: 0,
        complaintGoalFound: 2,
        complaintGoalVisibleCount: 2,
        complaintGoalSelector: "",
        interactiveControlCount: 2,
        haystack: "I want help resolving a problem with a business",
      }),
      onGoalClick: () => {
        clicked = true;
      },
    });

    await expect(waitForBbbComplainPortalInteractiveReady(page, 250)).rejects.toBeInstanceOf(
      OwnedFilingBbbReadyTimeoutError
    );
    expect(clicked).toBe(false);
    expect(page.locatorSelectors).toEqual([]);
  });

  it("fails closed when the resolved goal selector stops being unique at click time", async () => {
    let clicked = false;
    const page = pageWithBbbProbe({
      probe: mockBbbProbe({
        pathname: "/file-a-complaint",
        startComplaintFound: 1,
        startComplaintVisibleCount: 0,
        complaintGoalFound: 1,
        complaintGoalVisibleCount: 1,
        complaintGoalSelector: "body > main > ul > li > button",
        interactiveControlCount: 1,
      }),
      locatorCount: 2,
      onGoalClick: () => {
        clicked = true;
      },
    });

    await expect(waitForBbbComplainPortalInteractiveReady(page, 250)).rejects.toBeInstanceOf(
      OwnedFilingBbbReadyTimeoutError
    );
    expect(clicked).toBe(false);
  });

  it("resolves on Playwright mock form+Continue via mock_form_controls signal", async () => {
    const page = pageWithBbbProbe({
      urlValue: `http://127.0.0.1:3000${PLAYWRIGHT_MOCK_REAL_BBB_BOUNDED_SUBMIT_LOOP_ENTRY_PATH}`,
      probe: mockBbbProbe({
        pathname: PLAYWRIGHT_MOCK_REAL_BBB_BOUNDED_SUBMIT_LOOP_ENTRY_PATH,
        fieldCount: 1,
        interactiveControlCount: 1,
      }),
    });

    await expect(waitForBbbComplainPortalInteractiveReady(page, 500)).resolves.toEqual({
      ready_signal: "mock_form_controls",
    });
  });

  it("fails closed with ready_timeout and post-nav diagnostics when controls never appear", async () => {
    const page = pageWithBbbProbe({
      urlValue: "https://www.bbb.org/complain/",
      title: "Just a moment...",
      frames: 2,
      probe: mockBbbProbe({
        pathname: "/complain/",
        haystack: "Just a moment... Checking your browser before accessing bbb.org.",
      }),
    });

    await expect(waitForBbbComplainPortalInteractiveReady(page, 250)).rejects.toSatisfy(
      (err: unknown) => {
        expect(isOwnedFilingBbbReadyTimeoutError(err)).toBe(true);
        expect(err).toBeInstanceOf(OwnedFilingBbbReadyTimeoutError);
        const message = err instanceof Error ? err.message : String(err);
        expect(message).toContain("ready_timeout");
        expect(message).toContain("phase=ready");
        expect(message).toContain("ready_result=timeout");
        expect(message).toContain("ready_signal=none");
        expect(message).toContain("page_url=https://www.bbb.org/complain/");
        expect(message).toContain("start_complaint_found=false");
        expect(message).toContain("start_complaint_visible_count=0");
        expect(message).toContain("complaint_goal_visible_count=0");
        expect(message).toMatch(/challenge_markers=/);
        return true;
      }
    );
  });

  it("fails closed on hung DOM probe via Node wall-clock budget", async () => {
    const page = pageWithBbbProbe({
      evaluateHang: true,
      urlValue: "https://www.bbb.org/complain/",
    });

    const started = Date.now();
    await expect(waitForBbbComplainPortalInteractiveReady(page, 40)).rejects.toBeInstanceOf(
      OwnedFilingBbbReadyTimeoutError
    );
    // Probe + diagnostics each race a 2s diag timeout when evaluate never settles.
    expect(Date.now() - started).toBeLessThan(5_500);
  });

  it("propagates closed-target errors without wrapping as ready_timeout", async () => {
    const page = pageWithBbbProbe({ closed: true });
    await expect(waitForBbbComplainPortalInteractiveReady(page, 50)).rejects.toSatisfy(
      (err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        expect(message).toMatch(/closed/i);
        expect(isOwnedFilingBbbReadyTimeoutError(err)).toBe(false);
        return true;
      }
    );
  });

  it("collectOwnedFilingBbbPostNavDiagnostics formats durable note-safe fields including visibility", async () => {
    const page = pageWithBbbProbe({
      urlValue: "https://www.bbb.org/file-a-complaint",
      title: "File a Complaint | Better Business Bureau",
      frames: 2,
      probe: mockBbbProbe({
        pathname: "/file-a-complaint",
        startComplaintFound: 1,
        startComplaintVisibleCount: 0,
        complaintGoalFound: 1,
        complaintGoalVisibleCount: 1,
        haystack: "Start Complaint",
      }),
    });

    const diagnostics = await collectOwnedFilingBbbPostNavDiagnostics(page);
    expect(diagnostics).toMatchObject({
      page_url: "https://www.bbb.org/file-a-complaint",
      frame_count: 2,
      start_complaint_found: true,
      start_complaint_visible_count: 0,
      complaint_goal_found: true,
      complaint_goal_visible_count: 1,
      challenge_markers: "none",
    });
    expect(diagnostics.title).toContain("File a Complaint");
    expect(formatOwnedFilingBbbPostNavDiagnostics(diagnostics)).toContain(
      "start_complaint_visible_count=0"
    );
  });
});

describe("collectOwnedFilingBbbReadyDomInBrowser", () => {
  const GOAL_TEXT = "I want help resolving a problem with a business.";
  const REVIEW_GOAL_TEXT =
    "I want to share my experience with a business, and I don't need a resolution.";

  type FakeEl = {
    tagName: string;
    children: FakeEl[];
    parentElement: FakeEl | null;
    ownText: string;
    role: string | null;
    href: string | null;
    visible: boolean;
    hidden: boolean;
    readonly textContent: string;
    getAttribute(name: string): string | null;
    contains(other: FakeEl): boolean;
    matches(selector: string): boolean;
    getBoundingClientRect(): { width: number; height: number };
  };

  function el(
    tagName: string,
    options: { text?: string; role?: string; href?: string; visible?: boolean } = {},
    children: FakeEl[] = []
  ): FakeEl {
    const node: FakeEl = {
      tagName: tagName.toUpperCase(),
      children,
      parentElement: null,
      ownText: options.text ?? "",
      role: options.role ?? null,
      href: options.href ?? null,
      visible: options.visible ?? true,
      hidden: false,
      get textContent(): string {
        return [node.ownText, ...node.children.map((child) => child.textContent)]
          .filter(Boolean)
          .join(" ");
      },
      getAttribute: (name: string) =>
        name === "role" ? node.role : name === "href" ? node.href : null,
      contains: (other: FakeEl) =>
        other === node || node.children.some((child) => child.contains(other)),
      matches: (selector: string) => {
        const control =
          node.tagName === "BUTTON" ||
          (node.tagName === "A" && !!node.href) ||
          node.role === "button";
        if (!selector.includes("role=\"radio\"")) return control;
        return control || node.role === "radio" || node.role === "option" || node.tagName === "LABEL";
      },
      getBoundingClientRect: () => ({
        width: node.visible ? 100 : 0,
        height: node.visible ? 20 : 0,
      }),
    };
    for (const child of children) child.parentElement = node;
    return node;
  }

  function flatten(node: FakeEl): FakeEl[] {
    return [node, ...node.children.flatMap(flatten)];
  }

  function installDom(body: FakeEl, pathname = "/file-a-complaint"): void {
    const all = flatten(body).filter((node) => node !== body);
    vi.stubGlobal("document", {
      body: Object.assign(body, { innerText: body.textContent }),
      title: "File a Complaint | Consumer Complaints | Better Business Bureau",
      querySelectorAll(selector: string) {
        if (selector === "input, textarea, select") return [];
        if (selector.includes("h1")) return all;
        return all.filter((node) => node.matches('button, a[href], [role="button"]'));
      },
    });
    vi.stubGlobal("window", {
      location: { pathname },
      getComputedStyle: () => ({
        display: "block",
        visibility: "visible",
        opacity: "1",
        pointerEvents: "auto",
      }),
    });
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps the browser-world goal pattern in sync with the exported constant", () => {
    expect(collectOwnedFilingBbbReadyDomInBrowser.toString()).toContain(
      OWNED_FILING_BBB_COMPLAINT_GOAL_RE.source
    );
  });

  it("collapses nested wrappers of one goal into a single semantic candidate", () => {
    // Reproduces production complaint_goal_visible_count=3 on /file-a-complaint.
    installDom(
      el("body", {}, [
        el("ul", {}, [
          el("li", {}, [el("div", {}, [el("span", { text: GOAL_TEXT })])]),
          el("li", {}, [el("div", {}, [el("span", { text: REVIEW_GOAL_TEXT })])]),
        ]),
      ])
    );

    const probe = collectOwnedFilingBbbReadyDomInBrowser();
    expect(probe.complaintGoalFound).toBe(1);
    expect(probe.complaintGoalVisibleCount).toBe(1);
    expect(probe.complaintGoalSelector).toBe("body > ul > li:nth-of-type(1)");
  });

  it("resolves the innermost actionable host inside the collapsed chain", () => {
    installDom(
      el("body", {}, [
        el("ul", {}, [
          el("li", {}, [el("button", {}, [el("span", { text: GOAL_TEXT })])]),
          el("li", {}, [el("button", {}, [el("span", { text: REVIEW_GOAL_TEXT })])]),
        ]),
      ])
    );

    const probe = collectOwnedFilingBbbReadyDomInBrowser();
    expect(probe.complaintGoalFound).toBe(1);
    expect(probe.complaintGoalVisibleCount).toBe(1);
    expect(probe.complaintGoalSelector).toBe("body > ul > li:nth-of-type(1) > button");
  });

  it("keeps genuinely distinct sibling goals ambiguous and offers no selector", () => {
    installDom(
      el("body", {}, [
        el("ul", {}, [
          el("li", {}, [el("button", { text: GOAL_TEXT })]),
          el("li", {}, [el("button", { text: GOAL_TEXT })]),
        ]),
      ])
    );

    const probe = collectOwnedFilingBbbReadyDomInBrowser();
    expect(probe.complaintGoalFound).toBe(2);
    expect(probe.complaintGoalVisibleCount).toBe(2);
    expect(probe.complaintGoalSelector).toBe("");
    expect(
      shouldRevealBbbStartComplaintViaGoal({
        startComplaintVisibleCount: 0,
        complaintGoalVisibleCount: probe.complaintGoalVisibleCount,
      })
    ).toBe(false);
  });

  it("reports collapsed goal and Start Complaint as present but not visible", () => {
    installDom(
      el("body", {}, [
        el("ul", {}, [
          el("li", { visible: false }, [
            el("div", { visible: false }, [el("span", { text: GOAL_TEXT, visible: false })]),
          ]),
          el("li", {}, [el("span", { text: REVIEW_GOAL_TEXT })]),
        ]),
        el("button", { text: "Start Complaint", visible: false }),
      ])
    );

    const probe = collectOwnedFilingBbbReadyDomInBrowser();
    expect(probe.complaintGoalFound).toBe(1);
    expect(probe.complaintGoalVisibleCount).toBe(0);
    expect(probe.complaintGoalSelector).toBe("");
    expect(probe.startComplaintFound).toBe(1);
    expect(probe.startComplaintVisibleCount).toBe(0);
    expect(
      evaluateOwnedFilingBbbPortalReady({
        pathname: probe.pathname,
        startComplaintVisibleCount: probe.startComplaintVisibleCount,
        fieldCount: probe.fieldCount,
        interactiveControlCount: probe.interactiveControlCount,
      })
    ).toEqual({ ready: false, ready_signal: null });
  });

  it("reports the revealed unique Start Complaint as ready after goal selection", () => {
    installDom(
      el("body", {}, [
        el("ul", {}, [
          el("li", {}, [el("button", {}, [el("span", { text: GOAL_TEXT })])]),
          el("li", {}, [el("button", {}, [el("span", { text: REVIEW_GOAL_TEXT })])]),
        ]),
        el("button", { text: "Start Complaint" }),
      ])
    );

    const probe = collectOwnedFilingBbbReadyDomInBrowser();
    expect(probe.startComplaintVisibleCount).toBe(1);
    expect(
      evaluateOwnedFilingBbbPortalReady({
        pathname: probe.pathname,
        startComplaintVisibleCount: probe.startComplaintVisibleCount,
        fieldCount: probe.fieldCount,
        interactiveControlCount: probe.interactiveControlCount,
      })
    ).toEqual({ ready: true, ready_signal: "start_complaint" });
  });
});

import { describe, expect, it, vi } from "vitest";
import type { Browser, BrowserContext, Page } from "playwright";
import {
  abortOwnedFilingPageEvaluate,
  assertOwnedFilingPageAliveBeforeEvaluate,
  closeOwnedFilingBrowserFailClosed,
  enrichOwnedFilingTargetClosedError,
  formatOwnedFilingLifecycleDetail,
  isOwnedFilingClosedTargetProviderError,
  isOwnedFilingEvaluateTimeoutError,
  openOwnedFilingPlaywrightSession,
  OWNED_FILING_BROWSER_CLOSE_TIMEOUT_MS,
  OWNED_FILING_FTC_READY_SELECTOR,
  OWNED_FILING_FTC_READY_WAIT_MS,
  OWNED_FILING_PAGE_EVALUATE_TIMEOUT_MS,
  OwnedFilingEvaluateTimeoutError,
  replaceOwnedFilingPlaywrightSessionPage,
  waitForFtcReportFraudInteractiveReady,
  withOwnedFilingEvaluateLifecycle,
  withOwnedFilingEvaluateTimeout,
  withOwnedFilingFirstEvaluateRetry,
} from "@/lib/justice/ownedFilingPlaywrightSession";

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

  it("invokes onTimeoutAbort then throws evaluate_timeout", async () => {
    const abortOrder: string[] = [];
    const abort = vi.fn(async () => {
      abortOrder.push("abort");
    });

    let caught: unknown;
    try {
      await withOwnedFilingEvaluateTimeout(() => new Promise(() => {}), 40, abort);
    } catch (err) {
      abortOrder.push("reject");
      caught = err;
    }

    expect(caught).toBeInstanceOf(OwnedFilingEvaluateTimeoutError);
    expect(abort).toHaveBeenCalledTimes(1);
    expect(abortOrder).toEqual(["abort", "reject"]);
  });

  it("does not let abort-driven target-closed replace evaluate_timeout", async () => {
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
    ).rejects.toBeInstanceOf(OwnedFilingEvaluateTimeoutError);

    expect(abort).toHaveBeenCalledTimes(1);
    expect(page.close).toHaveBeenCalled();
  });
});

describe("closeOwnedFilingBrowserFailClosed", () => {
  it("exports a short fail-closed close bound", () => {
    expect(OWNED_FILING_BROWSER_CLOSE_TIMEOUT_MS).toBe(5_000);
  });

  it("returns when browser.close settles before the bound", async () => {
    const browser = mockBrowser({ contexts: [] }) as Browser & {
      close: ReturnType<typeof vi.fn>;
    };
    browser.close = vi.fn(async () => undefined);
    await closeOwnedFilingBrowserFailClosed(browser, { timeoutMs: 200, logLabel: "test" });
    expect(browser.close).toHaveBeenCalledTimes(1);
  });

  it("does not hang when browser.close never settles", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const browser = mockBrowser({ contexts: [] }) as Browser & {
      close: ReturnType<typeof vi.fn>;
    };
    browser.close = vi.fn(() => new Promise(() => {}));
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

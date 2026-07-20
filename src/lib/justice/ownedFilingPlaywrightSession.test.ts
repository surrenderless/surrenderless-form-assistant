import { describe, expect, it, vi } from "vitest";
import type { Browser, BrowserContext, Page } from "playwright";
import {
  assertOwnedFilingPageAliveBeforeEvaluate,
  formatOwnedFilingLifecycleDetail,
  openOwnedFilingPlaywrightSession,
} from "@/lib/justice/ownedFilingPlaywrightSession";

function mockPage(overrides: Partial<Page> & { urlValue?: string } = {}): Page {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const urlValue = overrides.urlValue ?? "about:blank";
  return {
    isClosed: vi.fn(() => false),
    url: vi.fn(() => urlValue),
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

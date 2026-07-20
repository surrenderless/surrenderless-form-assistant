import "server-only";
import type { Browser, BrowserContext, Page } from "playwright";

export type OwnedFilingChromiumMode = "browserless" | "local";

export type OwnedFilingCloseEvent =
  | "browser_disconnected"
  | "context_close"
  | "page_close";

export type OwnedFilingLifecycleSnapshot = {
  elapsed_ms: number;
  browser_connected: boolean;
  page_closed: boolean;
  first_close_event: OwnedFilingCloseEvent | null;
};

export type OwnedFilingPlaywrightSession = {
  context: BrowserContext;
  page: Page;
  snapshot: () => OwnedFilingLifecycleSnapshot;
  disposeListeners: () => void;
};

export type OwnedFilingContextOptions = {
  httpCredentials?: { username: string; password: string };
};

/** Extended lifecycle fields attached when a Playwright evaluate target closes. */
export type OwnedFilingEvaluateLifecycleFields = {
  elapsed_ms: string;
  browser_connected: string;
  page_closed: string;
  first_close_event: string;
  context_count: string;
  page_count: string;
  page_url: string;
  original_error: string;
};

function isReusableBlankPage(page: Page): boolean {
  if (page.isClosed()) return false;
  try {
    const url = page.url();
    return !url || url === "about:blank" || url === "about:blank/";
  } catch {
    return false;
  }
}

/**
 * Opens a page for owned BBB/FTC bounded submit.
 * Browserless CDP: reuse the default context (and a blank page when safe).
 * Local Chromium: create a fresh context with the provided options (unchanged behavior).
 */
export async function openOwnedFilingPlaywrightSession(
  browser: Browser,
  options: {
    chromiumMode: OwnedFilingChromiumMode;
    contextOptions?: OwnedFilingContextOptions;
  }
): Promise<OwnedFilingPlaywrightSession> {
  const startedAt = Date.now();
  let firstCloseEvent: OwnedFilingCloseEvent | null = null;

  const noteClose = (event: OwnedFilingCloseEvent) => {
    if (firstCloseEvent == null) firstCloseEvent = event;
  };

  let context: BrowserContext;
  if (options.chromiumMode === "browserless") {
    const existing = browser.contexts()[0];
    context = existing ?? (await browser.newContext(options.contextOptions ?? {}));
  } else {
    context = await browser.newContext(options.contextOptions ?? {});
  }

  const blank = context.pages().find(isReusableBlankPage);
  const page = blank ?? (await context.newPage());

  const onDisconnected = () => noteClose("browser_disconnected");
  const onContextClose = () => noteClose("context_close");
  const onPageClose = () => noteClose("page_close");

  browser.on("disconnected", onDisconnected);
  context.on("close", onContextClose);
  page.on("close", onPageClose);

  const disposeListeners = () => {
    browser.off("disconnected", onDisconnected);
    context.off("close", onContextClose);
    page.off("close", onPageClose);
  };

  const snapshot = (): OwnedFilingLifecycleSnapshot => ({
    elapsed_ms: Math.max(0, Date.now() - startedAt),
    browser_connected: browser.isConnected(),
    page_closed: page.isClosed(),
    first_close_event: firstCloseEvent,
  });

  return { context, page, snapshot, disposeListeners };
}

/** Formats lifecycle fields for dry-run / provider error detail. */
export function formatOwnedFilingLifecycleDetail(
  snapshot: OwnedFilingLifecycleSnapshot
): string {
  return [
    `elapsed_ms=${snapshot.elapsed_ms}`,
    `browser_connected=${snapshot.browser_connected}`,
    `page_closed=${snapshot.page_closed}`,
    `first_close_event=${snapshot.first_close_event ?? "none"}`,
  ].join(" ");
}

export function isOwnedFilingTargetClosedError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /target page, context or browser has been closed/i.test(message);
}

/**
 * Safely gathers evaluate-failure diagnostics. Individual field reads never throw.
 */
export function collectOwnedFilingEvaluateLifecycleFields(
  session: Pick<OwnedFilingPlaywrightSession, "context" | "page" | "snapshot">,
  browser: Browser,
  originalError: unknown
): OwnedFilingEvaluateLifecycleFields {
  const original =
    originalError instanceof Error ? originalError.message : String(originalError);

  let elapsed_ms = "unavailable";
  let first_close_event = "unavailable";
  try {
    const snap = session.snapshot();
    elapsed_ms = String(snap.elapsed_ms);
    first_close_event = snap.first_close_event ?? "none";
  } catch {
    // keep unavailable
  }

  const browser_connected = (() => {
    try {
      return String(browser.isConnected());
    } catch {
      return "unavailable";
    }
  })();

  const page_closed = (() => {
    try {
      return String(session.page.isClosed());
    } catch {
      return "unavailable";
    }
  })();

  const context_count = (() => {
    try {
      return String(browser.contexts().length);
    } catch {
      return "unavailable";
    }
  })();

  const page_count = (() => {
    try {
      return String(session.context.pages().length);
    } catch {
      return "unavailable";
    }
  })();

  const page_url = (() => {
    try {
      if (session.page.isClosed()) return "closed";
      return session.page.url() || "unknown";
    } catch {
      return "unavailable";
    }
  })();

  return {
    elapsed_ms,
    browser_connected,
    page_closed,
    first_close_event,
    context_count,
    page_count,
    page_url,
    original_error: original,
  };
}

export function formatOwnedFilingEvaluateLifecycleDetail(
  fields: OwnedFilingEvaluateLifecycleFields
): string {
  return [
    `elapsed_ms=${fields.elapsed_ms}`,
    `browser_connected=${fields.browser_connected}`,
    `page_closed=${fields.page_closed}`,
    `first_close_event=${fields.first_close_event}`,
    `context_count=${fields.context_count}`,
    `page_count=${fields.page_count}`,
    `page_url=${fields.page_url}`,
    `original_error=${fields.original_error}`,
  ].join(" ");
}

/**
 * Rethrows target-closed Playwright errors with fail-closed lifecycle detail.
 * Non-target-closed errors are rethrown unchanged.
 */
export function enrichOwnedFilingTargetClosedError(
  err: unknown,
  session: Pick<OwnedFilingPlaywrightSession, "context" | "page" | "snapshot">,
  browser: Browser
): never {
  if (!isOwnedFilingTargetClosedError(err)) {
    throw err;
  }
  const fields = collectOwnedFilingEvaluateLifecycleFields(session, browser, err);
  throw new Error(
    `owned-filing playwright evaluate target closed: ${formatOwnedFilingEvaluateLifecycleDetail(fields)}`
  );
}

/** Runs page.evaluate (or similar) and enriches target-closed failures with lifecycle detail. */
export async function withOwnedFilingEvaluateLifecycle<T>(
  session: Pick<OwnedFilingPlaywrightSession, "context" | "page" | "snapshot">,
  browser: Browser,
  run: () => Promise<T>
): Promise<T> {
  try {
    return await run();
  } catch (err: unknown) {
    enrichOwnedFilingTargetClosedError(err, session, browser);
  }
}

/**
 * Fail closed before the first page.evaluate when the CDP target is already gone.
 * Throws an Error whose message includes lifecycle detail for dry-run provider mapping.
 */
export function assertOwnedFilingPageAliveBeforeEvaluate(
  session: Pick<OwnedFilingPlaywrightSession, "page" | "snapshot">,
  browser: Browser
): void {
  const snap = session.snapshot();
  const disconnected = !browser.isConnected();
  const closed = session.page.isClosed();
  if (!disconnected && !closed) return;

  const layer = disconnected
    ? "browser_disconnected"
    : snap.first_close_event === "context_close"
      ? "context_close"
      : "page_close";

  throw new Error(
    `owned-filing playwright target closed before first evaluate (${layer}): ${formatOwnedFilingLifecycleDetail(
      {
        ...snap,
        browser_connected: browser.isConnected(),
        page_closed: session.page.isClosed(),
        first_close_event: snap.first_close_event ?? layer,
      }
    )}`
  );
}

/** Wall-clock bound for owned-filing page.evaluate (Playwright evaluate has no native timeout). */
export const OWNED_FILING_PAGE_EVALUATE_TIMEOUT_MS = 45_000;

/** Brief wait for ReportFraud interactive controls before the first FTC evaluate. */
export const OWNED_FILING_FTC_READY_WAIT_MS = 15_000;

export const OWNED_FILING_EVALUATE_TIMEOUT_REASON = "evaluate_timeout";

export class OwnedFilingEvaluateTimeoutError extends Error {
  readonly reason = OWNED_FILING_EVALUATE_TIMEOUT_REASON;

  constructor(timeoutMs: number = OWNED_FILING_PAGE_EVALUATE_TIMEOUT_MS) {
    super(
      `owned-filing playwright evaluate_timeout after ${timeoutMs}ms (provider/${OWNED_FILING_EVALUATE_TIMEOUT_REASON})`
    );
    this.name = "OwnedFilingEvaluateTimeoutError";
  }
}

export function isOwnedFilingEvaluateTimeoutError(err: unknown): boolean {
  if (err instanceof OwnedFilingEvaluateTimeoutError) return true;
  const message = err instanceof Error ? err.message : String(err);
  return /evaluate_timeout/i.test(message);
}

/**
 * Bounds an async evaluate (or similar) with a wall-clock timeout.
 * Does not cancel the underlying Playwright call; callers should close the browser/page on failure.
 */
export async function withOwnedFilingEvaluateTimeout<T>(
  run: () => Promise<T>,
  timeoutMs: number = OWNED_FILING_PAGE_EVALUATE_TIMEOUT_MS
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      run(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new OwnedFilingEvaluateTimeoutError(timeoutMs));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Runs `attempt` once; on evaluate_timeout only, runs `retrySetup` then `attempt` again.
 * A second timeout (or any other error) fails closed.
 */
export async function withOwnedFilingFirstEvaluateRetry<T>(
  attempt: () => Promise<T>,
  retrySetup: () => Promise<void>
): Promise<T> {
  try {
    return await attempt();
  } catch (err: unknown) {
    if (!isOwnedFilingEvaluateTimeoutError(err)) throw err;
    await retrySetup();
    return await attempt();
  }
}

/**
 * Soft-waits for a usable ReportFraud interactive control / stable DOM.
 * On timeout, returns without throwing so the bounded evaluate can still run.
 */
export async function waitForFtcReportFraudInteractiveReady(
  page: Page,
  timeoutMs: number = OWNED_FILING_FTC_READY_WAIT_MS
): Promise<void> {
  try {
    await page.waitForFunction(
      () => {
        if (!document.body) return false;
        return !!document.querySelector(
          'button, a[href], input, select, textarea, [role="button"]'
        );
      },
      { timeout: timeoutMs }
    );
  } catch {
    // Soft: first evaluate still has its own wall-clock bound.
  }
}

/**
 * Closes the current session page and opens a fresh page in the same context.
 * Preserves cumulative elapsed_ms for lifecycle diagnostics. Same Browserless session.
 */
export async function replaceOwnedFilingPlaywrightSessionPage(
  session: OwnedFilingPlaywrightSession,
  browser: Browser
): Promise<OwnedFilingPlaywrightSession> {
  const priorElapsed = (() => {
    try {
      return session.snapshot().elapsed_ms;
    } catch {
      return 0;
    }
  })();
  const priorFirstClose = (() => {
    try {
      return session.snapshot().first_close_event;
    } catch {
      return null;
    }
  })();

  session.disposeListeners();
  try {
    if (!session.page.isClosed()) {
      await session.page.close();
    }
  } catch {
    // continue with a fresh page even if close fails
  }

  const startedAt = Date.now() - Math.max(0, priorElapsed);
  let firstCloseEvent: OwnedFilingCloseEvent | null = priorFirstClose;

  const noteClose = (event: OwnedFilingCloseEvent) => {
    if (firstCloseEvent == null) firstCloseEvent = event;
  };

  const page = await session.context.newPage();
  const onDisconnected = () => noteClose("browser_disconnected");
  const onContextClose = () => noteClose("context_close");
  const onPageClose = () => noteClose("page_close");

  browser.on("disconnected", onDisconnected);
  session.context.on("close", onContextClose);
  page.on("close", onPageClose);

  const disposeListeners = () => {
    browser.off("disconnected", onDisconnected);
    session.context.off("close", onContextClose);
    page.off("close", onPageClose);
  };

  const snapshot = (): OwnedFilingLifecycleSnapshot => ({
    elapsed_ms: Math.max(0, Date.now() - startedAt),
    browser_connected: browser.isConnected(),
    page_closed: page.isClosed(),
    first_close_event: firstCloseEvent,
  });

  return { context: session.context, page, snapshot, disposeListeners };
}

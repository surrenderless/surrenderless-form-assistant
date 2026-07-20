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

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
 * newContext/newPage are wall-clock bounded — CDP wedges must not burn the Browserless session
 * before the first goto/evaluate.
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

  let openedPage: Page | null = null;

  const { context, page } = await withOwnedFilingNavigationTimeout(
    async () => {
      let context: BrowserContext;
      if (options.chromiumMode === "browserless") {
        const existing = browser.contexts()[0];
        context = existing ?? (await browser.newContext(options.contextOptions ?? {}));
      } else {
        context = await browser.newContext(options.contextOptions ?? {});
      }

      const blank = context.pages().find(isReusableBlankPage);
      const page = blank ?? (await context.newPage());
      openedPage = page;
      return { context, page };
    },
    OWNED_FILING_PAGE_NAVIGATION_TIMEOUT_MS,
    async () => {
      if (openedPage && !openedPage.isClosed()) {
        await abortOwnedFilingPageEvaluate(openedPage);
      }
    }
  );

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

/**
 * Node-local wall-clock bound for owned-filing page.goto / session CDP open.
 * Playwright's own goto timeout is CDP-mediated and ineffective when Browserless is wedged.
 */
export const OWNED_FILING_PAGE_NAVIGATION_TIMEOUT_MS = 60_000;

/**
 * Hard outer Node wall-clock budget for connect → first successful evaluate.
 * Cleared after first evaluate progress so healthy multi-step runs can continue.
 * Must stay well under Browserless’s historical ~300s session kill.
 */
export const OWNED_FILING_SESSION_BUDGET_MS = 60_000;

/** Fail-closed bound for browser.close so cleanup cannot burn remaining Browserless budget. */
export const OWNED_FILING_BROWSER_CLOSE_TIMEOUT_MS = 5_000;

/** Brief wait for ReportFraud interactive controls before the first FTC evaluate. */
export const OWNED_FILING_FTC_READY_WAIT_MS = 15_000;

export const OWNED_FILING_EVALUATE_TIMEOUT_REASON = "evaluate_timeout";

export const OWNED_FILING_NAVIGATION_TIMEOUT_REASON = "navigation_timeout";

export const OWNED_FILING_SESSION_TIMEOUT_REASON = "session_timeout";

export type OwnedFilingEvaluateRaceWinner =
  | "evaluate_timeout"
  | "evaluate_result"
  | "evaluate_target_closed"
  | "evaluate_error";

export type OwnedFilingNavigationRaceWinner =
  | "navigation_timeout"
  | "navigation_result"
  | "navigation_target_closed"
  | "navigation_error";

export type OwnedFilingSessionRaceWinner = "session_timeout" | "session_result";

/** Durable observability for evaluate timeout / race outcomes (safe for dry-run notes). */
export type OwnedFilingEvaluateTimeoutDiagnostics = {
  abort_timer_fired_at_ms: number | null;
  abort_close_ms: number | null;
  race_winner: OwnedFilingEvaluateRaceWinner;
};

/** Durable observability for navigation timeout / race outcomes (safe for dry-run notes). */
export type OwnedFilingNavigationTimeoutDiagnostics = {
  nav_timer_fired_at_ms: number | null;
  abort_close_ms: number | null;
  race_winner: OwnedFilingNavigationRaceWinner;
};

/** Durable observability for outer session budget outcomes (safe for dry-run notes). */
export type OwnedFilingSessionTimeoutDiagnostics = {
  budget_fired_at_ms: number | null;
  abort_close_ms: number | null;
  phase: string | null;
  race_winner: OwnedFilingSessionRaceWinner;
};

export function formatOwnedFilingEvaluateTimeoutDiagnostics(
  diagnostics: OwnedFilingEvaluateTimeoutDiagnostics
): string {
  return [
    `abort_timer_fired_at_ms=${diagnostics.abort_timer_fired_at_ms ?? "null"}`,
    `abort_close_ms=${diagnostics.abort_close_ms ?? "null"}`,
    `race_winner=${diagnostics.race_winner}`,
  ].join(" ");
}

export function formatOwnedFilingNavigationTimeoutDiagnostics(
  diagnostics: OwnedFilingNavigationTimeoutDiagnostics
): string {
  return [
    `nav_timer_fired_at_ms=${diagnostics.nav_timer_fired_at_ms ?? "null"}`,
    `abort_close_ms=${diagnostics.abort_close_ms ?? "null"}`,
    `race_winner=${diagnostics.race_winner}`,
  ].join(" ");
}

export function formatOwnedFilingSessionTimeoutDiagnostics(
  diagnostics: OwnedFilingSessionTimeoutDiagnostics
): string {
  return [
    `budget_fired_at_ms=${diagnostics.budget_fired_at_ms ?? "null"}`,
    `abort_close_ms=${diagnostics.abort_close_ms ?? "null"}`,
    `phase=${diagnostics.phase ?? "null"}`,
    `race_winner=${diagnostics.race_winner}`,
  ].join(" ");
}

export class OwnedFilingEvaluateTimeoutError extends Error {
  readonly reason = OWNED_FILING_EVALUATE_TIMEOUT_REASON;
  readonly diagnostics: OwnedFilingEvaluateTimeoutDiagnostics;

  constructor(
    timeoutMs: number = OWNED_FILING_PAGE_EVALUATE_TIMEOUT_MS,
    diagnostics: OwnedFilingEvaluateTimeoutDiagnostics = {
      abort_timer_fired_at_ms: null,
      abort_close_ms: null,
      race_winner: "evaluate_timeout",
    }
  ) {
    super(
      `owned-filing playwright evaluate_timeout after ${timeoutMs}ms (provider/${OWNED_FILING_EVALUATE_TIMEOUT_REASON}) ${formatOwnedFilingEvaluateTimeoutDiagnostics(diagnostics)}`
    );
    this.name = "OwnedFilingEvaluateTimeoutError";
    this.diagnostics = diagnostics;
  }
}

export function isOwnedFilingEvaluateTimeoutError(err: unknown): boolean {
  if (err instanceof OwnedFilingEvaluateTimeoutError) return true;
  const message = err instanceof Error ? err.message : String(err);
  return /evaluate_timeout/i.test(message);
}

export class OwnedFilingNavigationTimeoutError extends Error {
  readonly reason = OWNED_FILING_NAVIGATION_TIMEOUT_REASON;
  readonly diagnostics: OwnedFilingNavigationTimeoutDiagnostics;

  constructor(
    timeoutMs: number = OWNED_FILING_PAGE_NAVIGATION_TIMEOUT_MS,
    diagnostics: OwnedFilingNavigationTimeoutDiagnostics = {
      nav_timer_fired_at_ms: null,
      abort_close_ms: null,
      race_winner: "navigation_timeout",
    }
  ) {
    super(
      `owned-filing playwright navigation_timeout after ${timeoutMs}ms (provider/${OWNED_FILING_NAVIGATION_TIMEOUT_REASON}) ${formatOwnedFilingNavigationTimeoutDiagnostics(diagnostics)}`
    );
    this.name = "OwnedFilingNavigationTimeoutError";
    this.diagnostics = diagnostics;
  }
}

export function isOwnedFilingNavigationTimeoutError(err: unknown): boolean {
  if (err instanceof OwnedFilingNavigationTimeoutError) return true;
  const message = err instanceof Error ? err.message : String(err);
  return /navigation_timeout/i.test(message);
}

export class OwnedFilingSessionTimeoutError extends Error {
  readonly reason = OWNED_FILING_SESSION_TIMEOUT_REASON;
  readonly diagnostics: OwnedFilingSessionTimeoutDiagnostics;

  constructor(
    timeoutMs: number = OWNED_FILING_SESSION_BUDGET_MS,
    diagnostics: OwnedFilingSessionTimeoutDiagnostics = {
      budget_fired_at_ms: null,
      abort_close_ms: null,
      phase: null,
      race_winner: "session_timeout",
    }
  ) {
    super(
      `owned-filing playwright session_timeout after ${timeoutMs}ms (provider/${OWNED_FILING_SESSION_TIMEOUT_REASON}) ${formatOwnedFilingSessionTimeoutDiagnostics(diagnostics)}`
    );
    this.name = "OwnedFilingSessionTimeoutError";
    this.diagnostics = diagnostics;
  }
}

export function isOwnedFilingSessionTimeoutError(err: unknown): boolean {
  if (err instanceof OwnedFilingSessionTimeoutError) return true;
  const message = err instanceof Error ? err.message : String(err);
  return /session_timeout/i.test(message);
}

export type OwnedFilingSessionBudgetControl = {
  setPhase: (phase: string) => void;
  /** Disarm after first successful evaluate so healthy multi-step runs can continue. */
  clear: () => void;
};

/**
 * Fire-and-forget browser teardown — must not await wedged CDP close.
 */
export function destroyOwnedFilingBrowserBestEffort(
  browser: Browser | null | undefined
): void {
  if (!browser) return;
  try {
    void browser.close().catch(() => undefined);
  } catch {
    // ignore
  }
}

/**
 * Hard outer Node wall-clock budget around connect → first evaluate progress.
 * On timer fire: immediately reject OwnedFilingSessionTimeoutError, then fire-and-forget
 * onTimeoutAbort (typically destroyOwnedFilingBrowserBestEffort). Never awaits abort before reject.
 * Call control.clear() after the first successful page evaluate to disarm for the rest of the loop.
 */
export async function withOwnedFilingSessionBudget<T>(
  run: (control: OwnedFilingSessionBudgetControl) => Promise<T>,
  timeoutMs: number = OWNED_FILING_SESSION_BUDGET_MS,
  onTimeoutAbort?: () => void | Promise<void>
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let settled = false;
  let disarmed = false;
  let budgetFiredAtMs: number | null = null;
  let abortCloseMs: number | null = null;
  let phase: string | null = null;
  const startedAt = Date.now();

  const diagnostics = (
    winner: OwnedFilingSessionRaceWinner
  ): OwnedFilingSessionTimeoutDiagnostics => ({
    budget_fired_at_ms: budgetFiredAtMs,
    abort_close_ms: abortCloseMs,
    phase,
    race_winner: winner,
  });

  const control: OwnedFilingSessionBudgetControl = {
    setPhase: (next) => {
      if (!disarmed && !settled) phase = next;
    },
    clear: () => {
      disarmed = true;
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
    },
  };

  const runPromise = Promise.resolve()
    .then(() => run(control))
    .then(
      (value) => {
        if (settled && !disarmed) {
          return undefined as unknown as T;
        }
        settled = true;
        control.clear();
        return value;
      },
      (err: unknown) => {
        if (settled && !disarmed) {
          return undefined as unknown as T;
        }
        settled = true;
        control.clear();
        throw err;
      }
    );

  void runPromise.catch(() => undefined);

  try {
    return await Promise.race([
      runPromise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          if (settled || disarmed) return;
          settled = true;
          budgetFiredAtMs = Math.max(0, Date.now() - startedAt);
          reject(
            new OwnedFilingSessionTimeoutError(timeoutMs, diagnostics("session_timeout"))
          );
          void (async () => {
            const closeStarted = Date.now();
            try {
              await onTimeoutAbort?.();
            } catch {
              // best-effort
            } finally {
              abortCloseMs = Math.max(0, Date.now() - closeStarted);
              console.warn(
                "owned-filing session_timeout abort finished:",
                formatOwnedFilingSessionTimeoutDiagnostics(diagnostics("session_timeout"))
              );
            }
          })();
        }, timeoutMs);
      }),
    ]);
  } finally {
    control.clear();
  }
}

/**
 * Best-effort abort of an in-flight page.evaluate by closing the page.
 * Closing the execution context forces Playwright's pending evaluate to reject.
 */
export async function abortOwnedFilingPageEvaluate(page: Page): Promise<void> {
  try {
    if (!page.isClosed()) {
      await page.close();
    }
  } catch {
    // best-effort — timeout path still rejects with evaluate_timeout
  }
}

/**
 * Bounds an async evaluate (or similar) with a wall-clock timeout.
 * On timer fire: immediately reject with OwnedFilingEvaluateTimeoutError, then fire-and-forget
 * onTimeoutAbort (typically page.close). Never awaits abort before reject — a wedged Browserless
 * CDP close must not delay evaluate_timeout. Post-abort evaluate rejections are swallowed.
 */
export async function withOwnedFilingEvaluateTimeout<T>(
  run: () => Promise<T>,
  timeoutMs: number = OWNED_FILING_PAGE_EVALUATE_TIMEOUT_MS,
  onTimeoutAbort?: () => void | Promise<void>
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let settled = false;
  let abortStarted = false;
  let abortTimerFiredAtMs: number | null = null;
  let abortCloseMs: number | null = null;
  const startedAt = Date.now();

  const diagnostics = (
    winner: OwnedFilingEvaluateRaceWinner
  ): OwnedFilingEvaluateTimeoutDiagnostics => ({
    abort_timer_fired_at_ms: abortTimerFiredAtMs,
    abort_close_ms: abortCloseMs,
    race_winner: winner,
  });

  const runPromise = Promise.resolve()
    .then(() => run())
    .then(
      (value) => {
        if (abortStarted || settled) {
          return undefined as unknown as T;
        }
        settled = true;
        return value;
      },
      (err: unknown) => {
        if (abortStarted || settled) {
          // Swallow post-abort / late rejections — race already settled or settling via timeout.
          return undefined as unknown as T;
        }
        settled = true;
        if (isOwnedFilingTargetClosedError(err)) {
          const message = err instanceof Error ? err.message : String(err);
          throw new Error(
            `${message} ${formatOwnedFilingEvaluateTimeoutDiagnostics(
              diagnostics("evaluate_target_closed")
            )}`
          );
        }
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(
          `${message} ${formatOwnedFilingEvaluateTimeoutDiagnostics(diagnostics("evaluate_error"))}`
        );
      }
    );

  // Avoid unhandledRejection if evaluate settles after timeout already won the race.
  void runPromise.catch(() => undefined);

  try {
    return await Promise.race([
      runPromise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          if (settled) return;
          abortStarted = true;
          abortTimerFiredAtMs = Math.max(0, Date.now() - startedAt);
          settled = true;
          // Reject immediately — do not await abort/page.close on a possibly wedged CDP.
          reject(
            new OwnedFilingEvaluateTimeoutError(timeoutMs, diagnostics("evaluate_timeout"))
          );
          void (async () => {
            const closeStarted = Date.now();
            try {
              await onTimeoutAbort?.();
            } catch {
              // best-effort abort
            } finally {
              abortCloseMs = Math.max(0, Date.now() - closeStarted);
              console.warn(
                "owned-filing evaluate_timeout abort finished:",
                formatOwnedFilingEvaluateTimeoutDiagnostics(diagnostics("evaluate_timeout"))
              );
            }
          })();
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Bounds an async navigation (or session CDP open) with a Node-local wall-clock timeout.
 * On timer fire: immediately reject with OwnedFilingNavigationTimeoutError, then fire-and-forget
 * onTimeoutAbort (typically page.close). Never awaits abort before reject — Playwright's own
 * goto timeout is CDP-mediated and must not be the only bound when Browserless is wedged.
 * Post-abort navigation rejections are swallowed.
 */
export async function withOwnedFilingNavigationTimeout<T>(
  run: () => Promise<T>,
  timeoutMs: number = OWNED_FILING_PAGE_NAVIGATION_TIMEOUT_MS,
  onTimeoutAbort?: () => void | Promise<void>
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let settled = false;
  let abortStarted = false;
  let navTimerFiredAtMs: number | null = null;
  let abortCloseMs: number | null = null;
  const startedAt = Date.now();

  const diagnostics = (
    winner: OwnedFilingNavigationRaceWinner
  ): OwnedFilingNavigationTimeoutDiagnostics => ({
    nav_timer_fired_at_ms: navTimerFiredAtMs,
    abort_close_ms: abortCloseMs,
    race_winner: winner,
  });

  const runPromise = Promise.resolve()
    .then(() => run())
    .then(
      (value) => {
        if (abortStarted || settled) {
          return undefined as unknown as T;
        }
        settled = true;
        return value;
      },
      (err: unknown) => {
        if (abortStarted || settled) {
          return undefined as unknown as T;
        }
        settled = true;
        if (isOwnedFilingTargetClosedError(err)) {
          const message = err instanceof Error ? err.message : String(err);
          throw new Error(
            `${message} ${formatOwnedFilingNavigationTimeoutDiagnostics(
              diagnostics("navigation_target_closed")
            )}`
          );
        }
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(
          `${message} ${formatOwnedFilingNavigationTimeoutDiagnostics(
            diagnostics("navigation_error")
          )}`
        );
      }
    );

  void runPromise.catch(() => undefined);

  try {
    return await Promise.race([
      runPromise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          if (settled) return;
          abortStarted = true;
          navTimerFiredAtMs = Math.max(0, Date.now() - startedAt);
          settled = true;
          reject(
            new OwnedFilingNavigationTimeoutError(timeoutMs, diagnostics("navigation_timeout"))
          );
          void (async () => {
            const closeStarted = Date.now();
            try {
              await onTimeoutAbort?.();
            } catch {
              // best-effort abort
            } finally {
              abortCloseMs = Math.max(0, Date.now() - closeStarted);
              console.warn(
                "owned-filing navigation_timeout abort finished:",
                formatOwnedFilingNavigationTimeoutDiagnostics(diagnostics("navigation_timeout"))
              );
            }
          })();
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * page.goto with a Node-local wall-clock bound. Playwright's timeout option is kept as a
 * secondary CDP-side hint but is not relied on when Browserless is wedged.
 */
export async function gotoOwnedFilingPage(
  page: Page,
  url: string,
  options?: {
    timeoutMs?: number;
    playwrightGotoTimeoutMs?: number;
  }
): Promise<void> {
  const timeoutMs = options?.timeoutMs ?? OWNED_FILING_PAGE_NAVIGATION_TIMEOUT_MS;
  const playwrightGotoTimeoutMs =
    options?.playwrightGotoTimeoutMs ?? Math.min(timeoutMs, OWNED_FILING_PAGE_NAVIGATION_TIMEOUT_MS);
  await withOwnedFilingNavigationTimeout(
    () =>
      page.goto(url, {
        timeout: playwrightGotoTimeoutMs,
        waitUntil: "domcontentloaded",
      }),
    timeoutMs,
    () => abortOwnedFilingPageEvaluate(page)
  );
}

/**
 * Closes a Playwright browser with a short fail-closed timeout.
 * Logs and swallows close errors so cleanup cannot hang the request.
 */
export async function closeOwnedFilingBrowserFailClosed(
  browser: Browser | null | undefined,
  options?: { timeoutMs?: number; logLabel?: string }
): Promise<void> {
  if (!browser) return;
  const timeoutMs = options?.timeoutMs ?? OWNED_FILING_BROWSER_CLOSE_TIMEOUT_MS;
  const logLabel = options?.logLabel ?? "owned-filing";
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      browser.close(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`${logLabel}: browser.close timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } catch (closeErr: unknown) {
    const message = closeErr instanceof Error ? closeErr.message : String(closeErr);
    console.warn(`${logLabel}: browser close error:`, message);
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
 * Playwright options must be the 3rd argument to waitForFunction (2nd is pageFunction arg).
 * Closed-target errors propagate; a normal readiness timeout stays soft so bounded evaluate can run.
 */
export const OWNED_FILING_FTC_READY_SELECTOR =
  'button, a[href], input, select, textarea, [role="button"]';

export function isOwnedFilingClosedTargetProviderError(err: unknown): boolean {
  if (isOwnedFilingTargetClosedError(err)) return true;
  const message = err instanceof Error ? err.message : String(err);
  return (
    /browser.*(disconnected|has been closed)/i.test(message) ||
    /context.*(closed|destroyed)/i.test(message) ||
    /target closed/i.test(message)
  );
}

function isOwnedFilingReadyWaitTimeoutError(err: unknown): boolean {
  if (err && typeof err === "object" && "name" in err && (err as { name: unknown }).name === "TimeoutError") {
    return true;
  }
  const message = err instanceof Error ? err.message : String(err);
  return /timeout/i.test(message);
}

export async function waitForFtcReportFraudInteractiveReady(
  page: Page,
  timeoutMs: number = OWNED_FILING_FTC_READY_WAIT_MS
): Promise<void> {
  try {
    // arg is 2nd; options (including timeout) must be 3rd — default timeout is 0 (unbounded).
    await page.waitForFunction(
      (selector: string) => {
        if (!document.body) return false;
        return !!document.querySelector(selector);
      },
      OWNED_FILING_FTC_READY_SELECTOR,
      { timeout: timeoutMs }
    );
  } catch (err: unknown) {
    if (isOwnedFilingClosedTargetProviderError(err)) throw err;
    if (isOwnedFilingReadyWaitTimeoutError(err)) return;
    throw err;
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

/** Bounded FTC Browserless stage names for Production timing diagnostics. */
export type OwnedFilingFtcStageName =
  | "connect_cdp"
  | "open_session"
  | "goto_1"
  | "ready_1"
  | "evaluate_1"
  | "retry_replace"
  | "goto_2"
  | "ready_2"
  | "evaluate_2";

export type OwnedFilingFtcStageRecord = {
  stage: OwnedFilingFtcStageName;
  duration_ms: number;
  ok: boolean;
  /** Short sanitized category only — never raw page HTML, tokens, or form values. */
  error_category?: string;
};

const MAX_TIMELINE_CHARS = 700;

export type OwnedFilingFtcStageCloseSnapshot = {
  first_close_event: string | null;
};

/**
 * Maps errors to short non-sensitive categories for stage timelines.
 * Never returns emails, tokens, HTML, or free-form page content.
 */
export function categorizeOwnedFilingFtcStageError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/evaluate_timeout/i.test(message)) return "evaluate_timeout";
  if (/target page, context or browser has been closed/i.test(message)) return "target_closed";
  if (/browser.*(disconnected|has been closed)/i.test(message)) return "browser_disconnected";
  if (/context.*(closed|destroyed)/i.test(message)) return "context_closed";
  if (/TimeoutError/i.test(message) || /\btimeout\b/i.test(message)) return "timeout";
  if (/net::|NS_ERROR|Navigation|goto/i.test(message)) return "navigation_error";
  return "error";
}

export function createOwnedFilingFtcStageTiming() {
  const stages: OwnedFilingFtcStageRecord[] = [];
  let activeStage: OwnedFilingFtcStageName | null = null;
  let stageStartedAt = 0;
  let closeDuringStage: OwnedFilingFtcStageName | null = null;
  let sawCloseEvent = false;

  function begin(stage: OwnedFilingFtcStageName): void {
    activeStage = stage;
    stageStartedAt = Date.now();
  }

  function noteCloseFromSnapshot(snapshot: OwnedFilingFtcStageCloseSnapshot | null | undefined): void {
    if (sawCloseEvent || closeDuringStage) return;
    if (!snapshot?.first_close_event || snapshot.first_close_event === "none") return;
    sawCloseEvent = true;
    if (activeStage) closeDuringStage = activeStage;
  }

  function endOk(): void {
    if (!activeStage) return;
    stages.push({
      stage: activeStage,
      duration_ms: Math.max(0, Date.now() - stageStartedAt),
      ok: true,
    });
    activeStage = null;
  }

  function endFail(err: unknown): void {
    if (!activeStage) return;
    stages.push({
      stage: activeStage,
      duration_ms: Math.max(0, Date.now() - stageStartedAt),
      ok: false,
      error_category: categorizeOwnedFilingFtcStageError(err),
    });
    activeStage = null;
  }

  async function run<T>(
    stage: OwnedFilingFtcStageName,
    fn: () => Promise<T>,
    getCloseSnapshot?: () => OwnedFilingFtcStageCloseSnapshot | null | undefined
  ): Promise<T> {
    begin(stage);
    try {
      const result = await fn();
      if (getCloseSnapshot) noteCloseFromSnapshot(getCloseSnapshot());
      endOk();
      return result;
    } catch (err: unknown) {
      if (getCloseSnapshot) noteCloseFromSnapshot(getCloseSnapshot());
      endFail(err);
      throw err;
    }
  }

  function formatTimeline(): string {
    const parts = stages.map((s) =>
      s.ok
        ? `${s.stage}:${s.duration_ms}ms:ok`
        : `${s.stage}:${s.duration_ms}ms:fail:${s.error_category ?? "error"}`
    );
    if (activeStage) {
      parts.push(`${activeStage}:${Math.max(0, Date.now() - stageStartedAt)}ms:active`);
    }
    let out = `stages=${parts.join(";")}`;
    if (closeDuringStage) {
      out += `;close_during=${closeDuringStage}`;
    }
    return out.length <= MAX_TIMELINE_CHARS ? out : `${out.slice(0, MAX_TIMELINE_CHARS - 3)}...`;
  }

  function attachToError(err: unknown): Error {
    const timeline = formatTimeline();
    const base = err instanceof Error ? err.message : String(err);
    if (base.includes("stages=")) {
      return err instanceof Error ? err : new Error(base);
    }
    const message = timeline ? `${base} | ${timeline}` : base;
    const wrapped = new Error(message);
    if (err instanceof Error && err.name) wrapped.name = err.name;
    return wrapped;
  }

  return {
    begin,
    endOk,
    endFail,
    run,
    noteCloseFromSnapshot,
    formatTimeline,
    attachToError,
    getRecords: () => stages.slice(),
    getCloseDuringStage: () => closeDuringStage,
    getActiveStage: () => activeStage,
  };
}

export type OwnedFilingFtcStageTiming = ReturnType<typeof createOwnedFilingFtcStageTiming>;

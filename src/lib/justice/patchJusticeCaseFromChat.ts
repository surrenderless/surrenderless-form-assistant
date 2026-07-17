import { OWNED_FILING_TASK_ENSURE_RETRYABLE_ERROR } from "@/lib/justice/ensureOwnedFilingTaskAfterClientStateWrite";

export type PatchJusticeCaseFromChatFetch = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

export type PatchJusticeCaseFromChatSuccess = {
  ok: true;
  status: number;
  data: Record<string, unknown>;
  attempts: number;
};

export type PatchJusticeCaseFromChatFailure = {
  ok: false;
  status: number;
  error: string;
  /** True when every attempt ended with the owned-filing ensure retriable 500. */
  retryableOwnedFilingEnsure: boolean;
  attempts: number;
};

export type PatchJusticeCaseFromChatResult =
  | PatchJusticeCaseFromChatSuccess
  | PatchJusticeCaseFromChatFailure;

const DEFAULT_MAX_ATTEMPTS = 3;

export function isOwnedFilingTaskEnsureRetryableError(error: string | null | undefined): boolean {
  return (error ?? "").trim() === OWNED_FILING_TASK_ENSURE_RETRYABLE_ERROR;
}

/** Parse `{ error: string }` from a justice case API response body. */
export async function parseJusticeCaseApiError(res: Response): Promise<string | null> {
  try {
    const body = (await res.json()) as unknown;
    if (
      body !== null &&
      typeof body === "object" &&
      !Array.isArray(body) &&
      typeof (body as { error?: unknown }).error === "string"
    ) {
      const error = (body as { error: string }).error.trim();
      return error || null;
    }
  } catch {
    // ignore non-JSON bodies
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * PATCH /api/justice/cases/[id] with bounded retries only for owned-filing ensure
 * retriable failures (HTTP 500 + OWNED_FILING_TASK_ENSURE_RETRYABLE_ERROR).
 */
export async function patchJusticeCaseFromChat(params: {
  caseId: string;
  patch: Record<string, unknown>;
  fetchFn?: PatchJusticeCaseFromChatFetch;
  /** Total attempts including the first (default 3). */
  maxAttempts?: number;
  retryDelayMs?: number;
  logLabel?: string;
}): Promise<PatchJusticeCaseFromChatResult> {
  const caseId = params.caseId.trim();
  const fetchFn = params.fetchFn ?? fetch;
  const maxAttempts = Math.max(1, params.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
  const retryDelayMs = params.retryDelayMs ?? 0;
  const logLabel = params.logLabel ?? "justice chat";

  if (!caseId) {
    return {
      ok: false,
      status: 400,
      error: "Missing case id",
      retryableOwnedFilingEnsure: false,
      attempts: 0,
    };
  }

  let lastStatus = 0;
  let lastError = "Request failed";
  let lastWasRetryable = false;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const res = await fetchFn(`/api/justice/cases/${encodeURIComponent(caseId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params.patch),
      });

      if (res.ok) {
        let data: Record<string, unknown> = {};
        try {
          const body = (await res.json()) as unknown;
          if (body !== null && typeof body === "object" && !Array.isArray(body)) {
            data = body as Record<string, unknown>;
          }
        } catch {
          // empty / non-JSON success body is fine
        }
        return { ok: true, status: res.status, data, attempts: attempt };
      }

      const error = (await parseJusticeCaseApiError(res)) ?? `Request failed (${res.status})`;
      lastStatus = res.status;
      lastError = error;
      lastWasRetryable =
        res.status === 500 && isOwnedFilingTaskEnsureRetryableError(error);

      if (!lastWasRetryable || attempt >= maxAttempts) {
        if (!lastWasRetryable) {
          console.warn(`${logLabel}: PATCH /api/justice/cases/[id] failed`, res.status);
        } else {
          console.warn(
            `${logLabel}: PATCH owned-filing ensure still failing after ${attempt} attempt(s)`,
            error
          );
        }
        return {
          ok: false,
          status: lastStatus,
          error: lastError,
          retryableOwnedFilingEnsure: lastWasRetryable,
          attempts: attempt,
        };
      }

      console.warn(
        `${logLabel}: PATCH owned-filing ensure retryable; retrying`,
        `attempt ${attempt}/${maxAttempts}`
      );
      await sleep(retryDelayMs);
    } catch (e) {
      console.warn(`${logLabel}: PATCH /api/justice/cases/[id] error`, e);
      return {
        ok: false,
        status: 0,
        error: "Network error",
        retryableOwnedFilingEnsure: false,
        attempts: attempt,
      };
    }
  }

  return {
    ok: false,
    status: lastStatus,
    error: lastError,
    retryableOwnedFilingEnsure: lastWasRetryable,
    attempts: maxAttempts,
  };
}

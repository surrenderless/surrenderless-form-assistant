import {
  normalizeFormDecision,
  type AssistedFormPageData,
  type FormDecision,
} from "@/lib/justice/realBbbBoundedSubmitLoop";

export const OWNED_FILING_FTC_DECIDE_TIMEOUT_MS = 60_000;

type FtcDecisionResult =
  | { ok: true; decision: FormDecision }
  | { ok: false; stopReason: "decide_action_failed" | "invalid_decision"; detail: string };

function isAbortTimeout(err: unknown): boolean {
  if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
    return true;
  }
  return /\b(abort|timeout)\b/i.test(err instanceof Error ? err.message : String(err));
}

export async function fetchOwnedFilingFtcFormDecision(
  base: string,
  forwardedHeaders: Record<string, string>,
  pageData: AssistedFormPageData,
  userData: Record<string, unknown>
): Promise<FtcDecisionResult> {
  let res: Response;
  let payload: { decision?: unknown };
  try {
    res = await fetch(`${base}/api/decide-action`, {
      method: "POST",
      headers: forwardedHeaders,
      body: JSON.stringify({ pageData, userProfile: userData, userData }),
      signal: AbortSignal.timeout(OWNED_FILING_FTC_DECIDE_TIMEOUT_MS),
    });
    payload = (await res.json().catch((err: unknown) => {
      if (isAbortTimeout(err)) throw err;
      return {};
    })) as { decision?: unknown };
  } catch (err: unknown) {
    if (isAbortTimeout(err)) {
      throw new Error(
        `owned-filing decide_timeout after ${OWNED_FILING_FTC_DECIDE_TIMEOUT_MS}ms`
      );
    }
    throw err;
  }

  if (!res.ok) {
    return {
      ok: false,
      stopReason: "decide_action_failed",
      detail: `decide-action failed (${res.status})`,
    };
  }
  const normalized = normalizeFormDecision(payload.decision);
  if (!normalized) {
    return {
      ok: false,
      stopReason: "invalid_decision",
      detail: "decide-action returned an invalid decision shape",
    };
  }
  return { ok: true, decision: normalized };
}

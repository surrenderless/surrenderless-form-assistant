import {
  DECIDE_ACTION_FTC_FORM_MAIN_MODE,
  DECIDE_ACTION_FTC_MODE,
} from "@/lib/justice/decideActionFtcStructured";
import {
  normalizeFormDecision,
  type AssistedFormPageData,
  type FormDecision,
} from "@/lib/justice/realBbbBoundedSubmitLoop";
import { isFtcReportFormMainUrl } from "@/lib/justice/realFtcBoundedSubmitLoop";

export const OWNED_FILING_FTC_DECIDE_TIMEOUT_MS = 60_000;

/** Allowlisted `/api/decide-action` failure categories — never free-form text. */
const DECIDE_ACTION_FAILURE_CATEGORIES = new Set([
  "openai_request_failed",
  "empty_model_content",
  "model_json_parse_failed",
  "route_exception",
]);

type FtcDecisionResult =
  | { ok: true; decision: FormDecision }
  | { ok: false; stopReason: "decide_action_failed" | "invalid_decision"; detail: string };

/** FTC decide-action mode from the live page URL (/form/main vs assistant). */
export function decideActionModeForFtcPageUrl(url: string | undefined): string {
  return isFtcReportFormMainUrl(url ?? "")
    ? DECIDE_ACTION_FTC_FORM_MAIN_MODE
    : DECIDE_ACTION_FTC_MODE;
}

function isAbortTimeout(err: unknown): boolean {
  if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
    return true;
  }
  return /\b(abort|timeout)\b/i.test(err instanceof Error ? err.message : String(err));
}

function sanitizeDecideActionFailureCategory(value: unknown): string | null {
  return typeof value === "string" && DECIDE_ACTION_FAILURE_CATEGORIES.has(value) ? value : null;
}

function sanitizeUpstreamStatus(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const code = Math.trunc(value);
  if (code < 100 || code > 599) return null;
  return code;
}

/** Builds internal step detail: status, allowlisted category, optional upstream_status only. */
export function buildDecideActionFailedDetail(
  httpStatus: number,
  payload: { error?: unknown; upstream_status?: unknown }
): string {
  const category = sanitizeDecideActionFailureCategory(payload.error);
  const upstream = sanitizeUpstreamStatus(payload.upstream_status);
  if (!category) {
    return `decide-action failed (${httpStatus})`;
  }
  if (upstream != null) {
    return `decide-action failed (${httpStatus}:${category}:upstream_${upstream})`;
  }
  return `decide-action failed (${httpStatus}:${category})`;
}

export async function fetchOwnedFilingFtcFormDecision(
  base: string,
  forwardedHeaders: Record<string, string>,
  pageData: AssistedFormPageData,
  userData: Record<string, unknown>
): Promise<FtcDecisionResult> {
  let res: Response;
  let payload: { decision?: unknown; error?: unknown; upstream_status?: unknown };
  try {
    res = await fetch(`${base}/api/decide-action`, {
      method: "POST",
      headers: forwardedHeaders,
      body: JSON.stringify({
        pageData,
        userProfile: userData,
        userData,
        mode: decideActionModeForFtcPageUrl(pageData.url),
      }),
      signal: AbortSignal.timeout(OWNED_FILING_FTC_DECIDE_TIMEOUT_MS),
    });
    payload = (await res.json().catch((err: unknown) => {
      if (isAbortTimeout(err)) throw err;
      return {};
    })) as { decision?: unknown; error?: unknown; upstream_status?: unknown };
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
      detail: buildDecideActionFailedDetail(res.status, payload),
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

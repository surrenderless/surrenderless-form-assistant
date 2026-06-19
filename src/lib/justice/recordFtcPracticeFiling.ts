import type { RunFtcPracticeSuccess } from "@/lib/justice/runFtcPractice";

export const FTC_PRACTICE_FILING_DESTINATION = "FTC (practice)";

export const FTC_PRACTICE_FILING_CONFIRMATION = "FTC mock practice complete";

function parseFtcPracticeFillResult(technicalDetails: string): {
  screenshot?: string;
  storageReason?: string;
} {
  try {
    const parsed = JSON.parse(technicalDetails) as {
      fillResult?: { screenshot?: string; storageReason?: string };
    };
    const fillResult = parsed.fillResult;
    if (!fillResult || typeof fillResult !== "object") return {};
    return {
      screenshot:
        typeof fillResult.screenshot === "string" && fillResult.screenshot.trim()
          ? fillResult.screenshot.trim()
          : undefined,
      storageReason:
        typeof fillResult.storageReason === "string" && fillResult.storageReason.trim()
          ? fillResult.storageReason.trim()
          : undefined,
    };
  } catch {
    return {};
  }
}

export function buildFtcPracticeFilingBody(result: RunFtcPracticeSuccess): Record<string, string> {
  const { screenshot, storageReason } = parseFtcPracticeFillResult(result.technicalDetails);
  const noteParts = [
    "Mock FTC practice autofill completed (/mock/ftc-complaint).",
    result.storageSkipped ? "Screenshot storage skipped on this run." : null,
    storageReason ?? null,
  ].filter((part): part is string => Boolean(part));

  const body: Record<string, string> = {
    destination: FTC_PRACTICE_FILING_DESTINATION,
    filed_at: new Date().toISOString(),
    confirmation_number: FTC_PRACTICE_FILING_CONFIRMATION,
    notes: noteParts.join(" "),
  };
  if (screenshot) body.filing_url = screenshot;
  return body;
}

export type RecordFtcPracticeFilingResult =
  | { ok: true; payload: unknown }
  | { ok: false; error: string };

/** Persist a mock FTC practice run as a justice_case_filings row (practice lane only). */
export async function recordFtcPracticeFiling(
  caseId: string,
  result: RunFtcPracticeSuccess
): Promise<RecordFtcPracticeFilingResult> {
  try {
    const res = await fetch("/api/justice/filings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        case_id: caseId,
        ...buildFtcPracticeFilingBody(result),
      }),
    });
    const payload: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const err = (payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {}) as {
        error?: string;
      };
      return { ok: false, error: err.error ?? "Could not save filing record." };
    }
    return { ok: true, payload };
  } catch {
    return { ok: false, error: "Could not save filing record." };
  }
}

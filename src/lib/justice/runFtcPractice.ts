import { intakeToMockFtcUserData } from "@/lib/justice/ftc-user-data";
import {
  buildMockFtcPracticeSubmissionUrl,
  MOCK_FTC_PRACTICE_ASSISTED_SUBMISSION_LANE,
} from "@/lib/justice/assistedSubmissionLane";
import { appendTimelineEvent, readTimeline, replaceTimelineForCase } from "@/lib/justice/timeline";
import type { JusticeIntake, TimelineEntry } from "@/lib/justice/types";

export const FTC_MOCK_COMPLETED_SESSION_KEY = "justice_ftc_mock_completed";

export function buildFtcPracticeSummaryLines(intake: JusticeIntake): string[] {
  return [
    `Company: ${intake.company_name}`,
    `Issue: ${intake.problem_category.replace(/_/g, " ")}`,
    `Story: ${intake.story.slice(0, 200)}${intake.story.length > 200 ? "…" : ""}`,
    `Money: ${intake.money_involved}`,
    `Order/pay date: ${intake.pay_or_order_date}`,
    `Your email: ${intake.reply_email}`,
  ];
}

async function logFtcPracticeEvent(event_name: string, payload: Record<string, unknown>): Promise<void> {
  try {
    await fetch("/api/justice/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event_name, payload }),
    });
  } catch {
    /* ignore */
  }
}

async function syncFtcPracticeTimelineToServer(
  caseId: string | null,
  isLoaded: boolean,
  isSignedIn: boolean,
  logLabel: string
): Promise<void> {
  if (!caseId || !isLoaded || !isSignedIn) return;
  try {
    const timeline = readTimeline(caseId);
    const res = await fetch(`/api/justice/cases/${encodeURIComponent(caseId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timeline }),
    });
    if (res.ok) {
      const payload = (await res.json()) as { timeline?: unknown };
      if (Array.isArray(payload.timeline)) {
        replaceTimelineForCase(caseId, payload.timeline as TimelineEntry[]);
      }
    } else {
      console.warn(`${logLabel}: PATCH /api/justice/cases/[id] failed`, res.status);
    }
  } catch (e) {
    console.warn(`${logLabel}: PATCH /api/justice/cases/[id] error`, e);
  }
}

export type RunFtcPracticeParams = {
  intake: JusticeIntake;
  caseId: string | null;
  isLoaded: boolean;
  isSignedIn: boolean;
  logLabel?: string;
};

export type RunFtcPracticeSuccess = {
  ok: true;
  storageSkipped: boolean;
  technicalDetails: string;
};

export type RunFtcPracticeFailure = {
  ok: false;
  error: string;
};

export type RunFtcPracticeResult = RunFtcPracticeSuccess | RunFtcPracticeFailure;

/** Run internal mock FTC practice autofill (timeline, events, session flag). */
export async function runFtcPractice({
  intake,
  caseId,
  isLoaded,
  isSignedIn,
  logLabel = "justice ftc-review",
}: RunFtcPracticeParams): Promise<RunFtcPracticeResult> {
  if (typeof window === "undefined") {
    return { ok: false, error: "Practice autofill is only available in the browser." };
  }

  const mockUrl = buildMockFtcPracticeSubmissionUrl(window.location.origin);
  const userData = intakeToMockFtcUserData(intake);

  if (caseId) {
    appendTimelineEvent(caseId, { type: "ftc_practice_started", label: "FTC practice started" });
  }
  await syncFtcPracticeTimelineToServer(caseId, isLoaded, isSignedIn, logLabel);
  await logFtcPracticeEvent("ftc_mock_lane_started", {
    case_id: caseId,
    mock_path: MOCK_FTC_PRACTICE_ASSISTED_SUBMISSION_LANE.mockUrlPath,
  });

  try {
    const res = await fetch("/api/submit-form", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ url: mockUrl, userData }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error((data as { error?: string }).error || "Request failed");
    }

    await logFtcPracticeEvent("ftc_mock_lane_completed", { case_id: caseId, outcome: "success" });
    sessionStorage.setItem(FTC_MOCK_COMPLETED_SESSION_KEY, "1");
    const fillResult = (data as { fillResult?: { storageSkipped?: boolean } }).fillResult;
    if (caseId) {
      appendTimelineEvent(caseId, {
        type: "ftc_practice_completed",
        label: "FTC practice completed",
        detail: fillResult?.storageSkipped ? "Screenshot storage skipped locally" : undefined,
      });
    }
    await syncFtcPracticeTimelineToServer(caseId, isLoaded, isSignedIn, logLabel);

    return {
      ok: true,
      storageSkipped: fillResult?.storageSkipped === true,
      technicalDetails: JSON.stringify(data, null, 2),
    };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Something went wrong.";
    await logFtcPracticeEvent("ftc_mock_lane_completed", {
      case_id: caseId,
      outcome: "failed",
      error: message.slice(0, 200),
    });
    if (caseId) {
      appendTimelineEvent(caseId, {
        type: "ftc_practice_completed",
        label: "FTC practice completed",
        detail: "Did not complete",
      });
    }
    await syncFtcPracticeTimelineToServer(caseId, isLoaded, isSignedIn, logLabel);
    return { ok: false, error: message };
  }
}

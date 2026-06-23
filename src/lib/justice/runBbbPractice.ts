import { intakeToMockFtcUserData } from "@/lib/justice/ftc-user-data";
import {
  MOCK_BBB_PRACTICE_ASSISTED_SUBMISSION_LANE,
  resolveAssistedSubmissionFillUrl,
} from "@/lib/justice/assistedSubmissionLane";
import { appendTimelineEvent, readTimeline, replaceTimelineForCase } from "@/lib/justice/timeline";
import type { JusticeIntake, TimelineEntry } from "@/lib/justice/types";

export const BBB_MOCK_COMPLETED_SESSION_KEY = "justice_bbb_mock_completed";

/** Maps intake to `/mock/bbb-complaint` field names (same stable ids as the mock page). */
export function intakeToMockBbbUserData(intake: JusticeIntake): Record<string, string> {
  return intakeToMockFtcUserData(intake);
}

export function buildBbbPracticeSummaryLines(intake: JusticeIntake): string[] {
  return [
    `Company: ${intake.company_name}`,
    `Issue: ${intake.problem_category.replace(/_/g, " ")}`,
    `Story: ${intake.story.slice(0, 200)}${intake.story.length > 200 ? "…" : ""}`,
    `Money: ${intake.money_involved}`,
    `Order/pay date: ${intake.pay_or_order_date}`,
    `Your email: ${intake.reply_email}`,
  ];
}

async function logBbbPracticeEvent(event_name: string, payload: Record<string, unknown>): Promise<void> {
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

async function syncBbbPracticeTimelineToServer(
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

export type RunBbbPracticeParams = {
  intake: JusticeIntake;
  caseId: string | null;
  isLoaded: boolean;
  isSignedIn: boolean;
  logLabel?: string;
};

export type RunBbbPracticeSuccess = {
  ok: true;
  storageSkipped: boolean;
  technicalDetails: string;
};

export type RunBbbPracticeFailure = {
  ok: false;
  error: string;
};

export type RunBbbPracticeResult = RunBbbPracticeSuccess | RunBbbPracticeFailure;

/** Run internal mock BBB practice autofill (timeline, events, session flag). */
export async function runBbbPractice({
  intake,
  caseId,
  isLoaded,
  isSignedIn,
  logLabel = "justice bbb-practice",
}: RunBbbPracticeParams): Promise<RunBbbPracticeResult> {
  if (typeof window === "undefined") {
    return { ok: false, error: "Practice autofill is only available in the browser." };
  }

  const mockUrl = resolveAssistedSubmissionFillUrl(
    MOCK_BBB_PRACTICE_ASSISTED_SUBMISSION_LANE,
    window.location.origin
  );
  const userData = intakeToMockBbbUserData(intake);

  if (caseId) {
    appendTimelineEvent(caseId, { type: "bbb_practice_started", label: "BBB practice started" });
  }
  await syncBbbPracticeTimelineToServer(caseId, isLoaded, isSignedIn, logLabel);
  await logBbbPracticeEvent("bbb_mock_lane_started", {
    case_id: caseId,
    mock_path: MOCK_BBB_PRACTICE_ASSISTED_SUBMISSION_LANE.mockUrlPath,
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

    await logBbbPracticeEvent("bbb_mock_lane_completed", { case_id: caseId, outcome: "success" });
    sessionStorage.setItem(BBB_MOCK_COMPLETED_SESSION_KEY, "1");
    const fillResult = (data as { fillResult?: { storageSkipped?: boolean } }).fillResult;
    if (caseId) {
      appendTimelineEvent(caseId, {
        type: "bbb_practice_completed",
        label: "BBB practice completed",
        detail: fillResult?.storageSkipped ? "Screenshot storage skipped locally" : undefined,
      });
    }
    await syncBbbPracticeTimelineToServer(caseId, isLoaded, isSignedIn, logLabel);

    return {
      ok: true,
      storageSkipped: fillResult?.storageSkipped === true,
      technicalDetails: JSON.stringify(data, null, 2),
    };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Something went wrong.";
    await logBbbPracticeEvent("bbb_mock_lane_completed", {
      case_id: caseId,
      outcome: "failed",
      error: message.slice(0, 200),
    });
    if (caseId) {
      appendTimelineEvent(caseId, {
        type: "bbb_practice_completed",
        label: "BBB practice completed",
        detail: "Did not complete",
      });
    }
    await syncBbbPracticeTimelineToServer(caseId, isLoaded, isSignedIn, logLabel);
    return { ok: false, error: message };
  }
}

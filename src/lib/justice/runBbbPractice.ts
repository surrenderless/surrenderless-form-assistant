import { intakeToMockFtcUserData } from "@/lib/justice/ftc-user-data";
import {
  buildMockBbbPracticeSubmissionUrl,
  MOCK_BBB_PRACTICE_ASSISTED_SUBMISSION_LANE,
} from "@/lib/justice/assistedSubmissionLane";
import type { JusticeIntake } from "@/lib/justice/types";

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

/** Run internal mock BBB practice autofill (events, session flag). Timeline types ship in a later slice. */
export async function runBbbPractice({
  intake,
  caseId,
  isLoaded: _isLoaded,
  isSignedIn: _isSignedIn,
  logLabel: _logLabel = "justice bbb-practice",
}: RunBbbPracticeParams): Promise<RunBbbPracticeResult> {
  if (typeof window === "undefined") {
    return { ok: false, error: "Practice autofill is only available in the browser." };
  }

  const mockUrl = buildMockBbbPracticeSubmissionUrl(window.location.origin);
  const userData = intakeToMockBbbUserData(intake);

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
    return { ok: false, error: message };
  }
}

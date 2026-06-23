import {
  REAL_BBB_ASSISTED_SUBMISSION_LANE,
  resolveAssistedSubmissionFillUrl,
} from "@/lib/justice/assistedSubmissionLane";
import {
  isRealBbbComplaintAutofillEnabled,
  REAL_BBB_AUTOFILL_DISABLED_ERROR,
} from "@/lib/justice/realBbbAutofillEnabled";
import { intakeToMockBbbUserData } from "@/lib/justice/runBbbPractice";
import { appendTimelineEvent, readTimeline, replaceTimelineForCase } from "@/lib/justice/timeline";
import type { JusticeIntake, TimelineEntry } from "@/lib/justice/types";

async function logRealBbbComplaintEvent(event_name: string, payload: Record<string, unknown>): Promise<void> {
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

async function syncRealBbbComplaintTimelineToServer(
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

export type RunRealBbbComplaintParams = {
  intake: JusticeIntake;
  caseId: string | null;
  isLoaded: boolean;
  isSignedIn: boolean;
  logLabel?: string;
};

export type RunRealBbbComplaintSuccess = {
  ok: true;
  storageSkipped: boolean;
  technicalDetails: string;
};

export type RunRealBbbComplaintFailure = {
  ok: false;
  error: string;
};

export type RunRealBbbComplaintResult = RunRealBbbComplaintSuccess | RunRealBbbComplaintFailure;

/** Run real BBB complaint autofill via internal submit-form (chat-assisted lane). */
export async function runRealBbbComplaint({
  intake,
  caseId,
  isLoaded,
  isSignedIn,
  logLabel = "justice bbb-complaint",
}: RunRealBbbComplaintParams): Promise<RunRealBbbComplaintResult> {
  if (typeof window === "undefined") {
    return { ok: false, error: "Real BBB autofill is only available in the browser." };
  }

  if (!isRealBbbComplaintAutofillEnabled()) {
    return { ok: false, error: REAL_BBB_AUTOFILL_DISABLED_ERROR };
  }

  const submissionUrl = resolveAssistedSubmissionFillUrl(
    REAL_BBB_ASSISTED_SUBMISSION_LANE,
    window.location.origin
  );
  const userData = intakeToMockBbbUserData(intake);

  if (caseId) {
    appendTimelineEvent(caseId, {
      type: "bbb_complaint_autofill_started",
      label: "BBB complaint autofill started",
    });
  }
  await syncRealBbbComplaintTimelineToServer(caseId, isLoaded, isSignedIn, logLabel);
  await logRealBbbComplaintEvent("bbb_real_lane_started", {
    case_id: caseId,
    submission_url: REAL_BBB_ASSISTED_SUBMISSION_LANE.submissionUrl,
  });

  try {
    const res = await fetch("/api/submit-form", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ url: submissionUrl, userData }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error((data as { error?: string }).error || "Request failed");
    }

    await logRealBbbComplaintEvent("bbb_real_lane_completed", { case_id: caseId, outcome: "success" });
    const fillResult = (data as { fillResult?: { storageSkipped?: boolean } }).fillResult;
    if (caseId) {
      appendTimelineEvent(caseId, {
        type: "bbb_complaint_autofill_completed",
        label: "BBB complaint autofill completed",
        detail: fillResult?.storageSkipped ? "Screenshot storage skipped locally" : undefined,
      });
    }
    await syncRealBbbComplaintTimelineToServer(caseId, isLoaded, isSignedIn, logLabel);

    return {
      ok: true,
      storageSkipped: fillResult?.storageSkipped === true,
      technicalDetails: JSON.stringify(data, null, 2),
    };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Something went wrong.";
    await logRealBbbComplaintEvent("bbb_real_lane_completed", {
      case_id: caseId,
      outcome: "failed",
      error: message.slice(0, 200),
    });
    if (caseId) {
      appendTimelineEvent(caseId, {
        type: "bbb_complaint_autofill_completed",
        label: "BBB complaint autofill completed",
        detail: "Did not complete",
      });
    }
    await syncRealBbbComplaintTimelineToServer(caseId, isLoaded, isSignedIn, logLabel);
    return { ok: false, error: message };
  }
}

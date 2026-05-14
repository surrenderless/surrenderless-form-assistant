import type { JusticeIntake, TimelineEntry } from "@/lib/justice/types";
import { STORAGE_CASE_ID, STORAGE_FTC_MANUAL_UNLOCK, STORAGE_INTAKE } from "@/lib/justice/types";
import {
  appendTimelineEvent,
  clearTimelineForNewCase,
  readTimeline,
  replaceTimelineForCase,
} from "@/lib/justice/timeline";

const FTC_MOCK_COMPLETED_KEY = "justice_ftc_mock_completed";

function newCaseId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `case_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

async function logIntakeCompleted(caseId: string, alreadyContacted: JusticeIntake["already_contacted"]) {
  try {
    await fetch("/api/justice/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event_name: "intake_completed",
        payload: { case_id: caseId, already_contacted: alreadyContacted },
      }),
    });
  } catch {
    /* ignore */
  }
}

export type CommitIntakeToSessionAndServerParams = {
  intake: JusticeIntake;
  isLoaded: boolean;
  isSignedIn: boolean;
  /** Shown in console.warn on POST edge cases (match prior page-specific prefixes). */
  commitLogLabel: string;
};

/**
 * Persists a completed intake: new session case id, timeline `case_started`, optional POST
 * `/api/justice/cases`, then analytics. Caller runs validation and `router.push("/justice/plan")`.
 */
export async function commitIntakeToSessionAndServer({
  intake,
  isLoaded,
  isSignedIn,
  commitLogLabel,
}: CommitIntakeToSessionAndServerParams): Promise<void> {
  if (typeof window === "undefined") return;

  const prev_case_id = sessionStorage.getItem(STORAGE_CASE_ID);
  const case_id = newCaseId();
  clearTimelineForNewCase(prev_case_id, case_id);
  sessionStorage.setItem(STORAGE_INTAKE, JSON.stringify(intake));
  sessionStorage.setItem(STORAGE_CASE_ID, case_id);
  appendTimelineEvent(case_id, { type: "case_started", label: "Case started" });
  sessionStorage.removeItem(STORAGE_FTC_MANUAL_UNLOCK);
  sessionStorage.removeItem(FTC_MOCK_COMPLETED_KEY);

  let finalCaseId = case_id;
  if (isLoaded && isSignedIn) {
    const timeline = readTimeline(case_id);
    try {
      const res = await fetch("/api/justice/cases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intake, timeline }),
      });
      if (res.ok) {
        const data = (await res.json()) as {
          id?: string;
          intake?: JusticeIntake;
          timeline?: unknown;
        };
        if (data?.id) {
          finalCaseId = data.id;
          sessionStorage.setItem(STORAGE_CASE_ID, data.id);
          if (data.intake) {
            sessionStorage.setItem(STORAGE_INTAKE, JSON.stringify(data.intake));
          }
          const serverTimeline = Array.isArray(data.timeline)
            ? (data.timeline as TimelineEntry[])
            : timeline;
          replaceTimelineForCase(data.id, serverTimeline, { removeCaseIds: [case_id] });
        } else {
          console.warn(`${commitLogLabel}: POST /api/justice/cases succeeded but missing id`);
        }
      } else {
        console.warn(`${commitLogLabel}: POST /api/justice/cases failed`, res.status);
      }
    } catch (e) {
      console.warn(`${commitLogLabel}: POST /api/justice/cases error`, e);
    }
  }

  await logIntakeCompleted(finalCaseId, intake.already_contacted);
}

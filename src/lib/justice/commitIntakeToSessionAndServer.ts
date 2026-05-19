import { validate as isUuid } from "uuid";
import type { JusticeIntake, TimelineEntry } from "@/lib/justice/types";
import { STORAGE_CASE_ID, STORAGE_FTC_MANUAL_UNLOCK, STORAGE_INTAKE } from "@/lib/justice/types";
import {
  appendTimelineEvent,
  clearTimelineForNewCase,
  readTimeline,
  replaceTimelineForCase,
} from "@/lib/justice/timeline";

export type CommitIntakeMode = "create" | "update";

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
  /** Shown in console.warn on POST/PATCH edge cases (match prior page-specific prefixes). */
  commitLogLabel: string;
  /**
   * `create` (default): new case id, fresh timeline, POST when signed in.
   * `update`: preserve case id and timeline; PATCH when signed in and id is a UUID.
   */
  mode?: CommitIntakeMode;
};

async function commitIntakeUpdateToSessionAndServer({
  intake,
  isLoaded,
  isSignedIn,
  commitLogLabel,
}: CommitIntakeToSessionAndServerParams): Promise<void> {
  sessionStorage.setItem(STORAGE_INTAKE, JSON.stringify(intake));
  const caseId = sessionStorage.getItem(STORAGE_CASE_ID)?.trim() ?? "";
  if (!caseId || !isLoaded || !isSignedIn || !isUuid(caseId)) {
    return;
  }

  const timeline = readTimeline(caseId);
  try {
    const res = await fetch(`/api/justice/cases/${encodeURIComponent(caseId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ intake, timeline }),
    });
    if (res.ok) {
      const data = (await res.json()) as {
        intake?: JusticeIntake;
        timeline?: unknown;
      };
      if (data.intake) {
        sessionStorage.setItem(STORAGE_INTAKE, JSON.stringify(data.intake));
      }
      if (Array.isArray(data.timeline)) {
        replaceTimelineForCase(caseId, data.timeline as TimelineEntry[]);
      }
    } else {
      console.warn(`${commitLogLabel}: PATCH /api/justice/cases/[id] failed`, res.status);
    }
  } catch (e) {
    console.warn(`${commitLogLabel}: PATCH /api/justice/cases/[id] error`, e);
  }
}

/**
 * Persists a completed intake: new session case id, timeline `case_started`, optional POST
 * `/api/justice/cases`, then analytics. Caller runs validation and `router.push("/justice/plan")`.
 */
export async function commitIntakeToSessionAndServer({
  intake,
  isLoaded,
  isSignedIn,
  commitLogLabel,
  mode = "create",
}: CommitIntakeToSessionAndServerParams): Promise<void> {
  if (typeof window === "undefined") return;

  if (mode === "update") {
    await commitIntakeUpdateToSessionAndServer({ intake, isLoaded, isSignedIn, commitLogLabel });
    return;
  }

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

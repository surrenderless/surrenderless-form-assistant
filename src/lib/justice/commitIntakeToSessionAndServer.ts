import { validate as isUuid } from "uuid";
import { isJusticeIntakePayload } from "@/lib/justice/caseApiValidation";
import type { JusticeIntake, TimelineEntry } from "@/lib/justice/types";
import { STORAGE_CASE_ID, STORAGE_FTC_MANUAL_UNLOCK, STORAGE_INTAKE } from "@/lib/justice/types";
import {
  appendTimelineEvent,
  clearTimelineForNewCase,
  readTimeline,
  replaceTimelineForCase,
} from "@/lib/justice/timeline";
import { patchJusticeCaseIntake, writeLocalIntakeCaseVersion } from "@/lib/justice/patchJusticeCaseIntake";
import { refreshLocalIntakeAndVersionFromServer } from "@/lib/justice/hydrateActiveCaseFromServer";

export type CommitIntakeMode = "create" | "update";

export type CommitIntakeResult = {
  caseId: string;
  serverPersisted: boolean;
  /**
   * Present whenever serverPersisted is false — a user-facing message the caller must surface
   * (e.g. a banner), never just a console.warn. A prior incident let a missing/stale case_version
   * cause this edit to be silently dropped with no trace visible to the consumer; every failure
   * path here must instead give the caller something to show.
   */
  saveError?: string;
  /**
   * Present on a genuine version conflict or a missing-cached-version recovery — the fresh
   * server intake + case_version for the caller's OWN explicit reconciliation UI. Never applied
   * automatically here: the caller decides whether to keep the local draft or adopt this.
   */
  conflict?: { intake: JusticeIntake; caseVersion: number };
};

export type ShouldRouteToChatAiAfterIntakeCommitInput = {
  commitResult: CommitIntakeResult;
  isLoaded: boolean;
  isSignedIn: boolean;
  /** True when `/justice/chat-ai` is updating an existing hydrated case (not intake/chat create). */
  isUpdatingExistingCase?: boolean;
};

/** Signed-in server-persisted create commits and chat-ai update commits continue in `/justice/chat-ai`. */
export function shouldRouteToChatAiAfterIntakeCommit(
  input: ShouldRouteToChatAiAfterIntakeCommitInput
): boolean {
  if (!input.isLoaded || !input.isSignedIn) return false;
  const caseId = input.commitResult.caseId.trim();
  if (!caseId || !isUuid(caseId)) return false;
  if (input.isUpdatingExistingCase) return true;
  return input.commitResult.serverPersisted;
}

const EMPTY_COMMIT_RESULT: CommitIntakeResult = { caseId: "", serverPersisted: false };

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
}: CommitIntakeToSessionAndServerParams): Promise<CommitIntakeResult> {
  sessionStorage.setItem(STORAGE_INTAKE, JSON.stringify(intake));
  const caseId = sessionStorage.getItem(STORAGE_CASE_ID)?.trim() ?? "";
  if (!caseId || !isLoaded || !isSignedIn || !isUuid(caseId)) {
    return { caseId, serverPersisted: false };
  }

  const timeline = readTimeline(caseId);
  const result = await patchJusticeCaseIntake(caseId, intake, { timeline });
  if (result.ok) {
    // patchJusticeCaseIntake already wrote the fresh intake + case_version to sessionStorage.
    if (Array.isArray(result.timeline)) {
      replaceTimelineForCase(caseId, result.timeline as TimelineEntry[]);
    }
    return { caseId, serverPersisted: true };
  }
  let saveError = "Your latest change could not be saved. Try again.";
  let conflict: CommitIntakeResult["conflict"];
  if (result.reason === "missing_version") {
    // No cached version to pair with this write — refresh both content and case_version from the
    // server together before any further attempt, rather than ever fetching just one of the two.
    // This never touches the caller's in-memory draft (only sessionStorage) — the caller decides,
    // via `conflict` below, whether to keep the local draft or adopt the fresh server snapshot.
    const refreshed = await refreshLocalIntakeAndVersionFromServer(caseId);
    saveError = "Your latest change could not be verified against the server and was not saved. Try again.";
    if (refreshed) conflict = refreshed;
  } else if (result.reason === "conflict") {
    saveError = "This case was updated elsewhere. Your latest change was not saved — reload and retry.";
    if (isJusticeIntakePayload(result.current.intake) && typeof result.current.caseVersion === "number") {
      conflict = { intake: result.current.intake, caseVersion: result.current.caseVersion };
    }
  }
  // Never auto-retry or auto-overwrite: `conflict` (when present) is handed back for the
  // caller's own explicit reconciliation UI — a "the version is now refreshed for the next
  // attempt" outcome is not the same as "your edit was saved" or "nothing was lost".
  console.warn(`${commitLogLabel}: PATCH /api/justice/cases/[id] ${result.reason}`, result.error);
  return { caseId, serverPersisted: false, saveError, ...(conflict ? { conflict } : {}) };
}

/**
 * Persists a completed intake: new session case id, timeline `case_started`, optional POST
 * `/api/justice/cases`, then analytics. Caller runs validation and routes onward (e.g.
 * `router.push("/justice/chat-ai")` or `router.push("/justice/preview")` from intake/chat via
 * `shouldRouteToChatAiAfterIntakeCommit`; chat-ai continuity from `/justice/chat-ai`).
 */
export async function commitIntakeToSessionAndServer({
  intake,
  isLoaded,
  isSignedIn,
  commitLogLabel,
  mode = "create",
}: CommitIntakeToSessionAndServerParams): Promise<CommitIntakeResult> {
  if (typeof window === "undefined") return EMPTY_COMMIT_RESULT;

  if (mode === "update") {
    return commitIntakeUpdateToSessionAndServer({ intake, isLoaded, isSignedIn, commitLogLabel });
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
  let serverPersisted = false;
  let saveError: string | undefined;
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
          case_version?: number;
          timeline?: unknown;
        };
        if (data?.id) {
          finalCaseId = data.id;
          sessionStorage.setItem(STORAGE_CASE_ID, data.id);
          if (data.intake) {
            sessionStorage.setItem(STORAGE_INTAKE, JSON.stringify(data.intake));
          }
          // Cache the version this create response returned — without this, the very first
          // subsequent PATCH for this case would find no cached version and refuse to write
          // (patchJusticeCaseIntake's missing_version guard) until an explicit refresh. A create
          // response with no case_version is itself a server-side bug, not a benign edge case —
          // surface it rather than silently leaving the case unable to accept its first edit.
          if (typeof data.case_version === "number") {
            writeLocalIntakeCaseVersion(data.case_version);
            serverPersisted = true;
          } else {
            writeLocalIntakeCaseVersion(null);
            console.warn(`${commitLogLabel}: POST /api/justice/cases response missing case_version`);
            saveError =
              "Your case was created, but the server response was incomplete. Reload before making further edits.";
          }
          const serverTimeline = Array.isArray(data.timeline)
            ? (data.timeline as TimelineEntry[])
            : timeline;
          replaceTimelineForCase(data.id, serverTimeline, { removeCaseIds: [case_id] });
        } else {
          console.warn(`${commitLogLabel}: POST /api/justice/cases succeeded but missing id`);
          saveError = "Your case could not be saved to the server. Try again.";
        }
      } else {
        console.warn(`${commitLogLabel}: POST /api/justice/cases failed`, res.status);
        saveError = "Your case could not be saved to the server. Try again.";
      }
    } catch (e) {
      console.warn(`${commitLogLabel}: POST /api/justice/cases error`, e);
      saveError = "Your case could not be saved to the server. Try again.";
    }
  }

  await logIntakeCompleted(finalCaseId, intake.already_contacted);
  return { caseId: finalCaseId, serverPersisted, ...(saveError ? { saveError } : {}) };
}

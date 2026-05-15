import { isJusticeIntakePayload, parseJusticeCasesListEnvelope } from "@/lib/justice/caseApiValidation";
import { replaceTimelineForCase } from "@/lib/justice/timeline";
import type { JusticeIntake, TimelineEntry } from "@/lib/justice/types";
import {
  STORAGE_CASE_ID,
  STORAGE_INTAKE,
  STORAGE_PAYMENT_DISPUTE_CHECKLIST_DRAFT_V1,
} from "@/lib/justice/types";

export type JusticeCaseListRow = {
  id?: string;
  intake?: unknown;
  timeline?: unknown;
  payment_dispute_draft?: unknown;
};

/** Valid intake from sessionStorage, or null if missing / invalid. */
export function readValidLocalJusticeIntake(): JusticeIntake | null {
  if (typeof window === "undefined") return null;
  const raw = sessionStorage.getItem(STORAGE_INTAKE);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isJusticeIntakePayload(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Persist server list row to session (same fields as plan “resume latest”):
 * case id, intake, timeline, optional payment_dispute_draft.
 */
export function hydrateSessionFromCaseListRow(row: JusticeCaseListRow): JusticeIntake | null {
  if (typeof window === "undefined") return null;
  if (!row.id || !isJusticeIntakePayload(row.intake)) return null;
  sessionStorage.setItem(STORAGE_CASE_ID, row.id);
  sessionStorage.setItem(STORAGE_INTAKE, JSON.stringify(row.intake));
  const serverTimeline = Array.isArray(row.timeline) ? (row.timeline as TimelineEntry[]) : [];
  replaceTimelineForCase(row.id, serverTimeline);
  if (
    row.payment_dispute_draft != null &&
    typeof row.payment_dispute_draft === "object" &&
    !Array.isArray(row.payment_dispute_draft)
  ) {
    sessionStorage.setItem(STORAGE_PAYMENT_DISPUTE_CHECKLIST_DRAFT_V1, JSON.stringify(row.payment_dispute_draft));
  } else {
    sessionStorage.removeItem(STORAGE_PAYMENT_DISPUTE_CHECKLIST_DRAFT_V1);
  }
  return row.intake;
}

/** GET /api/justice/cases (unarchived, newest first) and hydrate session from `list[0]`. */
export async function fetchAndHydrateLatestJusticeCase(signal?: AbortSignal): Promise<JusticeIntake | null> {
  const res = await fetch("/api/justice/cases", { signal });
  if (!res.ok) return null;
  const body = (await res.json()) as unknown;
  const env = parseJusticeCasesListEnvelope(body);
  const list = env?.cases ?? [];
  if (!Array.isArray(list) || list.length === 0) return null;
  const latest = list[0] as JusticeCaseListRow;
  return hydrateSessionFromCaseListRow(latest);
}

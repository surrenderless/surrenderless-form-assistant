import { cfpbLikelyRelevant, ftcUnlockedFromIntake } from "./rules";
import type { JusticeIntake, TimelineEntry, TimelineEntryType } from "./types";
import { STORAGE_TIMELINE_V1 } from "./types";

type TimelineStore = Record<string, TimelineEntry[]>;

function loadStore(): TimelineStore {
  if (typeof window === "undefined") return {};
  try {
    const raw = sessionStorage.getItem(STORAGE_TIMELINE_V1);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as TimelineStore;
    }
    return {};
  } catch {
    return {};
  }
}

function saveStore(store: TimelineStore): void {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(STORAGE_TIMELINE_V1, JSON.stringify(store));
}

function newId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `tl_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

export function readTimeline(caseId: string): TimelineEntry[] {
  if (!caseId || typeof window === "undefined") return [];
  const list = loadStore()[caseId] ?? [];
  return [...list].sort((a, b) => a.ts.localeCompare(b.ts));
}

export function appendTimelineEvent(
  caseId: string,
  partial: {
    type: TimelineEntryType;
    label: string;
    detail?: string;
    ts?: string;
  }
): void {
  if (!caseId || typeof window === "undefined") return;
  const entry: TimelineEntry = {
    id: newId(),
    case_id: caseId,
    type: partial.type,
    label: partial.label,
    ts: partial.ts ?? new Date().toISOString(),
    ...(partial.detail !== undefined && partial.detail !== "" ? { detail: partial.detail } : {}),
  };
  const store = loadStore();
  const list = store[caseId] ?? [];
  list.push(entry);
  store[caseId] = list;
  saveStore(store);
}

/**
 * When starting a new case from intake: drop the previous case's timeline (if any) and reset storage for the new id.
 */
export function clearTimelineForNewCase(previousCaseId: string | null, newCaseId: string): void {
  if (typeof window === "undefined" || !newCaseId) return;
  const store = loadStore();
  if (previousCaseId && previousCaseId !== newCaseId) {
    delete store[previousCaseId];
  }
  store[newCaseId] = [];
  saveStore(store);
}

/** Maps POST /api/justice/events `event_name` to a user-facing label (for docs / future sync). */
export function labelForAnalyticsEventName(eventName: string): string | undefined {
  const m: Record<string, string> = {
    intake_completed: "Case started",
    action_plan_generated: "Action plan viewed",
    merchant_contact_saved: "Merchant contact saved",
    escalation_unlocked: "Escalation path unlocked",
    payment_dispute_checklist_viewed: "Payment checklist viewed",
    merchant_resolution_started: "Merchant flow opened",
    payment_dispute_started: "Payment dispute opened",
    ftc_mock_review_opened: "FTC practice opened",
    ftc_mock_lane_started: "FTC practice started",
    ftc_mock_lane_completed: "FTC practice completed",
    bbb_prep_opened: "BBB prep opened",
    state_ag_prep_opened: "State AG prep opened",
    cfpb_prep_opened: "CFPB prep opened",
  };
  return m[eventName];
}

export function appendActionPlanViewedOnce(caseId: string): void {
  if (!caseId) return;
  const entries = readTimeline(caseId);
  if (entries.some((e) => e.type === "action_plan_viewed")) return;
  appendTimelineEvent(caseId, {
    type: "action_plan_viewed",
    label: "Action plan viewed",
  });
}

export function appendPaymentChecklistViewedOnce(caseId: string): void {
  if (!caseId) return;
  const entries = readTimeline(caseId);
  if (entries.some((e) => e.type === "payment_checklist_viewed")) return;
  appendTimelineEvent(caseId, {
    type: "payment_checklist_viewed",
    label: "Payment checklist viewed",
  });
}

/** When merchant save documents a response that unlocks FTC via intake rules; skips if escalation_unlocked already exists. */
export function appendBbbPrepOpenedOnce(caseId: string): void {
  if (!caseId) return;
  const entries = readTimeline(caseId);
  if (entries.some((e) => e.type === "bbb_prep_opened")) return;
  appendTimelineEvent(caseId, {
    type: "bbb_prep_opened",
    label: "BBB prep opened",
    detail: "Reviewed complaint prep (manual filing next).",
  });
}

export function appendStateAgPrepOpenedOnce(caseId: string): void {
  if (!caseId) return;
  const entries = readTimeline(caseId);
  if (entries.some((e) => e.type === "state_ag_prep_opened")) return;
  appendTimelineEvent(caseId, {
    type: "state_ag_prep_opened",
    label: "State AG prep opened",
    detail: "Reviewed AG complaint prep (manual filing next).",
  });
}

export function appendCfpbPrepOpenedOnce(caseId: string): void {
  if (!caseId) return;
  const entries = readTimeline(caseId);
  if (entries.some((e) => e.type === "cfpb_prep_opened")) return;
  appendTimelineEvent(caseId, {
    type: "cfpb_prep_opened",
    label: "CFPB prep opened",
    detail: "Reviewed CFPB complaint prep (manual filing on official site next).",
  });
}

export function appendEscalationUnlockedFromMerchantSaveOnce(
  caseId: string,
  intakeAfterSave: JusticeIntake
): void {
  if (!caseId) return;
  if (!ftcUnlockedFromIntake(intakeAfterSave)) return;
  const entries = readTimeline(caseId);
  if (entries.some((e) => e.type === "escalation_unlocked")) return;
  const detail = cfpbLikelyRelevant(intakeAfterSave)
    ? "CFPB escalation became available."
    : "FTC escalation became available.";
  appendTimelineEvent(caseId, {
    type: "escalation_unlocked",
    label: "Escalation path unlocked",
    detail,
  });
}

import type { JusticeApprovedNextAction, JusticeCaseClientState } from "@/lib/justice/types";

/** Session JSON: `Record<caseId, JusticeApprovedNextAction>` */
export const STORAGE_APPROVED_NEXT_ACTION_V1 = "justice_approved_next_action_v1";

export function parseApprovedNextAction(raw: unknown): JusticeApprovedNextAction | undefined {
  if (raw === null || raw === undefined) return undefined;
  if (typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  const label = typeof o.label === "string" ? o.label.trim() : "";
  const href = typeof o.href === "string" ? o.href.trim() : "";
  if (!label && !href) return undefined;
  return {
    ...(label ? { label } : {}),
    ...(href ? { href } : {}),
    ...(o.status === "completed"
      ? { status: "completed" as const }
      : o.status === "started"
        ? { status: "started" as const }
        : o.status === "approved"
          ? { status: "approved" as const }
          : {}),
    ...(typeof o.approved_at === "string" && o.approved_at.trim()
      ? { approved_at: o.approved_at.trim() }
      : {}),
    ...(typeof o.started_at === "string" && o.started_at.trim()
      ? { started_at: o.started_at.trim() }
      : {}),
    ...(typeof o.completed_at === "string" && o.completed_at.trim()
      ? { completed_at: o.completed_at.trim() }
      : {}),
    ...(typeof o.outcome_note === "string" && o.outcome_note.trim()
      ? { outcome_note: o.outcome_note.trim() }
      : {}),
    ...(o.follow_up_needed === true ? { follow_up_needed: true } : {}),
    ...(typeof o.follow_up_at === "string" && o.follow_up_at.trim()
      ? { follow_up_at: o.follow_up_at.trim() }
      : {}),
  };
}

export function parseApprovedNextActionFromClientState(
  clientState: unknown
): JusticeApprovedNextAction | undefined {
  if (
    clientState === null ||
    clientState === undefined ||
    typeof clientState !== "object" ||
    Array.isArray(clientState)
  ) {
    return undefined;
  }
  return parseApprovedNextAction((clientState as Record<string, unknown>).approved_next_action);
}

export function approvedNextActionStatusLabel(
  status?: JusticeApprovedNextAction["status"]
): string | null {
  switch (status) {
    case "approved":
      return "Approved";
    case "started":
      return "Started";
    case "completed":
      return "Handled";
    default:
      return null;
  }
}

/** Removes follow_up_needed; preserves outcome_note, follow_up_at, status, href, label, timestamps, etc. */
export function clearFollowUpFromApprovedNextAction(
  next: JusticeApprovedNextAction
): JusticeApprovedNextAction {
  const cleared: JusticeApprovedNextAction = { ...next };
  delete cleared.follow_up_needed;
  return cleared;
}

export function mergeClientStateWithClearedFollowUp(
  existingClientState: unknown,
  clearedAction: JusticeApprovedNextAction
): JusticeCaseClientState {
  const merged: JusticeCaseClientState = { approved_next_action: clearedAction };
  if (
    existingClientState !== null &&
    existingClientState !== undefined &&
    typeof existingClientState === "object" &&
    !Array.isArray(existingClientState)
  ) {
    const o = existingClientState as Record<string, unknown>;
    if (o.prepared_packet_approved === true) merged.prepared_packet_approved = true;
  }
  return merged;
}

/** Chat-ai hydrate: merge session + server without status downgrade rules (OR on follow_up_needed). */
export function mergeApprovedNextActionForHydrate(
  fromSession?: JusticeApprovedNextAction,
  fromServer?: JusticeApprovedNextAction
): JusticeApprovedNextAction | undefined {
  if (!fromSession && !fromServer) return undefined;
  const label = fromServer?.label ?? fromSession?.label;
  const href = fromServer?.href ?? fromSession?.href;
  if (!label && !href && !fromServer?.status && !fromSession?.status) return undefined;
  return {
    ...(label ? { label } : {}),
    ...(href ? { href } : {}),
    ...(fromServer?.status ?? fromSession?.status
      ? { status: fromServer?.status ?? fromSession?.status }
      : {}),
    ...(fromServer?.approved_at ?? fromSession?.approved_at
      ? { approved_at: fromServer?.approved_at ?? fromSession?.approved_at }
      : {}),
    ...(fromServer?.started_at ?? fromSession?.started_at
      ? { started_at: fromServer?.started_at ?? fromSession?.started_at }
      : {}),
    ...(fromServer?.completed_at ?? fromSession?.completed_at
      ? { completed_at: fromServer?.completed_at ?? fromSession?.completed_at }
      : {}),
    ...(fromServer?.outcome_note ?? fromSession?.outcome_note
      ? { outcome_note: fromServer?.outcome_note ?? fromSession?.outcome_note }
      : {}),
    ...(fromServer?.follow_up_needed === true || fromSession?.follow_up_needed === true
      ? {
          follow_up_needed:
            fromServer?.follow_up_needed === true || fromSession?.follow_up_needed === true,
        }
      : {}),
    ...(fromServer?.follow_up_at ?? fromSession?.follow_up_at
      ? { follow_up_at: fromServer?.follow_up_at ?? fromSession?.follow_up_at }
      : {}),
  };
}

export function readSessionApprovedNextAction(caseId: string): JusticeApprovedNextAction | undefined {
  if (typeof window === "undefined" || !caseId) return undefined;
  try {
    const raw = sessionStorage.getItem(STORAGE_APPROVED_NEXT_ACTION_V1);
    if (!raw) return undefined;
    const map = JSON.parse(raw) as Record<string, unknown>;
    return parseApprovedNextAction(map[caseId]);
  } catch {
    return undefined;
  }
}

export function writeSessionApprovedNextAction(
  caseId: string,
  action: JusticeApprovedNextAction
): void {
  if (typeof window === "undefined" || !caseId) return;
  try {
    const raw = sessionStorage.getItem(STORAGE_APPROVED_NEXT_ACTION_V1);
    const map: Record<string, JusticeApprovedNextAction> = raw
      ? (JSON.parse(raw) as Record<string, JusticeApprovedNextAction>)
      : {};
    map[caseId] = action;
    sessionStorage.setItem(STORAGE_APPROVED_NEXT_ACTION_V1, JSON.stringify(map));
  } catch {
    // ignore corrupt session data
  }
}

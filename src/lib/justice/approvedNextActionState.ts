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
    ...(typeof o.handling_requested_at === "string" && o.handling_requested_at.trim()
      ? { handling_requested_at: o.handling_requested_at.trim() }
      : {}),
    ...(typeof o.handling_request_note === "string" && o.handling_request_note.trim()
      ? { handling_request_note: o.handling_request_note.trim() }
      : {}),
    ...(typeof o.handling_acknowledged_at === "string" && o.handling_acknowledged_at.trim()
      ? { handling_acknowledged_at: o.handling_acknowledged_at.trim() }
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

const HANDLING_REQUEST_NOTE_MAX_LENGTH = 500;

/** Same rule as Saved cases Needs attention and workbench Awaiting internal triage. */
export function isHandlingAwaitingTriageApprovedNextAction(
  next: JusticeApprovedNextAction | undefined
): next is JusticeApprovedNextAction {
  if (!next) return false;
  if (!next.handling_requested_at?.trim()) return false;
  if (next.handling_acknowledged_at?.trim()) return false;
  if (next.status === "completed") return false;
  return true;
}

/**
 * Approved packet next action without an explicit Surrenderless handling request.
 * Uses existing `client_state` only — not a handling-request queue signal.
 */
export function parseApprovedPacketActionWithoutHandlingRequest(
  clientState: unknown
): JusticeApprovedNextAction | undefined {
  const parsed = parseJusticeCaseClientState(clientState);
  if (!parsed.prepared_packet_approved) return undefined;
  const next = parsed.approved_next_action;
  if (!next) return undefined;
  if (!next.label?.trim() && !next.href?.trim()) return undefined;
  if (next.handling_requested_at?.trim()) return undefined;
  if (next.status === "completed") return undefined;
  return next;
}

export function isApprovedPacketActionWithoutHandlingRequest(clientState: unknown): boolean {
  return parseApprovedPacketActionWithoutHandlingRequest(clientState) !== undefined;
}

/** Empty string on approved_next_action means the user explicitly cleared the note (merge only). */
export const HANDLING_REQUEST_NOTE_EXPLICIT_CLEAR = "";

/** True when the action object carries an intentional note clear (empty string field). */
export function isExplicitHandlingRequestNoteClear(action: JusticeApprovedNextAction): boolean {
  return "handling_request_note" in action && !String(action.handling_request_note ?? "").trim();
}

/** Removes cleared/blank handling_request_note before session write or PATCH body. */
export function omitClearedHandlingRequestNoteFromApprovedNextAction(
  action: JusticeApprovedNextAction
): JusticeApprovedNextAction {
  if (!isExplicitHandlingRequestNoteClear(action)) return action;
  const { handling_request_note: _cleared, ...rest } = action;
  return rest;
}

/** Sets or clears handling_request_note; preserves handling_requested_at and other fields. */
export function applyHandlingRequestNoteToApprovedNextAction(
  action: JusticeApprovedNextAction,
  rawNote: string
): JusticeApprovedNextAction {
  const trimmed = rawNote.trim();
  const next = { ...action };
  if (trimmed) {
    next.handling_request_note = trimmed.slice(0, HANDLING_REQUEST_NOTE_MAX_LENGTH);
  } else {
    // Explicit clear: keep key as "" so merge does not restore a prior note.
    next.handling_request_note = HANDLING_REQUEST_NOTE_EXPLICIT_CLEAR;
  }
  return next;
}

function pickTrimmedIsoField(...values: (string | undefined)[]): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

/** Raw read before strict parse — used when hydrating display state from client_state. */
export function readHandlingAcknowledgedAtFromClientState(clientState: unknown): string | undefined {
  if (
    clientState === null ||
    clientState === undefined ||
    typeof clientState !== "object" ||
    Array.isArray(clientState)
  ) {
    return undefined;
  }
  const approved = (clientState as Record<string, unknown>).approved_next_action;
  if (
    approved === null ||
    approved === undefined ||
    typeof approved !== "object" ||
    Array.isArray(approved)
  ) {
    return undefined;
  }
  const raw = (approved as Record<string, unknown>).handling_acknowledged_at;
  return typeof raw === "string" && raw.trim() ? raw.trim() : undefined;
}

/** Preserves handling_requested_at / handling_acknowledged_at when a persist patch omits them. */
export function mergeApprovedNextActionTrackingFields(
  base: JusticeApprovedNextAction | undefined,
  incoming: JusticeApprovedNextAction
): JusticeApprovedNextAction {
  const merged = { ...incoming };
  const requested = pickTrimmedIsoField(incoming.handling_requested_at, base?.handling_requested_at);
  const acknowledged = pickTrimmedIsoField(
    incoming.handling_acknowledged_at,
    base?.handling_acknowledged_at
  );
  if (requested) merged.handling_requested_at = requested;
  else delete merged.handling_requested_at;
  if (acknowledged) merged.handling_acknowledged_at = acknowledged;
  else delete merged.handling_acknowledged_at;
  return merged;
}

/**
 * Resolve approved next action for UI, coalescing handling_acknowledged_at from
 * server client_state, session map, and raw client_state.
 */
export function hydrateApprovedNextActionForDisplay(
  caseId: string,
  clientState?: unknown
): JusticeApprovedNextAction | undefined {
  const fromSession = readSessionApprovedNextAction(caseId);
  const resolved =
    clientState !== undefined
      ? resolveApprovedNextAction(caseId, clientState)
      : fromSession;
  const base = resolved ?? fromSession;
  if (!base) return undefined;

  const rawAck =
    clientState !== undefined ? readHandlingAcknowledgedAtFromClientState(clientState) : undefined;
  const acknowledged = pickTrimmedIsoField(
    base.handling_acknowledged_at,
    fromSession?.handling_acknowledged_at,
    rawAck
  );
  if (!acknowledged) return base;
  return { ...base, handling_acknowledged_at: acknowledged };
}

/** Sets handling_acknowledged_at; preserves handling_requested_at and other fields. */
export function acknowledgeHandlingRequestInApprovedNextAction(
  next: JusticeApprovedNextAction
): JusticeApprovedNextAction {
  return {
    ...next,
    handling_acknowledged_at: new Date().toISOString(),
  };
}

export function mergeClientStateWithAcknowledgedHandling(
  existingClientState: unknown,
  acknowledgedAction: JusticeApprovedNextAction
): JusticeCaseClientState {
  const merged: JusticeCaseClientState = { approved_next_action: acknowledgedAction };
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

/** Removes follow_up_needed; preserves outcome_note, follow_up_at, handling_*, status, href, label, timestamps, etc. */
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
    ...(fromServer?.handling_requested_at ?? fromSession?.handling_requested_at
      ? {
          handling_requested_at:
            fromServer?.handling_requested_at ?? fromSession?.handling_requested_at,
        }
      : {}),
    ...(() => {
      const note = (
        fromServer?.handling_request_note ?? fromSession?.handling_request_note
      )?.trim();
      return note ? { handling_request_note: note } : {};
    })(),
    ...(fromServer?.handling_acknowledged_at ?? fromSession?.handling_acknowledged_at
      ? {
          handling_acknowledged_at:
            fromServer?.handling_acknowledged_at ?? fromSession?.handling_acknowledged_at,
        }
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

/** Plan/packet hydrate: merge session + server; never downgrade completed → started → approved. */
export function resolveApprovedNextAction(
  caseId: string,
  clientState: unknown
): JusticeApprovedNextAction | undefined {
  const fromSession = readSessionApprovedNextAction(caseId);
  const fromServer = parseApprovedNextActionFromClientState(clientState);
  if (!fromServer) return fromSession;
  if (!fromSession) return fromServer;

  const label = fromServer.label ?? fromSession.label;
  const href = fromServer.href ?? fromSession.href;
  const approved_at = fromServer.approved_at ?? fromSession.approved_at;
  const started_at = fromServer.started_at ?? fromSession.started_at;
  const completed_at = fromServer.completed_at ?? fromSession.completed_at;
  const outcome_note = fromServer.outcome_note ?? fromSession.outcome_note;
  const follow_up_needed = fromServer.follow_up_needed ?? fromSession.follow_up_needed;
  const follow_up_at = fromServer.follow_up_at ?? fromSession.follow_up_at;
  const handling_requested_at =
    fromServer.handling_requested_at ?? fromSession.handling_requested_at;
  const handling_request_noteRaw =
    fromServer.handling_request_note ?? fromSession.handling_request_note;
  const handling_request_note = handling_request_noteRaw?.trim()
    ? handling_request_noteRaw.trim()
    : undefined;
  const handling_acknowledged_at = pickTrimmedIsoField(
    fromServer.handling_acknowledged_at,
    fromSession.handling_acknowledged_at
  );
  const completed =
    fromServer.status === "completed" || fromSession.status === "completed";
  const started =
    !completed && (fromServer.status === "started" || fromSession.status === "started");
  const trackingFields = {
    ...(outcome_note ? { outcome_note } : {}),
    ...(follow_up_needed === true ? { follow_up_needed: true } : {}),
    ...(follow_up_at ? { follow_up_at } : {}),
    ...(handling_requested_at ? { handling_requested_at } : {}),
    ...(handling_request_note ? { handling_request_note } : {}),
    ...(handling_acknowledged_at ? { handling_acknowledged_at } : {}),
  };

  if (completed) {
    return {
      ...(label ? { label } : {}),
      ...(href ? { href } : {}),
      ...(approved_at ? { approved_at } : {}),
      status: "completed",
      ...(started_at ? { started_at } : {}),
      ...(completed_at ? { completed_at } : {}),
      ...trackingFields,
    };
  }

  if (started) {
    return {
      ...(label ? { label } : {}),
      ...(href ? { href } : {}),
      ...(approved_at ? { approved_at } : {}),
      status: "started",
      ...(started_at ? { started_at } : {}),
      ...trackingFields,
    };
  }

  return {
    ...(label ? { label } : {}),
    ...(href ? { href } : {}),
    ...(approved_at ? { approved_at } : {}),
    status: fromServer.status ?? fromSession.status,
    ...trackingFields,
  };
}

export function parseJusticeCaseClientState(raw: unknown): JusticeCaseClientState {
  if (raw === null || raw === undefined) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) return {};
  const o = raw as Record<string, unknown>;
  const approvedNext = parseApprovedNextAction(o.approved_next_action);
  return {
    ...(o as JusticeCaseClientState),
    prepared_packet_approved: o.prepared_packet_approved === true,
    ...(approvedNext ? { approved_next_action: approvedNext } : {}),
  };
}

/** Plan persist: merge approved_next_action; preserve prior fields; force prepared_packet_approved. */
export function mergeClientStateWithApprovedNextAction(
  existingClientState: unknown,
  approvedNext: JusticeApprovedNextAction
): JusticeCaseClientState {
  const merged: JusticeCaseClientState = { approved_next_action: approvedNext };
  if (
    existingClientState !== null &&
    existingClientState !== undefined &&
    typeof existingClientState === "object" &&
    !Array.isArray(existingClientState)
  ) {
    const o = existingClientState as Record<string, unknown>;
    if (o.prepared_packet_approved === true) merged.prepared_packet_approved = true;
    const prev = parseApprovedNextAction(o.approved_next_action);
    if (prev) {
      merged.approved_next_action = {
        ...approvedNext,
        ...(prev.approved_at && !approvedNext.approved_at ? { approved_at: prev.approved_at } : {}),
        ...(prev.started_at && !approvedNext.started_at ? { started_at: prev.started_at } : {}),
        ...(prev.completed_at && !approvedNext.completed_at ? { completed_at: prev.completed_at } : {}),
        ...(prev.outcome_note && !approvedNext.outcome_note ? { outcome_note: prev.outcome_note } : {}),
        ...(prev.follow_up_needed === true && approvedNext.follow_up_needed !== true
          ? { follow_up_needed: true }
          : {}),
        ...(prev.follow_up_at && !approvedNext.follow_up_at ? { follow_up_at: prev.follow_up_at } : {}),
        ...(prev.handling_requested_at && !approvedNext.handling_requested_at
          ? { handling_requested_at: prev.handling_requested_at }
          : {}),
        ...(prev.handling_request_note?.trim() && !("handling_request_note" in approvedNext)
          ? { handling_request_note: prev.handling_request_note.trim() }
          : {}),
        ...(prev.handling_acknowledged_at?.trim() &&
        !approvedNext.handling_acknowledged_at?.trim()
          ? { handling_acknowledged_at: prev.handling_acknowledged_at.trim() }
          : {}),
      };
    }
  }
  merged.prepared_packet_approved = true;
  if (merged.approved_next_action) {
    merged.approved_next_action = omitClearedHandlingRequestNoteFromApprovedNextAction(
      merged.approved_next_action
    );
  }
  return merged;
}

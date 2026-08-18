import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";
import { FTC_OWNED_FILING_DELIVERY_BLOCK_MARKER } from "@/lib/justice/ftcOwnedFilingDeliveryState";

const MAX_NOTES = 8000;
/** Marker line that opens the FTC live-pilot operator-authorization block inside task notes. */
export const FTC_PILOT_AUTHORIZATION_BLOCK_MARKER = "---ftc_pilot_authorization---";
const AUTH_BLOCK_MARKER = FTC_PILOT_AUTHORIZATION_BLOCK_MARKER;
const DELIVERY_BLOCK_MARKER = FTC_OWNED_FILING_DELIVERY_BLOCK_MARKER;

export type FtcPilotAuthorizationRecord = {
  /** Operator's Clerk userId — never a consumer identity. */
  authorized_by: string;
  authorized_at: string;
};

function splitNoteSegments(notes: string): string[] {
  return notes
    .split("\n\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function parseFtcPilotAuthorizationRecord(
  notes: string | null | undefined
): FtcPilotAuthorizationRecord | null {
  const trimmed = notes?.trim() ?? "";
  const idx = trimmed.indexOf(AUTH_BLOCK_MARKER);
  if (idx < 0) return null;
  const afterMarker = trimmed.slice(idx + AUTH_BLOCK_MARKER.length);
  // The auth block may be followed by other blocks (e.g. the delivery-state block) separated by
  // a blank line — stop at the first one so a later delivery block is never parsed as auth data.
  const blockEnd = afterMarker.indexOf("\n\n");
  const block = (blockEnd >= 0 ? afterMarker.slice(0, blockEnd) : afterMarker).trim();
  const map = new Map<string, string>();
  for (const line of block.split("\n").map((l) => l.trim()).filter(Boolean)) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    map.set(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
  }
  const authorizedBy = map.get("authorized_by")?.trim();
  const authorizedAt = map.get("authorized_at")?.trim();
  if (!authorizedBy || !authorizedAt) return null;
  return { authorized_by: authorizedBy, authorized_at: authorizedAt };
}

/**
 * Insert/replace the pilot-authorization block, always positioned BEFORE any existing
 * delivery-state block (never after). This is the property that keeps the two block types
 * compositionally safe: `upsertFtcOwnedFilingDeliveryNotes` truncates and rewrites everything
 * from its own marker onward, so as long as the auth block never sits after that marker, a later
 * delivery-state write (queued/submitting/failed/filed) can never silently discard it — and this
 * function likewise never touches a trailing delivery block when it rewrites its own.
 */
export function upsertFtcPilotAuthorizationNotes(
  notes: string | null | undefined,
  record: FtcPilotAuthorizationRecord
): string {
  const segments = splitNoteSegments((notes ?? "").trim());
  const withoutAuth = segments.filter((seg) => !seg.startsWith(AUTH_BLOCK_MARKER));
  const block = [
    AUTH_BLOCK_MARKER,
    `authorized_by: ${record.authorized_by}`,
    `authorized_at: ${record.authorized_at}`,
  ].join("\n");

  const deliveryIndex = withoutAuth.findIndex((seg) => seg.startsWith(DELIVERY_BLOCK_MARKER));
  const nextSegments =
    deliveryIndex >= 0
      ? [...withoutAuth.slice(0, deliveryIndex), block, ...withoutAuth.slice(deliveryIndex)]
      : [...withoutAuth, block];

  const next = nextSegments.join("\n\n");
  return next.length <= MAX_NOTES ? next : next.slice(0, MAX_NOTES);
}

/** True only when a valid, well-formed pilot-authorization record is present on the task. */
export function isFtcPilotAuthorized(task: JusticeCaseTaskRow | null | undefined): boolean {
  if (!task) return false;
  return parseFtcPilotAuthorizationRecord(task.notes) !== null;
}

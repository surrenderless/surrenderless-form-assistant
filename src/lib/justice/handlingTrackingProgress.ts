import type { JusticeApprovedNextAction } from "@/lib/justice/types";

/** Approved step opened by user action or by a Surrenderless handling request. */
export function isApprovedActionOpenedForHandlingTracking(
  action: Pick<JusticeApprovedNextAction, "status" | "handling_requested_at">
): boolean {
  if (action.status === "started" || action.status === "completed") return true;
  return Boolean(action.handling_requested_at?.trim());
}

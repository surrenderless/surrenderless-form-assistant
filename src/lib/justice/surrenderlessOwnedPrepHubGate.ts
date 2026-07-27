import type { SurrenderlessOwnedHumanFulfillmentPrepPageState } from "@/lib/justice/useSurrenderlessOwnedHumanFulfillmentPrepPage";

/**
 * Destination hubs never expose DIY prep/execute UI — ownership and chat own fulfillment.
 * Kept as a named gate so pages/tests fail closed if a DIY branch is reintroduced.
 */
export function isDiyAllowedOnSurrenderlessOwnedPrepHub(
  _status: SurrenderlessOwnedHumanFulfillmentPrepPageState["status"]
): boolean {
  return false;
}

/** Ownership still unresolved — hubs must show Loading, never DIY execution. */
export function shouldShowSurrenderlessOwnedPrepHubOwnershipPending(
  status: SurrenderlessOwnedHumanFulfillmentPrepPageState["status"]
): boolean {
  return status === "loading" || status === "indeterminate";
}

/**
 * Optional-hub escape redirects wait only for ownership fetch to leave `loading`.
 * Once owned or not_owned (or indeterminate), signed-in resumable consumers can
 * leave DIY hubs for chat. Blocking during `loading` prevents DIY race flashes.
 */
export function isOptionalHubEscapeSessionReadyForOwnedPrep(
  status: SurrenderlessOwnedHumanFulfillmentPrepPageState["status"]
): boolean {
  return status !== "loading";
}

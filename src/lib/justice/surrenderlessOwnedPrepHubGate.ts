import type { SurrenderlessOwnedHumanFulfillmentPrepPageState } from "@/lib/justice/useSurrenderlessOwnedHumanFulfillmentPrepPage";

/**
 * DIY prep/execute UI is allowed only after ownership resolves to not_owned.
 * Loading/indeterminate must not paint consumer submit/contact/file controls.
 */
export function isDiyAllowedOnSurrenderlessOwnedPrepHub(
  status: SurrenderlessOwnedHumanFulfillmentPrepPageState["status"]
): boolean {
  return status === "not_owned";
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

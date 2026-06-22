/** Destination persisted for a filing row; locked value wins when set. */
export function resolveFilingRecordSubmitDestination(
  lockedDestination: string | undefined,
  draftDestination: string
): string {
  const locked = lockedDestination?.trim();
  if (locked) return locked;
  return draftDestination.trim();
}

/** Whether filing destination capture is locked to a canonical step value. */
export function isFilingRecordDestinationLocked(lockedDestination: string | undefined): boolean {
  return Boolean(lockedDestination?.trim());
}

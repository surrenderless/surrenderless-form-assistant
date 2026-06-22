import { describe, expect, it } from "vitest";
import {
  canonicalFilingDestinationForApprovedActionHref,
  MANUAL_ACTION_TRACKING_REAL_BBB_PREP_HREF,
  MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF,
  MANUAL_ACTION_TRACKING_REAL_DOT_PREP_HREF,
  MANUAL_ACTION_TRACKING_REAL_STATE_AG_PREP_HREF,
} from "@/lib/justice/handlingTrackingProgress";

/** Prep pages pass these href constants as locked filing destinations. */
const PREP_PAGE_LOCKED_FILING_DESTINATIONS = [
  [MANUAL_ACTION_TRACKING_REAL_BBB_PREP_HREF, "Better Business Bureau"],
  [MANUAL_ACTION_TRACKING_REAL_STATE_AG_PREP_HREF, "State Attorney General (consumer)"],
  [MANUAL_ACTION_TRACKING_REAL_DOT_PREP_HREF, "USDOT / aviation consumer"],
  [MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF, "Small claims / demand letter"],
] as const;

describe("prep page filing destination lock", () => {
  it.each(PREP_PAGE_LOCKED_FILING_DESTINATIONS)(
    "resolves a non-empty canonical destination for %s",
    (href, expected) => {
      expect(canonicalFilingDestinationForApprovedActionHref(href)).toBe(expected);
    }
  );
});

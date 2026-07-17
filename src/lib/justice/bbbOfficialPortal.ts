import { REAL_BBB_COMPLAINT_SUBMISSION_URL } from "@/lib/justice/assistedSubmissionLane";

/**
 * Single official BBB consumer complaint portal.
 * Do not invent alternate URLs — this is the confirmed filing entry point already grounded in-repo.
 */
export const BBB_OFFICIAL_COMPLAINT_PORTAL_URL = REAL_BBB_COMPLAINT_SUBMISSION_URL;

export type BbbOfficialPortalResolution = {
  portal_url: typeof BBB_OFFICIAL_COMPLAINT_PORTAL_URL;
  portal_supported: true;
  operator_guidance: string;
};

export function resolveBbbOfficialPortal(): BbbOfficialPortalResolution {
  return {
    portal_url: BBB_OFFICIAL_COMPLAINT_PORTAL_URL,
    portal_supported: true,
    operator_guidance:
      "Owned BBB autofill may complete this step when it succeeds. If this queue item is still open, open the official BBB.org complaint portal in a new tab, paste the prepared answers and draft manually, then record the portal confirmation here. This workspace is operator fallback only — it does not invent autofill or submit the complaint.",
  };
}

import { DOT_AIR_CONSUMER_URL } from "@/lib/justice/buildDotAviationComplaintDraft";

/**
 * Single official DOT aviation consumer complaint portal.
 * Do not invent alternate URLs — this is the confirmed government filing entry point.
 */
export const DOT_OFFICIAL_AVIATION_CONSUMER_COMPLAINT_PORTAL_URL = DOT_AIR_CONSUMER_URL;

export type DotOfficialPortalResolution = {
  portal_url: typeof DOT_OFFICIAL_AVIATION_CONSUMER_COMPLAINT_PORTAL_URL;
  portal_supported: true;
  operator_guidance: string;
};

export function resolveDotOfficialPortal(): DotOfficialPortalResolution {
  return {
    portal_url: DOT_OFFICIAL_AVIATION_CONSUMER_COMPLAINT_PORTAL_URL,
    portal_supported: true,
    operator_guidance:
      "Open the official U.S. Department of Transportation aviation consumer portal in a new tab, paste the prepared answers and draft manually, then record the portal confirmation here. This app does not submit the complaint.",
  };
}

/**
 * Single official CFPB consumer complaint portal.
 * Do not invent alternate URLs — this is the confirmed government filing entry point.
 */
export const CFPB_OFFICIAL_CONSUMER_COMPLAINT_PORTAL_URL =
  "https://www.consumerfinance.gov/complaint/";

export type CfpbOfficialPortalResolution = {
  portal_url: typeof CFPB_OFFICIAL_CONSUMER_COMPLAINT_PORTAL_URL;
  portal_supported: true;
  operator_guidance: string;
};

export function resolveCfpbOfficialPortal(): CfpbOfficialPortalResolution {
  return {
    portal_url: CFPB_OFFICIAL_CONSUMER_COMPLAINT_PORTAL_URL,
    portal_supported: true,
    operator_guidance:
      "Open the official CFPB consumer-complaint portal in a new tab, paste the prepared answers and draft manually, then record the portal confirmation here. This app does not submit the complaint.",
  };
}

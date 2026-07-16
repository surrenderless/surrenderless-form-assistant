/**
 * Single official FCC consumer complaint portal.
 * Do not invent alternate URLs — this is the confirmed government filing entry point.
 */
export const FCC_OFFICIAL_CONSUMER_COMPLAINT_PORTAL_URL =
  "https://consumercomplaints.fcc.gov/";

export type FccOfficialPortalResolution = {
  portal_url: typeof FCC_OFFICIAL_CONSUMER_COMPLAINT_PORTAL_URL;
  portal_supported: true;
  operator_guidance: string;
};

export function resolveFccOfficialPortal(): FccOfficialPortalResolution {
  return {
    portal_url: FCC_OFFICIAL_CONSUMER_COMPLAINT_PORTAL_URL,
    portal_supported: true,
    operator_guidance:
      "Open the official FCC consumer-complaint portal in a new tab, paste the prepared answers and draft manually, then record the portal confirmation here. This app does not submit the complaint.",
  };
}

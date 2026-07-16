/**
 * Single official FTC consumer complaint portal (ReportFraud).
 * Do not invent alternate URLs — this is the confirmed government filing entry point.
 */
export const FTC_OFFICIAL_CONSUMER_COMPLAINT_PORTAL_URL = "https://reportfraud.ftc.gov/";

export type FtcOfficialPortalResolution = {
  portal_url: typeof FTC_OFFICIAL_CONSUMER_COMPLAINT_PORTAL_URL;
  portal_supported: true;
  operator_guidance: string;
};

export function resolveFtcOfficialPortal(): FtcOfficialPortalResolution {
  return {
    portal_url: FTC_OFFICIAL_CONSUMER_COMPLAINT_PORTAL_URL,
    portal_supported: true,
    operator_guidance:
      "Open the official FTC ReportFraud consumer-complaint portal in a new tab, paste the prepared answers and draft manually, then record the portal confirmation here. This app does not submit the complaint.",
  };
}

import { stateNameFromCode, US_STATES } from "@/lib/justice/buildStateAgComplaintDraft";

/**
 * Curated official state consumer-complaint portal URLs only.
 * States not listed intentionally return unsupported — never invent a URL.
 */
export const STATE_AG_OFFICIAL_CONSUMER_COMPLAINT_PORTALS: Readonly<
  Partial<Record<string, string>>
> = {
  AZ: "https://www.azag.gov/complaints/consumer",
  CA: "https://oag.ca.gov/contact/consumer-complaint-against-business-or-company",
  CO: "https://coag.gov/file-a-complaint/",
  CT: "https://portal.ct.gov/ag/consumer-protection",
  DC: "https://oag.dc.gov/consumer-protection",
  DE: "https://attorneygeneral.delaware.gov/fraud/cpu/complaint/",
  FL: "https://www.myfloridalegal.com/consumer-protection/consumer-complaint-form",
  GA: "https://consumer.georgia.gov/consumer-topics/consumer-complaint-form",
  IL: "https://illinoisattorneygeneral.gov/consumer-protection/consumer-complaint/",
  IN: "https://www.in.gov/attorneygeneral/consumer-protection-division/file-a-complaint/",
  MA: "https://www.mass.gov/how-to/file-a-consumer-complaint-with-the-attorney-generals-office",
  MD: "https://www.marylandattorneygeneral.gov/Pages/CPD/Complaint.aspx",
  MI: "https://www.michigan.gov/ag/initiate-a-complaint",
  MN: "https://www.ag.state.mn.us/consumer/complaint/",
  NC: "https://ncdoj.gov/protecting-consumers/consumer-complaints/",
  NJ: "https://www.njconsumeraffairs.gov/Pages/ConsumerComplaints.aspx",
  NY: "https://ag.ny.gov/consumer-frauds/filing-consumer-complaint",
  OH: "https://www.ohioattorneygeneral.gov/Individuals-and-Families/Consumers/File-a-Complaint",
  OR: "https://www.doj.state.or.us/consumer-protection/consumer-complaints/",
  PA: "https://www.attorneygeneral.gov/submit-a-complaint/",
  TX: "https://www.texasattorneygeneral.gov/consumer-protection/file-consumer-complaint",
  VA: "https://www.oag.state.va.us/consumer-protection/filing-a-complaint",
  WA: "https://www.atg.wa.gov/file-complaint",
  WI: "https://www.doj.state.wi.us/dls/consumer-protection/consumer-complaints",
};

/** Official federal directory for locating a state's consumer office — not a filing portal. */
export const STATE_CONSUMER_OFFICE_DIRECTORY_URL = "https://www.usa.gov/state-consumer";

export type StateAgPortalUnsupportedReason = "missing_state" | "unsupported_state";

export type StateAgOfficialPortalResolution = {
  consumer_us_state: string | null;
  state_name: string | null;
  portal_url: string | null;
  portal_supported: boolean;
  unsupported_reason: StateAgPortalUnsupportedReason | null;
  state_office_directory_url: typeof STATE_CONSUMER_OFFICE_DIRECTORY_URL;
  operator_guidance: string;
};

export function normalizeConsumerUsStateCode(
  consumerUsState: string | null | undefined
): string | null {
  const code = consumerUsState?.trim().toUpperCase() ?? "";
  if (!code) return null;
  if (!US_STATES.some((s) => s.code === code)) return null;
  return code;
}

export function resolveStateAgOfficialPortal(
  consumerUsState: string | null | undefined
): StateAgOfficialPortalResolution {
  const directory = STATE_CONSUMER_OFFICE_DIRECTORY_URL;
  const code = normalizeConsumerUsStateCode(consumerUsState);

  if (!code) {
    return {
      consumer_us_state: null,
      state_name: null,
      portal_url: null,
      portal_supported: false,
      unsupported_reason: "missing_state",
      state_office_directory_url: directory,
      operator_guidance:
        "Consumer US state is missing. Look up the correct official state consumer-complaint portal using the federal directory link — do not invent a URL, and do not mark filing complete until the portal confirms submission.",
    };
  }

  const portalUrl = STATE_AG_OFFICIAL_CONSUMER_COMPLAINT_PORTALS[code] ?? null;
  const stateName = stateNameFromCode(code);

  if (!portalUrl) {
    return {
      consumer_us_state: code,
      state_name: stateName,
      portal_url: null,
      portal_supported: false,
      unsupported_reason: "unsupported_state",
      state_office_directory_url: directory,
      operator_guidance: `No confirmed official consumer-complaint portal URL is configured for ${stateName} (${code}). Use the federal directory to open the correct official state site in a new tab. Do not invent a portal URL.`,
    };
  }

  return {
    consumer_us_state: code,
    state_name: stateName,
    portal_url: portalUrl,
    portal_supported: true,
    unsupported_reason: null,
    state_office_directory_url: directory,
    operator_guidance: `Open the official ${stateName} (${code}) consumer-complaint portal in a new tab, paste the prepared answers and draft manually, then record the portal confirmation here. This app does not submit the complaint.`,
  };
}

/** State codes in US_STATES that still lack a curated official portal URL. */
export function listUsStatesWithoutConfirmedStateAgPortal(): string[] {
  return US_STATES.map((s) => s.code).filter(
    (code) => !STATE_AG_OFFICIAL_CONSUMER_COMPLAINT_PORTALS[code]
  );
}

import { stateNameFromCode, US_STATES } from "@/lib/justice/buildStateAgComplaintDraft";

/**
 * Curated official state consumer-complaint portal URLs only.
 * States not listed intentionally return unsupported — never invent a URL.
 */
export const STATE_AG_OFFICIAL_CONSUMER_COMPLAINT_PORTALS: Readonly<
  Partial<Record<string, string>>
> = {
  AK: "https://www.law.alaska.gov/department/civil/consumer/complaint-form.html",
  AL: "https://www.alabamaag.gov/consumer-complaint/",
  AR: "https://arkansasag.gov/file-a-complaint/",
  AZ: "https://www.azag.gov/complaints/consumer",
  CA: "https://oag.ca.gov/contact/consumer-complaint-against-business-or-company",
  CO: "https://coag.gov/file-a-complaint/",
  CT: "https://portal.ct.gov/ag/consumer-protection",
  DC: "https://oag.dc.gov/consumer-protection",
  DE: "https://attorneygeneral.delaware.gov/fraud/cpu/complaint/",
  FL: "https://www.myfloridalegal.com/consumer-protection/consumer-complaint-form",
  GA: "https://consumer.georgia.gov/consumer-topics/consumer-complaint-form",
  HI: "https://web2.dcca.hawaii.gov/ocpcomplaint/",
  IA: "https://www.iowaattorneygeneral.gov/for-consumers/file-a-consumer-complaint/complaint-form",
  ID: "https://www.ag.idaho.gov/consumer-protection/consumer-complaints/",
  IL: "https://illinoisattorneygeneral.gov/consumer-protection/consumer-complaint/",
  IN: "https://www.in.gov/attorneygeneral/consumer-protection-division/file-a-complaint/",
  KS: "https://www.ag.ks.gov/file-a-complaint/consumer-protection",
  KY: "https://kyoag.highq.com/kyoag/renderSmartForm.action?formId=078dc72e-bd16-4041-9119-d248b2240c25",
  LA: "https://ag.state.la.us/Complaint/ConsumerDispute",
  MA: "https://www.mass.gov/how-to/file-a-consumer-complaint-with-the-attorney-generals-office",
  MD: "https://www.marylandattorneygeneral.gov/Pages/CPD/Complaint.aspx",
  ME: "https://www.maine.gov/ag/online-services/file-a-consumer-complaint-and-request-mediation",
  MI: "https://www.michigan.gov/ag/initiate-a-complaint",
  MN: "https://www.ag.state.mn.us/consumer/complaint/",
  MO: "https://app.ago.mo.gov/app/consumercomplaint",
  MS: "https://portal.ago.ms.gov/public/?q=node/403",
  MT: "https://app.doj.mt.gov/OCPPortal/?q=node/395",
  NC: "https://ncdoj.gov/protecting-consumers/consumer-complaints/",
  ND: "https://attorneygeneral.nd.gov/consumer-resources/general-complaint/",
  NE: "https://ago.nebraska.gov/constituent-complaint-form",
  NH: "https://www.doj.nh.gov/citizens/consumer-protection-antitrust-bureau/consumer-complaints",
  NJ: "https://www.njconsumeraffairs.gov/Pages/ConsumerComplaints.aspx",
  NM: "https://nmdoj.gov/get-help/submit-a-complaint/",
  NV: "https://ag.nv.gov/Complaints/CSU_Complaints___FAQ/",
  NY: "https://ag.ny.gov/consumer-frauds/filing-consumer-complaint",
  OH: "https://www.ohioattorneygeneral.gov/Individuals-and-Families/Consumers/File-a-Complaint",
  OK: "https://oklahoma.gov/oag/complaints-tiplines/complaints/consumer.html",
  OR: "https://www.doj.state.or.us/consumer-protection/consumer-complaints/",
  PA: "https://www.attorneygeneral.gov/submit-a-complaint/",
  RI: "https://riag.ri.gov/forms/consumer-complaint",
  SC: "https://applications.sc.gov/DCAComplaintSystem/Login/ConsumerLogin.aspx",
  SD: "https://atg.sd.gov/complaintform.aspx",
  TN: "https://www.tn.gov/attorneygeneral/working-for-tennessee/consumer/file-a-complaint.html",
  TX: "https://www.texasattorneygeneral.gov/consumer-protection/file-consumer-complaint",
  UT: "https://services.dcp.utah.gov/s/",
  VA: "https://www.oag.state.va.us/consumer-protection/filing-a-complaint",
  VT: "https://ago.vermont.gov/consumer-assistance-program-complaint-form",
  WA: "https://www.atg.wa.gov/file-complaint",
  WI: "https://www.doj.state.wi.us/dls/consumer-protection/consumer-complaints",
  WV: "https://ago.wv.gov/consumer-protection/file-complaint-consumer-protection-division",
  WY: "https://ag.wyo.gov/law-office-division/consumer-protection-and-antitrust-unit/consumer-complaints",
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

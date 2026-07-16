import { describe, expect, it } from "vitest";
import { US_STATES } from "@/lib/justice/buildStateAgComplaintDraft";
import {
  listUsStatesWithoutConfirmedStateAgPortal,
  resolveStateAgOfficialPortal,
  STATE_AG_OFFICIAL_CONSUMER_COMPLAINT_PORTALS,
  STATE_CONSUMER_OFFICE_DIRECTORY_URL,
} from "@/lib/justice/stateAgOfficialPortal";

/** Jurisdictions added in the coverage expansion; keep exact URL assertions. */
const NEWLY_CURATED_PORTALS: Readonly<Record<string, string>> = {
  AL: "https://www.alabamaag.gov/consumer-complaint/",
  AR: "https://arkansasag.gov/file-a-complaint/",
  HI: "https://web2.dcca.hawaii.gov/ocpcomplaint/",
  IA: "https://www.iowaattorneygeneral.gov/for-consumers/file-a-consumer-complaint/complaint-form",
  ID: "https://www.ag.idaho.gov/consumer-protection/consumer-complaints/",
  KS: "https://www.ag.ks.gov/file-a-complaint/consumer-protection",
  KY: "https://kyoag.highq.com/kyoag/renderSmartForm.action?formId=078dc72e-bd16-4041-9119-d248b2240c25",
  LA: "https://ag.state.la.us/Complaint/ConsumerDispute",
  ME: "https://www.maine.gov/ag/online-services/file-a-consumer-complaint-and-request-mediation",
  MO: "https://app.ago.mo.gov/app/consumercomplaint",
  MS: "https://portal.ago.ms.gov/public/?q=node/403",
  MT: "https://app.doj.mt.gov/OCPPortal/?q=node/395",
  ND: "https://attorneygeneral.nd.gov/consumer-resources/general-complaint/",
  NE: "https://ago.nebraska.gov/constituent-complaint-form",
  NH: "https://www.doj.nh.gov/citizens/consumer-protection-antitrust-bureau/consumer-complaints",
  NM: "https://nmdoj.gov/get-help/submit-a-complaint/",
  NV: "https://ag.nv.gov/Complaints/CSU_Complaints___FAQ/",
  RI: "https://riag.ri.gov/forms/consumer-complaint",
  SC: "https://applications.sc.gov/DCAComplaintSystem/Login/ConsumerLogin.aspx",
  SD: "https://atg.sd.gov/complaintform.aspx",
  TN: "https://www.tn.gov/attorneygeneral/working-for-tennessee/consumer/file-a-complaint.html",
  UT: "https://services.dcp.utah.gov/s/",
  VT: "https://ago.vermont.gov/consumer-assistance-program-complaint-form",
  WV: "https://ago.wv.gov/consumer-protection/file-complaint-consumer-protection-division",
  WY: "https://ag.wyo.gov/law-office-division/consumer-protection-and-antitrust-unit/consumer-complaints",
};

describe("resolveStateAgOfficialPortal", () => {
  it("resolves CA to the official complaint portal URL", () => {
    const resolved = resolveStateAgOfficialPortal("ca");
    expect(resolved.portal_supported).toBe(true);
    expect(resolved.consumer_us_state).toBe("CA");
    expect(resolved.state_name).toBe("California");
    expect(resolved.portal_url).toBe(STATE_AG_OFFICIAL_CONSUMER_COMPLAINT_PORTALS.CA);
    expect(resolved.unsupported_reason).toBeNull();
    expect(resolved.portal_url).toMatch(/^https:\/\//);
  });

  it("returns missing_state with no invented URL when state is absent", () => {
    const resolved = resolveStateAgOfficialPortal(undefined);
    expect(resolved.portal_supported).toBe(false);
    expect(resolved.portal_url).toBeNull();
    expect(resolved.unsupported_reason).toBe("missing_state");
    expect(resolved.state_office_directory_url).toBe(STATE_CONSUMER_OFFICE_DIRECTORY_URL);
  });

  it("returns unsupported_state with no invented URL when code has no curated portal", () => {
    const unsupported = listUsStatesWithoutConfirmedStateAgPortal();
    expect(unsupported.length).toBeGreaterThan(0);
    expect(unsupported).toEqual(expect.arrayContaining(["AK", "OK"]));
    const code = unsupported[0]!;
    const resolved = resolveStateAgOfficialPortal(code);
    expect(resolved.portal_supported).toBe(false);
    expect(resolved.portal_url).toBeNull();
    expect(resolved.unsupported_reason).toBe("unsupported_state");
    expect(resolved.consumer_us_state).toBe(code);
    expect(resolved.state_office_directory_url).toBe(STATE_CONSUMER_OFFICE_DIRECTORY_URL);
  });

  it("rejects unknown state codes without inventing a URL", () => {
    const resolved = resolveStateAgOfficialPortal("XX");
    expect(resolved.portal_supported).toBe(false);
    expect(resolved.portal_url).toBeNull();
    expect(resolved.unsupported_reason).toBe("missing_state");
  });

  it("covers only curated portals; remaining US_STATES are reported as lacking URLs", () => {
    const missing = listUsStatesWithoutConfirmedStateAgPortal();
    expect(missing.length + Object.keys(STATE_AG_OFFICIAL_CONSUMER_COMPLAINT_PORTALS).length).toBe(
      US_STATES.length
    );
    for (const code of Object.keys(STATE_AG_OFFICIAL_CONSUMER_COMPLAINT_PORTALS)) {
      expect(missing).not.toContain(code);
    }
  });

  it.each(Object.entries(NEWLY_CURATED_PORTALS))(
    "resolves newly curated %s to its confirmed official portal URL",
    (code, portalUrl) => {
      expect(STATE_AG_OFFICIAL_CONSUMER_COMPLAINT_PORTALS[code]).toBe(portalUrl);
      const resolved = resolveStateAgOfficialPortal(code);
      expect(resolved.portal_supported).toBe(true);
      expect(resolved.consumer_us_state).toBe(code);
      expect(resolved.portal_url).toBe(portalUrl);
      expect(resolved.unsupported_reason).toBeNull();
      expect(resolved.portal_url).toMatch(/^https:\/\//);
    }
  );
});

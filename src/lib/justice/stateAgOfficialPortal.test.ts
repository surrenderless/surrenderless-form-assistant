import { describe, expect, it } from "vitest";
import { US_STATES } from "@/lib/justice/buildStateAgComplaintDraft";
import {
  listUsStatesWithoutConfirmedStateAgPortal,
  resolveStateAgOfficialPortal,
  STATE_AG_OFFICIAL_CONSUMER_COMPLAINT_PORTALS,
  STATE_CONSUMER_OFFICE_DIRECTORY_URL,
} from "@/lib/justice/stateAgOfficialPortal";

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
});

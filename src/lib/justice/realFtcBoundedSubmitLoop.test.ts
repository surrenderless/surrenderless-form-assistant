import { describe, expect, it } from "vitest";
import {
  buildRealFtcIncompleteError,
  detectRealFtcTerminalConfirmation,
  extractFtcConfirmationReference,
  isFtcReportAssistantUrl,
  isFtcReportChoiceFlowUrl,
  isFtcReportEntryUrl,
  isFtcReportFormMainUrl,
  REAL_FTC_MAX_SUBMIT_STEPS,
} from "@/lib/justice/realFtcBoundedSubmitLoop";
import { REAL_BBB_MAX_SUBMIT_STEPS, hasReachedStepCap } from "@/lib/justice/realBbbBoundedSubmitLoop";
import type { AssistedFormPageData } from "@/lib/justice/realBbbBoundedSubmitLoop";

function pageData(partial: Partial<AssistedFormPageData>): AssistedFormPageData {
  return {
    fields: [],
    buttons: [],
    url: "https://reportfraud.ftc.gov/",
    pageText: "",
    ...partial,
  };
}

describe("REAL_FTC_MAX_SUBMIT_STEPS", () => {
  it("is independently 24 and does not share BBB's cap of 8", () => {
    expect(REAL_FTC_MAX_SUBMIT_STEPS).toBe(24);
    expect(REAL_BBB_MAX_SUBMIT_STEPS).toBe(8);
    expect(REAL_FTC_MAX_SUBMIT_STEPS).not.toBe(REAL_BBB_MAX_SUBMIT_STEPS);
    expect(hasReachedStepCap(8, REAL_FTC_MAX_SUBMIT_STEPS)).toBe(false);
    expect(hasReachedStepCap(24, REAL_FTC_MAX_SUBMIT_STEPS)).toBe(true);
    expect(hasReachedStepCap(8, REAL_BBB_MAX_SUBMIT_STEPS)).toBe(true);
  });
});

describe("isFtcReportEntryUrl", () => {
  it("accepts only the official HTTPS bare entry root", () => {
    expect(isFtcReportEntryUrl("https://reportfraud.ftc.gov/")).toBe(true);
    expect(isFtcReportEntryUrl("https://reportfraud.ftc.gov/#/")).toBe(true);
    expect(isFtcReportEntryUrl("https://reportfraud.ftc.gov/assistant")).toBe(false);
    expect(isFtcReportEntryUrl("https://reportfraud.ftc.gov/?source=test")).toBe(false);
    expect(isFtcReportEntryUrl("https://example.com/")).toBe(false);
    expect(isFtcReportEntryUrl("http://reportfraud.ftc.gov/")).toBe(false);
  });
});

describe("isFtcReportAssistantUrl", () => {
  it("accepts only the official HTTPS assistant path", () => {
    expect(isFtcReportAssistantUrl("https://reportfraud.ftc.gov/assistant")).toBe(true);
    expect(isFtcReportAssistantUrl("https://reportfraud.ftc.gov/assistant?page=2")).toBe(true);
    expect(isFtcReportAssistantUrl("https://reportfraud.ftc.gov/")).toBe(false);
    expect(isFtcReportAssistantUrl("https://example.com/assistant")).toBe(false);
    expect(isFtcReportAssistantUrl("http://reportfraud.ftc.gov/assistant")).toBe(false);
  });
});

describe("isFtcReportFormMainUrl / isFtcReportChoiceFlowUrl", () => {
  it("accepts only the official HTTPS form main path and choice-flow union", () => {
    expect(isFtcReportFormMainUrl("https://reportfraud.ftc.gov/form/main")).toBe(true);
    expect(isFtcReportFormMainUrl("https://reportfraud.ftc.gov/form/main?x=1")).toBe(true);
    expect(isFtcReportFormMainUrl("https://reportfraud.ftc.gov/assistant")).toBe(false);
    expect(isFtcReportFormMainUrl("https://example.com/form/main")).toBe(false);
    expect(isFtcReportChoiceFlowUrl("https://reportfraud.ftc.gov/form/main")).toBe(true);
    expect(isFtcReportChoiceFlowUrl("https://reportfraud.ftc.gov/assistant")).toBe(true);
    expect(isFtcReportChoiceFlowUrl("https://reportfraud.ftc.gov/")).toBe(false);
  });
});

describe("detectRealFtcTerminalConfirmation", () => {
  it("does not treat the ReportFraud entry page as terminal", () => {
    expect(
      detectRealFtcTerminalConfirmation(
        pageData({ url: "https://reportfraud.ftc.gov/", pageText: "Report fraud to the FTC" })
      )
    ).toBe(false);
  });

  it("does not treat an uncertain mid-wizard page as terminal", () => {
    expect(
      detectRealFtcTerminalConfirmation(
        pageData({
          url: "https://reportfraud.ftc.gov/#/?orgcode=X&pageNumber=3",
          pageText: "Tell us what happened. Continue to the next step.",
        })
      )
    ).toBe(false);
  });

  it("ignores confirmation-like text on non-FTC hosts", () => {
    expect(
      detectRealFtcTerminalConfirmation(
        pageData({
          url: "https://evil.example/thank-you",
          pageText: "Thank you for your report. Report number: 123456",
        })
      )
    ).toBe(false);
  });

  it("detects a terminal confirmation by strong body text", () => {
    expect(
      detectRealFtcTerminalConfirmation(
        pageData({
          url: "https://reportfraud.ftc.gov/#/thank-you",
          pageText: "Thank you for your report. Your report number is 987654.",
        })
      )
    ).toBe(true);
  });

  it("detects a terminal confirmation by confirmation-like URL path", () => {
    expect(
      detectRealFtcTerminalConfirmation(
        pageData({ url: "https://reportfraud.ftc.gov/confirmation", pageText: "" })
      )
    ).toBe(true);
  });
});

describe("extractFtcConfirmationReference", () => {
  it("extracts a report number when present", () => {
    expect(
      extractFtcConfirmationReference("Thank you. Report number: FTC-2026-4455")
    ).toBe("FTC-2026-4455");
  });

  it("extracts a reference number when present", () => {
    expect(extractFtcConfirmationReference("Your reference number is 55AA99B.")).toBe("55AA99B");
  });

  it("returns null when no identifier can be read", () => {
    expect(extractFtcConfirmationReference("Thank you for your report.")).toBeNull();
    expect(extractFtcConfirmationReference(null)).toBeNull();
  });
});

describe("buildRealFtcIncompleteError", () => {
  it("mentions the step cap for max_steps_reached", () => {
    expect(buildRealFtcIncompleteError("max_steps_reached", REAL_FTC_MAX_SUBMIT_STEPS)).toContain(
      String(REAL_FTC_MAX_SUBMIT_STEPS)
    );
  });

  it("returns retriable copy for decide_action_failed", () => {
    expect(buildRealFtcIncompleteError("decide_action_failed", 1)).toContain("retry");
  });
});

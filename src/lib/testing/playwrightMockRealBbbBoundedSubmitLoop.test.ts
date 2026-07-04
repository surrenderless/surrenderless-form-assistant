import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PLAYWRIGHT_MOCK_REAL_BBB_BOUNDED_SUBMIT_LOOP_CONFIRMATION_PATH,
  PLAYWRIGHT_MOCK_REAL_BBB_BOUNDED_SUBMIT_LOOP_ENTRY_PATH,
  buildPlaywrightMockRealBbbDecideActionDecision,
  detectBoundedSubmitTerminalConfirmation,
  detectPlaywrightMockRealBbbBoundedSubmitTerminalConfirmation,
  isPlaywrightMockRealBbbBoundedSubmitLoopEnabled,
  isPlaywrightMockRealBbbBoundedSubmitTerminalUrl,
  resolvePlaywrightMockRealBbbBoundedSubmitNavigationUrl,
} from "@/lib/testing/playwrightMockRealBbbBoundedSubmitLoop";
import type { AssistedFormPageData } from "@/lib/justice/realBbbBoundedSubmitLoop";

const BASE = "http://127.0.0.1:3000";
const OFFICIAL_URL = "https://www.bbb.org/complain/";

const entryPage: AssistedFormPageData = {
  url: `${BASE}${PLAYWRIGHT_MOCK_REAL_BBB_BOUNDED_SUBMIT_LOOP_ENTRY_PATH}`,
  fields: [{ tag: "input", type: "text", name: "company_name", id: "company_name", placeholder: "", label: "" }],
  buttons: [{ text: "Continue", id: "continue_btn", name: "", type: "submit" }],
  pageText: "File a complaint with BBB",
};

const terminalPage: AssistedFormPageData = {
  url: `${BASE}${PLAYWRIGHT_MOCK_REAL_BBB_BOUNDED_SUBMIT_LOOP_CONFIRMATION_PATH}`,
  fields: [],
  buttons: [],
  pageText:
    "Thank you for submitting your complaint. Your complaint has been successfully submitted.",
};

describe("playwrightMockRealBbbBoundedSubmitLoop", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is disabled unless PLAYWRIGHT_MOCK_REAL_BBB_BOUNDED_SUBMIT_LOOP=1 and assisted-submit mock is on", () => {
    expect(isPlaywrightMockRealBbbBoundedSubmitLoopEnabled()).toBe(false);
    vi.stubEnv("PLAYWRIGHT_MOCK_REAL_BBB_BOUNDED_SUBMIT_LOOP", "1");
    expect(isPlaywrightMockRealBbbBoundedSubmitLoopEnabled()).toBe(false);
    vi.stubEnv("PLAYWRIGHT_MOCK_ASSISTED_SUBMIT_PIPELINE", "1");
    expect(isPlaywrightMockRealBbbBoundedSubmitLoopEnabled()).toBe(true);
  });

  it("is disabled on deployed production even when flags are set", () => {
    vi.stubEnv("PLAYWRIGHT_MOCK_REAL_BBB_BOUNDED_SUBMIT_LOOP", "1");
    vi.stubEnv("PLAYWRIGHT_MOCK_ASSISTED_SUBMIT_PIPELINE", "1");
    vi.stubEnv("VERCEL_ENV", "production");
    expect(isPlaywrightMockRealBbbBoundedSubmitLoopEnabled()).toBe(false);
  });

  it("rewrites the official BBB complain URL to the loopback mock entry page", () => {
    vi.stubEnv("PLAYWRIGHT_MOCK_REAL_BBB_BOUNDED_SUBMIT_LOOP", "1");
    vi.stubEnv("PLAYWRIGHT_MOCK_ASSISTED_SUBMIT_PIPELINE", "1");

    expect(resolvePlaywrightMockRealBbbBoundedSubmitNavigationUrl(OFFICIAL_URL, BASE)).toBe(
      `${BASE}${PLAYWRIGHT_MOCK_REAL_BBB_BOUNDED_SUBMIT_LOOP_ENTRY_PATH}`
    );
    expect(resolvePlaywrightMockRealBbbBoundedSubmitNavigationUrl(OFFICIAL_URL, `${BASE}/`)).toBe(
      `${BASE}${PLAYWRIGHT_MOCK_REAL_BBB_BOUNDED_SUBMIT_LOOP_ENTRY_PATH}`
    );
    expect(resolvePlaywrightMockRealBbbBoundedSubmitNavigationUrl("https://example.com/", BASE)).toBe(
      "https://example.com/"
    );
  });

  it("does not rewrite when the loop flag is off", () => {
    expect(resolvePlaywrightMockRealBbbBoundedSubmitNavigationUrl(OFFICIAL_URL, BASE)).toBe(OFFICIAL_URL);
  });

  it("detects terminal confirmation on the mock confirmation page", () => {
    expect(isPlaywrightMockRealBbbBoundedSubmitTerminalUrl(terminalPage.url)).toBe(true);
    expect(detectPlaywrightMockRealBbbBoundedSubmitTerminalConfirmation(terminalPage)).toBe(true);
    expect(detectPlaywrightMockRealBbbBoundedSubmitTerminalConfirmation(entryPage)).toBe(false);
  });

  it("uses mock terminal detection only when the loop flag is enabled", () => {
    expect(detectBoundedSubmitTerminalConfirmation(terminalPage)).toBe(false);

    vi.stubEnv("PLAYWRIGHT_MOCK_REAL_BBB_BOUNDED_SUBMIT_LOOP", "1");
    vi.stubEnv("PLAYWRIGHT_MOCK_ASSISTED_SUBMIT_PIPELINE", "1");
    expect(detectBoundedSubmitTerminalConfirmation(terminalPage)).toBe(true);
    expect(detectBoundedSubmitTerminalConfirmation(entryPage)).toBe(false);
  });

  it("builds deterministic decide-action output for the mock entry page", () => {
    const decision = buildPlaywrightMockRealBbbDecideActionDecision(entryPage, {
      business_name: "E2E Co",
    });

    expect(decision).toEqual({
      fieldsToFill: [{ selector: "company_name", value: "E2E Co" }],
      nextButton: { selectorType: "id", value: "continue_btn" },
      waitForNavigation: true,
    });
    expect(buildPlaywrightMockRealBbbDecideActionDecision(terminalPage, {})).toEqual({
      fieldsToFill: [],
    });
    expect(
      buildPlaywrightMockRealBbbDecideActionDecision(
        { ...entryPage, url: "https://example.com/form" },
        {}
      )
    ).toBeNull();
  });
});

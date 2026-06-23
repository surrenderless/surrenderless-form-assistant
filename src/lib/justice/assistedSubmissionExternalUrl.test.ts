import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildMockBbbPracticeSubmissionUrl,
  buildMockFtcPracticeSubmissionUrl,
  REAL_BBB_COMPLAINT_SUBMISSION_URL,
} from "@/lib/justice/assistedSubmissionLane";
import {
  ASSISTED_SUBMISSION_URL_FORBIDDEN_ERROR,
  evaluateAssistedSubmissionUrlPolicy,
  isAllowedExternalAssistedSubmissionUrl,
  isSameOriginMockAssistedSubmissionUrl,
} from "@/lib/justice/assistedSubmissionExternalUrl";

const ORIGIN = "https://example.com";

describe("assistedSubmissionExternalUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("allows same-origin mock FTC and BBB practice submission URLs", () => {
    const ftcUrl = buildMockFtcPracticeSubmissionUrl(ORIGIN);
    const bbbUrl = buildMockBbbPracticeSubmissionUrl(ORIGIN);

    expect(isSameOriginMockAssistedSubmissionUrl(ftcUrl, ORIGIN)).toBe(true);
    expect(isSameOriginMockAssistedSubmissionUrl(bbbUrl, ORIGIN)).toBe(true);
    expect(evaluateAssistedSubmissionUrlPolicy(ftcUrl, ORIGIN)).toEqual({ allowed: true });
    expect(evaluateAssistedSubmissionUrlPolicy(bbbUrl, ORIGIN)).toEqual({ allowed: true });
  });

  it("rejects mock practice paths on a different origin", () => {
    const bbbUrl = buildMockBbbPracticeSubmissionUrl(ORIGIN);
    expect(isSameOriginMockAssistedSubmissionUrl(bbbUrl, "https://other.example")).toBe(false);
    expect(evaluateAssistedSubmissionUrlPolicy(bbbUrl, "https://other.example")).toEqual({
      allowed: false,
      error: ASSISTED_SUBMISSION_URL_FORBIDDEN_ERROR,
    });
  });

  it("allows loopback mock URLs during Playwright E2E when localhost and 127.0.0.1 differ", () => {
    vi.stubEnv("PLAYWRIGHT_MOCK_ASSISTED_SUBMIT_PIPELINE", "1");
    expect(
      evaluateAssistedSubmissionUrlPolicy(
        "http://127.0.0.1:3000/mock/ftc-complaint",
        "http://localhost:3000"
      )
    ).toEqual({ allowed: true });
  });

  it("does not allow loopback mock URLs during Playwright E2E when the flag is off", () => {
    expect(
      evaluateAssistedSubmissionUrlPolicy(
        "http://127.0.0.1:3000/mock/ftc-complaint",
        "http://localhost:3000"
      )
    ).toEqual({
      allowed: false,
      error: ASSISTED_SUBMISSION_URL_FORBIDDEN_ERROR,
    });
  });

  it("rejects the real BBB submission URL when autofill is disabled", () => {
    expect(isAllowedExternalAssistedSubmissionUrl(REAL_BBB_COMPLAINT_SUBMISSION_URL)).toBe(false);
    expect(evaluateAssistedSubmissionUrlPolicy(REAL_BBB_COMPLAINT_SUBMISSION_URL, ORIGIN)).toEqual({
      allowed: false,
      error: ASSISTED_SUBMISSION_URL_FORBIDDEN_ERROR,
    });
  });

  it("allows exactly the configured real BBB submission URL when autofill is enabled", () => {
    vi.stubEnv("NEXT_PUBLIC_JUSTICE_REAL_BBB_AUTOFILL_ENABLED", "true");
    expect(isAllowedExternalAssistedSubmissionUrl(REAL_BBB_COMPLAINT_SUBMISSION_URL)).toBe(true);
    expect(evaluateAssistedSubmissionUrlPolicy(REAL_BBB_COMPLAINT_SUBMISSION_URL, ORIGIN)).toEqual({
      allowed: true,
    });
  });

  it("rejects near-miss BBB URLs even when autofill is enabled", () => {
    vi.stubEnv("NEXT_PUBLIC_JUSTICE_REAL_BBB_AUTOFILL_ENABLED", "true");
    expect(evaluateAssistedSubmissionUrlPolicy("https://www.bbb.org", ORIGIN)).toEqual({
      allowed: false,
      error: ASSISTED_SUBMISSION_URL_FORBIDDEN_ERROR,
    });
    expect(evaluateAssistedSubmissionUrlPolicy("https://www.bbb.org/complain", ORIGIN)).toEqual({
      allowed: false,
      error: ASSISTED_SUBMISSION_URL_FORBIDDEN_ERROR,
    });
    expect(evaluateAssistedSubmissionUrlPolicy("https://www.bbb.org/file-a-complaint", ORIGIN)).toEqual({
      allowed: false,
      error: ASSISTED_SUBMISSION_URL_FORBIDDEN_ERROR,
    });
    expect(evaluateAssistedSubmissionUrlPolicy("https://www.bbb.org/complaint", ORIGIN)).toEqual({
      allowed: false,
      error: ASSISTED_SUBMISSION_URL_FORBIDDEN_ERROR,
    });
    expect(evaluateAssistedSubmissionUrlPolicy("https://bbb.org", ORIGIN)).toEqual({
      allowed: false,
      error: ASSISTED_SUBMISSION_URL_FORBIDDEN_ERROR,
    });
    expect(evaluateAssistedSubmissionUrlPolicy("https://bbb.org/complain/", ORIGIN)).toEqual({
      allowed: false,
      error: ASSISTED_SUBMISSION_URL_FORBIDDEN_ERROR,
    });
  });

  it("rejects malformed and missing URLs", () => {
    expect(evaluateAssistedSubmissionUrlPolicy("", ORIGIN)).toEqual({
      allowed: false,
      error: "Missing url",
    });
    expect(evaluateAssistedSubmissionUrlPolicy("   ", ORIGIN)).toEqual({
      allowed: false,
      error: "Missing url",
    });
    expect(evaluateAssistedSubmissionUrlPolicy(undefined, ORIGIN)).toEqual({
      allowed: false,
      error: "Missing url",
    });
    expect(evaluateAssistedSubmissionUrlPolicy("not-a-valid-url", ORIGIN)).toEqual({
      allowed: false,
      error: ASSISTED_SUBMISSION_URL_FORBIDDEN_ERROR,
    });
  });

  it("rejects arbitrary external URLs", () => {
    expect(
      evaluateAssistedSubmissionUrlPolicy("https://www.w3schools.com/html/html_forms.asp", ORIGIN)
    ).toEqual({
      allowed: false,
      error: ASSISTED_SUBMISSION_URL_FORBIDDEN_ERROR,
    });
    expect(evaluateAssistedSubmissionUrlPolicy("https://example.com/justice/bbb", ORIGIN)).toEqual({
      allowed: false,
      error: ASSISTED_SUBMISSION_URL_FORBIDDEN_ERROR,
    });
  });
});

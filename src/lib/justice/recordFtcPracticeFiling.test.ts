import { describe, expect, it } from "vitest";
import {
  buildFtcPracticeFilingBody,
  FTC_PRACTICE_FILING_CONFIRMATION,
  FTC_PRACTICE_FILING_DESTINATION,
} from "@/lib/justice/recordFtcPracticeFiling";
import type { RunFtcPracticeSuccess } from "@/lib/justice/runFtcPractice";

describe("buildFtcPracticeFilingBody", () => {
  it("builds a practice filing with confirmation and notes", () => {
    const result: RunFtcPracticeSuccess = {
      ok: true,
      storageSkipped: true,
      technicalDetails: JSON.stringify({
        fillResult: {
          screenshot: "https://example.com/shot.png",
          storageReason: "Missing Supabase storage env vars",
        },
      }),
    };

    const body = buildFtcPracticeFilingBody(result);

    expect(body.destination).toBe(FTC_PRACTICE_FILING_DESTINATION);
    expect(body.confirmation_number).toBe(FTC_PRACTICE_FILING_CONFIRMATION);
    expect(body.filing_url).toBe("https://example.com/shot.png");
    expect(body.filed_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(body.notes).toContain("Mock FTC practice autofill completed");
    expect(body.notes).toContain("Screenshot storage skipped on this run.");
    expect(body.notes).toContain("Missing Supabase storage env vars");
  });
});

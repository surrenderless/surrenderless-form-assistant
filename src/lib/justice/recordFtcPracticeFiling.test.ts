import { describe, expect, it } from "vitest";
import {
  buildFtcPracticeFilingBody,
  buildFtcPracticeSubmissionAttempt,
  FTC_PRACTICE_FILING_CONFIRMATION,
  FTC_PRACTICE_FILING_DESTINATION,
} from "@/lib/justice/recordFtcPracticeFiling";
import { buildFilingBodyFromAttempt } from "@/lib/justice/submissionAttempt";
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

  it("passes approval metadata into filing notes", () => {
    const result: RunFtcPracticeSuccess = {
      ok: true,
      storageSkipped: false,
      technicalDetails: JSON.stringify({ fillResult: {} }),
    };

    const body = buildFilingBodyFromAttempt(
      buildFtcPracticeSubmissionAttempt(result, "00000000-0000-4000-8000-000000000001", {
        executionContext: "assisted_after_packet_approval",
        approvedAt: "2026-06-15T10:00:00.000Z",
      })
    );

    expect(body?.notes).toContain("Assisted submission after packet approval (approved 2026-06-15T10:00:00.000Z).");
    expect(body?.notes).toContain("Mock FTC practice autofill completed");
  });
});

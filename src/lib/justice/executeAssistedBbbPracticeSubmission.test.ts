import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ASSISTED_SUBMISSION_BBB_MOCK_PRACTICE_PREP_HREF,
  ASSISTED_SUBMISSION_FTC_MOCK_PRACTICE_PREP_HREF,
} from "@/lib/justice/assistedSubmissionLane";
import { executeAssistedBbbPracticeSubmission } from "@/lib/justice/executeAssistedBbbPracticeSubmission";
import { BBB_PRACTICE_FILING_DESTINATION } from "@/lib/justice/submissionAttempt";
import type { RunBbbPracticeSuccess } from "@/lib/justice/runBbbPractice";
import type { JusticeApprovedNextAction, JusticeIntake } from "@/lib/justice/types";

const CASE_ID = "550e8400-e29b-41d4-a716-446655440000";

const intake: JusticeIntake = {
  company_name: "Acme",
  company_website: "",
  problem_category: "charge_dispute",
  story: "Charged twice",
  money_involved: "$50",
  pay_or_order_date: "2026-01-01",
  order_confirmation_details: "",
  user_display_name: "User",
  reply_email: "user@example.com",
  purchase_or_signup: "Widget",
  already_contacted: "no",
};

const bbbApprovedNextAction: JusticeApprovedNextAction = {
  label: "BBB practice",
  href: ASSISTED_SUBMISSION_BBB_MOCK_PRACTICE_PREP_HREF,
  status: "approved",
  approved_at: "2026-06-15T10:00:00.000Z",
};

const practiceSuccess: RunBbbPracticeSuccess = {
  ok: true,
  storageSkipped: false,
  technicalDetails: JSON.stringify({ fillResult: {} }),
};

describe("executeAssistedBbbPracticeSubmission", () => {
  const runPractice = vi.fn();
  const recordFiling = vi.fn();
  const applyTimeline = vi.fn();
  const fetchFn = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    runPractice.mockResolvedValue(practiceSuccess);
    recordFiling.mockResolvedValue({
      ok: true,
      payload: { id: "fil-bbb-123", destination: "BBB (practice)" },
    });
    fetchFn.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "PATCH") {
        return new Response(JSON.stringify({ client_state: {} }), { status: 200 });
      }
      if (url.includes("/api/justice/cases/")) {
        return new Response(JSON.stringify({ client_state: {} }), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    });
  });

  it("promotes approved to started, runs practice, records assisted submission, and completes action", async () => {
    const onApprovedNextActionPromoted = vi.fn();
    const onApprovedNextActionCompleted = vi.fn();
    const onAssistedSubmissionRecorded = vi.fn();

    const result = await executeAssistedBbbPracticeSubmission({
      intake,
      caseId: CASE_ID,
      isLoaded: true,
      isSignedIn: true,
      preparedPacketApproved: true,
      approvedNextAction: bbbApprovedNextAction,
      logLabel: "test",
      onApprovedNextActionPromoted,
      onApprovedNextActionCompleted,
      onAssistedSubmissionRecorded,
      fetchFn,
      runPractice,
      recordFiling,
      applyTimeline,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.assistedSubmissionRecorded).toBe(true);
    expect(result.approvedNextActionForSubmission?.status).toBe("completed");
    expect(runPractice).toHaveBeenCalledOnce();
    expect(recordFiling).toHaveBeenCalledWith(
      CASE_ID,
      practiceSuccess,
      expect.objectContaining({
        executionContext: "assisted_after_packet_approval",
        approvedAt: "2026-06-15T10:00:00.000Z",
      })
    );
    expect(applyTimeline).toHaveBeenCalledWith(CASE_ID, {
      id: "fil-bbb-123",
      destination: "BBB (practice)",
    });
    expect(result.lastAssistedSubmissionAttempt).toEqual(
      expect.objectContaining({
        kind: "bbb_practice",
        filingDestination: BBB_PRACTICE_FILING_DESTINATION,
        filingId: "fil-bbb-123",
      })
    );
  });

  it("returns practice error with failed snapshot when practice fails", async () => {
    runPractice.mockResolvedValue({ ok: false, error: "Request failed" });

    const result = await executeAssistedBbbPracticeSubmission({
      intake,
      caseId: CASE_ID,
      isLoaded: true,
      isSignedIn: true,
      preparedPacketApproved: true,
      approvedNextAction: { ...bbbApprovedNextAction, status: "started" },
      fetchFn,
      runPractice,
      recordFiling,
      applyTimeline,
    });

    expect(result).toEqual({
      ok: false,
      error: "Request failed",
      lastAssistedSubmissionAttempt: expect.objectContaining({
        kind: "bbb_practice",
        outcome: "failed",
        error: "Request failed",
        filingDestination: BBB_PRACTICE_FILING_DESTINATION,
      }),
    });
    expect(recordFiling).not.toHaveBeenCalled();
  });

  it("does not complete when filing record fails but persists failed filing snapshot", async () => {
    recordFiling.mockResolvedValue({ ok: false, error: "Filing record failed" });
    const onApprovedNextActionCompleted = vi.fn();

    const result = await executeAssistedBbbPracticeSubmission({
      intake,
      caseId: CASE_ID,
      isLoaded: true,
      isSignedIn: true,
      preparedPacketApproved: true,
      approvedNextAction: { ...bbbApprovedNextAction, status: "started" },
      onApprovedNextActionCompleted,
      fetchFn,
      runPractice,
      recordFiling,
      applyTimeline,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.assistedSubmissionRecorded).toBe(false);
    expect(result.approvedNextActionForSubmission?.status).toBe("started");
    expect(result.lastAssistedSubmissionAttempt).toEqual(
      expect.objectContaining({
        kind: "bbb_practice",
        outcome: "failed",
        error: "Filing record failed",
        filingDestination: BBB_PRACTICE_FILING_DESTINATION,
      })
    );
    expect(onApprovedNextActionCompleted).not.toHaveBeenCalled();
  });

  it("rejects unrelated approved action href without running practice", async () => {
    const result = await executeAssistedBbbPracticeSubmission({
      intake,
      caseId: CASE_ID,
      isLoaded: true,
      isSignedIn: true,
      preparedPacketApproved: true,
      approvedNextAction: {
        ...bbbApprovedNextAction,
        href: "/justice/cfpb",
        status: "started",
      },
      fetchFn,
      runPractice,
      recordFiling,
      applyTimeline,
    });

    expect(result).toEqual({
      ok: false,
      error: "Assisted submission requires the BBB mock practice lane.",
    });
    expect(runPractice).not.toHaveBeenCalled();
    expect(recordFiling).not.toHaveBeenCalled();
    expect(fetchFn.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(0);
  });

  it("rejects FTC lane href as a lane mismatch", async () => {
    const result = await executeAssistedBbbPracticeSubmission({
      intake,
      caseId: CASE_ID,
      isLoaded: true,
      isSignedIn: true,
      preparedPacketApproved: true,
      approvedNextAction: {
        ...bbbApprovedNextAction,
        label: "FTC review",
        href: ASSISTED_SUBMISSION_FTC_MOCK_PRACTICE_PREP_HREF,
        status: "started",
      },
      fetchFn,
      runPractice,
      recordFiling,
      applyTimeline,
    });

    expect(result).toEqual({
      ok: false,
      error: "Assisted submission requires the BBB mock practice lane.",
    });
    expect(runPractice).not.toHaveBeenCalled();
    expect(recordFiling).not.toHaveBeenCalled();
  });
});

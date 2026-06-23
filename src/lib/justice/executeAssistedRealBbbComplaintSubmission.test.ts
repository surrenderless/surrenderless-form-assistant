import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ASSISTED_SUBMISSION_BBB_MOCK_PRACTICE_PREP_HREF,
  ASSISTED_SUBMISSION_REAL_BBB_PREP_HREF,
} from "@/lib/justice/assistedSubmissionLane";
import { executeAssistedRealBbbComplaintSubmission } from "@/lib/justice/executeAssistedRealBbbComplaintSubmission";
import { REAL_BBB_COMPLAINT_FILING_DESTINATION } from "@/lib/justice/recordRealBbbComplaintFiling";
import type { RunRealBbbComplaintSuccess } from "@/lib/justice/runRealBbbComplaint";
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

const failedContactPracticeIntake: JusticeIntake = {
  ...intake,
  problem_category: "online_purchase",
  company_name: "Acme Retail",
  story: "Item never arrived",
  purchase_or_signup: "web order",
  money_involved: "",
  pay_or_order_date: "",
  already_contacted: "yes",
  contact_method: "email",
  contact_date: "2024-05-15",
  merchant_response_type: "refused_help",
  contact_proof_type: "paste",
  contact_proof_text: "Refund denied",
};

const realBbbApprovedNextAction: JusticeApprovedNextAction = {
  label: "Better Business Bureau",
  href: ASSISTED_SUBMISSION_REAL_BBB_PREP_HREF,
  status: "approved",
  approved_at: "2026-06-15T10:00:00.000Z",
};

const complaintSuccess: RunRealBbbComplaintSuccess = {
  ok: true,
  storageSkipped: false,
  technicalDetails: JSON.stringify({ fillResult: {} }),
};

describe("executeAssistedRealBbbComplaintSubmission", () => {
  const runComplaint = vi.fn();
  const recordFiling = vi.fn();
  const applyTimeline = vi.fn();
  const fetchFn = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    runComplaint.mockResolvedValue(complaintSuccess);
    recordFiling.mockResolvedValue({
      ok: true,
      payload: { id: "fil-real-bbb-123", destination: "Better Business Bureau" },
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

  it("promotes approved to started, runs complaint autofill, records assisted submission, and completes action when no next step exists", async () => {
    const onApprovedNextActionPromoted = vi.fn();
    const onApprovedNextActionCompleted = vi.fn();
    const onAssistedSubmissionRecorded = vi.fn();

    const result = await executeAssistedRealBbbComplaintSubmission({
      intake,
      caseId: CASE_ID,
      isLoaded: true,
      isSignedIn: true,
      preparedPacketApproved: true,
      approvedNextAction: realBbbApprovedNextAction,
      logLabel: "test",
      onApprovedNextActionPromoted,
      onApprovedNextActionCompleted,
      onAssistedSubmissionRecorded,
      fetchFn,
      runComplaint,
      recordFiling,
      applyTimeline,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.assistedSubmissionRecorded).toBe(true);
    expect(result.approvedNextActionForSubmission?.status).toBe("completed");
    expect(runComplaint).toHaveBeenCalledOnce();
    expect(recordFiling).toHaveBeenCalledWith(
      CASE_ID,
      complaintSuccess,
      expect.objectContaining({
        executionContext: "assisted_after_packet_approval",
        approvedAt: "2026-06-15T10:00:00.000Z",
      })
    );
    expect(applyTimeline).toHaveBeenCalledWith(CASE_ID, {
      id: "fil-real-bbb-123",
      destination: "Better Business Bureau",
    });
    expect(result.lastAssistedSubmissionAttempt).toEqual(
      expect.objectContaining({
        kind: "bbb_complaint",
        filingDestination: REAL_BBB_COMPLAINT_FILING_DESTINATION,
        filingId: "fil-real-bbb-123",
      })
    );
  });

  it("advances to state AG after successful real BBB assisted submission when queue allows", async () => {
    const onApprovedNextActionCompleted = vi.fn();

    const result = await executeAssistedRealBbbComplaintSubmission({
      intake: failedContactPracticeIntake,
      caseId: CASE_ID,
      isLoaded: true,
      isSignedIn: true,
      preparedPacketApproved: true,
      approvedNextAction: realBbbApprovedNextAction,
      onApprovedNextActionCompleted,
      fetchFn,
      runComplaint,
      recordFiling,
      applyTimeline,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.assistedSubmissionRecorded).toBe(true);
    expect(result.approvedNextActionForSubmission).toMatchObject({
      status: "approved",
      href: "/justice/state-ag",
      label: "State Attorney General (consumer)",
    });
    expect(onApprovedNextActionCompleted).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "completed",
        href: ASSISTED_SUBMISSION_REAL_BBB_PREP_HREF,
      })
    );
    const patchCalls = fetchFn.mock.calls.filter(([, init]) => init?.method === "PATCH");
    expect(
      patchCalls.some(([, init]) => {
        const body = JSON.parse(String(init?.body)) as {
          client_state?: { approved_next_action?: { status?: string; href?: string } };
        };
        return (
          body.client_state?.approved_next_action?.status === "approved" &&
          body.client_state?.approved_next_action?.href === "/justice/state-ag"
        );
      })
    ).toBe(true);
  });

  it("returns success with advanced action when advance persistence PATCH fails", async () => {
    fetchFn.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "PATCH") {
        const body = JSON.parse(String(init.body)) as {
          client_state?: {
            approved_next_action?: { status?: string; href?: string };
            last_assisted_submission_attempt?: unknown;
          };
        };
        if (
          body.client_state?.approved_next_action?.status === "approved" &&
          body.client_state?.approved_next_action?.href === "/justice/state-ag"
        ) {
          return new Response("failed", { status: 500 });
        }
        return new Response(JSON.stringify({ client_state: {} }), { status: 200 });
      }
      if (url.includes("/api/justice/cases/")) {
        return new Response(JSON.stringify({ client_state: {} }), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    });
    const onApprovedNextActionCompleted = vi.fn();

    const result = await executeAssistedRealBbbComplaintSubmission({
      intake: failedContactPracticeIntake,
      caseId: CASE_ID,
      isLoaded: true,
      isSignedIn: true,
      preparedPacketApproved: true,
      approvedNextAction: { ...realBbbApprovedNextAction, status: "started" },
      onApprovedNextActionCompleted,
      fetchFn,
      runComplaint,
      recordFiling,
      applyTimeline,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.assistedSubmissionRecorded).toBe(true);
    expect(result.approvedNextActionForSubmission).toMatchObject({
      status: "approved",
      href: "/justice/state-ag",
    });
    expect(onApprovedNextActionCompleted).toHaveBeenCalledWith(
      expect.objectContaining({ status: "completed" })
    );
  });

  it("leaves real BBB completed when no eligible downstream destination exists", async () => {
    const onApprovedNextActionCompleted = vi.fn();

    const result = await executeAssistedRealBbbComplaintSubmission({
      intake: { ...failedContactPracticeIntake, company_name: "" },
      caseId: CASE_ID,
      isLoaded: true,
      isSignedIn: true,
      preparedPacketApproved: true,
      approvedNextAction: { ...realBbbApprovedNextAction, status: "started" },
      onApprovedNextActionCompleted,
      fetchFn,
      runComplaint,
      recordFiling,
      applyTimeline,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.approvedNextActionForSubmission?.status).toBe("completed");
    expect(result.approvedNextActionForSubmission?.href).toBe(ASSISTED_SUBMISSION_REAL_BBB_PREP_HREF);
  });

  it("returns complaint error with failed snapshot when autofill fails", async () => {
    runComplaint.mockResolvedValue({ ok: false, error: "Request failed" });

    const result = await executeAssistedRealBbbComplaintSubmission({
      intake,
      caseId: CASE_ID,
      isLoaded: true,
      isSignedIn: true,
      preparedPacketApproved: true,
      approvedNextAction: { ...realBbbApprovedNextAction, status: "started" },
      fetchFn,
      runComplaint,
      recordFiling,
      applyTimeline,
    });

    expect(result).toEqual({
      ok: false,
      error: "Request failed",
      lastAssistedSubmissionAttempt: expect.objectContaining({
        kind: "bbb_complaint",
        outcome: "failed",
        error: "Request failed",
        filingDestination: REAL_BBB_COMPLAINT_FILING_DESTINATION,
      }),
    });
    expect(recordFiling).not.toHaveBeenCalled();
  });

  it("does not complete when filing record fails but persists failed filing snapshot", async () => {
    recordFiling.mockResolvedValue({ ok: false, error: "Filing record failed" });
    const onApprovedNextActionCompleted = vi.fn();

    const result = await executeAssistedRealBbbComplaintSubmission({
      intake,
      caseId: CASE_ID,
      isLoaded: true,
      isSignedIn: true,
      preparedPacketApproved: true,
      approvedNextAction: { ...realBbbApprovedNextAction, status: "started" },
      onApprovedNextActionCompleted,
      fetchFn,
      runComplaint,
      recordFiling,
      applyTimeline,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.assistedSubmissionRecorded).toBe(false);
    expect(result.approvedNextActionForSubmission?.status).toBe("started");
    expect(result.lastAssistedSubmissionAttempt).toEqual(
      expect.objectContaining({
        kind: "bbb_complaint",
        outcome: "failed",
        error: "Filing record failed",
        filingDestination: REAL_BBB_COMPLAINT_FILING_DESTINATION,
      })
    );
    expect(onApprovedNextActionCompleted).not.toHaveBeenCalled();
  });

  it("rejects unrelated approved action href without running complaint autofill", async () => {
    const result = await executeAssistedRealBbbComplaintSubmission({
      intake,
      caseId: CASE_ID,
      isLoaded: true,
      isSignedIn: true,
      preparedPacketApproved: true,
      approvedNextAction: {
        ...realBbbApprovedNextAction,
        href: "/justice/cfpb",
        status: "started",
      },
      fetchFn,
      runComplaint,
      recordFiling,
      applyTimeline,
    });

    expect(result).toEqual({
      ok: false,
      error: "Assisted submission requires the real BBB complaint lane.",
    });
    expect(runComplaint).not.toHaveBeenCalled();
    expect(recordFiling).not.toHaveBeenCalled();
    expect(fetchFn.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(0);
  });

  it("rejects BBB mock practice lane href as a lane mismatch", async () => {
    const result = await executeAssistedRealBbbComplaintSubmission({
      intake,
      caseId: CASE_ID,
      isLoaded: true,
      isSignedIn: true,
      preparedPacketApproved: true,
      approvedNextAction: {
        ...realBbbApprovedNextAction,
        label: "BBB practice",
        href: ASSISTED_SUBMISSION_BBB_MOCK_PRACTICE_PREP_HREF,
        status: "started",
      },
      fetchFn,
      runComplaint,
      recordFiling,
      applyTimeline,
    });

    expect(result).toEqual({
      ok: false,
      error: "Assisted submission requires the real BBB complaint lane.",
    });
    expect(runComplaint).not.toHaveBeenCalled();
    expect(recordFiling).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { executeAssistedFtcPracticeSubmission } from "@/lib/justice/executeAssistedFtcPracticeSubmission";
import { mergeClientStateWithLastAssistedSubmissionAttempt } from "@/lib/justice/submissionAttemptState";
import { FTC_PRACTICE_FILING_DESTINATION } from "@/lib/justice/submissionAttempt";
import type { RunFtcPracticeSuccess } from "@/lib/justice/runFtcPractice";
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

const approvedNextAction: JusticeApprovedNextAction = {
  label: "FTC review",
  href: "/justice/ftc-review",
  status: "approved",
  approved_at: "2026-06-15T10:00:00.000Z",
};

const practiceSuccess: RunFtcPracticeSuccess = {
  ok: true,
  storageSkipped: false,
  technicalDetails: JSON.stringify({ fillResult: {} }),
};

describe("executeAssistedFtcPracticeSubmission", () => {
  const runPractice = vi.fn();
  const recordFiling = vi.fn();
  const applyTimeline = vi.fn();
  const fetchFn = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    runPractice.mockResolvedValue(practiceSuccess);
    recordFiling.mockResolvedValue({
      ok: true,
      payload: { id: "fil-123", destination: "FTC (practice)" },
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

  it("promotes approved to started, runs practice, and records assisted submission", async () => {
    const onApprovedNextActionPromoted = vi.fn();
    const onAssistedSubmissionRecorded = vi.fn();

    const result = await executeAssistedFtcPracticeSubmission({
      intake,
      caseId: CASE_ID,
      isLoaded: true,
      isSignedIn: true,
      preparedPacketApproved: true,
      approvedNextAction,
      logLabel: "test",
      onApprovedNextActionPromoted,
      onAssistedSubmissionRecorded,
      fetchFn,
      runPractice,
      recordFiling,
      applyTimeline,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.storageSkipped).toBe(false);
    expect(result.assistedSubmissionRecorded).toBe(true);
    expect(result.approvedNextActionForSubmission?.status).toBe("started");
    expect(onApprovedNextActionPromoted).toHaveBeenCalledWith(
      expect.objectContaining({ status: "started" })
    );
    expect(runPractice).toHaveBeenCalledOnce();
    expect(recordFiling).toHaveBeenCalledWith(
      CASE_ID,
      practiceSuccess,
      expect.objectContaining({
        executionContext: "assisted_after_packet_approval",
        approvedAt: "2026-06-15T10:00:00.000Z",
      })
    );
    expect(applyTimeline).toHaveBeenCalledWith(CASE_ID, { id: "fil-123", destination: "FTC (practice)" });
    expect(onAssistedSubmissionRecorded).toHaveBeenCalledOnce();
    expect(fetchFn).toHaveBeenCalled();
    expect(result.lastAssistedSubmissionAttempt).toEqual(
      expect.objectContaining({
        kind: "ftc_practice",
        filingDestination: FTC_PRACTICE_FILING_DESTINATION,
        filingId: "fil-123",
        executionContext: "assisted_after_packet_approval",
        approvedAt: "2026-06-15T10:00:00.000Z",
      })
    );
  });

  it("returns snapshot on success even when snapshot persist PATCH fails", async () => {
    fetchFn.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "PATCH") {
        const body = JSON.parse(String(init.body)) as {
          client_state?: { last_assisted_submission_attempt?: unknown };
        };
        if (body.client_state?.last_assisted_submission_attempt) {
          return new Response("failed", { status: 500 });
        }
        return new Response(JSON.stringify({ client_state: {} }), { status: 200 });
      }
      if (url.includes("/api/justice/cases/")) {
        return new Response(JSON.stringify({ client_state: {} }), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    });

    const result = await executeAssistedFtcPracticeSubmission({
      intake,
      caseId: CASE_ID,
      isLoaded: true,
      isSignedIn: true,
      preparedPacketApproved: true,
      approvedNextAction: { ...approvedNextAction, status: "started" },
      fetchFn,
      runPractice,
      recordFiling,
      applyTimeline,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.assistedSubmissionRecorded).toBe(true);
    expect(result.lastAssistedSubmissionAttempt?.filingId).toBe("fil-123");
  });

  it("supports immediate handling local merge from returned snapshot", async () => {
    const result = await executeAssistedFtcPracticeSubmission({
      intake,
      caseId: CASE_ID,
      isLoaded: true,
      isSignedIn: true,
      preparedPacketApproved: true,
      approvedNextAction: { ...approvedNextAction, status: "started" },
      fetchFn,
      runPractice,
      recordFiling,
      applyTimeline,
    });

    expect(result.ok).toBe(true);
    if (!result.ok || !result.lastAssistedSubmissionAttempt) {
      throw new Error("expected assisted submission snapshot on success");
    }

    const merged = mergeClientStateWithLastAssistedSubmissionAttempt(
      {
        prepared_packet_approved: true,
        approved_next_action: { ...approvedNextAction, status: "started" },
      },
      result.lastAssistedSubmissionAttempt
    );

    expect(merged.last_assisted_submission_attempt.filingId).toBe("fil-123");
    expect(merged.approved_next_action?.status).toBe("started");
  });

  it("awaits snapshot persist before returning success", async () => {
    let resolveSnapshotPatch!: () => void;
    const snapshotPatchGate = new Promise<void>((resolve) => {
      resolveSnapshotPatch = resolve;
    });
    let resultResolved = false;

    fetchFn.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "PATCH") {
        const body = JSON.parse(String(init.body)) as {
          client_state?: { last_assisted_submission_attempt?: unknown };
        };
        if (body.client_state?.last_assisted_submission_attempt) {
          await snapshotPatchGate;
        }
        return new Response(JSON.stringify({ client_state: {} }), { status: 200 });
      }
      if (url.includes("/api/justice/cases/")) {
        return new Response(JSON.stringify({ client_state: {} }), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    });

    const resultPromise = executeAssistedFtcPracticeSubmission({
      intake,
      caseId: CASE_ID,
      isLoaded: true,
      isSignedIn: true,
      preparedPacketApproved: true,
      approvedNextAction: { ...approvedNextAction, status: "started" },
      logLabel: "test",
      fetchFn,
      runPractice,
      recordFiling,
      applyTimeline,
    }).then((result) => {
      resultResolved = true;
      return result;
    });

    await vi.waitFor(() => {
      const patchCalls = fetchFn.mock.calls.filter(([, init]) => init?.method === "PATCH");
      expect(patchCalls.length).toBeGreaterThanOrEqual(1);
      const snapshotPatch = patchCalls.some(([, init]) => {
        const body = JSON.parse(String(init?.body)) as {
          client_state?: { last_assisted_submission_attempt?: unknown };
        };
        return Boolean(body.client_state?.last_assisted_submission_attempt);
      });
      expect(snapshotPatch).toBe(true);
    });
    expect(resultResolved).toBe(false);

    resolveSnapshotPatch();
    const result = await resultPromise;
    expect(resultResolved).toBe(true);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.assistedSubmissionRecorded).toBe(true);
    }
  });

  it("still runs practice when promotion PATCH fails", async () => {
    fetchFn.mockImplementation(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        return new Response("failed", { status: 500 });
      }
      return new Response(JSON.stringify({ client_state: {} }), { status: 200 });
    });

    const result = await executeAssistedFtcPracticeSubmission({
      intake,
      caseId: CASE_ID,
      isLoaded: true,
      isSignedIn: true,
      preparedPacketApproved: true,
      approvedNextAction,
      fetchFn,
      runPractice,
      recordFiling,
      applyTimeline,
    });

    expect(result.ok).toBe(true);
    expect(runPractice).toHaveBeenCalledOnce();
    if (result.ok) {
      expect(result.assistedSubmissionRecorded).toBe(true);
    }
  });

  it("returns practice error without recording filing", async () => {
    runPractice.mockResolvedValue({ ok: false, error: "Request failed" });

    const result = await executeAssistedFtcPracticeSubmission({
      intake,
      caseId: CASE_ID,
      isLoaded: true,
      isSignedIn: true,
      preparedPacketApproved: true,
      approvedNextAction: { ...approvedNextAction, status: "started" },
      fetchFn,
      runPractice,
      recordFiling,
      applyTimeline,
    });

    expect(result).toEqual({
      ok: false,
      error: "Request failed",
      lastAssistedSubmissionAttempt: expect.objectContaining({
        kind: "ftc_practice",
        outcome: "failed",
        error: "Request failed",
        filingDestination: FTC_PRACTICE_FILING_DESTINATION,
        executionContext: "assisted_after_packet_approval",
        approvedAt: "2026-06-15T10:00:00.000Z",
      }),
    });
    expect(recordFiling).not.toHaveBeenCalled();
    const patchCalls = fetchFn.mock.calls.filter(([, init]) => init?.method === "PATCH");
    expect(
      patchCalls.some(([, init]) => {
        const body = JSON.parse(String(init?.body)) as {
          client_state?: { last_assisted_submission_attempt?: { outcome?: string } };
        };
        return body.client_state?.last_assisted_submission_attempt?.outcome === "failed";
      })
    ).toBe(true);
  });

  it("returns failure snapshot even when failure persist PATCH fails", async () => {
    runPractice.mockResolvedValue({ ok: false, error: "Request failed" });
    fetchFn.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "PATCH") {
        const body = JSON.parse(String(init.body)) as {
          client_state?: { last_assisted_submission_attempt?: unknown };
        };
        if (body.client_state?.last_assisted_submission_attempt) {
          return new Response("failed", { status: 500 });
        }
        return new Response(JSON.stringify({ client_state: {} }), { status: 200 });
      }
      if (url.includes("/api/justice/cases/")) {
        return new Response(JSON.stringify({ client_state: {} }), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    });

    const result = await executeAssistedFtcPracticeSubmission({
      intake,
      caseId: CASE_ID,
      isLoaded: true,
      isSignedIn: true,
      preparedPacketApproved: true,
      approvedNextAction: { ...approvedNextAction, status: "started" },
      fetchFn,
      runPractice,
      recordFiling,
      applyTimeline,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("Request failed");
    expect(result.lastAssistedSubmissionAttempt?.outcome).toBe("failed");
  });

  it("skips failure snapshot when assisted recording gates do not pass", async () => {
    runPractice.mockResolvedValue({ ok: false, error: "Request failed" });

    const result = await executeAssistedFtcPracticeSubmission({
      intake,
      caseId: CASE_ID,
      isLoaded: true,
      isSignedIn: true,
      preparedPacketApproved: false,
      approvedNextAction: { ...approvedNextAction, status: "started" },
      fetchFn,
      runPractice,
      recordFiling,
      applyTimeline,
    });

    expect(result).toEqual({ ok: false, error: "Request failed" });
    const patchCalls = fetchFn.mock.calls.filter(([, init]) => init?.method === "PATCH");
    expect(patchCalls).toHaveLength(0);
  });

  it("skips assisted recording when packet is not approved", async () => {
    const result = await executeAssistedFtcPracticeSubmission({
      intake,
      caseId: CASE_ID,
      isLoaded: true,
      isSignedIn: true,
      preparedPacketApproved: false,
      approvedNextAction: { ...approvedNextAction, status: "started" },
      fetchFn,
      runPractice,
      recordFiling,
      applyTimeline,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.assistedSubmissionRecorded).toBe(false);
      expect(result.lastAssistedSubmissionAttempt).toBeUndefined();
    }
    expect(recordFiling).not.toHaveBeenCalled();
  });
});

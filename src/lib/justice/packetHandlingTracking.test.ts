import { describe, expect, it } from "vitest";
import { HANDLING_TRACKING_STEP_RECORD_OUTCOME } from "@/lib/justice/approvedNextActionHandlingDisplay";
import { handlingWorkbenchOutcomeTrackingFormVisible } from "@/lib/justice/handlingTrackingProgress";
import { derivePacketHandlingTrackingLine } from "@/lib/justice/packetHandlingTracking";
import {
  MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF,
  MERCHANT_RESOLVED_TERMINAL_HREF,
} from "@/lib/justice/handlingTrackingProgress";

describe("derivePacketHandlingTrackingLine", () => {
  const readyPacketInput = {
    basicsReady: true,
    draftReviewed: true,
    preparedPacketApproved: true,
    evidenceCount: 1,
  };
  const demandLetterNextAction = {
    href: MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF,
    label: "Small claims / demand letter",
    status: "started" as const,
  };
  const priorBbbFilingConfirmed = {
    destination: "Better Business Bureau",
    confirmation_number: "BBB-REAL-123",
  };
  const demandLetterFiling = {
    destination: "Small claims / demand letter",
    confirmation_number: null,
  };
  const demandLetterFilingConfirmed = {
    destination: "Small claims / demand letter",
    confirmation_number: "DL-REAL-321",
  };

  it("is ready for external manual action with any saved evidence row, including text-only proof with no uploaded file", () => {
    expect(
      derivePacketHandlingTrackingLine({
        ...readyPacketInput,
        evidenceCount: 1,
        filings: [],
        next: demandLetterNextAction,
      })
    ).not.toBe("Review packet and saved proof before external manual action.");
  });

  it("is not ready for external manual action when no evidence is saved at all", () => {
    expect(
      derivePacketHandlingTrackingLine({
        ...readyPacketInput,
        evidenceCount: 0,
        filings: [],
        next: demandLetterNextAction,
      })
    ).toBe("Review packet and saved proof before external manual action.");
  });

  it("does not treat a prior-step filing as satisfying a mapped active step", () => {
    expect(
      derivePacketHandlingTrackingLine({
        ...readyPacketInput,
        filings: [priorBbbFilingConfirmed],
        next: demandLetterNextAction,
      })
    ).toBe("Add filing records from the case packet after external submission.");
  });

  it("requires active-step confirmation after the active-step filing is on file", () => {
    expect(
      derivePacketHandlingTrackingLine({
        ...readyPacketInput,
        filings: [priorBbbFilingConfirmed, demandLetterFiling],
        next: demandLetterNextAction,
      })
    ).toBe(
      "Add or edit the filing confirmation from the case packet after external submission."
    );
  });

  it("advances past filing gates when the active-step filing and confirmation are on file", () => {
    expect(
      derivePacketHandlingTrackingLine({
        ...readyPacketInput,
        filings: [priorBbbFilingConfirmed, demandLetterFilingConfirmed],
        next: { ...demandLetterNextAction, status: "completed" },
      })
    ).toBe("Record the handling outcome.");
  });

  it("requires outcome when handling was requested, status is still approved, and filing gates are satisfied", () => {
    expect(
      derivePacketHandlingTrackingLine({
        ...readyPacketInput,
        filings: [demandLetterFilingConfirmed],
        next: {
          ...demandLetterNextAction,
          status: "approved",
          handling_requested_at: "2026-06-16T12:00:00.000Z",
        },
      })
    ).toBe("Record the handling outcome.");
  });

  it("requires acknowledgement after outcome when handling was requested with status still approved", () => {
    expect(
      derivePacketHandlingTrackingLine({
        ...readyPacketInput,
        filings: [demandLetterFilingConfirmed],
        next: {
          ...demandLetterNextAction,
          status: "approved",
          handling_requested_at: "2026-06-16T12:00:00.000Z",
          outcome_note: "Awaiting merchant response.",
        },
      })
    ).toBe("Mark the handling request acknowledged.");
  });

  it("composes packet derived step with shared outcome-form visibility after escalation is terminal", () => {
    const next = {
      ...demandLetterNextAction,
      status: "completed" as const,
      completed_at: "2026-06-20T12:00:00.000Z",
      handling_requested_at: "2026-06-16T12:00:00.000Z",
    };
    const derivedStep = derivePacketHandlingTrackingLine({
      ...readyPacketInput,
      filings: [demandLetterFilingConfirmed],
      next,
    });
    expect(derivedStep).toBe(HANDLING_TRACKING_STEP_RECORD_OUTCOME);
    expect(
      handlingWorkbenchOutcomeTrackingFormVisible({
        manualActionNextStep: derivedStep,
        filingsReady: true,
        action: next,
        caseId: "550e8400-e29b-41d4-a716-446655440000",
      })
    ).toBe(true);
  });

  it("scopes CFPB packet tracking away from BBB filings", () => {
    expect(
      derivePacketHandlingTrackingLine({
        ...readyPacketInput,
        filings: [{ destination: "Better Business Bureau", confirmation_number: null }],
        next: {
          href: "/justice/cfpb",
          label: "CFPB complaint prep",
          status: "started",
        },
      })
    ).toBe("Add filing records from the case packet after external submission.");
  });

  it("returns the completed state for the merchant-resolved terminal action even with realistic ready/evidence inputs and no filing on file — never 'Add filing records...' (no filing destination exists for this href)", () => {
    // This is the exact realistic, common-case combination that previously fell through to the
    // "add filing records" branch: readiness satisfied (basics/draft/packet approved), real
    // evidence already on the case (evidenceCount > 0), and — deliberately — no filings at all,
    // since MERCHANT_RESOLVED_TERMINAL_HREF is absent from the filing-destination map by design.
    expect(
      derivePacketHandlingTrackingLine({
        ...readyPacketInput,
        evidenceCount: 3,
        filings: [],
        next: {
          href: MERCHANT_RESOLVED_TERMINAL_HREF,
          label: "Merchant issue resolved",
          status: "completed",
        },
      })
    ).toBe("Tracking complete for now.");
  });

  it("returns the completed state for the merchant-resolved terminal action even with worst-case (not-ready, no-evidence) readiness inputs", () => {
    expect(
      derivePacketHandlingTrackingLine({
        basicsReady: false,
        draftReviewed: false,
        preparedPacketApproved: false,
        evidenceCount: 0,
        filings: [],
        next: {
          href: MERCHANT_RESOLVED_TERMINAL_HREF,
          label: "Merchant issue resolved",
          status: "completed",
        },
      })
    ).toBe("Tracking complete for now.");
  });

  it("does not affect a different href with status completed and no filing (regression guard for the generic 'unknown href' path)", () => {
    expect(
      derivePacketHandlingTrackingLine({
        ...readyPacketInput,
        filings: [],
        next: {
          href: "/justice/unknown-lane",
          label: "Unknown prep",
          status: "completed",
        },
      })
    ).not.toBe("Tracking complete for now.");
  });

  it("uses practice-filtered global filings for unknown hrefs", () => {
    expect(
      derivePacketHandlingTrackingLine({
        ...readyPacketInput,
        filings: [{ destination: "Better Business Bureau", confirmation_number: null }],
        next: {
          href: "/justice/unknown-lane",
          label: "Unknown prep",
          status: "started",
        },
      })
    ).toBe(
      "Add or edit the filing confirmation from the case packet after external submission."
    );
  });
});

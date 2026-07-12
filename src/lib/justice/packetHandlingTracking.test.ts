import { describe, expect, it } from "vitest";
import { HANDLING_TRACKING_STEP_RECORD_OUTCOME } from "@/lib/justice/approvedNextActionHandlingDisplay";
import { handlingWorkbenchOutcomeTrackingFormVisible } from "@/lib/justice/handlingTrackingProgress";
import { derivePacketHandlingTrackingLine } from "@/lib/justice/packetHandlingTracking";
import {
  MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF,
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

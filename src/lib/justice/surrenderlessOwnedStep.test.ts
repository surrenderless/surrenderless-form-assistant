import { describe, expect, it } from "vitest";
import {
  MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF,
  MANUAL_ACTION_TRACKING_REAL_STATE_AG_PREP_HREF,
} from "@/lib/justice/handlingTrackingProgress";
import { demandLetterFilingTaskNotesMarker } from "@/lib/justice/demandLetterFilingTask";
import { shouldSuppressChatManualActionForSurrenderlessOwnedStep } from "@/lib/justice/surrenderlessOwnedStep";
import { stateAgFilingTaskNotesMarker } from "@/lib/justice/stateAgFilingTask";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";

const CASE_ID = "550e8400-e29b-41d4-a716-446655440000";

const stateAgAction = {
  href: MANUAL_ACTION_TRACKING_REAL_STATE_AG_PREP_HREF,
  label: "State Attorney General (consumer)",
} as const;

const demandLetterAction = {
  href: MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF,
  label: "Small claims / demand letter",
} as const;

function openStateAgTask(): JusticeCaseTaskRow {
  const marker = stateAgFilingTaskNotesMarker(CASE_ID);
  return {
    id: "task-state-ag",
    user_id: "user",
    case_id: CASE_ID,
    title: "State AG filing: Acme Retail",
    due_date: null,
    notes: `${marker}\ncase_id: ${CASE_ID}`,
    completed_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

function openDemandLetterTask(): JusticeCaseTaskRow {
  const marker = demandLetterFilingTaskNotesMarker(CASE_ID);
  return {
    id: "task-demand-letter",
    user_id: "user",
    case_id: CASE_ID,
    title: "Demand letter: Acme Retail",
    due_date: null,
    notes: `${marker}\ncase_id: ${CASE_ID}`,
    completed_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

describe("shouldSuppressChatManualActionForSurrenderlessOwnedStep", () => {
  it("suppresses when an open State AG human-fulfillment task exists", () => {
    expect(
      shouldSuppressChatManualActionForSurrenderlessOwnedStep({
        approvedAction: stateAgAction,
        caseId: CASE_ID,
        tasks: [openStateAgTask()],
        filings: [],
      })
    ).toBe(true);
  });

  it("suppresses when a confirmed State AG filing exists", () => {
    expect(
      shouldSuppressChatManualActionForSurrenderlessOwnedStep({
        approvedAction: stateAgAction,
        caseId: CASE_ID,
        tasks: [],
        filings: [
          {
            destination: "State Attorney General (consumer)",
            confirmation_number: "AG-12345",
          },
        ],
      })
    ).toBe(true);
  });

  it("suppresses when State AG escalation is approved before operator tasks hydrate", () => {
    expect(
      shouldSuppressChatManualActionForSurrenderlessOwnedStep({
        approvedAction: { ...stateAgAction, status: "approved" },
        caseId: CASE_ID,
        tasks: [],
        filings: [],
      })
    ).toBe(true);
  });

  it("does not suppress when State AG filing exists without confirmation", () => {
    expect(
      shouldSuppressChatManualActionForSurrenderlessOwnedStep({
        approvedAction: stateAgAction,
        caseId: CASE_ID,
        tasks: [],
        filings: [
          {
            destination: "State Attorney General (consumer)",
            confirmation_number: null,
          },
        ],
      })
    ).toBe(false);
  });

  it("does not suppress for other approved actions", () => {
    expect(
      shouldSuppressChatManualActionForSurrenderlessOwnedStep({
        approvedAction: { href: "/justice/bbb", label: "Better Business Bureau" },
        caseId: CASE_ID,
        tasks: [openStateAgTask()],
        filings: [
          {
            destination: "State Attorney General (consumer)",
            confirmation_number: "AG-12345",
          },
        ],
      })
    ).toBe(false);
  });

  it("does not suppress when task is completed and no confirmed filing", () => {
    expect(
      shouldSuppressChatManualActionForSurrenderlessOwnedStep({
        approvedAction: stateAgAction,
        caseId: CASE_ID,
        tasks: [{ ...openStateAgTask(), completed_at: "2026-01-02T00:00:00.000Z" }],
        filings: [],
      })
    ).toBe(false);
  });

  it("suppresses when an open demand letter human-fulfillment task exists", () => {
    expect(
      shouldSuppressChatManualActionForSurrenderlessOwnedStep({
        approvedAction: demandLetterAction,
        caseId: CASE_ID,
        tasks: [openDemandLetterTask()],
        filings: [],
      })
    ).toBe(true);
  });

  it("does not suppress demand letter when task is completed", () => {
    expect(
      shouldSuppressChatManualActionForSurrenderlessOwnedStep({
        approvedAction: demandLetterAction,
        caseId: CASE_ID,
        tasks: [{ ...openDemandLetterTask(), completed_at: "2026-01-02T00:00:00.000Z" }],
        filings: [],
      })
    ).toBe(false);
  });

  it("does not suppress demand letter for other approved actions", () => {
    expect(
      shouldSuppressChatManualActionForSurrenderlessOwnedStep({
        approvedAction: { href: "/justice/bbb", label: "Better Business Bureau" },
        caseId: CASE_ID,
        tasks: [openDemandLetterTask()],
        filings: [],
      })
    ).toBe(false);
  });

  it("suppresses when a confirmed demand letter filing exists", () => {
    expect(
      shouldSuppressChatManualActionForSurrenderlessOwnedStep({
        approvedAction: demandLetterAction,
        caseId: CASE_ID,
        tasks: [],
        filings: [
          {
            destination: "Small claims / demand letter",
            confirmation_number: "cm-12345",
          },
        ],
      })
    ).toBe(true);
  });

  it("suppresses when demand letter escalation is approved before operator tasks hydrate", () => {
    expect(
      shouldSuppressChatManualActionForSurrenderlessOwnedStep({
        approvedAction: { ...demandLetterAction, status: "approved" },
        caseId: CASE_ID,
        tasks: [],
        filings: [],
      })
    ).toBe(true);
  });

  it("does not suppress demand letter when filing exists without confirmation", () => {
    expect(
      shouldSuppressChatManualActionForSurrenderlessOwnedStep({
        approvedAction: demandLetterAction,
        caseId: CASE_ID,
        tasks: [],
        filings: [
          {
            destination: "Small claims / demand letter",
            confirmation_number: null,
          },
        ],
      })
    ).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { MANUAL_ACTION_TRACKING_REAL_STATE_AG_PREP_HREF } from "@/lib/justice/handlingTrackingProgress";
import { shouldSuppressChatManualActionForSurrenderlessOwnedStep } from "@/lib/justice/surrenderlessOwnedStep";
import { stateAgFilingTaskNotesMarker } from "@/lib/justice/stateAgFilingTask";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";

const CASE_ID = "550e8400-e29b-41d4-a716-446655440000";

const stateAgAction = {
  href: MANUAL_ACTION_TRACKING_REAL_STATE_AG_PREP_HREF,
  label: "State Attorney General (consumer)",
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
});

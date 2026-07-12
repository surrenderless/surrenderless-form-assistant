import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  buildChatCaseProgressNarrationMessage,
  collectNewChatCaseProgressNarrationMessages,
  deriveSatisfiedChatCaseProgressMilestones,
  readNarratedChatCaseProgressMilestones,
  STORAGE_CHAT_CASE_PROGRESS_NARRATED_V1,
} from "@/lib/justice/chatCaseProgressNarration";
import { stateAgFilingTaskNotesMarker } from "@/lib/justice/stateAgFilingTask";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";

const CASE_ID = "550e8400-e29b-41d4-a716-446655440000";

function openStateAgTask(): JusticeCaseTaskRow {
  const marker = stateAgFilingTaskNotesMarker(CASE_ID);
  return {
    id: "task-state-ag",
    user_id: "user",
    case_id: CASE_ID,
    title: "State AG filing: Acme",
    due_date: null,
    notes: `${marker}\ncase_id: ${CASE_ID}`,
    completed_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

describe("chatCaseProgressNarration", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      clear: () => {
        store.clear();
      },
    });
  });

  it("derives BBB filed and State AG queued milestones from observed state", () => {
    expect(
      deriveSatisfiedChatCaseProgressMilestones({
        caseId: CASE_ID,
        approvedAction: {
          label: "State Attorney General (consumer)",
          href: "/justice/state-ag",
          status: "approved",
        },
        tasks: [openStateAgTask()],
        filings: [
          {
            destination: "Better Business Bureau",
            confirmation_number: "bbb-123",
          },
        ],
      })
    ).toEqual(["bbb_filed", "state_ag_queued"]);
  });

  it("derives CFPB queued and confirmed milestones from observed state", () => {
    expect(
      deriveSatisfiedChatCaseProgressMilestones({
        caseId: CASE_ID,
        approvedAction: {
          label: "CFPB",
          href: "/justice/cfpb",
          status: "approved",
        },
        tasks: [
          {
            id: "task-cfpb",
            user_id: "user",
            case_id: CASE_ID,
            title: "CFPB filing: Acme",
            due_date: null,
            notes: `cfpb_filing_queue:${CASE_ID}\ncase_id: ${CASE_ID}`,
            completed_at: null,
            created_at: "2026-01-01T00:00:00.000Z",
            updated_at: "2026-01-01T00:00:00.000Z",
          },
        ],
        filings: [],
      })
    ).toEqual(["cfpb_queued"]);

    expect(
      deriveSatisfiedChatCaseProgressMilestones({
        caseId: CASE_ID,
        approvedAction: {
          label: "CFPB",
          href: "/justice/cfpb",
          status: "completed",
          completed_at: "2026-06-22T12:00:00.000Z",
        },
        tasks: [],
        filings: [
          {
            destination: "CFPB",
            confirmation_number: "cfpb-123",
          },
        ],
      })
    ).toEqual(["cfpb_confirmed"]);
  });

  it("derives payment dispute queued and confirmed milestones from observed state", () => {
    expect(
      deriveSatisfiedChatCaseProgressMilestones({
        caseId: CASE_ID,
        approvedAction: {
          label: "Payment dispute (bank/card)",
          href: "/justice/payment-dispute",
          status: "approved",
        },
        tasks: [
          {
            id: "task-pd",
            user_id: "user",
            case_id: CASE_ID,
            title: "Payment dispute: Acme",
            due_date: null,
            notes: `payment_dispute_filing_queue:${CASE_ID}\ncase_id: ${CASE_ID}`,
            completed_at: null,
            created_at: "2026-01-01T00:00:00.000Z",
            updated_at: "2026-01-01T00:00:00.000Z",
          },
        ],
        filings: [],
      })
    ).toEqual(["payment_dispute_queued"]);

    expect(
      deriveSatisfiedChatCaseProgressMilestones({
        caseId: CASE_ID,
        approvedAction: {
          label: "Payment dispute (bank/card)",
          href: "/justice/payment-dispute",
          status: "completed",
          completed_at: "2026-06-22T12:00:00.000Z",
        },
        tasks: [],
        filings: [
          {
            destination: "Payment dispute (bank/card)",
            confirmation_number: "pd-123",
          },
        ],
      })
    ).toEqual(["payment_dispute_confirmed"]);
  });

  it("collects narration once and dedupes across repeated observations", () => {
    const observation = {
      caseId: CASE_ID,
      approvedAction: {
        label: "State Attorney General (consumer)",
        href: "/justice/state-ag",
        status: "approved",
      },
      tasks: [openStateAgTask()],
      filings: [
        {
          destination: "Better Business Bureau",
          confirmation_number: "bbb-123",
        },
      ],
    } as const;

    const first = collectNewChatCaseProgressNarrationMessages(observation);
    const second = collectNewChatCaseProgressNarrationMessages(observation);

    expect(first).toHaveLength(2);
    expect(first[0]).toBe(buildChatCaseProgressNarrationMessage("bbb_filed"));
    expect(first[1]).toBe(buildChatCaseProgressNarrationMessage("state_ag_queued"));
    expect(second).toEqual([]);
    expect(readNarratedChatCaseProgressMilestones(CASE_ID).has("bbb_filed")).toBe(true);
    expect(sessionStorage.getItem(STORAGE_CHAT_CASE_PROGRESS_NARRATED_V1)).toContain(CASE_ID);
  });

  it("derives resolution ready when outcome tracking is exposed", () => {
    expect(
      deriveSatisfiedChatCaseProgressMilestones({
        caseId: CASE_ID,
        approvedAction: {
          label: "Small claims / demand letter",
          href: "/justice/demand-letter",
          status: "completed",
          outcome_note: "Escalation complete. Awaiting responses.",
        },
        tasks: [],
        filings: [
          { destination: "Small claims / demand letter", confirmation_number: "dl-1" },
        ],
      })
    ).toContain("resolution_ready");
  });
});

import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  buildChatCaseProgressNarrationMessage,
  collectNewChatCaseProgressNarrationMessages,
  deriveSatisfiedChatCaseProgressMilestones,
  readNarratedChatCaseProgressMilestones,
  STORAGE_CHAT_CASE_PROGRESS_NARRATED_V1,
  type ChatCaseProgressObservation,
} from "@/lib/justice/chatCaseProgressNarration";
import { stateAgFilingTaskNotesMarker } from "@/lib/justice/stateAgFilingTask";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";

const CASE_ID = "550e8400-e29b-41d4-a716-446655440000";
// Recent (not a fixed past date): deriveSatisfiedChatCaseProgressMilestones now derives each
// queued milestone's authoritative age from created_at, and a fixed date fixture would drift into
// the 24h-stale milestone as real wall-clock time passes.
const RECENT_TASK_TIMESTAMP = new Date().toISOString();

function openStateAgTask(): JusticeCaseTaskRow {
  const marker = stateAgFilingTaskNotesMarker(CASE_ID);
  // Recent (not a fixed past date): collectNewChatCaseProgressNarrationMessages now derives the
  // queued milestone's authoritative age from created_at, and a fixed date fixture would drift
  // into the 24h-stale wording as real wall-clock time passes.
  const nowIso = new Date().toISOString();
  return {
    id: "task-state-ag",
    user_id: "user",
    case_id: CASE_ID,
    title: "State AG filing: Acme",
    due_date: null,
    notes: `${marker}\ncase_id: ${CASE_ID}`,
    completed_at: null,
    created_at: nowIso,
    updated_at: nowIso,
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

  it("derives BBB queued and confirmed milestones from observed state", () => {
    expect(
      deriveSatisfiedChatCaseProgressMilestones({
        caseId: CASE_ID,
        approvedAction: {
          label: "Better Business Bureau",
          href: "/justice/bbb",
          status: "approved",
        },
        tasks: [
          {
            id: "task-bbb",
            user_id: "user",
            case_id: CASE_ID,
            title: "BBB filing: Acme",
            due_date: null,
            notes: `bbb_filing_queue:${CASE_ID}\ncase_id: ${CASE_ID}`,
            completed_at: null,
            created_at: RECENT_TASK_TIMESTAMP,
            updated_at: RECENT_TASK_TIMESTAMP,
          },
        ],
        filings: [],
      })
    ).toEqual(["bbb_queued"]);

    expect(buildChatCaseProgressNarrationMessage("bbb_queued")).toMatch(/operator filing/i);
    expect(buildChatCaseProgressNarrationMessage("bbb_queued")).not.toMatch(/autofill/i);

    expect(
      deriveSatisfiedChatCaseProgressMilestones({
        caseId: CASE_ID,
        approvedAction: {
          label: "Better Business Bureau",
          href: "/justice/bbb",
          status: "completed",
          completed_at: "2026-06-22T12:00:00.000Z",
        },
        tasks: [],
        filings: [
          {
            destination: "Better Business Bureau",
            confirmation_number: "bbb-123",
          },
        ],
      })
    ).toEqual(["bbb_confirmed"]);
  });

  it("derives BBB confirmed and State AG queued milestones from observed state", () => {
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
    ).toEqual(["bbb_confirmed", "state_ag_queued"]);
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
            created_at: RECENT_TASK_TIMESTAMP,
            updated_at: RECENT_TASK_TIMESTAMP,
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
            created_at: RECENT_TASK_TIMESTAMP,
            updated_at: RECENT_TASK_TIMESTAMP,
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

  it("derives FCC queued and confirmed milestones from observed state", () => {
    expect(
      deriveSatisfiedChatCaseProgressMilestones({
        caseId: CASE_ID,
        approvedAction: {
          label: "FCC",
          href: "/justice/fcc",
          status: "approved",
        },
        tasks: [
          {
            id: "task-fcc",
            user_id: "user",
            case_id: CASE_ID,
            title: "FCC filing: Acme",
            due_date: null,
            notes: `fcc_filing_queue:${CASE_ID}\ncase_id: ${CASE_ID}`,
            completed_at: null,
            created_at: RECENT_TASK_TIMESTAMP,
            updated_at: RECENT_TASK_TIMESTAMP,
          },
        ],
        filings: [],
      })
    ).toEqual(["fcc_queued"]);

    expect(
      deriveSatisfiedChatCaseProgressMilestones({
        caseId: CASE_ID,
        approvedAction: {
          label: "FCC",
          href: "/justice/fcc",
          status: "completed",
          completed_at: "2026-06-22T12:00:00.000Z",
        },
        tasks: [],
        filings: [
          {
            destination: "FCC",
            confirmation_number: "fcc-123",
          },
        ],
      })
    ).toEqual(["fcc_confirmed"]);
  });

  it("derives DOT queued and confirmed milestones from observed state", () => {
    expect(
      deriveSatisfiedChatCaseProgressMilestones({
        caseId: CASE_ID,
        approvedAction: {
          label: "USDOT / aviation consumer",
          href: "/justice/dot",
          status: "approved",
        },
        tasks: [
          {
            id: "task-dot",
            user_id: "user",
            case_id: CASE_ID,
            title: "DOT filing: Acme",
            due_date: null,
            notes: `dot_filing_queue:${CASE_ID}\ncase_id: ${CASE_ID}`,
            completed_at: null,
            created_at: RECENT_TASK_TIMESTAMP,
            updated_at: RECENT_TASK_TIMESTAMP,
          },
        ],
        filings: [],
      })
    ).toEqual(["dot_queued"]);

    expect(
      deriveSatisfiedChatCaseProgressMilestones({
        caseId: CASE_ID,
        approvedAction: {
          label: "USDOT / aviation consumer",
          href: "/justice/dot",
          status: "completed",
          completed_at: "2026-06-22T12:00:00.000Z",
        },
        tasks: [],
        filings: [
          {
            destination: "USDOT / aviation consumer",
            confirmation_number: "dot-123",
          },
        ],
      })
    ).toEqual(["dot_confirmed"]);
  });

  it("derives FTC queued and confirmed milestones from observed state", () => {
    expect(
      deriveSatisfiedChatCaseProgressMilestones({
        caseId: CASE_ID,
        approvedAction: {
          label: "FTC (consumer complaint)",
          href: "/justice/ftc",
          status: "approved",
        },
        tasks: [
          {
            id: "task-ftc",
            user_id: "user",
            case_id: CASE_ID,
            title: "FTC filing: Acme",
            due_date: null,
            notes: `ftc_filing_queue:${CASE_ID}\ncase_id: ${CASE_ID}`,
            completed_at: null,
            created_at: RECENT_TASK_TIMESTAMP,
            updated_at: RECENT_TASK_TIMESTAMP,
          },
        ],
        filings: [],
      })
    ).toEqual(["ftc_queued"]);

    expect(buildChatCaseProgressNarrationMessage("ftc_queued")).toMatch(/operator filing/i);
    expect(buildChatCaseProgressNarrationMessage("ftc_queued")).not.toMatch(/autofill/i);

    expect(
      deriveSatisfiedChatCaseProgressMilestones({
        caseId: CASE_ID,
        approvedAction: {
          label: "FTC (consumer complaint)",
          href: "/justice/ftc",
          status: "completed",
          completed_at: "2026-06-22T12:00:00.000Z",
        },
        tasks: [],
        filings: [
          {
            destination: "FTC (consumer complaint)",
            confirmation_number: "ftc-123",
          },
        ],
      })
    ).toEqual(["ftc_confirmed"]);
  });

  it("derives merchant contact queued and confirmed milestones from observed state", () => {
    expect(
      deriveSatisfiedChatCaseProgressMilestones({
        caseId: CASE_ID,
        approvedAction: {
          label: "Merchant contact",
          href: "/justice/merchant",
          status: "approved",
        },
        tasks: [
          {
            id: "task-merchant",
            user_id: "user",
            case_id: CASE_ID,
            title: "Merchant contact: Acme",
            due_date: null,
            notes: `merchant_contact_queue:${CASE_ID}\ncase_id: ${CASE_ID}`,
            completed_at: null,
            created_at: RECENT_TASK_TIMESTAMP,
            updated_at: RECENT_TASK_TIMESTAMP,
          },
        ],
        filings: [],
      })
    ).toEqual(["merchant_contact_queued"]);

    expect(
      deriveSatisfiedChatCaseProgressMilestones({
        caseId: CASE_ID,
        approvedAction: {
          label: "Merchant contact",
          href: "/justice/merchant",
          status: "completed",
          completed_at: "2026-06-22T12:00:00.000Z",
        },
        tasks: [],
        filings: [
          {
            destination: "Merchant contact",
            confirmation_number: "merchant-123",
          },
        ],
      })
    ).toEqual(["merchant_contact_confirmed"]);
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
    expect(first[0]).toBe(buildChatCaseProgressNarrationMessage("bbb_confirmed"));
    expect(first[1]).toBe(buildChatCaseProgressNarrationMessage("state_ag_queued"));
    expect(second).toEqual([]);
    expect(readNarratedChatCaseProgressMilestones(CASE_ID).has("bbb_confirmed")).toBe(true);
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

  it("narrates owned follow-up wait for resolution_ready (not consumer DIY form)", () => {
    const message = buildChatCaseProgressNarrationMessage("resolution_ready");
    expect(message.toLowerCase()).toContain("tracking follow-up");
    expect(message.toLowerCase()).toContain("stay here in chat");
    expect(message.toLowerCase()).not.toContain("ready below");
    expect(message.toLowerCase()).not.toContain("record outcome");
  });

  it("narrates operator-owned closure pending for terminal response-review outcomes", () => {
    const observation = {
      caseId: CASE_ID,
      approvedAction: {
        label: "Small claims / demand letter",
        href: "/justice/demand-letter",
        status: "completed",
        outcome_note:
          "Operator confirmed resolution after follow-up response review. Consumer refunded.",
        follow_up_needed: false,
      },
      tasks: [],
      filings: [
        { destination: "Small claims / demand letter", confirmation_number: "dl-1" },
      ],
    } as const;

    expect(deriveSatisfiedChatCaseProgressMilestones(observation)).toContain(
      "operator_closure_pending"
    );
    expect(deriveSatisfiedChatCaseProgressMilestones(observation)).not.toContain(
      "operator_case_closed"
    );
    expect(buildChatCaseProgressNarrationMessage("operator_closure_pending")).toContain(
      "Surrenderless will close it"
    );
  });

  it("emits one closed-case handoff when archived_at appears, then dedupes refreshes", () => {
    const pending = {
      caseId: CASE_ID,
      approvedAction: {
        label: "Small claims / demand letter",
        href: "/justice/demand-letter",
        status: "completed",
        outcome_note:
          "Operator confirmed no resolution after follow-up response review.",
        follow_up_needed: false,
      },
      tasks: [],
      filings: [
        { destination: "Small claims / demand letter", confirmation_number: "dl-1" },
      ],
    } as const;

    const pendingMsgs = collectNewChatCaseProgressNarrationMessages(pending);
    expect(pendingMsgs).toContainEqual(
      buildChatCaseProgressNarrationMessage("operator_closure_pending")
    );

    const closed = {
      ...pending,
      archivedAt: "2026-07-17T12:00:00.000Z",
    } as const;

    expect(deriveSatisfiedChatCaseProgressMilestones(closed)).toContain("operator_case_closed");
    expect(deriveSatisfiedChatCaseProgressMilestones(closed)).not.toContain(
      "operator_closure_pending"
    );

    const firstClosed = collectNewChatCaseProgressNarrationMessages(closed);
    expect(firstClosed).toEqual([
      buildChatCaseProgressNarrationMessage("operator_case_closed"),
    ]);
    expect(firstClosed[0]).toContain("Surrenderless has closed this case");

    const secondClosed = collectNewChatCaseProgressNarrationMessages(closed);
    expect(secondClosed).toEqual([]);
  });
});

describe("chatCaseProgressNarration — 24h staleness escalation", () => {
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

  const HOUR = 3_600_000;

  function queuedTask(marker: string, createdAt: string): JusticeCaseTaskRow {
    return {
      id: "task-1",
      user_id: "user",
      case_id: CASE_ID,
      title: "Filing task",
      due_date: null,
      notes: `${marker}\ncase_id: ${CASE_ID}`,
      completed_at: null,
      created_at: createdAt,
      updated_at: createdAt,
    };
  }

  function bbbTask(createdAt: string): JusticeCaseTaskRow {
    return queuedTask(`bbb_filing_queue:${CASE_ID}`, createdAt);
  }

  function cfpbTask(createdAt: string): JusticeCaseTaskRow {
    return queuedTask(`cfpb_filing_queue:${CASE_ID}`, createdAt);
  }

  function bbbObservation(createdAt: string): ChatCaseProgressObservation {
    return {
      caseId: CASE_ID,
      approvedAction: { label: "Better Business Bureau", href: "/justice/bbb", status: "approved" },
      tasks: [bbbTask(createdAt)],
      filings: [],
    };
  }

  function cfpbObservation(createdAt: string): ChatCaseProgressObservation {
    return {
      caseId: CASE_ID,
      approvedAction: { label: "CFPB", href: "/justice/cfpb", status: "approved" },
      tasks: [cfpbTask(createdAt)],
      filings: [],
    };
  }

  it("preserves current wording before 24 hours, both for the base message and derived state", () => {
    const createdAt = "2026-07-01T00:00:00.000Z";
    expect(buildChatCaseProgressNarrationMessage("bbb_queued")).toMatch(/operator filing/i);
    expect(
      deriveSatisfiedChatCaseProgressMilestones(
        bbbObservation(createdAt),
        Date.parse(createdAt) + 24 * HOUR - 1
      )
    ).toEqual(["bbb_queued"]);
  });

  it("derives the separate stale milestone once task age reevaluates past 24 hours, alongside the base milestone", () => {
    const createdAt = "2026-07-01T00:00:00.000Z";
    expect(
      deriveSatisfiedChatCaseProgressMilestones(
        bbbObservation(createdAt),
        Date.parse(createdAt) + 24 * HOUR
      )
    ).toEqual(["bbb_queued", "bbb_queued_stale"]);

    expect(buildChatCaseProgressNarrationMessage("bbb_queued_stale")).toMatch(
      /taking longer than expected/i
    );
    expect(buildChatCaseProgressNarrationMessage("bbb_queued_stale")).toMatch(
      /Better Business Bureau/i
    );
  });

  it("emits one new 'taking longer than expected' update when a previously-narrated task crosses 24h, and never resends it", () => {
    const createdAt = "2026-07-01T00:00:00.000Z";
    const observation = bbbObservation(createdAt);

    const fresh = collectNewChatCaseProgressNarrationMessages(observation, Date.parse(createdAt));
    expect(fresh).toEqual([buildChatCaseProgressNarrationMessage("bbb_queued")]);
    expect(fresh[0]).not.toMatch(/taking longer than expected/i);

    const stale = collectNewChatCaseProgressNarrationMessages(
      observation,
      Date.parse(createdAt) + 25 * HOUR
    );
    expect(stale).toEqual([buildChatCaseProgressNarrationMessage("bbb_queued_stale")]);
    expect(stale[0]).toMatch(/taking longer than expected/i);

    // Never resent, at this age or any later one.
    const again = collectNewChatCaseProgressNarrationMessages(
      observation,
      Date.parse(createdAt) + 25 * HOUR
    );
    expect(again).toEqual([]);
    const muchLater = collectNewChatCaseProgressNarrationMessages(
      observation,
      Date.parse(createdAt) + 500 * HOUR
    );
    expect(muchLater).toEqual([]);
  });

  it("sends only the stale message when a task is first observed already stale — no burst of both", () => {
    const createdAt = "2026-07-01T00:00:00.000Z";
    const observation = bbbObservation(createdAt);

    const messages = collectNewChatCaseProgressNarrationMessages(
      observation,
      Date.parse(createdAt) + 30 * HOUR
    );
    expect(messages).toEqual([buildChatCaseProgressNarrationMessage("bbb_queued_stale")]);
    expect(messages).toHaveLength(1);

    // The base "queued" milestone is resolved (never sent later) alongside the stale one.
    expect(readNarratedChatCaseProgressMilestones(CASE_ID).has("bbb_queued")).toBe(true);
    expect(readNarratedChatCaseProgressMilestones(CASE_ID).has("bbb_queued_stale")).toBe(true);

    const later = collectNewChatCaseProgressNarrationMessages(
      observation,
      Date.parse(createdAt) + 300 * HOUR
    );
    expect(later).toEqual([]);
  });

  it("includes CFPB's manual operator queue in staleness handling, even though CFPB automation is out of scope", () => {
    const createdAt = "2026-07-01T00:00:00.000Z";
    const observation = cfpbObservation(createdAt);

    expect(
      deriveSatisfiedChatCaseProgressMilestones(observation, Date.parse(createdAt) + 25 * HOUR)
    ).toEqual(["cfpb_queued", "cfpb_queued_stale"]);

    const fresh = collectNewChatCaseProgressNarrationMessages(observation, Date.parse(createdAt));
    expect(fresh).toEqual([buildChatCaseProgressNarrationMessage("cfpb_queued")]);

    const stale = collectNewChatCaseProgressNarrationMessages(
      observation,
      Date.parse(createdAt) + 25 * HOUR
    );
    expect(stale).toEqual([buildChatCaseProgressNarrationMessage("cfpb_queued_stale")]);
    expect(stale[0]).toMatch(/taking longer than expected/i);
    expect(stale[0]).toMatch(/CFPB/i);
  });

  it("leaves unrelated (non-queued) milestones unaffected by staleness", () => {
    expect(buildChatCaseProgressNarrationMessage("bbb_confirmed")).toMatch(/confirmed on file/i);
    expect(
      deriveSatisfiedChatCaseProgressMilestones(
        {
          caseId: CASE_ID,
          approvedAction: {
            label: "Better Business Bureau",
            href: "/justice/bbb",
            status: "completed",
            completed_at: "2026-06-22T12:00:00.000Z",
          },
          tasks: [],
          filings: [{ destination: "Better Business Bureau", confirmation_number: "bbb-123" }],
        },
        Date.parse("2026-07-01T00:00:00.000Z") + 500 * HOUR
      )
    ).toEqual(["bbb_confirmed"]);
  });
});

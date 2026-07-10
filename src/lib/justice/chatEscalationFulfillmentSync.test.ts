import { describe, expect, it, vi } from "vitest";
import {
  ensureChatResolutionAfterEscalationFulfillment,
  observeChatEscalationFulfillmentPending,
  shouldInitiateResolutionFromFulfillmentObservation,
  shouldRehydrateCaseAfterResolutionSync,
  shouldSyncChatEscalationResolution,
} from "@/lib/justice/chatEscalationFulfillmentSync";
import { MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF } from "@/lib/justice/handlingTrackingProgress";
import { demandLetterFilingTaskNotesMarker } from "@/lib/justice/demandLetterFilingTask";
import { stateAgFilingTaskNotesMarker } from "@/lib/justice/stateAgFilingTask";
import type { JusticeIntake } from "@/lib/justice/types";

const CASE_ID = "550e8400-e29b-41d4-a716-446655440000";

const intake: JusticeIntake = {
  company_name: "Acme Retail",
  company_website: "",
  problem_category: "online_purchase",
  story: "Item never arrived",
  money_involved: "$50",
  pay_or_order_date: "2026-01-01",
  order_confirmation_details: "",
  user_display_name: "User",
  reply_email: "user@example.com",
  purchase_or_signup: "widget order",
  already_contacted: "yes",
};

const confirmedDemandLetterFilings = [
  {
    destination: "Small claims / demand letter",
    confirmation_number: "dl-confirmed-123",
  },
];

const completedDemandLetterTask = {
  id: "task-demand-letter",
  user_id: "user",
  case_id: CASE_ID,
  title: "Demand letter",
  due_date: null,
  notes: `${demandLetterFilingTaskNotesMarker(CASE_ID)}\ncase_id: ${CASE_ID}`,
  completed_at: "2026-06-23T12:00:00.000Z",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-06-23T12:00:00.000Z",
};

describe("observeChatEscalationFulfillmentPending", () => {
  it("detects terminal transition when open operator task completes", () => {
    const result = observeChatEscalationFulfillmentPending({
      wasPending: true,
      observation: {
        caseId: CASE_ID,
        approvedAction: {
          label: "Small claims / demand letter",
          href: MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF,
          status: "completed",
          completed_at: "2026-06-23T12:00:00.000Z",
        },
        tasks: [completedDemandLetterTask],
        filings: confirmedDemandLetterFilings,
      },
    });

    expect(result.isPending).toBe(false);
    expect(result.terminalTransitioned).toBe(true);
    expect(result.shouldInitiateResolution).toBe(true);
  });

  it("does not initiate resolution while operator fulfillment is still pending", () => {
    const result = observeChatEscalationFulfillmentPending({
      wasPending: false,
      observation: {
        caseId: CASE_ID,
        approvedAction: {
          label: "State Attorney General (consumer)",
          href: "/justice/state-ag",
          status: "approved",
        },
        tasks: [],
        filings: [],
      },
    });

    expect(result.isPending).toBe(true);
    expect(result.terminalTransitioned).toBe(false);
    expect(result.shouldInitiateResolution).toBe(false);
  });

  it("initiates resolution when tasks and filings prove terminal fulfillment but approved_next_action is stale", () => {
    const observation = {
      caseId: CASE_ID,
      approvedAction: {
        label: "Small claims / demand letter",
        href: MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF,
        status: "approved" as const,
      },
      tasks: [completedDemandLetterTask],
      filings: confirmedDemandLetterFilings,
    };

    const result = observeChatEscalationFulfillmentPending({
      wasPending: true,
      observation,
    });

    expect(result.isPending).toBe(false);
    expect(result.terminalTransitioned).toBe(true);
    expect(result.shouldInitiateResolution).toBe(true);
    expect(shouldInitiateResolutionFromFulfillmentObservation(observation)).toBe(true);
  });

  it("does not initiate resolution after State AG completion when demand-letter work is still pending", () => {
    const openDemandLetterMarker = demandLetterFilingTaskNotesMarker(CASE_ID);
    const observation = {
      caseId: CASE_ID,
      approvedAction: {
        label: "Small claims / demand letter",
        href: MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF,
        status: "approved" as const,
      },
      tasks: [
        {
          id: "task-state-ag",
          user_id: "user",
          case_id: CASE_ID,
          title: "State AG filing",
          due_date: null,
          notes: `${stateAgFilingTaskNotesMarker(CASE_ID)}\ncase_id: ${CASE_ID}`,
          completed_at: "2026-06-22T12:00:00.000Z",
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-06-22T12:00:00.000Z",
        },
        {
          id: "task-demand-letter-open",
          user_id: "user",
          case_id: CASE_ID,
          title: "Demand letter",
          due_date: null,
          notes: `${openDemandLetterMarker}\ncase_id: ${CASE_ID}`,
          completed_at: null,
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z",
        },
      ],
      filings: [
        {
          destination: "State Attorney General (consumer)",
          confirmation_number: "ag-confirmed-456",
        },
      ],
    };

    expect(shouldInitiateResolutionFromFulfillmentObservation(observation)).toBe(false);
    expect(
      shouldSyncChatEscalationResolution({
        wasPending: true,
        observation,
      })
    ).toBe(false);
  });

  it("requests resolution sync on cold load when fulfillment is complete but tracking is missing", () => {
    const observation = {
      caseId: CASE_ID,
      approvedAction: {
        label: "Small claims / demand letter",
        href: MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF,
        status: "completed" as const,
        completed_at: "2026-06-23T12:00:00.000Z",
      },
      tasks: [completedDemandLetterTask],
      filings: confirmedDemandLetterFilings,
    };

    const result = observeChatEscalationFulfillmentPending({
      wasPending: false,
      observation,
    });

    expect(result.isPending).toBe(false);
    expect(result.terminalTransitioned).toBe(false);
    expect(result.shouldInitiateResolution).toBe(true);
    expect(
      shouldSyncChatEscalationResolution({
        wasPending: false,
        observation,
      })
    ).toBe(true);
  });

  it("skips resolution sync on cold load when tracking is already present", () => {
    const observation = {
      caseId: CASE_ID,
      approvedAction: {
        label: "Small claims / demand letter",
        href: MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF,
        status: "completed" as const,
        completed_at: "2026-06-23T12:00:00.000Z",
        handling_requested_at: "2026-06-23T12:05:00.000Z",
        outcome_note: "Escalation complete. Awaiting responses.",
      },
      tasks: [],
      filings: confirmedDemandLetterFilings,
    };

    expect(
      shouldSyncChatEscalationResolution({
        wasPending: false,
        observation,
      })
    ).toBe(false);
    expect(shouldInitiateResolutionFromFulfillmentObservation(observation)).toBe(false);
  });
});

describe("ensureChatResolutionAfterEscalationFulfillment", () => {
  it("PATCHes resolution tracking when escalation is terminal but tracking is missing", async () => {
    const onLocalAction = vi.fn();
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("/api/justice/cases/") && !init?.method) {
        return new Response(
          JSON.stringify({
            intake,
            client_state: {
              approved_next_action: {
                label: "Small claims / demand letter",
                href: MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF,
                status: "completed",
                completed_at: "2026-06-23T12:00:00.000Z",
              },
            },
          }),
          { status: 200 }
        );
      }
      if (url.includes("/api/justice/cases/") && init?.method === "PATCH") {
        return new Response(JSON.stringify({ timeline: [] }), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    const result = await ensureChatResolutionAfterEscalationFulfillment({
      caseId: CASE_ID,
      intakeFallback: intake,
      approvedAction: {
        label: "Small claims / demand letter",
        href: MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF,
        status: "completed",
        completed_at: "2026-06-23T12:00:00.000Z",
      },
      tasks: [completedDemandLetterTask],
      filings: confirmedDemandLetterFilings,
      fetchFn,
      onLocalAction,
    });

    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(result.action?.outcome_note?.trim()).toBeTruthy();
    expect(result.action?.handling_requested_at?.trim()).toBeTruthy();
    expect(result.persisted).toBe(true);
    expect(onLocalAction).toHaveBeenCalledOnce();
    expect(shouldRehydrateCaseAfterResolutionSync(result)).toBe(true);
  });

  it("PATCHes when tasks and filings prove terminal fulfillment but approved_next_action is stale", async () => {
    const onLocalAction = vi.fn();
    let patchBody: { client_state?: { approved_next_action?: { status?: string } } } = {};
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("/api/justice/cases/") && !init?.method) {
        return new Response(
          JSON.stringify({
            intake,
            client_state: {
              approved_next_action: {
                label: "Small claims / demand letter",
                href: MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF,
                status: "approved",
              },
            },
          }),
          { status: 200 }
        );
      }
      if (url.includes("/api/justice/cases/") && init?.method === "PATCH") {
        patchBody = JSON.parse(String(init.body)) as typeof patchBody;
        return new Response(JSON.stringify({ timeline: [] }), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    const result = await ensureChatResolutionAfterEscalationFulfillment({
      caseId: CASE_ID,
      intakeFallback: intake,
      approvedAction: {
        label: "Small claims / demand letter",
        href: MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF,
        status: "approved",
      },
      tasks: [completedDemandLetterTask],
      filings: confirmedDemandLetterFilings,
      fetchFn,
      onLocalAction,
    });

    expect(result.persisted).toBe(true);
    expect(result.action?.status).toBe("completed");
    expect(result.action?.outcome_note?.trim()).toBeTruthy();
    expect(patchBody.client_state?.approved_next_action?.status).toBe("completed");
    expect(onLocalAction).toHaveBeenCalledOnce();
  });

  it("does not PATCH when resolution tracking is already seeded", async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error("fetch should not run when tracking is already present");
    }) as typeof fetch;

    const result = await ensureChatResolutionAfterEscalationFulfillment({
      caseId: CASE_ID,
      intakeFallback: intake,
      approvedAction: {
        label: "Small claims / demand letter",
        href: MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF,
        status: "approved",
        handling_requested_at: "2026-06-23T12:05:00.000Z",
        outcome_note: "Escalation complete. Awaiting responses.",
      },
      tasks: [completedDemandLetterTask],
      filings: confirmedDemandLetterFilings,
      fetchFn,
    });

    expect(result.persisted).toBe(false);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("does not mark persistence when resolution PATCH fails", async () => {
    const onLocalAction = vi.fn();
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("/api/justice/cases/") && !init?.method) {
        return new Response(
          JSON.stringify({
            intake,
            client_state: {
              approved_next_action: {
                label: "Small claims / demand letter",
                href: MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF,
                status: "completed",
                completed_at: "2026-06-23T12:00:00.000Z",
              },
            },
          }),
          { status: 200 }
        );
      }
      if (url.includes("/api/justice/cases/") && init?.method === "PATCH") {
        return new Response(JSON.stringify({ error: "forbidden" }), { status: 403 });
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    const result = await ensureChatResolutionAfterEscalationFulfillment({
      caseId: CASE_ID,
      intakeFallback: intake,
      approvedAction: {
        label: "Small claims / demand letter",
        href: MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF,
        status: "completed",
        completed_at: "2026-06-23T12:00:00.000Z",
      },
      tasks: [completedDemandLetterTask],
      filings: confirmedDemandLetterFilings,
      fetchFn,
      onLocalAction,
    });

    expect(result.action?.outcome_note?.trim()).toBeTruthy();
    expect(result.action?.handling_requested_at?.trim()).toBeTruthy();
    expect(result.persisted).toBe(false);
    expect(onLocalAction).toHaveBeenCalledOnce();
    expect(shouldRehydrateCaseAfterResolutionSync(result)).toBe(false);
  });
});

describe("shouldRehydrateCaseAfterResolutionSync", () => {
  it("rehydrates only after confirmed server persistence", () => {
    expect(
      shouldRehydrateCaseAfterResolutionSync({
        persisted: true,
        action: {
          label: "Small claims / demand letter",
          href: MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF,
          status: "completed",
          completed_at: "2026-06-23T12:00:00.000Z",
          handling_requested_at: "2026-06-23T12:05:00.000Z",
          outcome_note: "Escalation complete. Awaiting responses.",
        },
      })
    ).toBe(true);
  });

  it("does not rehydrate when persistence was not confirmed", () => {
    expect(
      shouldRehydrateCaseAfterResolutionSync({
        persisted: false,
        action: {
          label: "Small claims / demand letter",
          href: MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF,
          status: "completed",
          completed_at: "2026-06-23T12:00:00.000Z",
          handling_requested_at: "2026-06-23T12:05:00.000Z",
          outcome_note: "Escalation complete. Awaiting responses.",
        },
      })
    ).toBe(false);
  });
});

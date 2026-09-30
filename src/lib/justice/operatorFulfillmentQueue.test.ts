import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  parseBbbFilingTaskDraft,
  taskNotesMatchBbbFilingMarker,
} from "@/lib/justice/bbbFilingTask";
import {
  parseCfpbFilingTaskDraft,
  taskNotesMatchCfpbFilingMarker,
} from "@/lib/justice/cfpbFilingTask";
import {
  parseDemandLetterFilingTaskDraft,
  taskNotesMatchDemandLetterFilingMarker,
} from "@/lib/justice/demandLetterFilingTask";
import {
  parseDotFilingTaskDraft,
  taskNotesMatchDotFilingMarker,
} from "@/lib/justice/dotFilingTask";
import {
  parseFccFilingTaskDraft,
  taskNotesMatchFccFilingMarker,
} from "@/lib/justice/fccFilingTask";
import {
  parseFtcFilingTaskDraft,
  taskNotesMatchFtcFilingMarker,
} from "@/lib/justice/ftcFilingTask";
import {
  parseMerchantContactFilingTaskDraft,
  taskNotesMatchMerchantContactFilingMarker,
} from "@/lib/justice/merchantContactFilingTask";
import {
  parsePaymentDisputeFilingTaskDraft,
  taskNotesMatchPaymentDisputeFilingMarker,
} from "@/lib/justice/paymentDisputeFilingTask";
import {
  parseStateAgFilingTaskDraft,
  taskNotesMatchStateAgFilingMarker,
} from "@/lib/justice/stateAgFilingTask";
import { orphanedPaidCaseApprovalTaskNotesMarker } from "@/lib/justice/orphanedPaidCaseApprovalTask";
import {
  classifyOpenOperatorTask,
  listOperatorFulfillmentQueue,
  operatorFulfillmentStepLoadsCaseEvidence,
  resolveOperatorFulfillmentPanelKind,
} from "@/lib/justice/operatorFulfillmentQueue";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";
import type { JusticeIntake } from "@/lib/justice/types";

describe("operatorFulfillmentQueue markers", () => {
  const CASE_ID = "550e8400-e29b-41d4-a716-446655440000";

  const intake: JusticeIntake = {
    problem_category: "online_purchase",
    company_name: "Acme Retail",
    company_website: "",
    purchase_or_signup: "widget",
    story: "Test",
    money_involved: "$10",
    pay_or_order_date: "",
    order_confirmation_details: "",
    user_display_name: "Jordan",
    reply_email: "test@example.com",
    already_contacted: "no",
    consumer_us_state: "CA",
  };

  it("recognizes State AG operator task notes", () => {
    const notes = `state_ag_filing_queue:${CASE_ID}\ncase_id: ${CASE_ID}\ndraft:\nComplaint body`;
    expect(taskNotesMatchStateAgFilingMarker(notes, CASE_ID)).toBe(true);
    expect(parseStateAgFilingTaskDraft(notes)).toBe("Complaint body");
  });

  it("recognizes demand letter operator task notes", () => {
    const notes = `demand_letter_filing_queue:${CASE_ID}\ncase_id: ${CASE_ID}\ndraft:\nLetter body`;
    expect(taskNotesMatchDemandLetterFilingMarker(notes, CASE_ID)).toBe(true);
    expect(parseDemandLetterFilingTaskDraft(notes)).toBe("Letter body");
  });

  it("recognizes CFPB operator task notes", () => {
    const notes = `cfpb_filing_queue:${CASE_ID}\ncase_id: ${CASE_ID}\ndraft:\nCFPB body`;
    expect(taskNotesMatchCfpbFilingMarker(notes, CASE_ID)).toBe(true);
    expect(parseCfpbFilingTaskDraft(notes)).toBe("CFPB body");
  });

  it("recognizes payment dispute operator task notes", () => {
    const notes = `payment_dispute_filing_queue:${CASE_ID}\ncase_id: ${CASE_ID}\ndraft:\nPD body`;
    expect(taskNotesMatchPaymentDisputeFilingMarker(notes, CASE_ID)).toBe(true);
    expect(parsePaymentDisputeFilingTaskDraft(notes)).toBe("PD body");
  });

  it("recognizes FCC operator task notes", () => {
    const notes = `fcc_filing_queue:${CASE_ID}\ncase_id: ${CASE_ID}\ndraft:\nFCC body`;
    expect(taskNotesMatchFccFilingMarker(notes, CASE_ID)).toBe(true);
    expect(parseFccFilingTaskDraft(notes)).toBe("FCC body");
  });

  it("recognizes DOT operator task notes", () => {
    const notes = `dot_filing_queue:${CASE_ID}\ncase_id: ${CASE_ID}\ndraft:\nDOT body`;
    expect(taskNotesMatchDotFilingMarker(notes, CASE_ID)).toBe(true);
    expect(parseDotFilingTaskDraft(notes)).toBe("DOT body");
  });

  it("recognizes BBB operator task notes", () => {
    const notes = `bbb_filing_queue:${CASE_ID}\ncase_id: ${CASE_ID}\ndraft:\nBBB body`;
    expect(taskNotesMatchBbbFilingMarker(notes, CASE_ID)).toBe(true);
    expect(parseBbbFilingTaskDraft(notes)).toBe("BBB body");
  });

  it("recognizes FTC operator task notes", () => {
    const notes = `ftc_filing_queue:${CASE_ID}\ncase_id: ${CASE_ID}\ndraft:\nFTC body`;
    expect(taskNotesMatchFtcFilingMarker(notes, CASE_ID)).toBe(true);
    expect(parseFtcFilingTaskDraft(notes)).toBe("FTC body");
  });

  it("recognizes merchant contact operator task notes", () => {
    const notes = `merchant_contact_queue:${CASE_ID}\ncase_id: ${CASE_ID}\ndraft:\nOutreach body`;
    expect(taskNotesMatchMerchantContactFilingMarker(notes, CASE_ID)).toBe(true);
    expect(parseMerchantContactFilingTaskDraft(notes)).toBe("Outreach body");
  });

  it("ignores unrelated open tasks", () => {
    const task: JusticeCaseTaskRow = {
      id: "task-1",
      user_id: "user_1",
      case_id: CASE_ID,
      title: "Follow up merchant",
      due_date: null,
      notes: "manual follow up",
      completed_at: null,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    };
    expect(taskNotesMatchStateAgFilingMarker(task.notes, CASE_ID)).toBe(false);
    expect(taskNotesMatchDemandLetterFilingMarker(task.notes, CASE_ID)).toBe(false);
    expect(taskNotesMatchCfpbFilingMarker(task.notes, CASE_ID)).toBe(false);
    expect(taskNotesMatchPaymentDisputeFilingMarker(task.notes, CASE_ID)).toBe(false);
    expect(taskNotesMatchFccFilingMarker(task.notes, CASE_ID)).toBe(false);
    expect(taskNotesMatchDotFilingMarker(task.notes, CASE_ID)).toBe(false);
    expect(taskNotesMatchFtcFilingMarker(task.notes, CASE_ID)).toBe(false);
    expect(taskNotesMatchBbbFilingMarker(task.notes, CASE_ID)).toBe(false);
    expect(taskNotesMatchMerchantContactFilingMarker(task.notes, CASE_ID)).toBe(false);
    expect(intake.company_name).toBe("Acme Retail");
  });
});

describe("orphaned_paid_case_approval in the operator fulfillment queue", () => {
  const CASE_ID = "550e8400-e29b-41d4-a716-446655440000";

  const intake: JusticeIntake = {
    problem_category: "online_purchase",
    company_name: "Acme Retail",
    company_website: "",
    purchase_or_signup: "widget",
    story: "Test",
    money_involved: "$10",
    pay_or_order_date: "",
    order_confirmation_details: "",
    user_display_name: "Jordan",
    reply_email: "test@example.com",
    already_contacted: "no",
    consumer_us_state: "CA",
  };

  function orphanedTask(): JusticeCaseTaskRow {
    return {
      id: "task-1",
      user_id: "user_1",
      case_id: CASE_ID,
      title: "Paid case needs manual approval review",
      due_date: null,
      notes: `${orphanedPaidCaseApprovalTaskNotesMarker(CASE_ID)}\nreason: no_routable_destination`,
      completed_at: null,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    };
  }

  it("classifies an open orphaned-paid-case-approval task into the queue", () => {
    const item = classifyOpenOperatorTask(orphanedTask(), intake);
    expect(item).not.toBeNull();
    expect(item?.step).toBe("orphaned_paid_case_approval");
    expect(item?.case_id).toBe(CASE_ID);
    expect(item?.case_owner_user_id).toBe("user_1");
  });

  it("resolves a dedicated panel kind, distinct from the generic record form every filing step falls through to", () => {
    const item = classifyOpenOperatorTask(orphanedTask(), intake);
    expect(item).not.toBeNull();
    if (!item) return;
    expect(resolveOperatorFulfillmentPanelKind(item)).toBe("orphaned_paid_case_approval_review");
  });

  it("loads case evidence for orphaned-paid-case-approval, so an operator can review it before choosing an action", () => {
    expect(operatorFulfillmentStepLoadsCaseEvidence("orphaned_paid_case_approval")).toBe(true);
  });

  it("returns null (not classified) for a completed task, matching every other step", () => {
    const item = classifyOpenOperatorTask(
      { ...orphanedTask(), completed_at: "2026-02-01T00:00:00.000Z" },
      intake
    );
    expect(item).toBeNull();
  });
});

describe("listOperatorFulfillmentQueue — invalid-intake recovery", () => {
  const CASE_ID = "550e8400-e29b-41d4-a716-446655440002";
  const ARCHIVED_CASE_ID = "550e8400-e29b-41d4-a716-446655440003";

  function makeSupabase(params: {
    tasks: { id: string; case_id: string; notes: string }[];
    cases: { id: string; user_id: string; intake: unknown; archived_at: string | null }[];
  }): SupabaseClient {
    const from = (table: string) => {
      if (table === "justice_case_tasks") {
        return {
          select: () => ({
            is: () => ({
              order: async () => ({
                data: params.tasks.map((t) => ({
                  id: t.id,
                  user_id: "user_1",
                  case_id: t.case_id,
                  title: "Paid case needs manual approval review",
                  due_date: null,
                  notes: t.notes,
                  completed_at: null,
                  created_at: "2026-01-01T00:00:00.000Z",
                  updated_at: "2026-01-01T00:00:00.000Z",
                })),
                error: null,
              }),
            }),
          }),
        } as unknown as ReturnType<SupabaseClient["from"]>;
      }
      if (table === "justice_cases") {
        return {
          select: () => ({
            in: async (_col: string, ids: string[]) => ({
              data: params.cases.filter((c) => ids.includes(c.id)),
              error: null,
            }),
          }),
        } as unknown as ReturnType<SupabaseClient["from"]>;
      }
      if (table === "justice_case_evidence") {
        return {
          select: () => ({
            in: () => ({
              order: () => ({
                limit: async () => ({ data: [], error: null }),
              }),
            }),
          }),
        } as unknown as ReturnType<SupabaseClient["from"]>;
      }
      throw new Error(`unexpected table ${table}`);
    };
    return { from } as unknown as SupabaseClient;
  }

  it("surfaces an invalid_intake-flagged orphaned_paid_case_approval task instead of silently dropping it — the one review reason no other step type could ever recover from being excluded", async () => {
    const marker = `orphaned_paid_case_approval_queue:${CASE_ID}`;
    const supabase = makeSupabase({
      tasks: [{ id: "task-1", case_id: CASE_ID, notes: `${marker}\nreason: invalid_intake` }],
      cases: [{ id: CASE_ID, user_id: "user_1", intake: { not: "a real intake" }, archived_at: null }],
    });

    const items = await listOperatorFulfillmentQueue(supabase);

    expect(items).toHaveLength(1);
    expect(items[0]?.step).toBe("orphaned_paid_case_approval");
    expect(items[0]?.orphaned_paid_case_approval_invalid_intake).toEqual({
      raw_intake: { not: "a real intake" },
    });
  });

  it("still excludes an archived case's invalid-intake orphaned task, matching every other step's convention", async () => {
    const marker = `orphaned_paid_case_approval_queue:${ARCHIVED_CASE_ID}`;
    const supabase = makeSupabase({
      tasks: [{ id: "task-1", case_id: ARCHIVED_CASE_ID, notes: `${marker}\nreason: invalid_intake` }],
      cases: [
        {
          id: ARCHIVED_CASE_ID,
          user_id: "user_1",
          intake: { not: "a real intake" },
          archived_at: "2026-01-01T00:00:00.000Z",
        },
      ],
    });

    const items = await listOperatorFulfillmentQueue(supabase);

    expect(items).toHaveLength(0);
  });

  it("does not surface a different task type's task for a case with invalid intake — the invalid-intake carve-out is scoped to orphaned_paid_case_approval only", async () => {
    const marker = `state_ag_filing_queue:${CASE_ID}`;
    const supabase = makeSupabase({
      tasks: [{ id: "task-1", case_id: CASE_ID, notes: `${marker}\ncase_id: ${CASE_ID}` }],
      cases: [{ id: CASE_ID, user_id: "user_1", intake: { not: "a real intake" }, archived_at: null }],
    });

    const items = await listOperatorFulfillmentQueue(supabase);

    expect(items).toHaveLength(0);
  });
});

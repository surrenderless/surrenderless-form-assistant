import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { defaultBuildJusticeIntakeParts } from "@/lib/justice/buildJusticeIntake";
import { buildJusticeIntakeFromParts } from "@/lib/justice/buildJusticeIntake";
import {
  buildDefaultPaymentDisputeDraft,
  type PaymentDisputeDraft,
} from "@/lib/justice/buildPaymentDisputeBankLetter";
import {
  buildPaymentDisputeEvidenceInventory,
  buildPaymentDisputeFilingTaskNotes,
  buildPaymentDisputeFilingTaskTitle,
  findLatestPaymentDisputeFiling,
  findLatestPaymentDisputeFilingCreatedAt,
  findOpenPaymentDisputeFilingTask,
  hasPaymentDisputeFilingRecord,
  hasPaymentDisputeFilingWithConfirmation,
  parsePaymentDisputeFilingTaskDraft,
  paymentDisputeFilingTaskCompletedTimelineId,
  paymentDisputeFilingTaskNotesMarker,
  reopenPaymentDisputeFilingTaskForBounce,
  resolvePaymentDisputeDraftForOperatorPacket,
  shouldQueuePaymentDisputeFilingTask,
  taskNotesMatchPaymentDisputeFilingMarker,
} from "@/lib/justice/paymentDisputeFilingTask";
import type { JusticeCaseFilingRow } from "@/lib/justice/filings";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";

const CASE_ID = "550e8400-e29b-41d4-a716-446655440000";

function baseIntake() {
  return buildJusticeIntakeFromParts({
    ...defaultBuildJusticeIntakeParts(),
    problem_category: "charge_dispute",
    company_name: "Acme Retail",
    money_amount: "$49.99",
    pay_or_order_date: "2026-01-10",
    consumer_us_state: "CA",
    user_display_name: "Jordan Lee",
    reply_email: "e2e@example.com",
    story: "Unauthorized charge after canceling order.",
    already_contacted: "yes",
    contact_method: "email",
    contact_date: "2026-01-15",
    merchant_response_type: "refused_help",
    contact_proof_type: "paste",
    contact_proof_text: "Refused refund by email.",
  });
}

describe("paymentDisputeFilingTask", () => {
  it("uses a stable notes marker per case", () => {
    expect(paymentDisputeFilingTaskNotesMarker(CASE_ID)).toBe(
      `payment_dispute_filing_queue:${CASE_ID}`
    );
  });

  it("builds title from company name", () => {
    expect(buildPaymentDisputeFilingTaskTitle(baseIntake())).toBe("Payment dispute: Acme Retail");
  });

  it("builds stable completed timeline id", () => {
    expect(paymentDisputeFilingTaskCompletedTimelineId("task-1")).toBe(
      "payment_dispute_filing_task_done:task-1"
    );
  });

  it("detects payment dispute filing records and confirmation", () => {
    const filings: JusticeCaseFilingRow[] = [
      {
        id: "fil-1",
        user_id: "user",
        case_id: CASE_ID,
        destination: "CFPB",
        filed_at: "2026-01-01",
        confirmation_number: "cfpb-1",
        filing_url: null,
        notes: null,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "fil-2",
        user_id: "user",
        case_id: CASE_ID,
        destination: "Payment dispute (bank/card)",
        filed_at: "2026-01-02",
        confirmation_number: null,
        filing_url: null,
        notes: null,
        created_at: "2026-01-02T00:00:00.000Z",
        updated_at: "2026-01-02T00:00:00.000Z",
      },
    ];
    expect(hasPaymentDisputeFilingRecord(filings)).toBe(true);
    expect(hasPaymentDisputeFilingWithConfirmation(filings)).toBe(false);
    expect(
      hasPaymentDisputeFilingWithConfirmation([
        { ...filings[1]!, confirmation_number: "pd-123" },
      ])
    ).toBe(true);
  });

  it("findLatestPaymentDisputeFiling picks the most recently created filing regardless of confirmation state", () => {
    const older = {
      id: "fil-pd-older",
      user_id: "user",
      case_id: CASE_ID,
      destination: "Payment dispute (bank/card)",
      filed_at: "2026-06-01",
      confirmation_number: "re_bounced",
      filing_url: null,
      notes: null,
      created_at: "2026-06-01T00:00:00.000Z",
      updated_at: "2026-06-01T00:00:00.000Z",
    };
    const newer = {
      ...older,
      id: "fil-pd-newer",
      confirmation_number: "PD-REMEDIATED",
      created_at: "2026-06-21T00:00:00.000Z",
      updated_at: "2026-06-21T00:00:00.000Z",
    };
    expect(findLatestPaymentDisputeFiling([older, newer])?.id).toBe("fil-pd-newer");
    expect(findLatestPaymentDisputeFiling([newer, older])?.id).toBe("fil-pd-newer");
    expect(findLatestPaymentDisputeFiling([])).toBeUndefined();
  });

  it("builds notes with packet, evidence inventory, and bank letter draft", () => {
    const intake = baseIntake();
    const draft = buildDefaultPaymentDisputeDraft(CASE_ID, intake);
    const notes = buildPaymentDisputeFilingTaskNotes(CASE_ID, intake, draft, [
      { title: "Receipt", evidence_type: "receipt", evidence_date: "2026-01-09" },
    ]);
    expect(notes.startsWith(`payment_dispute_filing_queue:${CASE_ID}\n`)).toBe(true);
    expect(notes).toContain(`case_id: ${CASE_ID}`);
    expect(notes).toContain("packet:");
    expect(notes).toContain("payment_method: credit_card");
    expect(notes).toContain("evidence:");
    expect(notes).toContain("1. [receipt] Receipt (2026-01-09)");
    expect(notes).toContain("draft:");
    expect(notes).toContain("DISPUTE REQUEST");
    expect(notes).toContain("Acme Retail");
  });

  it("formats empty evidence inventory", () => {
    expect(buildPaymentDisputeEvidenceInventory([])).toBe(
      "(no saved evidence rows on this case yet)"
    );
  });

  it("matches marker-only and structured notes", () => {
    const marker = paymentDisputeFilingTaskNotesMarker(CASE_ID);
    expect(taskNotesMatchPaymentDisputeFilingMarker(marker, CASE_ID)).toBe(true);
    expect(
      taskNotesMatchPaymentDisputeFilingMarker(`${marker}\ncase_id: ${CASE_ID}`, CASE_ID)
    ).toBe(true);
    expect(taskNotesMatchPaymentDisputeFilingMarker("other task", CASE_ID)).toBe(false);
  });

  it("parses draft body from task notes", () => {
    const intake = baseIntake();
    const draft = buildDefaultPaymentDisputeDraft(CASE_ID, intake);
    const notes = buildPaymentDisputeFilingTaskNotes(CASE_ID, intake, draft);
    const letter = parsePaymentDisputeFilingTaskDraft(notes);
    expect(letter.length).toBeGreaterThan(0);
    expect(letter).toContain("DISPUTE REQUEST");
  });

  it("finds open payment dispute filing task", () => {
    const marker = paymentDisputeFilingTaskNotesMarker(CASE_ID);
    const tasks: JusticeCaseTaskRow[] = [
      {
        id: "task-1",
        user_id: "user",
        case_id: CASE_ID,
        title: "Payment dispute: Acme Retail",
        due_date: null,
        notes: `${marker}\ncase_id: ${CASE_ID}`,
        completed_at: null,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      },
    ];
    expect(findOpenPaymentDisputeFilingTask(tasks, CASE_ID)?.id).toBe("task-1");
    expect(
      findOpenPaymentDisputeFilingTask(
        [{ ...tasks[0]!, completed_at: "2026-01-02T00:00:00.000Z" }],
        CASE_ID
      )
    ).toBeUndefined();
  });

  it("shouldQueuePaymentDisputeFilingTask when packet approved and next action is payment dispute", () => {
    expect(
      shouldQueuePaymentDisputeFilingTask({
        prepared_packet_approved: true,
        approved_next_action: {
          label: "Payment dispute (bank/card)",
          href: "/justice/payment-dispute",
          status: "approved",
        },
      })
    ).toBe(true);
    expect(
      shouldQueuePaymentDisputeFilingTask({
        prepared_packet_approved: true,
        approved_next_action: {
          label: "CFPB",
          href: "/justice/cfpb",
          status: "approved",
        },
      })
    ).toBe(false);
    expect(
      shouldQueuePaymentDisputeFilingTask({
        prepared_packet_approved: false,
        approved_next_action: {
          label: "Payment dispute (bank/card)",
          href: "/justice/payment-dispute",
          status: "approved",
        },
      })
    ).toBe(false);
  });

  it("queues formal goods-not-received reason for non-delivery intake when no saved draft", () => {
    const intake = buildJusticeIntakeFromParts({
      ...defaultBuildJusticeIntakeParts(),
      problem_category: "online_purchase",
      company_name: "Laptop World",
      money_amount: "$1,299.00",
      pay_or_order_date: "2026-02-01",
      consumer_us_state: "CA",
      user_display_name: "Alex River",
      reply_email: "alex@example.com",
      story: "I purchased a laptop that never arrived and the seller stopped responding.",
      already_contacted: "yes",
      contact_method: "email",
      contact_date: "2026-02-10",
      merchant_response_type: "no_response",
      contact_proof_type: "none",
    });
    const draft = resolvePaymentDisputeDraftForOperatorPacket(CASE_ID, intake, null);
    expect(draft.dispute_reason).toBe("goods_not_received");
    const notes = buildPaymentDisputeFilingTaskNotes(CASE_ID, intake, draft);
    expect(notes).toContain("I am disputing this charge as: Goods or services not received.");
    expect(notes).not.toContain("Unauthorized charge");
  });

  it("does not overwrite a valid saved payment_dispute_draft reason", () => {
    const intake = buildJusticeIntakeFromParts({
      ...defaultBuildJusticeIntakeParts(),
      problem_category: "online_purchase",
      company_name: "Laptop World",
      money_amount: "$1,299.00",
      pay_or_order_date: "2026-02-01",
      story: "I purchased a laptop that never arrived.",
      already_contacted: "no",
    });
    const saved: PaymentDisputeDraft = {
      case_id: CASE_ID,
      payment_method: "debit_card",
      charge_date: "2026-02-01",
      charge_amount: "$1,299.00",
      merchant_name: "Laptop World",
      dispute_reason: "duplicate_charge",
      prior_company_contact: "no",
      proof_type: "bank_statement",
    };
    const resolved = resolvePaymentDisputeDraftForOperatorPacket(CASE_ID, intake, saved);
    expect(resolved.dispute_reason).toBe("duplicate_charge");
    expect(resolved.payment_method).toBe("debit_card");
    expect(resolved.proof_type).toBe("bank_statement");
  });
});

describe("reopenPaymentDisputeFilingTaskForBounce", () => {
  const USER_ID = "user-pd-bounce";

  function makeCompletedTask(): JusticeCaseTaskRow {
    const marker = paymentDisputeFilingTaskNotesMarker(CASE_ID);
    return {
      id: "task-pd-bounce",
      user_id: USER_ID,
      case_id: CASE_ID,
      title: "Payment dispute: Acme Retail",
      due_date: null,
      notes: `${marker}\ncase_id: ${CASE_ID}\ndraft:\nDISPUTE REQUEST...`,
      completed_at: "2026-01-10T00:00:00.000Z",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-10T00:00:00.000Z",
    };
  }

  function makeSupabase(task: JusticeCaseTaskRow | null) {
    const store = { task: task ? { ...task } : null, timeline: [] as unknown[] };
    return {
      from(table: string) {
        if (table === "justice_case_tasks") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  like: () => ({
                    order: () => ({
                      limit: async () => ({
                        data: store.task ? [store.task] : [],
                        error: null,
                      }),
                    }),
                  }),
                }),
              }),
            }),
            update: (payload: Record<string, unknown>) => ({
              eq: () => ({
                eq: () => ({
                  select: () => ({
                    maybeSingle: async () => {
                      if (!store.task) return { data: null, error: null };
                      store.task = { ...store.task, ...payload } as JusticeCaseTaskRow;
                      return { data: store.task, error: null };
                    },
                  }),
                }),
              }),
            }),
          };
        }
        if (table === "justice_cases") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({ maybeSingle: async () => ({ data: { timeline: store.timeline }, error: null }) }),
              }),
            }),
            update: (payload: Record<string, unknown>) => ({
              eq: () => ({
                eq: () => {
                  store.timeline = payload.timeline as unknown[];
                  return { data: null, error: null };
                },
              }),
            }),
          };
        }
        throw new Error(`unexpected table ${table}`);
      },
    } as unknown as SupabaseClient;
  }

  it("reopens a completed task, prefixes the title, and appends an actionable timeline entry", async () => {
    const supabase = makeSupabase(makeCompletedTask());

    const result = await reopenPaymentDisputeFilingTaskForBounce(supabase, USER_ID, CASE_ID, "bounced");

    expect(result.reopened).toBe(true);
    expect(result.task?.completed_at).toBeNull();
    expect(result.task?.title).toBe("[Needs manual follow-up — bounced] Payment dispute: Acme Retail");
    expect(result.timeline).toHaveLength(1);
    expect(result.timeline?.[0]?.label).toBe("Payment dispute task reopened for manual follow-up");
  });

  it("uses a distinct title prefix for a spam complaint", async () => {
    const supabase = makeSupabase(makeCompletedTask());

    const result = await reopenPaymentDisputeFilingTaskForBounce(
      supabase,
      USER_ID,
      CASE_ID,
      "complained"
    );

    expect(result.task?.title).toBe(
      "[Needs manual follow-up — marked as spam] Payment dispute: Acme Retail"
    );
  });

  it("is a no-op (not reopened) when no matching task exists for the case", async () => {
    const supabase = makeSupabase(null);

    const result = await reopenPaymentDisputeFilingTaskForBounce(supabase, USER_ID, CASE_ID, "bounced");

    expect(result).toEqual({ task: null, timeline: null, reopened: false });
  });
});

describe("findLatestPaymentDisputeFilingCreatedAt", () => {
  const USER_ID = "user-pd-latest";

  function makeFilingsSupabase(filings: JusticeCaseFilingRow[]) {
    return {
      from(table: string) {
        if (table !== "justice_case_filings") throw new Error(`unexpected table ${table}`);
        return {
          select: () => ({
            eq: () => ({
              eq: async () => ({ data: filings, error: null }),
            }),
          }),
        };
      },
    } as unknown as import("@supabase/supabase-js").SupabaseClient;
  }

  function paymentDisputeFiling(id: string, createdAt: string): JusticeCaseFilingRow {
    return {
      id,
      user_id: USER_ID,
      case_id: CASE_ID,
      destination: "Payment dispute (bank/card)",
      filed_at: createdAt.slice(0, 10),
      confirmation_number: `conf-${id}`,
      filing_url: null,
      notes: null,
      created_at: createdAt,
      updated_at: createdAt,
    };
  }

  it("returns the created_at of the most recently created payment-dispute filing", async () => {
    const supabase = makeFilingsSupabase([
      paymentDisputeFiling("fil-1", "2026-06-01T00:00:00.000Z"),
      paymentDisputeFiling("fil-2", "2026-06-21T00:00:00.000Z"),
    ]);

    await expect(findLatestPaymentDisputeFilingCreatedAt(supabase, USER_ID, CASE_ID)).resolves.toBe(
      "2026-06-21T00:00:00.000Z"
    );
  });

  it("returns null when no payment-dispute filing exists yet", async () => {
    const supabase = makeFilingsSupabase([]);

    await expect(findLatestPaymentDisputeFilingCreatedAt(supabase, USER_ID, CASE_ID)).resolves.toBeNull();
  });

  it('returns "error" on a select error rather than throwing or reporting confirmed absence', async () => {
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: async () => ({ data: null, error: { message: "select down" } }),
          }),
        }),
      }),
    } as unknown as import("@supabase/supabase-js").SupabaseClient;

    await expect(findLatestPaymentDisputeFilingCreatedAt(supabase, USER_ID, CASE_ID)).resolves.toBe("error");
  });
});

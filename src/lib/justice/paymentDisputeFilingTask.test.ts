import { describe, expect, it } from "vitest";
import { defaultBuildJusticeIntakeParts } from "@/lib/justice/buildJusticeIntake";
import { buildJusticeIntakeFromParts } from "@/lib/justice/buildJusticeIntake";
import { buildDefaultPaymentDisputeDraft } from "@/lib/justice/buildPaymentDisputeBankLetter";
import {
  buildPaymentDisputeEvidenceInventory,
  buildPaymentDisputeFilingTaskNotes,
  buildPaymentDisputeFilingTaskTitle,
  findOpenPaymentDisputeFilingTask,
  hasPaymentDisputeFilingRecord,
  hasPaymentDisputeFilingWithConfirmation,
  parsePaymentDisputeFilingTaskDraft,
  paymentDisputeFilingTaskCompletedTimelineId,
  paymentDisputeFilingTaskNotesMarker,
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
});

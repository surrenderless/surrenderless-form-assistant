import { describe, expect, it } from "vitest";
import { defaultBuildJusticeIntakeParts } from "@/lib/justice/buildJusticeIntake";
import { buildJusticeIntakeFromParts } from "@/lib/justice/buildJusticeIntake";
import {
  merchantContactFilingTaskCompletedTimelineId,
  merchantContactFilingTaskNotesMarker,
  buildMerchantContactEvidenceInventory,
  buildMerchantContactFilingTaskNotes,
  buildMerchantContactFilingTaskTitle,
  buildMerchantContactIdentityBlock,
  findOpenMerchantContactFilingTask,
  hasMerchantContactFilingRecord,
  hasMerchantContactFilingWithConfirmation,
  parseMerchantContactFilingTaskDraft,
  shouldQueueMerchantContactFilingTask,
  taskNotesMatchMerchantContactFilingMarker,
} from "@/lib/justice/merchantContactFilingTask";
import type { JusticeCaseFilingRow } from "@/lib/justice/filings";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";

const CASE_ID = "550e8400-e29b-41d4-a716-446655440000";

function baseIntake() {
  return buildJusticeIntakeFromParts({
    ...defaultBuildJusticeIntakeParts(),
    problem_category: "online_purchase",
    company_name: "Acme Retail",
    company_website: "https://acme.example",
    purchase_or_signup: "widget order",
    consumer_us_state: "CA",
    user_display_name: "Jordan Lee",
    reply_email: "e2e@example.com",
    story: "Ordered a widget that never arrived and merchant refused a refund.",
    already_contacted: "no",
  });
}

describe("merchantContactFilingTask", () => {
  it("uses a stable notes marker per case", () => {
    expect(merchantContactFilingTaskNotesMarker(CASE_ID)).toBe(`merchant_contact_queue:${CASE_ID}`);
  });

  it("builds title from company name", () => {
    expect(buildMerchantContactFilingTaskTitle(baseIntake())).toBe("Merchant contact: Acme Retail");
  });

  it("builds company-contact title when CFPB-relevant", () => {
    const intake = buildJusticeIntakeFromParts({
      ...defaultBuildJusticeIntakeParts(),
      problem_category: "financial_account_issue",
      company_name: "Acme Bank",
      purchase_or_signup: "checking account",
      story: "Unauthorized fees after closing the account.",
      already_contacted: "no",
    });
    expect(buildMerchantContactFilingTaskTitle(intake)).toBe("Company contact: Acme Bank");
  });

  it("builds stable completed timeline id", () => {
    expect(merchantContactFilingTaskCompletedTimelineId("task-1")).toBe(
      "merchant_contact_task_done:task-1"
    );
  });

  it("detects merchant contact filing records and confirmation", () => {
    const filings: JusticeCaseFilingRow[] = [
      {
        id: "fil-1",
        user_id: "user",
        case_id: CASE_ID,
        destination: "FTC (consumer complaint)",
        filed_at: "2026-01-01",
        confirmation_number: "ftc-1",
        filing_url: null,
        notes: null,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "fil-2",
        user_id: "user",
        case_id: CASE_ID,
        destination: "Merchant contact",
        filed_at: "2026-01-02",
        confirmation_number: null,
        filing_url: null,
        notes: null,
        created_at: "2026-01-02T00:00:00.000Z",
        updated_at: "2026-01-02T00:00:00.000Z",
      },
    ];
    expect(hasMerchantContactFilingRecord(filings)).toBe(true);
    expect(hasMerchantContactFilingWithConfirmation(filings)).toBe(false);
    expect(
      hasMerchantContactFilingWithConfirmation([
        { ...filings[1]!, confirmation_number: "merchant-123" },
      ])
    ).toBe(true);
  });

  it("builds identity block and notes with packet, evidence, and draft", () => {
    const identity = buildMerchantContactIdentityBlock(baseIntake());
    expect(identity).toContain("merchant/company: Acme Retail");
    expect(identity).toContain("consumer: Jordan Lee");

    const notes = buildMerchantContactFilingTaskNotes(CASE_ID, baseIntake(), [
      { title: "Order receipt", evidence_type: "screenshot", evidence_date: "2026-01-09" },
    ]);
    expect(notes.startsWith(`merchant_contact_queue:${CASE_ID}\n`)).toBe(true);
    expect(notes).toContain(`case_id: ${CASE_ID}`);
    expect(notes).toContain("merchant_identity:");
    expect(notes).toContain("packet:");
    expect(notes).toContain("JUSTICE CASE PACKET");
    expect(notes).toContain("evidence:");
    expect(notes).toContain("1. [screenshot] Order receipt (2026-01-09)");
    expect(notes).toContain("draft:");
    expect(notes.length).toBeLessThanOrEqual(8000);
  });

  it("formats empty evidence inventory", () => {
    expect(buildMerchantContactEvidenceInventory([])).toBe(
      "(no saved evidence rows on this case yet)"
    );
  });

  it("matches marker-only and structured notes", () => {
    const marker = merchantContactFilingTaskNotesMarker(CASE_ID);
    expect(taskNotesMatchMerchantContactFilingMarker(marker, CASE_ID)).toBe(true);
    expect(taskNotesMatchMerchantContactFilingMarker(`${marker}\ncase_id: ${CASE_ID}`, CASE_ID)).toBe(
      true
    );
    expect(taskNotesMatchMerchantContactFilingMarker("other task", CASE_ID)).toBe(false);
  });

  it("parses draft body from task notes", () => {
    const notes = buildMerchantContactFilingTaskNotes(CASE_ID, baseIntake());
    const draft = parseMerchantContactFilingTaskDraft(notes);
    expect(draft.length).toBeGreaterThan(0);
    expect(draft).toContain("Acme Retail");
  });

  it("finds open merchant contact filing task", () => {
    const marker = merchantContactFilingTaskNotesMarker(CASE_ID);
    const tasks: JusticeCaseTaskRow[] = [
      {
        id: "task-1",
        user_id: "user",
        case_id: CASE_ID,
        title: "Merchant contact: Acme Retail",
        due_date: null,
        notes: `${marker}\ncase_id: ${CASE_ID}`,
        completed_at: null,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      },
    ];
    expect(findOpenMerchantContactFilingTask(tasks, CASE_ID)?.id).toBe("task-1");
    expect(
      findOpenMerchantContactFilingTask(
        [{ ...tasks[0]!, completed_at: "2026-06-22T00:00:00.000Z" }],
        CASE_ID
      )
    ).toBeUndefined();
  });

  it("shouldQueueMerchantContactFilingTask when packet approved and next action is owned merchant", () => {
    expect(
      shouldQueueMerchantContactFilingTask({
        prepared_packet_approved: true,
        approved_next_action: {
          label: "Merchant contact",
          href: "/justice/merchant",
          status: "approved",
        },
      })
    ).toBe(true);
    expect(
      shouldQueueMerchantContactFilingTask({
        prepared_packet_approved: true,
        approved_next_action: {
          label: "Merchant contact",
          href: "/justice/merchant",
          status: "completed",
        },
      })
    ).toBe(false);
    expect(
      shouldQueueMerchantContactFilingTask({
        prepared_packet_approved: true,
        approved_next_action: {
          label: "FTC (consumer complaint)",
          href: "/justice/ftc",
          status: "approved",
        },
      })
    ).toBe(false);
    expect(
      shouldQueueMerchantContactFilingTask({
        prepared_packet_approved: false,
        approved_next_action: {
          label: "Merchant contact",
          href: "/justice/merchant",
          status: "approved",
        },
      })
    ).toBe(false);
  });
});

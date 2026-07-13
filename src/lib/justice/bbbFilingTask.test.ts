import { describe, expect, it } from "vitest";
import { defaultBuildJusticeIntakeParts } from "@/lib/justice/buildJusticeIntake";
import { buildJusticeIntakeFromParts } from "@/lib/justice/buildJusticeIntake";
import {
  bbbFilingTaskCompletedTimelineId,
  bbbFilingTaskNotesMarker,
  buildBbbEvidenceInventory,
  buildBbbFilingTaskNotes,
  buildBbbFilingTaskTitle,
  findOpenBbbFilingTask,
  hasBbbFilingRecord,
  hasBbbFilingWithConfirmation,
  parseBbbFilingTaskDraft,
  shouldQueueBbbFilingTask,
  taskNotesMatchBbbFilingMarker,
} from "@/lib/justice/bbbFilingTask";
import type { JusticeCaseFilingRow } from "@/lib/justice/filings";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";

const CASE_ID = "550e8400-e29b-41d4-a716-446655440000";

function baseIntake() {
  return buildJusticeIntakeFromParts({
    ...defaultBuildJusticeIntakeParts(),
    problem_category: "online_purchase",
    company_name: "Acme Retail",
    purchase_or_signup: "widget order",
    consumer_us_state: "CA",
    user_display_name: "Jordan Lee",
    reply_email: "e2e@example.com",
    story: "Ordered a widget that never arrived and merchant refused a refund.",
    already_contacted: "yes",
    contact_method: "email",
    contact_date: "2026-01-15",
    merchant_response_type: "refused_help",
    contact_proof_type: "paste",
    contact_proof_text: "Refused refund by email.",
  });
}

describe("bbbFilingTask", () => {
  it("uses a stable notes marker per case", () => {
    expect(bbbFilingTaskNotesMarker(CASE_ID)).toBe(`bbb_filing_queue:${CASE_ID}`);
  });

  it("builds title from company name", () => {
    expect(buildBbbFilingTaskTitle(baseIntake())).toBe("BBB filing: Acme Retail");
  });

  it("builds stable completed timeline id", () => {
    expect(bbbFilingTaskCompletedTimelineId("task-1")).toBe("bbb_filing_task_done:task-1");
  });

  it("detects BBB filing records and confirmation", () => {
    const filings: JusticeCaseFilingRow[] = [
      {
        id: "fil-1",
        user_id: "user",
        case_id: CASE_ID,
        destination: "FCC",
        filed_at: "2026-01-01",
        confirmation_number: "fcc-1",
        filing_url: null,
        notes: null,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "fil-2",
        user_id: "user",
        case_id: CASE_ID,
        destination: "Better Business Bureau",
        filed_at: "2026-01-02",
        confirmation_number: null,
        filing_url: null,
        notes: null,
        created_at: "2026-01-02T00:00:00.000Z",
        updated_at: "2026-01-02T00:00:00.000Z",
      },
    ];
    expect(hasBbbFilingRecord(filings)).toBe(true);
    expect(hasBbbFilingWithConfirmation(filings)).toBe(false);
    expect(
      hasBbbFilingWithConfirmation([{ ...filings[1]!, confirmation_number: "bbb-123" }])
    ).toBe(true);
  });

  it("builds notes with packet, evidence inventory, and complaint draft", () => {
    const notes = buildBbbFilingTaskNotes(CASE_ID, baseIntake(), [
      { title: "Order receipt", evidence_type: "screenshot", evidence_date: "2026-01-09" },
    ]);
    expect(notes.startsWith(`bbb_filing_queue:${CASE_ID}\n`)).toBe(true);
    expect(notes).toContain(`case_id: ${CASE_ID}`);
    expect(notes).toContain("company: Acme Retail");
    expect(notes).toContain("packet:");
    expect(notes).toContain("JUSTICE CASE PACKET");
    expect(notes).toContain("evidence:");
    expect(notes).toContain("1. [screenshot] Order receipt (2026-01-09)");
    expect(notes).toContain("draft:");
    expect(notes).toContain("DRAFT FOR BBB COMPLAINT");
    expect(notes).toContain("Ordered a widget");
    expect(notes.length).toBeLessThanOrEqual(8000);
  });

  it("formats empty evidence inventory", () => {
    expect(buildBbbEvidenceInventory([])).toBe("(no saved evidence rows on this case yet)");
  });

  it("matches marker-only and structured notes", () => {
    const marker = bbbFilingTaskNotesMarker(CASE_ID);
    expect(taskNotesMatchBbbFilingMarker(marker, CASE_ID)).toBe(true);
    expect(taskNotesMatchBbbFilingMarker(`${marker}\ncase_id: ${CASE_ID}`, CASE_ID)).toBe(true);
    expect(taskNotesMatchBbbFilingMarker("other task", CASE_ID)).toBe(false);
  });

  it("parses draft body from task notes", () => {
    const notes = buildBbbFilingTaskNotes(CASE_ID, baseIntake());
    const draft = parseBbbFilingTaskDraft(notes);
    expect(draft.length).toBeGreaterThan(0);
    expect(draft).toContain("Acme Retail");
  });

  it("finds open BBB filing task", () => {
    const marker = bbbFilingTaskNotesMarker(CASE_ID);
    const tasks: JusticeCaseTaskRow[] = [
      {
        id: "task-1",
        user_id: "user",
        case_id: CASE_ID,
        title: "BBB filing: Acme Retail",
        due_date: null,
        notes: `${marker}\ncase_id: ${CASE_ID}`,
        completed_at: null,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      },
    ];
    expect(findOpenBbbFilingTask(tasks, CASE_ID)?.id).toBe("task-1");
    expect(
      findOpenBbbFilingTask([{ ...tasks[0]!, completed_at: "2026-01-02T00:00:00.000Z" }], CASE_ID)
    ).toBeUndefined();
  });

  it("shouldQueueBbbFilingTask when packet approved and next action is BBB", () => {
    expect(
      shouldQueueBbbFilingTask({
        prepared_packet_approved: true,
        approved_next_action: {
          label: "Better Business Bureau",
          href: "/justice/bbb",
          status: "approved",
        },
      })
    ).toBe(true);
    expect(
      shouldQueueBbbFilingTask({
        prepared_packet_approved: true,
        approved_next_action: {
          label: "FCC",
          href: "/justice/fcc",
          status: "approved",
        },
      })
    ).toBe(false);
    expect(
      shouldQueueBbbFilingTask({
        prepared_packet_approved: false,
        approved_next_action: {
          label: "Better Business Bureau",
          href: "/justice/bbb",
          status: "approved",
        },
      })
    ).toBe(false);
  });
});

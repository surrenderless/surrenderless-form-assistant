import { describe, expect, it } from "vitest";
import { defaultBuildJusticeIntakeParts } from "@/lib/justice/buildJusticeIntake";
import { buildJusticeIntakeFromParts } from "@/lib/justice/buildJusticeIntake";
import {
  ftcFilingTaskCompletedTimelineId,
  ftcFilingTaskNotesMarker,
  buildFtcEvidenceInventory,
  buildFtcFilingTaskNotes,
  buildFtcFilingTaskTitle,
  findOpenFtcFilingTask,
  hasFtcFilingRecord,
  hasFtcFilingWithConfirmation,
  parseFtcFilingTaskDraft,
  shouldQueueFtcFilingTask,
  taskNotesMatchFtcFilingMarker,
} from "@/lib/justice/ftcFilingTask";
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

describe("ftcFilingTask", () => {
  it("uses a stable notes marker per case", () => {
    expect(ftcFilingTaskNotesMarker(CASE_ID)).toBe(`ftc_filing_queue:${CASE_ID}`);
  });

  it("builds title from company name", () => {
    expect(buildFtcFilingTaskTitle(baseIntake())).toBe("FTC filing: Acme Retail");
  });

  it("builds stable completed timeline id", () => {
    expect(ftcFilingTaskCompletedTimelineId("task-1")).toBe("ftc_filing_task_done:task-1");
  });

  it("detects FTC filing records and confirmation", () => {
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
        destination: "FTC (consumer complaint)",
        filed_at: "2026-01-02",
        confirmation_number: null,
        filing_url: null,
        notes: null,
        created_at: "2026-01-02T00:00:00.000Z",
        updated_at: "2026-01-02T00:00:00.000Z",
      },
    ];
    expect(hasFtcFilingRecord(filings)).toBe(true);
    expect(hasFtcFilingWithConfirmation(filings)).toBe(false);
    expect(
      hasFtcFilingWithConfirmation([{ ...filings[1]!, confirmation_number: "ftc-123" }])
    ).toBe(true);
  });

  it("builds notes with packet, evidence inventory, and complaint draft", () => {
    const notes = buildFtcFilingTaskNotes(CASE_ID, baseIntake(), [
      { title: "Order receipt", evidence_type: "screenshot", evidence_date: "2026-01-09" },
    ]);
    expect(notes.startsWith(`ftc_filing_queue:${CASE_ID}\n`)).toBe(true);
    expect(notes).toContain(`case_id: ${CASE_ID}`);
    expect(notes).toContain("company: Acme Retail");
    expect(notes).toContain("packet:");
    expect(notes).toContain("JUSTICE CASE PACKET");
    expect(notes).toContain("evidence:");
    expect(notes).toContain("1. [screenshot] Order receipt (2026-01-09)");
    expect(notes).toContain("draft:");
    expect(notes).toContain("DRAFT FOR FTC CONSUMER COMPLAINT");
    expect(notes).toContain("Ordered a widget");
    expect(notes.length).toBeLessThanOrEqual(8000);
  });

  it("formats empty evidence inventory", () => {
    expect(buildFtcEvidenceInventory([])).toBe("(no saved evidence rows on this case yet)");
  });

  it("matches marker-only and structured notes", () => {
    const marker = ftcFilingTaskNotesMarker(CASE_ID);
    expect(taskNotesMatchFtcFilingMarker(marker, CASE_ID)).toBe(true);
    expect(taskNotesMatchFtcFilingMarker(`${marker}\ncase_id: ${CASE_ID}`, CASE_ID)).toBe(true);
    expect(taskNotesMatchFtcFilingMarker("other task", CASE_ID)).toBe(false);
  });

  it("parses draft body from task notes", () => {
    const notes = buildFtcFilingTaskNotes(CASE_ID, baseIntake());
    const draft = parseFtcFilingTaskDraft(notes);
    expect(draft.length).toBeGreaterThan(0);
    expect(draft).toContain("Acme Retail");
  });

  it("finds open FTC filing task", () => {
    const marker = ftcFilingTaskNotesMarker(CASE_ID);
    const tasks: JusticeCaseTaskRow[] = [
      {
        id: "task-1",
        user_id: "user",
        case_id: CASE_ID,
        title: "FTC filing: Acme Retail",
        due_date: null,
        notes: `${marker}\ncase_id: ${CASE_ID}`,
        completed_at: null,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      },
    ];
    expect(findOpenFtcFilingTask(tasks, CASE_ID)?.id).toBe("task-1");
    expect(
      findOpenFtcFilingTask([{ ...tasks[0]!, completed_at: "2026-01-02T00:00:00.000Z" }], CASE_ID)
    ).toBeUndefined();
  });

  it("shouldQueueFtcFilingTask when packet approved and next action is owned FTC", () => {
    expect(
      shouldQueueFtcFilingTask({
        prepared_packet_approved: true,
        approved_next_action: {
          label: "FTC (consumer complaint)",
          href: "/justice/ftc",
          status: "approved",
        },
      })
    ).toBe(true);
    expect(
      shouldQueueFtcFilingTask({
        prepared_packet_approved: true,
        approved_next_action: {
          label: "FTC (consumer complaint)",
          href: "/justice/ftc-review",
          status: "approved",
        },
      })
    ).toBe(false);
    expect(
      shouldQueueFtcFilingTask({
        prepared_packet_approved: true,
        approved_next_action: {
          label: "Better Business Bureau",
          href: "/justice/bbb",
          status: "approved",
        },
      })
    ).toBe(false);
    expect(
      shouldQueueFtcFilingTask({
        prepared_packet_approved: false,
        approved_next_action: {
          label: "FTC (consumer complaint)",
          href: "/justice/ftc",
          status: "approved",
        },
      })
    ).toBe(false);
  });
});

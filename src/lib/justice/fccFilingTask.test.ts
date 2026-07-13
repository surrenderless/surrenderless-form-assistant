import { describe, expect, it } from "vitest";
import { defaultBuildJusticeIntakeParts } from "@/lib/justice/buildJusticeIntake";
import { buildJusticeIntakeFromParts } from "@/lib/justice/buildJusticeIntake";
import {
  buildFccEvidenceInventory,
  buildFccFilingTaskNotes,
  buildFccFilingTaskTitle,
  fccFilingTaskCompletedTimelineId,
  fccFilingTaskNotesMarker,
  findOpenFccFilingTask,
  hasFccFilingRecord,
  hasFccFilingWithConfirmation,
  parseFccFilingTaskDraft,
  shouldQueueFccFilingTask,
  taskNotesMatchFccFilingMarker,
} from "@/lib/justice/fccFilingTask";
import type { JusticeCaseFilingRow } from "@/lib/justice/filings";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";

const CASE_ID = "550e8400-e29b-41d4-a716-446655440000";

function baseIntake() {
  return buildJusticeIntakeFromParts({
    ...defaultBuildJusticeIntakeParts(),
    problem_category: "service_failed",
    company_name: "Acme Wireless",
    purchase_or_signup: "wireless phone plan",
    consumer_us_state: "CA",
    user_display_name: "Jordan Lee",
    reply_email: "e2e@example.com",
    story: "Spam robocalls and unauthorized wireless charges after canceling.",
    already_contacted: "yes",
    contact_method: "email",
    contact_date: "2026-01-15",
    merchant_response_type: "refused_help",
    contact_proof_type: "paste",
    contact_proof_text: "Refused refund by email.",
  });
}

describe("fccFilingTask", () => {
  it("uses a stable notes marker per case", () => {
    expect(fccFilingTaskNotesMarker(CASE_ID)).toBe(`fcc_filing_queue:${CASE_ID}`);
  });

  it("builds title from company name", () => {
    expect(buildFccFilingTaskTitle(baseIntake())).toBe("FCC filing: Acme Wireless");
  });

  it("builds stable completed timeline id", () => {
    expect(fccFilingTaskCompletedTimelineId("task-1")).toBe("fcc_filing_task_done:task-1");
  });

  it("detects FCC filing records and confirmation", () => {
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
        destination: "FCC",
        filed_at: "2026-01-02",
        confirmation_number: null,
        filing_url: null,
        notes: null,
        created_at: "2026-01-02T00:00:00.000Z",
        updated_at: "2026-01-02T00:00:00.000Z",
      },
    ];
    expect(hasFccFilingRecord(filings)).toBe(true);
    expect(hasFccFilingWithConfirmation(filings)).toBe(false);
    expect(
      hasFccFilingWithConfirmation([{ ...filings[1]!, confirmation_number: "fcc-123" }])
    ).toBe(true);
  });

  it("builds notes with evidence inventory and complaint draft", () => {
    const notes = buildFccFilingTaskNotes(CASE_ID, baseIntake(), [
      { title: "Bill screenshot", evidence_type: "screenshot", evidence_date: "2026-01-09" },
    ]);
    expect(notes.startsWith(`fcc_filing_queue:${CASE_ID}\n`)).toBe(true);
    expect(notes).toContain(`case_id: ${CASE_ID}`);
    expect(notes).toContain("company: Acme Wireless");
    expect(notes).toContain("evidence:");
    expect(notes).toContain("1. [screenshot] Bill screenshot (2026-01-09)");
    expect(notes).toContain("draft:");
    expect(notes).toContain("DRAFT FOR FCC CONSUMER COMPLAINT");
    expect(notes).toContain("Spam robocalls");
  });

  it("formats empty evidence inventory", () => {
    expect(buildFccEvidenceInventory([])).toBe("(no saved evidence rows on this case yet)");
  });

  it("matches marker-only and structured notes", () => {
    const marker = fccFilingTaskNotesMarker(CASE_ID);
    expect(taskNotesMatchFccFilingMarker(marker, CASE_ID)).toBe(true);
    expect(taskNotesMatchFccFilingMarker(`${marker}\ncase_id: ${CASE_ID}`, CASE_ID)).toBe(true);
    expect(taskNotesMatchFccFilingMarker("other task", CASE_ID)).toBe(false);
  });

  it("parses draft body from task notes", () => {
    const notes = buildFccFilingTaskNotes(CASE_ID, baseIntake());
    const draft = parseFccFilingTaskDraft(notes);
    expect(draft.length).toBeGreaterThan(0);
    expect(draft).toContain("Acme Wireless");
  });

  it("finds open FCC filing task", () => {
    const marker = fccFilingTaskNotesMarker(CASE_ID);
    const tasks: JusticeCaseTaskRow[] = [
      {
        id: "task-1",
        user_id: "user",
        case_id: CASE_ID,
        title: "FCC filing: Acme Wireless",
        due_date: null,
        notes: `${marker}\ncase_id: ${CASE_ID}`,
        completed_at: null,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      },
    ];
    expect(findOpenFccFilingTask(tasks, CASE_ID)?.id).toBe("task-1");
    expect(
      findOpenFccFilingTask([{ ...tasks[0]!, completed_at: "2026-01-02T00:00:00.000Z" }], CASE_ID)
    ).toBeUndefined();
  });

  it("shouldQueueFccFilingTask when packet approved and next action is FCC", () => {
    expect(
      shouldQueueFccFilingTask({
        prepared_packet_approved: true,
        approved_next_action: {
          label: "FCC",
          href: "/justice/fcc",
          status: "approved",
        },
      })
    ).toBe(true);
    expect(
      shouldQueueFccFilingTask({
        prepared_packet_approved: true,
        approved_next_action: {
          label: "CFPB",
          href: "/justice/cfpb",
          status: "approved",
        },
      })
    ).toBe(false);
    expect(
      shouldQueueFccFilingTask({
        prepared_packet_approved: false,
        approved_next_action: {
          label: "FCC",
          href: "/justice/fcc",
          status: "approved",
        },
      })
    ).toBe(false);
  });
});

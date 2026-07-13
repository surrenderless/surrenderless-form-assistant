import { describe, expect, it } from "vitest";
import { defaultBuildJusticeIntakeParts } from "@/lib/justice/buildJusticeIntake";
import { buildJusticeIntakeFromParts } from "@/lib/justice/buildJusticeIntake";
import {
  buildDotEvidenceInventory,
  buildDotFilingTaskNotes,
  buildDotFilingTaskTitle,
  dotFilingTaskCompletedTimelineId,
  dotFilingTaskNotesMarker,
  findOpenDotFilingTask,
  hasDotFilingRecord,
  hasDotFilingWithConfirmation,
  parseDotFilingTaskDraft,
  shouldQueueDotFilingTask,
  taskNotesMatchDotFilingMarker,
} from "@/lib/justice/dotFilingTask";
import type { JusticeCaseFilingRow } from "@/lib/justice/filings";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";

const CASE_ID = "550e8400-e29b-41d4-a716-446655440000";

function baseIntake() {
  return buildJusticeIntakeFromParts({
    ...defaultBuildJusticeIntakeParts(),
    problem_category: "service_failed",
    company_name: "Acme Air",
    purchase_or_signup: "flight AA1234",
    consumer_us_state: "CA",
    user_display_name: "Jordan Lee",
    reply_email: "e2e@example.com",
    story: "Airline canceled my flight and refused a refund for baggage fees.",
    already_contacted: "yes",
    contact_method: "email",
    contact_date: "2026-01-15",
    merchant_response_type: "refused_help",
    contact_proof_type: "paste",
    contact_proof_text: "Refused refund by email.",
  });
}

describe("dotFilingTask", () => {
  it("uses a stable notes marker per case", () => {
    expect(dotFilingTaskNotesMarker(CASE_ID)).toBe(`dot_filing_queue:${CASE_ID}`);
  });

  it("builds title from company name", () => {
    expect(buildDotFilingTaskTitle(baseIntake())).toBe("DOT filing: Acme Air");
  });

  it("builds stable completed timeline id", () => {
    expect(dotFilingTaskCompletedTimelineId("task-1")).toBe("dot_filing_task_done:task-1");
  });

  it("detects DOT filing records and confirmation", () => {
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
        destination: "USDOT / aviation consumer",
        filed_at: "2026-01-02",
        confirmation_number: null,
        filing_url: null,
        notes: null,
        created_at: "2026-01-02T00:00:00.000Z",
        updated_at: "2026-01-02T00:00:00.000Z",
      },
    ];
    expect(hasDotFilingRecord(filings)).toBe(true);
    expect(hasDotFilingWithConfirmation(filings)).toBe(false);
    expect(
      hasDotFilingWithConfirmation([{ ...filings[1]!, confirmation_number: "dot-123" }])
    ).toBe(true);
  });

  it("builds notes with evidence inventory and complaint draft", () => {
    const notes = buildDotFilingTaskNotes(CASE_ID, baseIntake(), [
      { title: "Boarding pass", evidence_type: "screenshot", evidence_date: "2026-01-09" },
    ]);
    expect(notes.startsWith(`dot_filing_queue:${CASE_ID}\n`)).toBe(true);
    expect(notes).toContain(`case_id: ${CASE_ID}`);
    expect(notes).toContain("company: Acme Air");
    expect(notes).toContain("evidence:");
    expect(notes).toContain("1. [screenshot] Boarding pass (2026-01-09)");
    expect(notes).toContain("draft:");
    expect(notes).toContain("DRAFT FOR USDOT / AVIATION CONSUMER COMPLAINT");
    expect(notes).toContain("Airline canceled my flight");
  });

  it("formats empty evidence inventory", () => {
    expect(buildDotEvidenceInventory([])).toBe("(no saved evidence rows on this case yet)");
  });

  it("matches marker-only and structured notes", () => {
    const marker = dotFilingTaskNotesMarker(CASE_ID);
    expect(taskNotesMatchDotFilingMarker(marker, CASE_ID)).toBe(true);
    expect(taskNotesMatchDotFilingMarker(`${marker}\ncase_id: ${CASE_ID}`, CASE_ID)).toBe(true);
    expect(taskNotesMatchDotFilingMarker("other task", CASE_ID)).toBe(false);
  });

  it("parses draft body from task notes", () => {
    const notes = buildDotFilingTaskNotes(CASE_ID, baseIntake());
    const draft = parseDotFilingTaskDraft(notes);
    expect(draft.length).toBeGreaterThan(0);
    expect(draft).toContain("Acme Air");
  });

  it("finds open DOT filing task", () => {
    const marker = dotFilingTaskNotesMarker(CASE_ID);
    const tasks: JusticeCaseTaskRow[] = [
      {
        id: "task-1",
        user_id: "user",
        case_id: CASE_ID,
        title: "DOT filing: Acme Air",
        due_date: null,
        notes: `${marker}\ncase_id: ${CASE_ID}`,
        completed_at: null,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      },
    ];
    expect(findOpenDotFilingTask(tasks, CASE_ID)?.id).toBe("task-1");
    expect(
      findOpenDotFilingTask([{ ...tasks[0]!, completed_at: "2026-01-02T00:00:00.000Z" }], CASE_ID)
    ).toBeUndefined();
  });

  it("shouldQueueDotFilingTask when packet approved and next action is DOT", () => {
    expect(
      shouldQueueDotFilingTask({
        prepared_packet_approved: true,
        approved_next_action: {
          label: "USDOT / aviation consumer",
          href: "/justice/dot",
          status: "approved",
        },
      })
    ).toBe(true);
    expect(
      shouldQueueDotFilingTask({
        prepared_packet_approved: true,
        approved_next_action: {
          label: "FCC",
          href: "/justice/fcc",
          status: "approved",
        },
      })
    ).toBe(false);
    expect(
      shouldQueueDotFilingTask({
        prepared_packet_approved: false,
        approved_next_action: {
          label: "USDOT / aviation consumer",
          href: "/justice/dot",
          status: "approved",
        },
      })
    ).toBe(false);
  });
});

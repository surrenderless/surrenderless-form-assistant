import { describe, expect, it } from "vitest";
import { defaultBuildJusticeIntakeParts } from "@/lib/justice/buildJusticeIntake";
import { buildJusticeIntakeFromParts } from "@/lib/justice/buildJusticeIntake";
import {
  buildDemandLetterFilingTaskNotes,
  buildDemandLetterFilingTaskTitle,
  demandLetterFilingTaskNotesMarker,
  findOpenDemandLetterFilingTask,
  parseDemandLetterFilingTaskDraft,
  shouldQueueDemandLetterFilingTask,
  taskNotesMatchDemandLetterFilingMarker,
} from "@/lib/justice/demandLetterFilingTask";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";

const CASE_ID = "550e8400-e29b-41d4-a716-446655440000";

function baseIntake() {
  return buildJusticeIntakeFromParts({
    ...defaultBuildJusticeIntakeParts(),
    company_name: "Acme Retail",
    user_display_name: "Jordan Lee",
    reply_email: "e2e@example.com",
    story: "Double charge on widget order.",
    already_contacted: "yes",
    contact_method: "email",
    contact_date: "2026-01-15",
    merchant_response_type: "refused_help",
    contact_proof_type: "paste",
    contact_proof_text: "Refused refund by email.",
  });
}

describe("demandLetterFilingTask", () => {
  it("uses a stable notes marker per case", () => {
    expect(demandLetterFilingTaskNotesMarker(CASE_ID)).toBe(
      `demand_letter_filing_queue:${CASE_ID}`
    );
  });

  it("builds title from company name", () => {
    expect(buildDemandLetterFilingTaskTitle(baseIntake())).toBe("Demand letter: Acme Retail");
  });

  it("builds notes with case id, company, and draft only", () => {
    const notes = buildDemandLetterFilingTaskNotes(CASE_ID, baseIntake());
    expect(notes.startsWith(`demand_letter_filing_queue:${CASE_ID}\n`)).toBe(true);
    expect(notes).toContain(`case_id: ${CASE_ID}`);
    expect(notes).toContain("company: Acme Retail");
    expect(notes).toContain("draft:");
    expect(notes).toContain("DRAFT DEMAND LETTER");
    expect(notes).toContain("Double charge on widget order.");
  });

  it("matches marker-only and structured notes", () => {
    const marker = demandLetterFilingTaskNotesMarker(CASE_ID);
    expect(taskNotesMatchDemandLetterFilingMarker(marker, CASE_ID)).toBe(true);
    expect(taskNotesMatchDemandLetterFilingMarker(`${marker}\ncase_id: ${CASE_ID}`, CASE_ID)).toBe(
      true
    );
    expect(taskNotesMatchDemandLetterFilingMarker("other task", CASE_ID)).toBe(false);
  });

  it("parses draft body from task notes", () => {
    const notes = buildDemandLetterFilingTaskNotes(CASE_ID, baseIntake());
    const draft = parseDemandLetterFilingTaskDraft(notes);
    expect(draft).toContain("DRAFT DEMAND LETTER");
    expect(draft).toContain("Acme Retail");
  });

  it("finds open demand letter filing task", () => {
    const marker = demandLetterFilingTaskNotesMarker(CASE_ID);
    const tasks: JusticeCaseTaskRow[] = [
      {
        id: "task-dl-1",
        user_id: "user",
        case_id: CASE_ID,
        title: "Demand letter: Acme Retail",
        due_date: null,
        notes: `${marker}\ncase_id: ${CASE_ID}`,
        completed_at: null,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      },
    ];
    expect(findOpenDemandLetterFilingTask(tasks, CASE_ID)?.id).toBe("task-dl-1");
    expect(
      findOpenDemandLetterFilingTask(
        [{ ...tasks[0]!, completed_at: "2026-01-02T00:00:00.000Z" }],
        CASE_ID
      )
    ).toBeUndefined();
  });

  it("shouldQueueDemandLetterFilingTask when packet approved and next action is demand letter", () => {
    expect(
      shouldQueueDemandLetterFilingTask({
        prepared_packet_approved: true,
        approved_next_action: {
          label: "Small claims / demand letter",
          href: "/justice/demand-letter",
          status: "approved",
        },
      })
    ).toBe(true);
    expect(
      shouldQueueDemandLetterFilingTask({
        prepared_packet_approved: true,
        approved_next_action: {
          label: "State Attorney General (consumer)",
          href: "/justice/state-ag",
          status: "approved",
        },
      })
    ).toBe(false);
    expect(
      shouldQueueDemandLetterFilingTask({
        prepared_packet_approved: false,
        approved_next_action: {
          label: "Small claims / demand letter",
          href: "/justice/demand-letter",
          status: "approved",
        },
      })
    ).toBe(false);
  });
});

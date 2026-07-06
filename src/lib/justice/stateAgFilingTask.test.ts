import { describe, expect, it } from "vitest";
import { defaultBuildJusticeIntakeParts } from "@/lib/justice/buildJusticeIntake";
import { buildJusticeIntakeFromParts } from "@/lib/justice/buildJusticeIntake";
import {
  buildStateAgFilingTaskNotes,
  buildStateAgFilingTaskTitle,
  findOpenStateAgFilingTask,
  parseStateAgFilingTaskDraft,
  shouldQueueStateAgFilingTask,
  stateAgFilingTaskNotesMarker,
  taskNotesMatchStateAgFilingMarker,
} from "@/lib/justice/stateAgFilingTask";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";

const CASE_ID = "550e8400-e29b-41d4-a716-446655440000";

function baseIntake() {
  return buildJusticeIntakeFromParts({
    ...defaultBuildJusticeIntakeParts(),
    company_name: "Acme Retail",
    consumer_us_state: "CA",
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

describe("stateAgFilingTask", () => {
  it("uses a stable notes marker per case", () => {
    expect(stateAgFilingTaskNotesMarker(CASE_ID)).toBe(`state_ag_filing_queue:${CASE_ID}`);
  });

  it("builds title from company name", () => {
    expect(buildStateAgFilingTaskTitle(baseIntake())).toBe("State AG filing: Acme Retail");
  });

  it("builds notes with case id, state, company, and draft only", () => {
    const notes = buildStateAgFilingTaskNotes(CASE_ID, baseIntake());
    expect(notes.startsWith(`state_ag_filing_queue:${CASE_ID}\n`)).toBe(true);
    expect(notes).toContain(`case_id: ${CASE_ID}`);
    expect(notes).toContain("consumer_us_state: CA");
    expect(notes).toContain("company: Acme Retail");
    expect(notes).toContain("draft:");
    expect(notes).toContain("Acme Retail");
    expect(notes).toContain("Double charge on widget order.");
  });

  it("matches marker-only and structured notes", () => {
    const marker = stateAgFilingTaskNotesMarker(CASE_ID);
    expect(taskNotesMatchStateAgFilingMarker(marker, CASE_ID)).toBe(true);
    expect(taskNotesMatchStateAgFilingMarker(`${marker}\ncase_id: ${CASE_ID}`, CASE_ID)).toBe(true);
    expect(taskNotesMatchStateAgFilingMarker("other task", CASE_ID)).toBe(false);
  });

  it("parses draft body from task notes", () => {
    const notes = buildStateAgFilingTaskNotes(CASE_ID, baseIntake());
    const draft = parseStateAgFilingTaskDraft(notes);
    expect(draft).toContain("DRAFT FOR STATE ATTORNEY GENERAL");
    expect(draft).toContain("Acme Retail");
  });

  it("finds open State AG filing task", () => {
    const marker = stateAgFilingTaskNotesMarker(CASE_ID);
    const tasks: JusticeCaseTaskRow[] = [
      {
        id: "task-1",
        user_id: "user",
        case_id: CASE_ID,
        title: "State AG filing: Acme Retail",
        due_date: null,
        notes: `${marker}\ncase_id: ${CASE_ID}`,
        completed_at: null,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      },
    ];
    expect(findOpenStateAgFilingTask(tasks, CASE_ID)?.id).toBe("task-1");
    expect(
      findOpenStateAgFilingTask(
        [{ ...tasks[0]!, completed_at: "2026-01-02T00:00:00.000Z" }],
        CASE_ID
      )
    ).toBeUndefined();
  });

  it("shouldQueueStateAgFilingTask when packet approved and next action is State AG", () => {
    expect(
      shouldQueueStateAgFilingTask({
        prepared_packet_approved: true,
        approved_next_action: {
          label: "State Attorney General (consumer)",
          href: "/justice/state-ag",
          status: "approved",
        },
      })
    ).toBe(true);
    expect(
      shouldQueueStateAgFilingTask({
        prepared_packet_approved: true,
        approved_next_action: {
          label: "Better Business Bureau",
          href: "/justice/bbb",
          status: "approved",
        },
      })
    ).toBe(false);
    expect(
      shouldQueueStateAgFilingTask({
        prepared_packet_approved: false,
        approved_next_action: {
          label: "State Attorney General (consumer)",
          href: "/justice/state-ag",
          status: "approved",
        },
      })
    ).toBe(false);
  });
});

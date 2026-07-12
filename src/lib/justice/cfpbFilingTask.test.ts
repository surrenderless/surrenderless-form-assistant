import { describe, expect, it } from "vitest";
import { defaultBuildJusticeIntakeParts } from "@/lib/justice/buildJusticeIntake";
import { buildJusticeIntakeFromParts } from "@/lib/justice/buildJusticeIntake";
import {
  buildCfpbFilingTaskNotes,
  buildCfpbFilingTaskTitle,
  cfpbFilingTaskCompletedTimelineId,
  cfpbFilingTaskNotesMarker,
  findOpenCfpbFilingTask,
  hasCfpbFilingRecord,
  hasCfpbFilingWithConfirmation,
  parseCfpbFilingTaskDraft,
  shouldQueueCfpbFilingTask,
  taskNotesMatchCfpbFilingMarker,
} from "@/lib/justice/cfpbFilingTask";
import type { JusticeCaseFilingRow } from "@/lib/justice/filings";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";

const CASE_ID = "550e8400-e29b-41d4-a716-446655440000";

function baseIntake() {
  return buildJusticeIntakeFromParts({
    ...defaultBuildJusticeIntakeParts(),
    problem_category: "financial_account_issue",
    company_name: "Acme Bank",
    consumer_us_state: "CA",
    user_display_name: "Jordan Lee",
    reply_email: "e2e@example.com",
    story: "Unauthorized fee on checking account.",
    already_contacted: "yes",
    contact_method: "email",
    contact_date: "2026-01-15",
    merchant_response_type: "refused_help",
    contact_proof_type: "paste",
    contact_proof_text: "Refused refund by email.",
  });
}

describe("cfpbFilingTask", () => {
  it("uses a stable notes marker per case", () => {
    expect(cfpbFilingTaskNotesMarker(CASE_ID)).toBe(`cfpb_filing_queue:${CASE_ID}`);
  });

  it("builds title from company name", () => {
    expect(buildCfpbFilingTaskTitle(baseIntake())).toBe("CFPB filing: Acme Bank");
  });

  it("builds stable completed timeline id", () => {
    expect(cfpbFilingTaskCompletedTimelineId("task-1")).toBe("cfpb_filing_task_done:task-1");
  });

  it("detects CFPB filing records and confirmation", () => {
    const filings: JusticeCaseFilingRow[] = [
      {
        id: "fil-1",
        user_id: "user",
        case_id: CASE_ID,
        destination: "Better Business Bureau",
        filed_at: "2026-01-01",
        confirmation_number: "bbb-1",
        filing_url: null,
        notes: null,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "fil-2",
        user_id: "user",
        case_id: CASE_ID,
        destination: "CFPB",
        filed_at: "2026-01-02",
        confirmation_number: null,
        filing_url: null,
        notes: null,
        created_at: "2026-01-02T00:00:00.000Z",
        updated_at: "2026-01-02T00:00:00.000Z",
      },
    ];
    expect(hasCfpbFilingRecord(filings)).toBe(true);
    expect(hasCfpbFilingWithConfirmation(filings)).toBe(false);
    expect(
      hasCfpbFilingWithConfirmation([{ ...filings[1]!, confirmation_number: "cfpb-123" }])
    ).toBe(true);
  });

  it("builds notes with case id, company, and draft only", () => {
    const notes = buildCfpbFilingTaskNotes(CASE_ID, baseIntake());
    expect(notes.startsWith(`cfpb_filing_queue:${CASE_ID}\n`)).toBe(true);
    expect(notes).toContain(`case_id: ${CASE_ID}`);
    expect(notes).toContain("company: Acme Bank");
    expect(notes).toContain("draft:");
    expect(notes).toContain("Acme Bank");
    expect(notes).toContain("Unauthorized fee on checking account.");
  });

  it("matches marker-only and structured notes", () => {
    const marker = cfpbFilingTaskNotesMarker(CASE_ID);
    expect(taskNotesMatchCfpbFilingMarker(marker, CASE_ID)).toBe(true);
    expect(taskNotesMatchCfpbFilingMarker(`${marker}\ncase_id: ${CASE_ID}`, CASE_ID)).toBe(true);
    expect(taskNotesMatchCfpbFilingMarker("other task", CASE_ID)).toBe(false);
  });

  it("parses draft body from task notes", () => {
    const notes = buildCfpbFilingTaskNotes(CASE_ID, baseIntake());
    const draft = parseCfpbFilingTaskDraft(notes);
    expect(draft.length).toBeGreaterThan(0);
    expect(draft).toContain("Acme Bank");
  });

  it("finds open CFPB filing task", () => {
    const marker = cfpbFilingTaskNotesMarker(CASE_ID);
    const tasks: JusticeCaseTaskRow[] = [
      {
        id: "task-1",
        user_id: "user",
        case_id: CASE_ID,
        title: "CFPB filing: Acme Bank",
        due_date: null,
        notes: `${marker}\ncase_id: ${CASE_ID}`,
        completed_at: null,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      },
    ];
    expect(findOpenCfpbFilingTask(tasks, CASE_ID)?.id).toBe("task-1");
    expect(
      findOpenCfpbFilingTask([{ ...tasks[0]!, completed_at: "2026-01-02T00:00:00.000Z" }], CASE_ID)
    ).toBeUndefined();
  });

  it("shouldQueueCfpbFilingTask when packet approved and next action is CFPB", () => {
    expect(
      shouldQueueCfpbFilingTask({
        prepared_packet_approved: true,
        approved_next_action: {
          label: "CFPB",
          href: "/justice/cfpb",
          status: "approved",
        },
      })
    ).toBe(true);
    expect(
      shouldQueueCfpbFilingTask({
        prepared_packet_approved: true,
        approved_next_action: {
          label: "Better Business Bureau",
          href: "/justice/bbb",
          status: "approved",
        },
      })
    ).toBe(false);
    expect(
      shouldQueueCfpbFilingTask({
        prepared_packet_approved: false,
        approved_next_action: {
          label: "CFPB",
          href: "/justice/cfpb",
          status: "approved",
        },
      })
    ).toBe(false);
  });
});

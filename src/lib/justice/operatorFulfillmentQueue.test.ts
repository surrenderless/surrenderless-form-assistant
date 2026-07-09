import { describe, expect, it } from "vitest";
import {
  parseDemandLetterFilingTaskDraft,
  taskNotesMatchDemandLetterFilingMarker,
} from "@/lib/justice/demandLetterFilingTask";
import {
  parseStateAgFilingTaskDraft,
  taskNotesMatchStateAgFilingMarker,
} from "@/lib/justice/stateAgFilingTask";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";
import type { JusticeIntake } from "@/lib/justice/types";

describe("operatorFulfillmentQueue markers", () => {
  const CASE_ID = "550e8400-e29b-41d4-a716-446655440000";

  const intake: JusticeIntake = {
    problem_category: "online_purchase",
    company_name: "Acme Retail",
    company_website: "",
    purchase_or_signup: "widget",
    story: "Test",
    money_involved: "$10",
    pay_or_order_date: "",
    order_confirmation_details: "",
    user_display_name: "Jordan",
    reply_email: "test@example.com",
    already_contacted: "no",
    consumer_us_state: "CA",
  };

  it("recognizes State AG operator task notes", () => {
    const notes = `state_ag_filing_queue:${CASE_ID}\ncase_id: ${CASE_ID}\ndraft:\nComplaint body`;
    expect(taskNotesMatchStateAgFilingMarker(notes, CASE_ID)).toBe(true);
    expect(parseStateAgFilingTaskDraft(notes)).toBe("Complaint body");
  });

  it("recognizes demand letter operator task notes", () => {
    const notes = `demand_letter_filing_queue:${CASE_ID}\ncase_id: ${CASE_ID}\ndraft:\nLetter body`;
    expect(taskNotesMatchDemandLetterFilingMarker(notes, CASE_ID)).toBe(true);
    expect(parseDemandLetterFilingTaskDraft(notes)).toBe("Letter body");
  });

  it("ignores unrelated open tasks", () => {
    const task: JusticeCaseTaskRow = {
      id: "task-1",
      user_id: "user_1",
      case_id: CASE_ID,
      title: "Follow up merchant",
      due_date: null,
      notes: "manual follow up",
      completed_at: null,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    };
    expect(taskNotesMatchStateAgFilingMarker(task.notes, CASE_ID)).toBe(false);
    expect(taskNotesMatchDemandLetterFilingMarker(task.notes, CASE_ID)).toBe(false);
    expect(intake.company_name).toBe("Acme Retail");
  });
});

import { describe, expect, it } from "vitest";
import { buildJusticeIntakeFromParts, defaultBuildJusticeIntakeParts } from "@/lib/justice/buildJusticeIntake";
import {
  buildNoResponseOutcomeNote,
  caseHasConfirmedResolution,
  isOpenFollowUpTaskDue,
  NO_RESPONSE_OUTCOME_MARKER,
  outcomeNoteAlreadyRecordsNoResponse,
  planDueFollowUpClientState,
} from "@/lib/justice/processDueFollowUps";
import type { JusticeApprovedNextAction } from "@/lib/justice/types";

function intake(overrides: Record<string, unknown> = {}) {
  return buildJusticeIntakeFromParts({
    ...defaultBuildJusticeIntakeParts(),
    problem_category: "online_purchase",
    company_name: "Acme Retail",
    purchase_or_signup: "widget",
    story: "Widget never arrived.",
    money_amount: "$80",
    pay_or_order_date: "2026-01-10",
    already_contacted: "yes",
    contact_method: "email",
    contact_date: "2026-01-15",
    merchant_response_type: "refused_help",
    user_display_name: "Jordan Lee",
    reply_email: "e2e@example.com",
    consumer_us_state: "CA",
    ...overrides,
  });
}

describe("isOpenFollowUpTaskDue", () => {
  const now = new Date("2026-07-15T16:00:00.000Z");

  it("is due when task due_date is today or earlier", () => {
    expect(
      isOpenFollowUpTaskDue({
        task: { due_date: "2026-07-15", completed_at: null },
        now,
      })
    ).toBe(true);
    expect(
      isOpenFollowUpTaskDue({
        task: { due_date: "2026-07-10", completed_at: null },
        now,
      })
    ).toBe(true);
  });

  it("is not due when upcoming or already completed", () => {
    expect(
      isOpenFollowUpTaskDue({
        task: { due_date: "2026-08-01", completed_at: null },
        now,
      })
    ).toBe(false);
    expect(
      isOpenFollowUpTaskDue({
        task: { due_date: "2026-07-10", completed_at: "2026-07-11T00:00:00.000Z" },
        now,
      })
    ).toBe(false);
  });

  it("falls back to follow_up_at when task has no due_date", () => {
    expect(
      isOpenFollowUpTaskDue({
        task: { due_date: null, completed_at: null },
        followUpAt: "2026-07-01T12:00:00.000Z",
        now,
      })
    ).toBe(true);
    expect(
      isOpenFollowUpTaskDue({
        task: { due_date: null, completed_at: null },
        followUpAt: "2026-08-01T12:00:00.000Z",
        now,
      })
    ).toBe(false);
  });
});

describe("resolution and no-response notes", () => {
  it("detects confirmed resolution from intake merchant_response_type", () => {
    expect(
      caseHasConfirmedResolution(intake({ merchant_response_type: "resolved" }), {
        label: "Demand letter",
        href: "/justice/demand-letter",
        status: "completed",
        follow_up_needed: true,
      })
    ).toBe(true);
    expect(
      caseHasConfirmedResolution(intake(), {
        label: "Demand letter",
        href: "/justice/demand-letter",
        status: "completed",
        follow_up_needed: true,
        outcome_note: "Awaiting responses.",
      })
    ).toBe(false);
  });

  it("builds idempotent no-response outcome notes without claiming resolved", () => {
    const note = buildNoResponseOutcomeNote("Awaiting BBB/merchant response.", "2026-07-01T12:00:00.000Z");
    expect(note).toContain(NO_RESPONSE_OUTCOME_MARKER);
    expect(note.toLowerCase()).not.toMatch(/\b(case resolved|marking case resolved)\b/);
    expect(note.toLowerCase()).toContain("no automatic resolution");
    expect(outcomeNoteAlreadyRecordsNoResponse(note)).toBe(true);
    expect(buildNoResponseOutcomeNote(note, "2026-07-01T12:00:00.000Z")).toBe(note);
  });
});

describe("planDueFollowUpClientState", () => {
  it("advances to the next approved escalation when one exists after BBB wait", () => {
    const clientState = {
      prepared_packet_approved: true,
      approved_next_action: {
        label: "Better Business Bureau",
        href: "/justice/bbb",
        status: "completed",
        completed_at: "2026-05-01T00:00:00.000Z",
        follow_up_needed: true,
        follow_up_at: "2026-06-15T12:00:00.000Z",
        outcome_note: "BBB filing recorded. Awaiting response.",
      } satisfies JusticeApprovedNextAction,
    };
    const plan = planDueFollowUpClientState({ intake: intake(), clientState });
    expect(plan.kind).toBe("advanced");
    if (plan.kind !== "advanced") return;
    expect(plan.nextAction.href).toBeTruthy();
    expect(plan.nextAction.href).not.toBe("/justice/bbb");
    expect(plan.nextAction.status).toBe("approved");
    expect(plan.nextAction.follow_up_needed).not.toBe(true);
    const next = (plan.clientState.approved_next_action ?? {}) as JusticeApprovedNextAction;
    expect(next.follow_up_needed).not.toBe(true);
  });

  it("creates terminal response-review plan when ladder is complete", () => {
    const clientState = {
      prepared_packet_approved: true,
      approved_next_action: {
        label: "Small claims / demand letter",
        href: "/justice/demand-letter",
        status: "completed",
        completed_at: "2026-06-01T00:00:00.000Z",
        follow_up_needed: true,
        follow_up_at: "2026-07-01T12:00:00.000Z",
        outcome_note: "Escalation complete. Awaiting responses.",
        handling_requested_at: "2026-06-01T00:00:00.000Z",
      } satisfies JusticeApprovedNextAction,
    };
    const plan = planDueFollowUpClientState({ intake: intake(), clientState });
    expect(plan.kind).toBe("terminal_response_review");
    if (plan.kind !== "terminal_response_review") return;
    expect(plan.nextAction.follow_up_needed).toBe(false);
    expect(plan.nextAction.outcome_note).toContain(NO_RESPONSE_OUTCOME_MARKER);
    expect(plan.nextAction.status).toBe("completed");
  });

  it("skips resolved cases without planning advancement", () => {
    const plan = planDueFollowUpClientState({
      intake: intake({ merchant_response_type: "resolved" }),
      clientState: {
        prepared_packet_approved: true,
        approved_next_action: {
          label: "Demand letter",
          href: "/justice/demand-letter",
          status: "completed",
          follow_up_needed: true,
          follow_up_at: "2026-07-01T12:00:00.000Z",
        },
      },
    });
    expect(plan).toEqual({ kind: "skip", reason: "resolved" });
  });

  it("skips when follow-up is no longer needed", () => {
    const plan = planDueFollowUpClientState({
      intake: intake(),
      clientState: {
        approved_next_action: {
          label: "Demand letter",
          href: "/justice/demand-letter",
          status: "completed",
          follow_up_needed: false,
        },
      },
    });
    expect(plan).toEqual({ kind: "skip", reason: "follow_up_not_needed" });
  });
});

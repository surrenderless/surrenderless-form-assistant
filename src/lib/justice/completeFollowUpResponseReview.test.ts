import { describe, expect, it } from "vitest";
import { buildJusticeIntakeFromParts, defaultBuildJusticeIntakeParts } from "@/lib/justice/buildJusticeIntake";
import {
  OPERATOR_NO_RESOLUTION_OUTCOME_MARKER,
  OPERATOR_RESOLVED_OUTCOME_MARKER,
  planFollowUpResponseReviewClientState,
} from "@/lib/justice/completeFollowUpResponseReview";
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

const terminalAction: JusticeApprovedNextAction = {
  label: "Small claims / demand letter",
  href: "/justice/demand-letter",
  status: "completed",
  completed_at: "2026-06-01T00:00:00.000Z",
  follow_up_needed: false,
  outcome_note: "No response recorded by follow-up date.",
  handling_requested_at: "2026-06-01T00:00:00.000Z",
};

describe("planFollowUpResponseReviewClientState", () => {
  it("records resolved outcome without archiving and clears follow-up", () => {
    const plan = planFollowUpResponseReviewClientState({
      intake: intake(),
      clientState: {
        prepared_packet_approved: true,
        approved_next_action: terminalAction,
      },
      outcome: "resolved",
      operatorNotes: "Refund confirmed by bank.",
    });
    expect(plan.kind).toBe("ok");
    if (plan.kind !== "ok") return;
    expect(plan.advanced).toBe(false);
    expect(plan.intake.merchant_response_type).toBe("resolved");
    expect(plan.nextAction.follow_up_needed).toBe(false);
    expect(plan.nextAction.outcome_note).toContain(OPERATOR_RESOLVED_OUTCOME_MARKER);
    expect(plan.nextAction.outcome_note).toContain("Refund confirmed by bank.");
    expect(plan.nextAction.handling_acknowledged_at).toBeTruthy();
    expect(plan.clientState).not.toHaveProperty("archived_at");
  });

  it("records no resolution without marking intake resolved or archiving", () => {
    const plan = planFollowUpResponseReviewClientState({
      intake: intake(),
      clientState: {
        prepared_packet_approved: true,
        approved_next_action: terminalAction,
      },
      outcome: "no_resolution",
    });
    expect(plan.kind).toBe("ok");
    if (plan.kind !== "ok") return;
    expect(plan.intake.merchant_response_type).toBe("refused_help");
    expect(plan.nextAction.outcome_note).toContain(OPERATOR_NO_RESOLUTION_OUTCOME_MARKER);
    expect(plan.nextAction.follow_up_needed).toBe(false);
    expect(plan.advanced).toBe(false);
  });

  it("advances to the next escalation when further escalation is available after BBB", () => {
    const plan = planFollowUpResponseReviewClientState({
      intake: intake(),
      clientState: {
        prepared_packet_approved: true,
        approved_next_action: {
          label: "Better Business Bureau",
          href: "/justice/bbb",
          status: "completed",
          completed_at: "2026-05-01T00:00:00.000Z",
          follow_up_needed: false,
          outcome_note: "No response recorded by follow-up date.",
        },
      },
      outcome: "further_escalation",
    });
    expect(plan.kind).toBe("ok");
    if (plan.kind !== "ok") return;
    expect(plan.advanced).toBe(true);
    expect(plan.nextAction.href).toBeTruthy();
    expect(plan.nextAction.href).not.toBe("/justice/bbb");
    expect(plan.nextAction.status).toBe("approved");
    expect(plan.nextAction.follow_up_needed).not.toBe(true);
    expect(plan.intake.merchant_response_type).not.toBe("resolved");
  });

  it("errors when further escalation is requested at a terminal ladder step", () => {
    const plan = planFollowUpResponseReviewClientState({
      intake: intake(),
      clientState: {
        prepared_packet_approved: true,
        approved_next_action: terminalAction,
      },
      outcome: "further_escalation",
    });
    expect(plan).toEqual({
      kind: "error",
      error: "No further escalation step is available for this case",
      status: 400,
    });
  });
});

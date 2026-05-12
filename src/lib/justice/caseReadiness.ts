import type { JusticeIntake } from "@/lib/justice/types";

/**
 * Whether intake has the fields we treat as “ready to escalate” basics:
 * company, issue category, product/service, what happened, and requested resolution.
 * There is no separate resolution field on intake; `money_involved` holds the money/remedy ask used here.
 */
export function isBasicCaseInfoReadyForEscalation(intake: JusticeIntake): boolean {
  return (
    intake.company_name.trim().length > 0 &&
    Boolean(intake.problem_category) &&
    intake.purchase_or_signup.trim().length > 0 &&
    intake.story.trim().length > 0 &&
    intake.money_involved.trim().length > 0
  );
}

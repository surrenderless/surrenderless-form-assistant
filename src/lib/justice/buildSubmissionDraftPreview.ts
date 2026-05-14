import type { DestinationId, JusticeIntake, ProblemCategory } from "@/lib/justice/types";

export type SubmissionDraftEvidenceLine = {
  title: string;
};

export type BuildSubmissionDraftPreviewInput = {
  intake: JusticeIntake;
  destinationId: DestinationId;
  destinationLabel: string;
  evidenceLines: SubmissionDraftEvidenceLine[];
};

function problemCategoryLabel(cat: ProblemCategory): string {
  return cat.replace(/_/g, " ");
}

function contactSummary(intake: JusticeIntake): string[] {
  if (intake.already_contacted !== "yes") {
    return ["Prior contact with the company: No (not recorded as contacted yet)."];
  }
  const lines = [
    "Prior contact with the company: Yes.",
    intake.contact_method
      ? `  How you contacted them: ${intake.contact_method.replace(/_/g, " ")}`
      : "",
    intake.contact_date?.trim() ? `  When: ${intake.contact_date.trim()}` : "",
    intake.merchant_response_type
      ? `  Their response (as you recorded it): ${intake.merchant_response_type.replace(/_/g, " ")}`
      : "",
  ];
  if (intake.contact_proof_text?.trim()) {
    lines.push(`  Proof / details: ${intake.contact_proof_text.trim()}`);
  }
  return lines.filter(Boolean);
}

/**
 * Deterministic plain-text draft for in-app review only (not filed, not legal advice).
 */
export function buildSubmissionDraftPreview(input: BuildSubmissionDraftPreviewInput): string {
  const { intake, destinationId, destinationLabel, evidenceLines } = input;
  const lines: string[] = [];

  lines.push("DRAFT FOR YOUR REVIEW (NOT FILED)");
  lines.push("===================================");
  lines.push("");
  lines.push(
    "This draft is generated only to help you review your case inside Surrenderless. It is not legal advice. It has not been submitted to any government agency, company, or court."
  );
  lines.push("");
  lines.push(`RELATED ACTION: ${destinationLabel}`);
  lines.push(`(Destination id: ${destinationId})`);
  lines.push("");
  lines.push("---", "CONSUMER", "---");
  lines.push(`Name: ${intake.user_display_name.trim() || "—"}`);
  lines.push(`Reply email: ${intake.reply_email.trim() || "—"}`);
  if (intake.consumer_us_state?.trim()) {
    lines.push(`State (if noted): ${intake.consumer_us_state.trim().toUpperCase()}`);
  }
  lines.push("");
  lines.push("---", "COMPANY / ISSUE", "---");
  lines.push(`Company: ${intake.company_name.trim() || "—"}`);
  lines.push(`Website: ${intake.company_website.trim() || "—"}`);
  lines.push(`Issue category: ${problemCategoryLabel(intake.problem_category)}`);
  lines.push(`Product or service: ${intake.purchase_or_signup.trim() || "—"}`);
  if (intake.order_confirmation_details.trim()) {
    lines.push(`Order / confirmation details: ${intake.order_confirmation_details.trim()}`);
  }
  lines.push(`Order or problem date: ${intake.pay_or_order_date.trim() || "—"}`);
  lines.push(`Money involved / remedy sought: ${intake.money_involved.trim() || "—"}`);
  lines.push("");
  lines.push("---", "WHAT HAPPENED", "---");
  lines.push(intake.story.trim() || "(No story text provided.)");
  lines.push("");
  lines.push("---", "CONTACT STATUS", "---");
  lines.push(...contactSummary(intake));
  lines.push("");
  lines.push("---", "SAVED EVIDENCE (titles only)", "---");
  if (evidenceLines.length === 0) {
    lines.push("(No saved evidence records in Surrenderless yet — you can add notes on the Evidence page.)");
  } else {
    evidenceLines.forEach((e, i) => {
      lines.push(`${i + 1}. ${e.title.trim() || "(untitled)"}`);
    });
  }
  lines.push("");
  lines.push(
    "---",
    "NEXT STEPS",
    "---",
    "When you file outside Surrenderless, use only official sites and your own judgment. This draft is for your records and preparation only."
  );

  return lines.join("\n").trim();
}

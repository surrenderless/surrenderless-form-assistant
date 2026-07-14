import type { BuildJusticeIntakeParts } from "@/lib/justice/buildJusticeIntake";

export function cloneBuildJusticeIntakeParts(parts: BuildJusticeIntakeParts): BuildJusticeIntakeParts {
  return { ...parts };
}

export type SummarizeSessionChangesInput = {
  baseline: BuildJusticeIntakeParts;
  current: BuildJusticeIntakeParts;
  /** When true, append proof-note visit line (caller gates on loaded counts). */
  evidenceAddedThisVisit?: boolean;
};

function norm(value: string): string {
  return value.trim();
}

function stringFieldChanged(a: string, b: string): boolean {
  return norm(a) !== norm(b);
}

function contactFieldsChanged(baseline: BuildJusticeIntakeParts, current: BuildJusticeIntakeParts): boolean {
  if (baseline.already_contacted !== current.already_contacted) return true;
  return (
    baseline.contact_method !== current.contact_method ||
    stringFieldChanged(baseline.contact_date, current.contact_date) ||
    baseline.merchant_response_type !== current.merchant_response_type ||
    baseline.contact_proof_type !== current.contact_proof_type ||
    stringFieldChanged(baseline.contact_proof_text, current.contact_proof_text)
  );
}

function requestedOutcomeChanged(baseline: BuildJusticeIntakeParts, current: BuildJusticeIntakeParts): boolean {
  return (
    stringFieldChanged(baseline.money_amount, current.money_amount) ||
    stringFieldChanged(baseline.desired_resolution, current.desired_resolution)
  );
}

/**
 * Human-readable intake field changes between session baseline and current parts.
 */
export function summarizeBuildJusticeIntakePartsSessionChanges(
  input: SummarizeSessionChangesInput
): string[] {
  const { baseline, current } = input;
  const lines: string[] = [];

  if (stringFieldChanged(baseline.company_name, current.company_name)) {
    lines.push("Company — updated");
  }
  if (stringFieldChanged(baseline.company_website, current.company_website)) {
    lines.push("Website — updated");
  }
  if (stringFieldChanged(baseline.company_contact_email, current.company_contact_email)) {
    lines.push("Company contact email — updated");
  }
  if (stringFieldChanged(baseline.story, current.story)) {
    lines.push("What happened — updated");
  }
  if (requestedOutcomeChanged(baseline, current)) {
    lines.push("Requested outcome — updated");
  }
  if (contactFieldsChanged(baseline, current)) {
    lines.push("Contact details — updated");
  }
  if (stringFieldChanged(baseline.consumer_us_state, current.consumer_us_state)) {
    lines.push("Consumer state — updated");
  }
  if (input.evidenceAddedThisVisit) {
    lines.push("Added proof note(s) this visit");
  }

  return lines;
}

import type { DestinationId, JusticeIntake } from "@/lib/justice/types";

export type PreviewDraftAiEvidenceItem = {
  title: string;
  evidence_type?: string;
  description?: string;
  /** Omitted when unknown; `null` means explicitly none. */
  evidence_date?: string | null;
};

export type PreviewDraftAiTimelineItem = {
  type: string;
  label: string;
  ts?: string;
  detail?: string;
};

export type BuildSubmissionDraftAiPromptInput = {
  intake: JusticeIntake;
  destinationId: DestinationId;
  destinationLabel: string;
  evidenceItems: PreviewDraftAiEvidenceItem[];
  timelineItems: PreviewDraftAiTimelineItem[];
};

/**
 * Builds chat messages for an AI-assisted submission draft (server-only).
 * Caller must pass already validated/clamped structured data.
 */
export function buildSubmissionDraftAiMessages(
  input: BuildSubmissionDraftAiPromptInput
): { role: "system" | "user"; content: string }[] {
  const system = [
    "You help users prepare plain text for their own review inside Surrenderless.",
    "",
    "Hard rules:",
    "- This is NOT legal advice. Do not give legal strategy, cite specific statutes, or tell the user what a court or agency will do.",
    "- Nothing has been filed. Do not imply filing, acceptance, investigation, or agency action.",
    "- Stay faithful to the user-provided facts only. Do not invent confirmation numbers, dates, amounts, names, addresses, laws, or outcomes.",
    "- Do not invent filing status, portal logins, or government responses.",
    "- Output plain text only (no Markdown headings, no HTML, no links). Do not include URLs, especially not fake government or company portals.",
    "- If information is missing, say it is not provided rather than guessing.",
    "- Write a coherent draft the user could copy for their own records; keep a neutral, factual tone.",
  ].join("\n");

  const payload = {
    related_action: {
      destination_id: input.destinationId,
      destination_label: input.destinationLabel,
    },
    intake: input.intake,
    evidence_items: input.evidenceItems,
    timeline: input.timelineItems,
  };

  const user = [
    "Using only the JSON facts below, write a single plain-text draft titled line: AI-ASSISTED DRAFT FOR REVIEW (NOT FILED).",
    "Then briefly restate the issue and suggested narrative in the user's voice where possible, without adding facts.",
    "End with one short paragraph reminding them this is not filed, not legal advice, and they must verify everything on official channels.",
    "",
    "FACTS (JSON):",
    JSON.stringify(payload),
  ].join("\n");

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

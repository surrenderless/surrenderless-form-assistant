import {
  JUSTICE_EVIDENCE_TYPE_LABELS,
  justiceEvidenceRowHasUploadedFile,
  type JusticeCaseEvidenceRow,
  type JusticeEvidenceType,
} from "@/lib/justice/evidence";
import {
  buildPacketEvidenceFileLines,
  isPublicSupabaseStorageObjectUrl,
} from "@/lib/justice/evidenceFileAccess";
import type { JusticeCaseFilingRow } from "@/lib/justice/filings";
import type { JusticeIntake, TimelineEntry } from "@/lib/justice/types";

function formatTimelineTs(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function desiredResolutionPhrase(category: JusticeIntake["problem_category"]): string {
  switch (category) {
    case "financial_account_issue":
      return "Correction of account errors, improper charges, or clear written explanation of the issue.";
    case "online_purchase":
      return "A full refund or a correct replacement, whichever fairly applies.";
    case "subscription":
      return "Cancellation of unwanted recurring charges and any refund owed for improper renewals.";
    case "service_failed":
      return "A remedy that matches what was promised (refund, redo, or credit).";
    case "charge_dispute":
      return "Reversal of the charge or a clear written justification.";
    case "something_else":
      return "A fair resolution that puts me back to where I should have been.";
    default:
      return "A fair resolution that puts me back to where I should have been.";
  }
}

export function evidenceTypeLabel(t: string): string {
  return JUSTICE_EVIDENCE_TYPE_LABELS[t as JusticeEvidenceType] ?? t.replace(/_/g, " ");
}

function formatEvidenceAdded(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export { formatTimelineTs };

export function buildPacketPlainText(
  intake: JusticeIntake,
  timeline: TimelineEntry[],
  evidence: JusticeCaseEvidenceRow[],
  filings: JusticeCaseFilingRow[],
  caseId: string
): string {
  const lines: string[] = [
    "JUSTICE CASE PACKET",
    "====================",
    `Generated: ${new Date().toISOString()}`,
    `Case id: ${caseId}`,
    "",
    "CASE SUMMARY",
    "--------------",
    `Company: ${intake.company_name}`,
    `Website: ${intake.company_website.trim() || "—"}`,
    `Issue category: ${intake.problem_category.replace(/_/g, " ")}`,
    `Product / service: ${intake.purchase_or_signup.trim() || "—"}`,
    `Money involved: ${intake.money_involved}`,
    `Order or problem date: ${intake.pay_or_order_date}`,
    intake.order_confirmation_details.trim()
      ? `Order / confirmation details: ${intake.order_confirmation_details.trim()}`
      : "",
    `Consumer name: ${intake.user_display_name}`,
    `Reply email: ${intake.reply_email}`,
    intake.consumer_us_state?.trim()
      ? `Consumer state (if noted): ${intake.consumer_us_state.trim().toUpperCase()}`
      : "",
    `Already contacted company: ${intake.already_contacted}`,
    intake.already_contacted === "yes" && intake.contact_method
      ? `Contact method: ${intake.contact_method.replace(/_/g, " ")}`
      : "",
    intake.contact_date ? `Contact date: ${intake.contact_date}` : "",
    intake.merchant_response_type
      ? `Their response (as recorded): ${intake.merchant_response_type.replace(/_/g, " ")}`
      : "",
    "",
    "WHAT HAPPENED",
    "---------------",
    intake.story.trim(),
    "",
    "REQUESTED RESOLUTION",
    "--------------------",
    desiredResolutionPhrase(intake.problem_category),
    "",
    "TIMELINE",
    "--------",
  ];

  const sorted = [...timeline].sort((a, b) => a.ts.localeCompare(b.ts));
  if (sorted.length === 0) {
    lines.push("(No timeline events yet.)");
  } else {
    for (const row of sorted) {
      const when = formatTimelineTs(row.ts);
      const detail = row.detail?.trim();
      lines.push(`- ${when} — ${row.label}${detail ? ` — ${detail}` : ""}`);
    }
  }

  lines.push("", "SAVED EVIDENCE", "---------------");
  if (evidence.length === 0) {
    lines.push("(No saved evidence records yet.)");
  } else {
    evidence.forEach((row, i) => {
      const sourceUrl = row.source_url?.trim() ?? "";
      // Never include public storage object URLs or internal private storage keys in the packet.
      const safeSourceUrl =
        sourceUrl &&
        !isPublicSupabaseStorageObjectUrl(sourceUrl) &&
        !justiceEvidenceRowHasUploadedFile(row)
          ? sourceUrl
          : "";
      lines.push(
        `${i + 1}. ${row.title}`,
        `   Type: ${evidenceTypeLabel(row.evidence_type)}`,
        row.evidence_date ? `   Date: ${row.evidence_date}` : "",
        row.description?.trim() ? `   Description: ${row.description.trim()}` : "",
        ...buildPacketEvidenceFileLines(row),
        safeSourceUrl ? `   Source URL: ${safeSourceUrl}` : "",
        row.storage_note?.trim() ? `   Storage: ${row.storage_note.trim()}` : "",
        `   Recorded: ${formatEvidenceAdded(row.created_at)}`,
        ""
      );
    });
  }

  lines.push("", "FILING RECORDS", "---------------");
  if (filings.length === 0) {
    lines.push("(No filing records yet.)");
  } else {
    filings.forEach((row, i) => {
      lines.push(
        `${i + 1}. ${row.destination}`,
        row.filed_at ? `   Filed at: ${row.filed_at}` : "",
        row.confirmation_number ? `   Confirmation: ${row.confirmation_number}` : "",
        row.filing_url ? `   URL: ${row.filing_url}` : "",
        row.notes?.trim() ? `   Notes: ${row.notes.trim()}` : "",
        `   Recorded: ${formatEvidenceAdded(row.created_at)}`,
        ""
      );
    });
  }

  lines.push("---", "End of packet");
  return lines.filter(Boolean).join("\n").trim();
}

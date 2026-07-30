import type { JusticeCaseFilingRow } from "@/lib/justice/filings";

export type ChatConfirmedFilingSummaryLine = {
  id: string;
  destination: string;
  filedAtLabel: string | null;
  confirmationNumber: string;
};

const FALLBACK_DESTINATION_LABEL = "Filing";

function formatChatConfirmedFilingDate(filedAt: string | null | undefined): string | null {
  const trimmed = filedAt?.trim();
  if (!trimmed) return null;
  const isPlainDate = /^\d{4}-\d{2}-\d{2}$/.test(trimmed);
  const parsed = new Date(isPlainDate ? `${trimmed}T00:00:00` : trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString(undefined, { dateStyle: "medium" });
}

/**
 * Confirmed filings (those with a confirmation_number on file) mapped to the concrete record
 * a consumer needs to see: destination, filed date, and the complete confirmation number.
 * Prior to this, chat only ever showed a boolean "confirmation on file" — this is what's
 * rendered inline in ChatHandlingPersistedStatusReadOnly so consumers never have to leave chat.
 */
export function buildChatConfirmedFilingSummaryLines(
  filings: readonly JusticeCaseFilingRow[]
): ChatConfirmedFilingSummaryLine[] {
  return filings
    .filter((filing) => Boolean(filing.confirmation_number?.trim()))
    .map((filing) => ({
      id: filing.id,
      destination: filing.destination?.trim() || FALLBACK_DESTINATION_LABEL,
      filedAtLabel: formatChatConfirmedFilingDate(filing.filed_at),
      confirmationNumber: filing.confirmation_number?.trim() ?? "",
    }));
}

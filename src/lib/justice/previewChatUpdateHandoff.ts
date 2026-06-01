export const STORAGE_PREVIEW_CHAT_UPDATE_SUMMARY_V1 = "justice_preview_chat_update_summary_v1";

export type PreviewChatUpdateSummary = {
  lines: string[];
};

export function writePreviewChatUpdateSummary(lines: string[]): void {
  if (typeof window === "undefined") return;
  const trimmed = lines.map((l) => l.trim()).filter(Boolean);
  if (trimmed.length === 0) {
    clearPreviewChatUpdateSummary();
    return;
  }
  sessionStorage.setItem(
    STORAGE_PREVIEW_CHAT_UPDATE_SUMMARY_V1,
    JSON.stringify({ lines: trimmed } satisfies PreviewChatUpdateSummary)
  );
}

export function clearPreviewChatUpdateSummary(): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(STORAGE_PREVIEW_CHAT_UPDATE_SUMMARY_V1);
}

/** Reads summary lines once and removes the key so the preview card is one-time. */
export function readAndClearPreviewChatUpdateSummary(): string[] | null {
  if (typeof window === "undefined") return null;
  const raw = sessionStorage.getItem(STORAGE_PREVIEW_CHAT_UPDATE_SUMMARY_V1);
  sessionStorage.removeItem(STORAGE_PREVIEW_CHAT_UPDATE_SUMMARY_V1);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const lines = (parsed as PreviewChatUpdateSummary).lines;
    if (!Array.isArray(lines)) return null;
    const trimmed = lines.filter((l): l is string => typeof l === "string" && l.trim().length > 0);
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

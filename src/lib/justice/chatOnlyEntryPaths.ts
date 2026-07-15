/** Normal users enter justice only through chat AI intake. */
export const JUSTICE_CHAT_ONLY_ENTRY_PATH = "/justice/chat-ai" as const;

/** Legacy consumer entry URLs that must redirect to chat AI. */
export const LEGACY_JUSTICE_ENTRY_PATHS = ["/justice/chat", "/justice/intake"] as const;

export type LegacyJusticeEntryPath = (typeof LEGACY_JUSTICE_ENTRY_PATHS)[number];

export function isLegacyJusticeEntryPath(pathname: string): pathname is LegacyJusticeEntryPath {
  return (LEGACY_JUSTICE_ENTRY_PATHS as readonly string[]).includes(pathname);
}

export function legacyJusticeEntryRedirectTarget(
  pathname: string
): typeof JUSTICE_CHAT_ONLY_ENTRY_PATH | null {
  return isLegacyJusticeEntryPath(pathname) ? JUSTICE_CHAT_ONLY_ENTRY_PATH : null;
}

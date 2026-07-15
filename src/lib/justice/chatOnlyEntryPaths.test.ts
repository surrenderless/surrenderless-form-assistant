import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  JUSTICE_CHAT_ONLY_ENTRY_PATH,
  LEGACY_JUSTICE_ENTRY_PATHS,
  isLegacyJusticeEntryPath,
  legacyJusticeEntryRedirectTarget,
} from "./chatOnlyEntryPaths";

describe("chatOnlyEntryPaths", () => {
  it("routes legacy chat and intake entry paths to chat-ai only", () => {
    expect(LEGACY_JUSTICE_ENTRY_PATHS).toEqual(["/justice/chat", "/justice/intake"]);
    for (const path of LEGACY_JUSTICE_ENTRY_PATHS) {
      expect(isLegacyJusticeEntryPath(path)).toBe(true);
      expect(legacyJusticeEntryRedirectTarget(path)).toBe(JUSTICE_CHAT_ONLY_ENTRY_PATH);
    }
  });

  it("does not redirect the chat-ai entry or other justice routes", () => {
    expect(legacyJusticeEntryRedirectTarget("/justice/chat-ai")).toBeNull();
    expect(legacyJusticeEntryRedirectTarget("/justice")).toBeNull();
    expect(legacyJusticeEntryRedirectTarget("/justice/cases")).toBeNull();
    expect(isLegacyJusticeEntryPath("/justice/chat-ai")).toBe(false);
  });

  it("redirect pages and hub promote chat-ai only as entry", () => {
    const root = join(process.cwd(), "src");
    const chatPage = readFileSync(join(root, "app/justice/chat/page.tsx"), "utf8");
    const intakePage = readFileSync(join(root, "app/justice/intake/page.tsx"), "utf8");
    const hub = readFileSync(join(root, "app/justice/JusticeHubWorkspaceBody.tsx"), "utf8");
    const chatAi = readFileSync(join(root, "app/justice/chat-ai/page.tsx"), "utf8");

    expect(chatPage).toContain("JUSTICE_CHAT_ONLY_ENTRY_PATH");
    expect(chatPage).toContain("redirect(");
    expect(intakePage).toContain("JUSTICE_CHAT_ONLY_ENTRY_PATH");
    expect(intakePage).toContain("redirect(");

    expect(hub).toContain('href="/justice/chat-ai"');
    expect(hub).not.toMatch(/Use step-by-step chat|Start with form intake/);
    expect(hub).not.toContain('href="/justice/chat"');
    expect(hub).not.toContain('href="/justice/intake"');

    expect(chatAi).not.toMatch(/Prefer one question at a time|Use step-by-step chat/);
    expect(chatAi).not.toContain('href="/justice/chat"');
    expect(chatAi).not.toContain('href="/justice/intake"');
    expect(chatAi).not.toMatch(/nothing is filed automatically/i);
  });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const HUB_PAGES = [
  "bbb",
  "cfpb",
  "fcc",
  "dot",
  "state-ag",
  "demand-letter",
  "payment-dispute",
  "merchant",
  "ftc",
  "ftc-review",
  "evidence",
] as const;

const DIY_MARKERS = [
  "Manual filing required",
  "Mark BBB complaint filed",
  "Mark CFPB complaint filed",
  "Mark FCC complaint filed",
  "Mark State AG complaint filed",
  "send yourself",
  "Paste into your banking",
  "complete your complaint yourself",
  "appendBbbPrepOpenedOnce",
  "appendCfpbPrepOpenedOnce",
  "appendFccPrepOpenedOnce",
  "appendStateAgPrepOpenedOnce",
];

describe("destination hub chat-only retirement", () => {
  it("wires each hub page through the chat-only shell without DIY filing UI", () => {
    const root = join(process.cwd(), "src/app/justice");
    for (const hub of HUB_PAGES) {
      const src = readFileSync(join(root, hub, "page.tsx"), "utf8");
      expect(src).toMatch(/JusticeDestinationHubChatOnlyPage|JusticeOptionalHubChatOnlyResumePage/);
      for (const marker of DIY_MARKERS) {
        expect(src, `${hub} must not contain ${marker}`).not.toContain(marker);
      }
    }
  });

  it("keeps the shared shell free of DIY filing CTAs", () => {
    const shell = readFileSync(
      join(process.cwd(), "src/app/components/JusticeDestinationHubChatOnlyPage.tsx"),
      "utf8"
    );
    expect(shell).toContain("Consumer DIY filing is not available here");
    expect(shell).not.toContain("Manual filing required");
    expect(shell).not.toContain("bbb.org");
    expect(shell).not.toContain("consumerfinance.gov");
  });

  it("uses owned/chat framing for prep_opened timeline details", () => {
    const timelineSrc = readFileSync(join(process.cwd(), "src/lib/justice/timeline.ts"), "utf8");
    expect(timelineSrc).not.toMatch(/manual filing next/);
    expect(timelineSrc).not.toMatch(/manual filing on official site next/);
    expect(timelineSrc).toContain("Surrenderless owns filing in chat");
  });
});

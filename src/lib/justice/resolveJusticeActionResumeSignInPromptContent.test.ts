import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveJusticeActionResumeSignInPromptContent } from "./resolveJusticeActionResumeSignInPromptContent";

describe("resolveJusticeActionResumeSignInPromptContent", () => {
  it("offers Start new case and resume wording when an active case exists", () => {
    const content = resolveJusticeActionResumeSignInPromptContent(true);
    expect(content.showStartNewCase).toBe(true);
    expect(content.heading).toBe("Sign in to resume your case");
    expect(content.description).toContain("start a new case");
  });

  it("hides Start new case and uses start wording with no active case", () => {
    const content = resolveJusticeActionResumeSignInPromptContent(false);
    expect(content.showStartNewCase).toBe(false);
    expect(content.heading).toBe("Sign in to start your case");
    expect(content.heading).not.toContain("resume");
    expect(content.description).not.toContain("start a new case");
  });
});

describe("JusticeActionResumeSignInPrompt wiring", () => {
  it("defaults hasActiveCase to true and only renders Start new case when true", () => {
    const source = readFileSync(
      join(process.cwd(), "src/app/components/JusticeActionResumeSignInPrompt.tsx"),
      "utf8"
    );
    expect(source).toContain("hasActiveCase = true");
    expect(source).toContain("resolveJusticeActionResumeSignInPromptContent");
    expect(source).toContain("showStartNewCase &&");
  });

  it("chat-ai passes hasActiveCase from the local active-case signal, not the default", () => {
    const source = readFileSync(join(process.cwd(), "src/app/justice/chat-ai/page.tsx"), "utf8");
    expect(source).toContain("<JusticeActionResumeSignInPrompt hasActiveCase={Boolean(activeUuidCaseId)} />");
  });

  it("preview and packet keep the default resume behavior (no prop passed)", () => {
    const preview = readFileSync(join(process.cwd(), "src/app/justice/preview/page.tsx"), "utf8");
    const packet = readFileSync(join(process.cwd(), "src/app/justice/packet/page.tsx"), "utf8");
    expect(preview).toContain("<JusticeActionResumeSignInPrompt />");
    expect(packet).toContain("<JusticeActionResumeSignInPrompt />");
  });
});

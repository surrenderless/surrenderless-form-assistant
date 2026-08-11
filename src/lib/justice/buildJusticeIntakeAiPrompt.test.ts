import { describe, expect, it } from "vitest";
import { defaultBuildJusticeIntakeParts } from "@/lib/justice/buildJusticeIntake";
import { buildIntakeChatAiMessages } from "@/lib/justice/buildJusticeIntakeAiPrompt";

function systemPrompt(): string {
  const messages = buildIntakeChatAiMessages({
    userMessage: "They never sent my order.",
    parts: defaultBuildJusticeIntakeParts(),
  });
  const system = messages.find((m) => m.role === "system");
  if (!system) throw new Error("Expected a system message in the prompt");
  return system.content;
}

describe("buildIntakeChatAiMessages system prompt", () => {
  it("actively instructs the model to ask for consumer_us_state when empty", () => {
    // State AG filings need the consumer's state, but the field was previously listed as
    // merely optional with no ask instruction, so it was never actually collected in chat —
    // this asserts the active-ask instruction (mirroring reply_email) is present.
    const system = systemPrompt();
    expect(system).toMatch(
      /If consumer_us_state is empty, ask the user which US state they personally live in/i
    );
  });

  it("explicitly disambiguates the consumer's own state from the merchant's state", () => {
    // company_state (the merchant's state, e.g. for BBB filings) is a distinct field the
    // model is never told about — but the same conversation routinely discusses the
    // merchant's location, so the instruction must be explicit that it wants the consumer's
    // own state, not the company's, or the model could misattribute a just-stated merchant
    // location as the answer.
    const system = systemPrompt();
    expect(system).toMatch(/not the merchant's state/i);
  });

  it("still actively instructs the model to ask for reply_email when empty", () => {
    // Regression guard: the new consumer_us_state instruction must not replace or crowd out
    // the existing reply_email ask instruction.
    const system = systemPrompt();
    expect(system).toMatch(
      /If reply_email is empty, ask the user for their OWN email address/i
    );
  });

  it("still lists consumer_us_state in the structured parts schema", () => {
    const system = systemPrompt();
    expect(system).toContain("consumer_us_state");
  });

  it("proactively asks for the company's contact email on merchant-first cases, without blocking", () => {
    // When the consumer hasn't contacted the merchant, Surrenderless sends first contact itself and
    // now requires a recipient — so the model must proactively collect company_contact_email while
    // still accepting "I don't have it" (operators handle outreach) rather than dead-ending.
    const system = systemPrompt();
    expect(system).toMatch(/already_contacted is "no"[\s\S]*company's contact\/support email/i);
    expect(system).toMatch(/operators can still handle first outreach|never block on it/i);
  });
});

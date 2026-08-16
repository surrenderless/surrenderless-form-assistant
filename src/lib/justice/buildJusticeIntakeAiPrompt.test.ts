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

  // Safety gap: this is the ONLY general-chat fallback in the product (page.tsx posts here
  // whenever the legal-consent gate, closure gate, and premature-archive check all decline to
  // act). The model has no access to real submission-draft / packet / BBB-autofill state, so
  // without an explicit prohibition it can freely paraphrase a user's own claim back as if it
  // were recorded (e.g. "Got it — I've noted that you reviewed the draft").
  describe("never falsely acknowledges legal-consent / task state it cannot know", () => {
    it("forbids claiming draft review, packet approval, or BBB/filing status was recorded", () => {
      const system = systemPrompt();
      expect(system).toMatch(/must NEVER claim, confirm, or acknowledge/i);
      expect(system).toMatch(/submission draft has been reviewed/i);
      expect(system).toMatch(/prepared packet has been approved/i);
      expect(system).toMatch(/BBB autofill.*run, been queued, or completed/i);
      expect(system).toMatch(/never say you have recorded, noted, saved, or queued/i);
    });

    it("redirects to the page's real status instead of naming a specific control", () => {
      // A specific control ("Mark draft reviewed", "Run BBB autofill", etc.) is only rendered
      // while its step is still pending — the block disappears (draft/packet) or its label
      // changes (BBB: "Run BBB autofill" -> "BBB autofill completed") once done. Naming a
      // specific control here would send the user looking for something that may no longer be
      // on the page, so the instruction must stay control-agnostic.
      const system = systemPrompt();
      expect(system).toMatch(/cannot confirm status from chat/i);
      expect(system).toMatch(/shown elsewhere on this page/i);
      expect(system).toMatch(/Do not name a specific button or control/i);
      expect(system).not.toMatch(/Mark draft reviewed/);
      expect(system).not.toMatch(/Approve prepared packet/);
      expect(system).not.toMatch(/Run BBB autofill/);
    });

    it("never confirms status in either direction, including a false 'not yet'", () => {
      // A stale negative claim is just as false as a stale positive one once the step is
      // actually done — the rule must forbid both, not only optimistic claims.
      const system = systemPrompt();
      expect(system).toMatch(/never imply their status either way/i);
      expect(system).toMatch(/even to say something has NOT happened yet/i);
    });

    it("does not narrow the redirect to a named checklist control the current state may lack", () => {
      // "or any other filing" in the prohibition must not be paired with a specific checklist/
      // checkbox claim — most owned filings (CFPB, FTC, DOT, FCC, State AG) have no consumer
      // chat checkbox at all, only an operator-status paragraph.
      const system = systemPrompt();
      expect(system).toMatch(/status of any other filing/i);
      expect(system).not.toMatch(/checklist\/checkbox shown above/i);
    });

    it("keeps the existing 'do not imply filings already happened' rule alongside the new one", () => {
      // Regression guard: the new rule generalizes this one — it must not replace it.
      const system = systemPrompt();
      expect(system).toMatch(/Do not imply that filings already happened/i);
    });
  });
});

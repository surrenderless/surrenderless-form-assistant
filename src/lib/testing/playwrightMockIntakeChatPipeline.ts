import type { BuildJusticeIntakeParts } from "@/lib/justice/buildJusticeIntake";
import { mergeModelBuildJusticeIntakeParts } from "@/lib/justice/parseIntakeChatAiResponse";

/** Deterministic assistant copy returned for the standard Playwright E2E user message. */
export const PLAYWRIGHT_MOCK_INTAKE_CHAT_ASSISTANT_MESSAGE =
  "Thanks — I've noted Acme Retail and the double charge. What email should we use for updates on this case?";

/** Deterministic assistant copy returned for the second Playwright E2E user message. */
export const PLAYWRIGHT_MOCK_INTAKE_CHAT_SECOND_ASSISTANT_MESSAGE =
  "Got it — I'll use Jordan Lee (e2e-chat@example.com) for case updates. Your basics look ready; you can save and continue in chat when you're ready.";

/** Canonical signed-in chat round-trip message used in Playwright E2E. */
export const PLAYWRIGHT_MOCK_INTAKE_CHAT_E2E_USER_MESSAGE =
  "I ordered a widget from Acme Retail for $49.99. They charged me twice and never refunded.";

/** Canonical second-turn message providing email and display name for Playwright E2E. */
export const PLAYWRIGHT_MOCK_INTAKE_CHAT_E2E_SECOND_USER_MESSAGE =
  "My email is e2e-chat@example.com and my name is Jordan Lee.";

/** Enabled only when Playwright webServer sets PLAYWRIGHT_MOCK_INTAKE_CHAT_PIPELINE=1. */
export function isPlaywrightMockIntakeChatPipelineEnabled(): boolean {
  if (process.env.PLAYWRIGHT_MOCK_INTAKE_CHAT_PIPELINE !== "1") {
    return false;
  }
  // Never allow on deployed production, even if the env var is set.
  if (process.env.VERCEL_ENV === "production") {
    return false;
  }
  return true;
}

function extractMockCompanyName(userMessage: string): string {
  if (userMessage.includes("Acme Retail")) {
    return "Acme Retail";
  }
  const match = userMessage.match(
    /\bfrom\s+([A-Za-z0-9][A-Za-z0-9\s&'.-]*?)(?:\s+for\b|\s+on\b|[.,]|$)/i
  );
  return match?.[1]?.trim() ?? "";
}

function extractMockMoneyAmount(userMessage: string): string {
  const match = userMessage.match(/\$[\d,]+(?:\.\d{2})?/);
  return match?.[0] ?? "";
}

function extractMockEmail(userMessage: string): string {
  const match = userMessage.match(/[\w.+-]+@[\w.-]+\.\w+/);
  return match?.[0] ?? "";
}

function extractMockDisplayName(userMessage: string): string {
  if (userMessage.includes("Jordan Lee")) {
    return "Jordan Lee";
  }
  const match = userMessage.match(/\bname is\s+([A-Za-z][A-Za-z\s'.-]{0,80})/i);
  return match?.[1]?.trim() ?? "";
}

function isPlaywrightMockIntakeChatSecondTurnMessage(
  userMessage: string,
  baselineParts: BuildJusticeIntakeParts
): boolean {
  const trimmed = userMessage.trim();
  if (trimmed === PLAYWRIGHT_MOCK_INTAKE_CHAT_E2E_SECOND_USER_MESSAGE) {
    return true;
  }
  const email = extractMockEmail(trimmed);
  const displayName = extractMockDisplayName(trimmed);
  return Boolean(email && displayName && baselineParts.company_name.trim().length > 0);
}

function buildPlaywrightMockIntakeChatSecondTurnResponse(
  userMessage: string,
  baselineParts: BuildJusticeIntakeParts
): { assistantMessage: string; parts: BuildJusticeIntakeParts } {
  const reply_email = extractMockEmail(userMessage) || "e2e-chat@example.com";
  const user_display_name = extractMockDisplayName(userMessage) || "Jordan Lee";

  const parts = mergeModelBuildJusticeIntakeParts(baselineParts, {
    reply_email,
    user_display_name,
  });

  return {
    assistantMessage: PLAYWRIGHT_MOCK_INTAKE_CHAT_SECOND_ASSISTANT_MESSAGE,
    parts,
  };
}

/**
 * Deterministic intake-chat response for Playwright E2E.
 * Matches production route shape: `{ assistantMessage, parts }`.
 */
export function buildPlaywrightMockIntakeChatResponse(
  userMessage: string,
  baselineParts: BuildJusticeIntakeParts
): { assistantMessage: string; parts: BuildJusticeIntakeParts } {
  const trimmed = userMessage.trim();

  if (isPlaywrightMockIntakeChatSecondTurnMessage(trimmed, baselineParts)) {
    return buildPlaywrightMockIntakeChatSecondTurnResponse(trimmed, baselineParts);
  }

  const company_name = extractMockCompanyName(trimmed);
  const money_amount = extractMockMoneyAmount(trimmed);

  const parts = mergeModelBuildJusticeIntakeParts(baselineParts, {
    company_name: company_name || baselineParts.company_name,
    story: trimmed || baselineParts.story,
    problem_category: "online_purchase",
    purchase_or_signup: trimmed.toLowerCase().includes("widget") ? "widget order" : baselineParts.purchase_or_signup,
    money_amount: money_amount || baselineParts.money_amount,
    already_contacted: "no",
  });

  const assistantMessage =
    company_name === "Acme Retail"
      ? PLAYWRIGHT_MOCK_INTAKE_CHAT_ASSISTANT_MESSAGE
      : `Thanks — I've captured your message${company_name ? ` about ${company_name}` : ""}. What else should I know?`;

  return { assistantMessage, parts };
}

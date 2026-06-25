import type { BuildJusticeIntakeParts } from "@/lib/justice/buildJusticeIntake";
import { mergeModelBuildJusticeIntakeParts } from "@/lib/justice/parseIntakeChatAiResponse";

/** Deterministic assistant copy returned for the standard Playwright E2E user message. */
export const PLAYWRIGHT_MOCK_INTAKE_CHAT_ASSISTANT_MESSAGE =
  "Thanks — I've noted Acme Retail and the double charge. What email should we use for updates on this case?";

/** Canonical signed-in chat round-trip message used in Playwright E2E. */
export const PLAYWRIGHT_MOCK_INTAKE_CHAT_E2E_USER_MESSAGE =
  "I ordered a widget from Acme Retail for $49.99. They charged me twice and never refunded.";

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

/**
 * Deterministic intake-chat response for Playwright E2E.
 * Matches production route shape: `{ assistantMessage, parts }`.
 */
export function buildPlaywrightMockIntakeChatResponse(
  userMessage: string,
  baselineParts: BuildJusticeIntakeParts
): { assistantMessage: string; parts: BuildJusticeIntakeParts } {
  const trimmed = userMessage.trim();
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

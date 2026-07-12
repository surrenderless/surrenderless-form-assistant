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

/** Canonical second-turn message providing email, display name, and merchant contact for Playwright E2E. */
export const PLAYWRIGHT_MOCK_INTAKE_CHAT_E2E_SECOND_USER_MESSAGE =
  "My email is e2e-chat@example.com and my name is Jordan Lee. I emailed Acme Retail on 2026-01-15 and they refused a refund.";

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

function extractMockIsoContactDate(userMessage: string): string {
  const iso = userMessage.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  return iso?.[1] ?? "";
}

function extractMockMerchantContactProofText(userMessage: string, companyName: string): string {
  const company = companyName.trim() || "the merchant";
  const isoDate = extractMockIsoContactDate(userMessage);
  if (/\brefused\b/i.test(userMessage) && isoDate) {
    return `E2E: ${company} refused a refund by email on ${isoDate}.`;
  }
  const trimmed = userMessage.trim();
  return trimmed.length > 0 ? trimmed : "";
}

function mergeMockMerchantContactFromUserMessage(
  parts: BuildJusticeIntakeParts,
  userMessage: string
): BuildJusticeIntakeParts {
  const contacted =
    /\b(?:emailed|called|contacted|reached out|messaged|chatted)\b/i.test(userMessage) ||
    /\brefused\b/i.test(userMessage);
  if (!contacted) return parts;

  const contactDate = extractMockIsoContactDate(userMessage);
  const proofText = extractMockMerchantContactProofText(userMessage, parts.company_name);
  if (!contactDate || !proofText) return parts;

  let merchantResponseType = parts.merchant_response_type;
  if (/\brefused\b/i.test(userMessage)) {
    merchantResponseType = "refused_help";
  } else if (/\bno response\b/i.test(userMessage)) {
    merchantResponseType = "no_response";
  }

  let contactMethod = parts.contact_method;
  if (/\bemailed\b/i.test(userMessage)) {
    contactMethod = "email";
  } else if (/\bcalled\b/i.test(userMessage)) {
    contactMethod = "phone";
  } else if (/\bchatted?\b/i.test(userMessage)) {
    contactMethod = "chat";
  }

  return mergeModelBuildJusticeIntakeParts(parts, {
    already_contacted: "yes",
    contact_method: contactMethod,
    contact_date: contactDate,
    merchant_response_type: merchantResponseType,
    contact_proof_type: "paste",
    contact_proof_text: proofText,
  });
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

  const company = parts.company_name.trim();
  const assistantMessage =
    company === "Acme Retail"
      ? PLAYWRIGHT_MOCK_INTAKE_CHAT_SECOND_ASSISTANT_MESSAGE
      : `Got it — I'll use ${user_display_name} (${reply_email}) for case updates. Your basics look ready; you can save and continue in chat when you're ready.`;

  return {
    assistantMessage,
    parts: mergeMockMerchantContactFromUserMessage(parts, userMessage),
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
    purchase_or_signup: trimmed.toLowerCase().includes("widget")
      ? "widget order"
      : trimmed.toLowerCase().includes("gadget")
        ? "gadget order"
        : baselineParts.purchase_or_signup,
    money_amount: money_amount || baselineParts.money_amount,
    already_contacted: "no",
  });

  const assistantMessage =
    company_name === "Acme Retail"
      ? PLAYWRIGHT_MOCK_INTAKE_CHAT_ASSISTANT_MESSAGE
      : company_name
        ? `Thanks — I've noted ${company_name}. What email should we use for updates on this case?`
        : `Thanks — I've captured your message. What else should I know?`;

  return { assistantMessage, parts };
}

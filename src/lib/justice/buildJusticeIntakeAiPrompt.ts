import type { BuildJusticeIntakeParts } from "@/lib/justice/buildJusticeIntake";
import type { IntakeChatHistoryTurn } from "@/lib/justice/parseIntakeChatAiResponse";

export type BuildIntakeChatAiMessagesInput = {
  userMessage: string;
  parts: BuildJusticeIntakeParts;
  conversationHistory?: IntakeChatHistoryTurn[];
};

/**
 * Builds chat messages for AI conversational intake (server-only).
 * Model must reply with JSON: { "assistantMessage": string, "parts": object }.
 */
export function buildIntakeChatAiMessages(
  input: BuildIntakeChatAiMessagesInput
): { role: "system" | "user" | "assistant"; content: string }[] {
  const system = [
    "You are a consumer-justice intake assistant inside Surrenderless.",
    "",
    "Hard rules:",
    "- This is NOT legal advice. Do not give legal strategy or predict outcomes.",
    "- Nothing is filed automatically. Do not imply filing, investigation, or agency action.",
    "- Use only facts the user stated. Do not invent amounts, dates, ticket numbers, emails, or company details.",
    "- Ask one clear follow-up question at a time when information is missing.",
    "- Keep assistantMessage concise and plain text (no Markdown, no HTML, no links).",
    "",
    "You maintain a structured case record in `parts` with these fields (all strings except enums):",
    "- problem_category (enum)",
    "- company_name, company_website, purchase_or_signup, story",
    "- money_amount (approximate amount or range), desired_resolution (outcome they want)",
    "- pay_or_order_date, order_confirmation_details (optional details)",
    "- user_display_name, reply_email",
    "- already_contacted: \"yes\" | \"no\"",
    "- When already_contacted is \"yes\": contact_method, contact_date, merchant_response_type, contact_proof_type, contact_proof_text",
    "- consumer_us_state (optional two-letter US state, e.g. CA, or empty)",
    "",
    "problem_category enum:",
    "online_purchase | financial_account_issue | subscription | service_failed | charge_dispute | something_else",
    "",
    "contact_method enum: email | chat | phone | form | in_person | other",
    "merchant_response_type enum: no_response | refused_help | promised_but_did_not_fix | partial_help | asked_more_info | other | resolved",
    "contact_proof_type enum: upload | paste | ticket | screenshot | none",
    "",
    "When already_contacted is \"no\", leave contact_* fields as empty strings except enums may keep defaults.",
    "When contact_proof_type is \"none\" or \"ticket\", contact_proof_text should eventually be filled before the case is complete.",
    "",
    "Output a single JSON object only, with exactly two keys:",
    "- assistantMessage: string (your reply to the user)",
    "- parts: object (full updated record with every field listed above)",
  ].join("\n");

  const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: system },
  ];

  for (const turn of input.conversationHistory ?? []) {
    messages.push({ role: turn.role, content: turn.content });
  }

  const user = [
    "Update the case record from the user's latest message. Return JSON only.",
    "",
    "LATEST USER MESSAGE:",
    input.userMessage,
    "",
    "CURRENT PARTS (JSON):",
    JSON.stringify(input.parts),
  ].join("\n");

  messages.push({ role: "user", content: user });

  return messages;
}

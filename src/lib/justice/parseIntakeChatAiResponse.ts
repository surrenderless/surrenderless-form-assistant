import type { BuildJusticeIntakeParts } from "@/lib/justice/buildJusticeIntake";
import type {
  ContactMethod,
  ContactProofType,
  JusticeIntake,
  MerchantResponseType,
  ProblemCategory,
} from "@/lib/justice/types";

const PROBLEM_CATEGORIES = new Set<ProblemCategory>([
  "online_purchase",
  "financial_account_issue",
  "subscription",
  "service_failed",
  "charge_dispute",
  "something_else",
]);

const CONTACT_METHODS = new Set<ContactMethod>([
  "email",
  "chat",
  "phone",
  "form",
  "in_person",
  "other",
]);

const MERCHANT_RESPONSE_TYPES = new Set<MerchantResponseType>([
  "no_response",
  "refused_help",
  "promised_but_did_not_fix",
  "partial_help",
  "asked_more_info",
  "other",
  "resolved",
]);

const CONTACT_PROOF_TYPES = new Set<ContactProofType>(["upload", "paste", "ticket", "screenshot", "none"]);

const STRING_LIMITS: Record<keyof BuildJusticeIntakeParts, number> = {
  problem_category: 64,
  company_name: 500,
  company_website: 500,
  purchase_or_signup: 2000,
  story: 12_000,
  money_amount: 4000,
  desired_resolution: 4000,
  pay_or_order_date: 200,
  order_confirmation_details: 4000,
  user_display_name: 200,
  reply_email: 320,
  already_contacted: 8,
  contact_method: 32,
  contact_date: 200,
  merchant_response_type: 64,
  contact_proof_type: 32,
  contact_proof_text: 8000,
  consumer_us_state: 8,
};

export const MAX_INTAKE_CHAT_USER_MESSAGE = 8_000;
export const MAX_INTAKE_CHAT_ASSISTANT_MESSAGE = 4_000;
export const MAX_INTAKE_CHAT_HISTORY_ITEMS = 20;
export const MAX_INTAKE_CHAT_HISTORY_CONTENT = 4_000;

export type IntakeChatHistoryTurn = {
  role: "user" | "assistant";
  content: string;
};

function clampStr(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max);
}

export function defaultBuildJusticeIntakeParts(): BuildJusticeIntakeParts {
  return {
    problem_category: "online_purchase",
    company_name: "",
    company_website: "",
    purchase_or_signup: "",
    story: "",
    money_amount: "",
    desired_resolution: "",
    pay_or_order_date: "",
    order_confirmation_details: "",
    user_display_name: "",
    reply_email: "",
    already_contacted: "no",
    contact_method: "email",
    contact_date: "",
    merchant_response_type: "no_response",
    contact_proof_type: "none",
    contact_proof_text: "",
    consumer_us_state: "",
  };
}

function coerceProblemCategory(v: unknown, fallback: ProblemCategory): ProblemCategory {
  return typeof v === "string" && PROBLEM_CATEGORIES.has(v as ProblemCategory)
    ? (v as ProblemCategory)
    : fallback;
}

function coerceAlreadyContacted(
  v: unknown,
  fallback: JusticeIntake["already_contacted"]
): JusticeIntake["already_contacted"] {
  return v === "yes" || v === "no" ? v : fallback;
}

function coerceContactMethod(v: unknown, fallback: ContactMethod): ContactMethod {
  return typeof v === "string" && CONTACT_METHODS.has(v as ContactMethod) ? (v as ContactMethod) : fallback;
}

function coerceMerchantResponse(v: unknown, fallback: MerchantResponseType): MerchantResponseType {
  return typeof v === "string" && MERCHANT_RESPONSE_TYPES.has(v as MerchantResponseType)
    ? (v as MerchantResponseType)
    : fallback;
}

function coerceContactProofType(v: unknown, fallback: ContactProofType): ContactProofType {
  return typeof v === "string" && CONTACT_PROOF_TYPES.has(v as ContactProofType)
    ? (v as ContactProofType)
    : fallback;
}

function coerceStringField(
  raw: Record<string, unknown>,
  key: keyof BuildJusticeIntakeParts,
  fallback: string
): string {
  const v = raw[key];
  if (typeof v !== "string") return fallback;
  return clampStr(v.trim(), STRING_LIMITS[key]);
}

function normalizeConsumerUsState(value: string): string {
  const st = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(st) ? st : "";
}

/** Clamp and coerce a partial `parts` object from the request body. */
export function parseRequestBuildJusticeIntakeParts(v: unknown): BuildJusticeIntakeParts | null {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const defaults = defaultBuildJusticeIntakeParts();

  const parts: BuildJusticeIntakeParts = {
    problem_category: coerceProblemCategory(o.problem_category, defaults.problem_category),
    company_name: coerceStringField(o, "company_name", defaults.company_name),
    company_website: coerceStringField(o, "company_website", defaults.company_website),
    purchase_or_signup: coerceStringField(o, "purchase_or_signup", defaults.purchase_or_signup),
    story: coerceStringField(o, "story", defaults.story),
    money_amount: coerceStringField(o, "money_amount", defaults.money_amount),
    desired_resolution: coerceStringField(o, "desired_resolution", defaults.desired_resolution),
    pay_or_order_date: coerceStringField(o, "pay_or_order_date", defaults.pay_or_order_date),
    order_confirmation_details: coerceStringField(
      o,
      "order_confirmation_details",
      defaults.order_confirmation_details
    ),
    user_display_name: coerceStringField(o, "user_display_name", defaults.user_display_name),
    reply_email: coerceStringField(o, "reply_email", defaults.reply_email),
    already_contacted: coerceAlreadyContacted(o.already_contacted, defaults.already_contacted),
    contact_method: coerceContactMethod(o.contact_method, defaults.contact_method),
    contact_date: coerceStringField(o, "contact_date", defaults.contact_date),
    merchant_response_type: coerceMerchantResponse(
      o.merchant_response_type,
      defaults.merchant_response_type
    ),
    contact_proof_type: coerceContactProofType(o.contact_proof_type, defaults.contact_proof_type),
    contact_proof_text: coerceStringField(o, "contact_proof_text", defaults.contact_proof_text),
    consumer_us_state: normalizeConsumerUsState(
      typeof o.consumer_us_state === "string" ? o.consumer_us_state : defaults.consumer_us_state
    ),
  };

  return parts;
}

/** Merge model `parts` onto baseline; invalid enums keep baseline values. */
export function mergeModelBuildJusticeIntakeParts(
  baseline: BuildJusticeIntakeParts,
  raw: unknown
): BuildJusticeIntakeParts {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return baseline;
  }
  const o = raw as Record<string, unknown>;

  return {
    problem_category: coerceProblemCategory(o.problem_category, baseline.problem_category),
    company_name: coerceStringField(o, "company_name", baseline.company_name),
    company_website: coerceStringField(o, "company_website", baseline.company_website),
    purchase_or_signup: coerceStringField(o, "purchase_or_signup", baseline.purchase_or_signup),
    story: coerceStringField(o, "story", baseline.story),
    money_amount: coerceStringField(o, "money_amount", baseline.money_amount),
    desired_resolution: coerceStringField(o, "desired_resolution", baseline.desired_resolution),
    pay_or_order_date: coerceStringField(o, "pay_or_order_date", baseline.pay_or_order_date),
    order_confirmation_details: coerceStringField(
      o,
      "order_confirmation_details",
      baseline.order_confirmation_details
    ),
    user_display_name: coerceStringField(o, "user_display_name", baseline.user_display_name),
    reply_email: coerceStringField(o, "reply_email", baseline.reply_email),
    already_contacted: coerceAlreadyContacted(o.already_contacted, baseline.already_contacted),
    contact_method: coerceContactMethod(o.contact_method, baseline.contact_method),
    contact_date: coerceStringField(o, "contact_date", baseline.contact_date),
    merchant_response_type: coerceMerchantResponse(
      o.merchant_response_type,
      baseline.merchant_response_type
    ),
    contact_proof_type: coerceContactProofType(o.contact_proof_type, baseline.contact_proof_type),
    contact_proof_text: coerceStringField(o, "contact_proof_text", baseline.contact_proof_text),
    consumer_us_state: normalizeConsumerUsState(
      typeof o.consumer_us_state === "string"
        ? o.consumer_us_state
        : baseline.consumer_us_state
    ),
  };
}

export function parseIntakeChatConversationHistory(v: unknown): IntakeChatHistoryTurn[] {
  if (!Array.isArray(v)) return [];
  const out: IntakeChatHistoryTurn[] = [];
  for (const item of v.slice(0, MAX_INTAKE_CHAT_HISTORY_ITEMS)) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) continue;
    const o = item as Record<string, unknown>;
    const role = o.role === "user" || o.role === "assistant" ? o.role : null;
    const content = typeof o.content === "string" ? clampStr(o.content.trim(), MAX_INTAKE_CHAT_HISTORY_CONTENT) : "";
    if (!role || !content) continue;
    out.push({ role, content });
  }
  return out;
}

export type ParsedIntakeChatModelResponse = {
  assistantMessage: string;
  parts: BuildJusticeIntakeParts;
};

/** Parse OpenAI JSON content; returns null when invalid. */
export function parseIntakeChatModelResponse(
  content: string,
  baselineParts: BuildJusticeIntakeParts
): ParsedIntakeChatModelResponse | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }

  const o = parsed as Record<string, unknown>;
  if (typeof o.assistantMessage !== "string") return null;

  const assistantMessage = clampStr(o.assistantMessage.trim(), MAX_INTAKE_CHAT_ASSISTANT_MESSAGE);
  if (!assistantMessage) return null;

  const parts = mergeModelBuildJusticeIntakeParts(baselineParts, o.parts);

  return { assistantMessage, parts };
}

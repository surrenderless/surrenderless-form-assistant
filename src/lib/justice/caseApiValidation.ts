import type { JusticeIntake, ProblemCategory, TimelineEntry } from "@/lib/justice/types";

const PROBLEM_CATEGORIES = new Set<ProblemCategory>([
  "online_purchase",
  "financial_account_issue",
  "subscription",
  "service_failed",
  "charge_dispute",
  "something_else",
]);

const CONTACT_METHODS = new Set([
  "email",
  "chat",
  "phone",
  "form",
  "in_person",
  "other",
]);

const MERCHANT_RESPONSE_TYPES = new Set([
  "no_response",
  "refused_help",
  "promised_but_did_not_fix",
  "partial_help",
  "asked_more_info",
  "other",
  "resolved",
]);

const CONTACT_PROOF_TYPES = new Set(["upload", "paste", "ticket", "screenshot", "none"]);

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string";
}

/** Light structural checks for API persistence (not full business rules). */
export function isJusticeIntakePayload(v: unknown): v is JusticeIntake {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  if (!PROBLEM_CATEGORIES.has(o.problem_category as ProblemCategory)) return false;
  if (typeof o.company_website !== "string") return false;
  const strings = [
    "company_name",
    "purchase_or_signup",
    "story",
    "money_involved",
    "pay_or_order_date",
    "order_confirmation_details",
    "user_display_name",
    "reply_email",
  ] as const;
  for (const k of strings) {
    if (!isNonEmptyString(o[k])) return false;
  }
  if (o.already_contacted !== "yes" && o.already_contacted !== "no") return false;

  if (o.contact_method !== undefined && !CONTACT_METHODS.has(o.contact_method as string)) {
    return false;
  }
  if (o.contact_date !== undefined && typeof o.contact_date !== "string") return false;
  if (
    o.merchant_response_type !== undefined &&
    !MERCHANT_RESPONSE_TYPES.has(o.merchant_response_type as string)
  ) {
    return false;
  }
  if (o.contact_proof_type !== undefined && !CONTACT_PROOF_TYPES.has(o.contact_proof_type as string)) {
    return false;
  }
  if (o.contact_proof_text !== undefined && typeof o.contact_proof_text !== "string") return false;
  if (o.consumer_us_state !== undefined && typeof o.consumer_us_state !== "string") return false;

  return true;
}

export function isTimelineArray(v: unknown): v is TimelineEntry[] {
  if (!Array.isArray(v)) return false;
  for (const item of v) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) return false;
  }
  return true;
}

/** JSON body from `GET /api/justice/cases` (paginated list). */
export type JusticeCasesListEnvelope = {
  cases: unknown[];
  has_more: boolean;
  offset: number;
  limit: number;
};

export function parseJusticeCasesListEnvelope(body: unknown): JusticeCasesListEnvelope | null {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return null;
  const o = body as Record<string, unknown>;
  if (!Array.isArray(o.cases) || typeof o.has_more !== "boolean") return null;
  const offset =
    typeof o.offset === "number" && Number.isFinite(o.offset) && o.offset >= 0 ? Math.trunc(o.offset) : 0;
  const limit =
    typeof o.limit === "number" && Number.isFinite(o.limit) && o.limit >= 1 ? Math.trunc(o.limit) : 10;
  return { cases: o.cases, has_more: o.has_more, offset, limit };
}

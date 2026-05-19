import { normalizeCompanyWebsite } from "@/lib/justice/normalizeCompanyWebsite";
import type {
  ContactMethod,
  ContactProofType,
  JusticeIntake,
  MerchantResponseType,
  ProblemCategory,
} from "@/lib/justice/types";

const DESIRED_OUTCOME_SEPARATORS = [" — Desired outcome: ", " - Desired outcome: "] as const;

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

/** Collected chat-intake fields before merge into `JusticeIntake`. */
export type BuildJusticeIntakeParts = {
  problem_category: JusticeIntake["problem_category"];
  company_name: string;
  company_website: string;
  purchase_or_signup: string;
  story: string;
  money_amount: string;
  desired_resolution: string;
  pay_or_order_date: string;
  order_confirmation_details: string;
  user_display_name: string;
  reply_email: string;
  already_contacted: JusticeIntake["already_contacted"];
  contact_method: NonNullable<JusticeIntake["contact_method"]>;
  contact_date: string;
  merchant_response_type: NonNullable<JusticeIntake["merchant_response_type"]>;
  contact_proof_type: NonNullable<JusticeIntake["contact_proof_type"]>;
  contact_proof_text: string;
  consumer_us_state: string;
};

export type ContactProofValidationInput = {
  already_contacted: JusticeIntake["already_contacted"];
  contact_proof_type: JusticeIntake["contact_proof_type"];
  contact_proof_text: string;
};

export type ContactProofValidationResult = { ok: true } | { ok: false; message: string };

/** Gate intake commit/advance when contact proof is required for `none` / `ticket`. */
export function validateContactProofForIntake(
  input: ContactProofValidationInput
): ContactProofValidationResult {
  if (input.already_contacted !== "yes") return { ok: true };
  if (input.contact_proof_type === "none" && !input.contact_proof_text.trim()) {
    return { ok: false, message: "Describe your contact attempt before continuing." };
  }
  if (input.contact_proof_type === "ticket" && !input.contact_proof_text.trim()) {
    return { ok: false, message: "Enter the ticket or case number before continuing." };
  }
  return { ok: true };
}

/** Default partial intake for chat-style collectors (AI + scripted parts shape). */
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

function splitMoneyInvolved(money_involved: string): Pick<BuildJusticeIntakeParts, "money_amount" | "desired_resolution"> {
  const raw = money_involved.trim();
  if (!raw || raw === "—") {
    return { money_amount: "", desired_resolution: "" };
  }
  for (const sep of DESIRED_OUTCOME_SEPARATORS) {
    const idx = raw.indexOf(sep);
    if (idx >= 0) {
      return {
        money_amount: raw.slice(0, idx).trim(),
        desired_resolution: raw.slice(idx + sep.length).trim(),
      };
    }
  }
  return { money_amount: raw, desired_resolution: "" };
}

/**
 * Reverse-map saved `JusticeIntake` into chat `BuildJusticeIntakeParts` (e.g. hydrate `/justice/chat-ai`).
 */
export function justiceIntakeToBuildJusticeIntakeParts(intake: JusticeIntake): BuildJusticeIntakeParts {
  const defaults = defaultBuildJusticeIntakeParts();
  const { money_amount, desired_resolution } = splitMoneyInvolved(intake.money_involved);
  const already_contacted = intake.already_contacted === "yes" ? "yes" : "no";

  const parts: BuildJusticeIntakeParts = {
    problem_category:
      intake.problem_category && PROBLEM_CATEGORIES.has(intake.problem_category)
        ? intake.problem_category
        : defaults.problem_category,
    company_name: intake.company_name?.trim() ?? "",
    company_website: intake.company_website?.trim() ?? "",
    purchase_or_signup: intake.purchase_or_signup?.trim() ?? "",
    story: intake.story?.trim() ?? "",
    money_amount,
    desired_resolution,
    pay_or_order_date: intake.pay_or_order_date?.trim() ?? "",
    order_confirmation_details: intake.order_confirmation_details?.trim() ?? "",
    user_display_name: intake.user_display_name?.trim() ?? "",
    reply_email: intake.reply_email?.trim() ?? "",
    already_contacted,
    contact_method: defaults.contact_method,
    contact_date: "",
    merchant_response_type: defaults.merchant_response_type,
    contact_proof_type: defaults.contact_proof_type,
    contact_proof_text: "",
    consumer_us_state: intake.consumer_us_state?.trim().toUpperCase() ?? "",
  };

  if (already_contacted === "yes") {
    parts.contact_method =
      intake.contact_method && CONTACT_METHODS.has(intake.contact_method)
        ? intake.contact_method
        : defaults.contact_method;
    parts.contact_date = intake.contact_date?.trim() ?? "";
    parts.merchant_response_type =
      intake.merchant_response_type && MERCHANT_RESPONSE_TYPES.has(intake.merchant_response_type)
        ? intake.merchant_response_type
        : defaults.merchant_response_type;
    parts.contact_proof_type =
      intake.contact_proof_type && CONTACT_PROOF_TYPES.has(intake.contact_proof_type)
        ? intake.contact_proof_type
        : defaults.contact_proof_type;
    parts.contact_proof_text = intake.contact_proof_text?.trim() ?? "";
  }

  const st = parts.consumer_us_state.trim();
  if (!/^[A-Z]{2}$/.test(st)) {
    parts.consumer_us_state = "";
  }

  return parts;
}

/**
 * Build a `JusticeIntake` from chat-style collected parts (scripted or future AI intake).
 * Matches legacy `/justice/chat` `buildIntake()` semantics.
 */
export function buildJusticeIntakeFromParts(parts: BuildJusticeIntakeParts): JusticeIntake {
  const moneyPart = parts.money_amount.trim();
  const resPart = parts.desired_resolution.trim();
  const money_involved =
    moneyPart && resPart ? `${moneyPart} — Desired outcome: ${resPart}` : moneyPart || resPart || "—";

  const intake: JusticeIntake = {
    problem_category: parts.problem_category,
    company_name: parts.company_name.trim(),
    company_website: normalizeCompanyWebsite(parts.company_website),
    purchase_or_signup: parts.purchase_or_signup.trim(),
    story: parts.story.trim(),
    money_involved,
    pay_or_order_date: parts.pay_or_order_date.trim(),
    order_confirmation_details: parts.order_confirmation_details.trim(),
    user_display_name: parts.user_display_name.trim(),
    reply_email: parts.reply_email.trim(),
    already_contacted: parts.already_contacted,
    ...(parts.already_contacted === "yes"
      ? {
          contact_method: parts.contact_method,
          contact_date: parts.contact_date.trim(),
          merchant_response_type: parts.merchant_response_type,
          contact_proof_type: parts.contact_proof_type,
          ...(parts.contact_proof_text.trim()
            ? { contact_proof_text: parts.contact_proof_text.trim() }
            : {}),
        }
      : {}),
  };

  const st = parts.consumer_us_state.trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(st)) {
    intake.consumer_us_state = st;
  }

  return intake;
}

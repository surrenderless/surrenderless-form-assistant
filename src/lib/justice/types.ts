export type ProblemCategory =
  | "online_purchase"
  | "subscription"
  | "service_failed"
  | "charge_dispute"
  | "something_else";

export type ContactMethod = "email" | "chat" | "phone" | "form" | "in_person" | "other";

export type MerchantResponseType =
  | "no_response"
  | "refused_help"
  | "promised_but_did_not_fix"
  | "partial_help"
  | "asked_more_info"
  | "other"
  | "resolved";

export type ContactProofType = "upload" | "paste" | "ticket" | "screenshot" | "none";

export type JusticeIntake = {
  problem_category: ProblemCategory;
  company_name: string;
  company_website: string;
  purchase_or_signup: string;
  story: string;
  money_involved: string;
  pay_or_order_date: string;
  order_confirmation_details: string;
  user_display_name: string;
  reply_email: string;
  already_contacted: "yes" | "no";
  contact_method?: ContactMethod;
  contact_date?: string;
  merchant_response_type?: MerchantResponseType;
  contact_proof_type?: ContactProofType;
  contact_proof_text?: string;
};

export type DestinationId =
  | "merchant_resolution"
  | "payment_dispute"
  | "ftc"
  | "bbb"
  | "state_ag"
  | "cfpb"
  | "fcc"
  | "dot"
  | "small_claims";

export type DestinationStatus = "recommended" | "available" | "later" | "manual";

export type JusticeDestination = {
  id: DestinationId;
  label: string;
  rationale: string;
  status: DestinationStatus;
  priority: number;
  internalRoute?: string;
};

export type JusticeDestinationsContext = {
  manualFtc: boolean;
};

export const STORAGE_INTAKE = "justice_intake_v1";
export const STORAGE_CASE_ID = "justice_case_id";
export const STORAGE_FTC_MANUAL_UNLOCK = "justice_ftc_manual_unlock";

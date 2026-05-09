export type ProblemCategory =
  | "online_purchase"
  | "financial_account_issue"
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
  /** Two-letter US state code (e.g. CA) for consumer / AG complaint context. */
  consumer_us_state?: string;
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

export type DestinationStatus = "recommended" | "available" | "later" | "manual" | "locked";

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
  /** When true, FTC destination copy uses "company" instead of "merchant" where applicable. */
  useCompanyContactLabels?: boolean;
};

export type TimelineEntryType =
  | "case_started"
  | "action_plan_viewed"
  | "merchant_contact_saved"
  | "escalation_unlocked"
  | "payment_checklist_viewed"
  | "ftc_practice_started"
  | "ftc_practice_completed"
  | "bbb_prep_opened"
  | "state_ag_prep_opened"
  | "cfpb_prep_opened"
  | "fcc_prep_opened";

export type TimelineEntry = {
  id: string;
  case_id: string;
  type: TimelineEntryType;
  label: string;
  ts: string;
  detail?: string;
};

export const STORAGE_INTAKE = "justice_intake_v1";
export const STORAGE_CASE_ID = "justice_case_id";
export const STORAGE_FTC_MANUAL_UNLOCK = "justice_ftc_manual_unlock";
/** Session JSON: `Record<caseId, TimelineEntry[]>` */
export const STORAGE_TIMELINE_V1 = "justice_timeline_v1";

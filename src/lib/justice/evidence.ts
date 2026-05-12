export const JUSTICE_EVIDENCE_TYPES = [
  "screenshot",
  "receipt",
  "email",
  "call_note",
  "account_page",
  "other",
] as const;

export type JusticeEvidenceType = (typeof JUSTICE_EVIDENCE_TYPES)[number];

export function isJusticeEvidenceType(s: string): s is JusticeEvidenceType {
  return (JUSTICE_EVIDENCE_TYPES as readonly string[]).includes(s);
}

export const JUSTICE_EVIDENCE_TYPE_LABELS: Record<JusticeEvidenceType, string> = {
  screenshot: "Screenshot",
  receipt: "Receipt",
  email: "Email",
  call_note: "Call note",
  account_page: "Account page",
  other: "Other",
};

export type JusticeCaseEvidenceRow = {
  id: string;
  user_id: string;
  case_id: string;
  title: string;
  evidence_type: string;
  evidence_date: string | null;
  description: string | null;
  created_at: string;
  updated_at: string;
};

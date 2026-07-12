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
  source_url: string | null;
  storage_note: string | null;
  file_path?: string | null;
  file_name: string | null;
  mime_type: string | null;
  file_size_bytes: number | null;
  created_at: string;
  updated_at: string;
};

/** True when an evidence row has a persisted uploaded file attachment.
 * Uses client-safe metadata only (file_path is never returned by evidence APIs).
 */
export function justiceEvidenceRowHasUploadedFile(row: Pick<
  JusticeCaseEvidenceRow,
  "file_name" | "mime_type" | "file_size_bytes"
> & { file_path?: string | null }): boolean {
  return Boolean(
    row.file_name?.trim() &&
      row.mime_type?.trim() &&
      typeof row.file_size_bytes === "number" &&
      row.file_size_bytes > 0
  );
}

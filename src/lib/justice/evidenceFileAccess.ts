import { validate as isUuid } from "uuid";

/** Short-lived signed URL lifetime for private evidence file access (seconds). */
export const JUSTICE_EVIDENCE_SIGNED_URL_TTL_SECONDS = 60;

/**
 * Public SELECT list for evidence API responses — never includes file_path
 * (private storage key stays server-side only).
 */
export const JUSTICE_EVIDENCE_API_SELECT =
  "id, user_id, case_id, title, evidence_type, evidence_date, description, source_url, storage_note, file_name, mime_type, file_size_bytes, created_at, updated_at" as const;

/** Clear error when the dedicated private evidence bucket is not configured. */
export const JUSTICE_EVIDENCE_BUCKET_MISSING_ERROR =
  "Evidence file storage is not configured. Set JUSTICE_EVIDENCE_BUCKET to a private Supabase Storage bucket.";

/**
 * Dedicated private evidence bucket only — never falls back to SUPABASE_BUCKET
 * (that bucket is used for public screenshot URLs elsewhere).
 */
export function getRequiredJusticeEvidenceBucket(): string | null {
  const bucket = process.env.JUSTICE_EVIDENCE_BUCKET?.trim();
  return bucket || null;
}

/** Strip private storage path before returning evidence rows to API clients. */
export function omitEvidenceFilePathFromApiRow<T extends Record<string, unknown>>(
  row: T
): Omit<T, "file_path"> {
  const { file_path: _omit, ...rest } = row;
  return rest;
}

export function omitEvidenceFilePathFromApiRows<T extends Record<string, unknown>>(
  rows: T[]
): Array<Omit<T, "file_path">> {
  return rows.map((row) => omitEvidenceFilePathFromApiRow(row));
}

/** True when a URL targets a Supabase public storage object (must never be stored for evidence files). */
export function isPublicSupabaseStorageObjectUrl(value: string | null | undefined): boolean {
  const url = value?.trim() ?? "";
  if (!url) return false;
  return /\/storage\/v1\/object\/public\//i.test(url);
}

/** Authenticated app path for owner download of an evidence file attachment. */
export function buildPrivateEvidenceFileAccessPath(evidenceId: string): string | null {
  const id = evidenceId.trim();
  if (!id || !isUuid(id)) return null;
  return `/api/justice/evidence/${encodeURIComponent(id)}/file`;
}

/**
 * Packet lines for an attached file — metadata only, never a public storage URL.
 * Points operators/reviewers at the private authenticated access path.
 */
export function buildPacketEvidenceFileLines(row: {
  id: string;
  file_name?: string | null;
  mime_type?: string | null;
  file_size_bytes?: number | null;
  file_path?: string | null;
}): string[] {
  const lines: string[] = [];
  const fileName = row.file_name?.trim();
  if (!fileName) return lines;

  lines.push(
    `   File: ${fileName}${row.mime_type?.trim() ? ` (${row.mime_type.trim()})` : ""}`
  );
  if (typeof row.file_size_bytes === "number" && row.file_size_bytes > 0) {
    lines.push(`   File size: ${row.file_size_bytes} bytes`);
  }
  const accessPath = buildPrivateEvidenceFileAccessPath(row.id);
  if (accessPath) {
    lines.push(`   Private access (signed-in owner): ${accessPath}`);
  }
  // Intentionally omit file_path from user-facing packet text (internal storage key).
  return lines;
}

/** Reject storing public object URLs on evidence rows that carry uploaded files. */
export function assertNoPublicEvidenceSourceUrl(sourceUrl: string | null | undefined): boolean {
  return !isPublicSupabaseStorageObjectUrl(sourceUrl);
}

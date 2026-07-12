/** Allowed MIME types for chat-native justice evidence file uploads. */
export const JUSTICE_EVIDENCE_UPLOAD_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
] as const;

export type JusticeEvidenceUploadMimeType = (typeof JUSTICE_EVIDENCE_UPLOAD_MIME_TYPES)[number];

/** 10 MiB — keeps chat uploads practical for screenshots and short PDFs. */
export const JUSTICE_EVIDENCE_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;

const MIME_SET = new Set<string>(JUSTICE_EVIDENCE_UPLOAD_MIME_TYPES);

export function isJusticeEvidenceUploadMimeType(value: string): value is JusticeEvidenceUploadMimeType {
  return MIME_SET.has(value.trim().toLowerCase());
}

export function sanitizeJusticeEvidenceUploadFileName(name: string): string {
  const base = name
    .trim()
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean)
    .pop() ?? "evidence-file";
  const cleaned = base
    .replace(/\0/g, "")
    .replace(/[^\w.\- ()[\]]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^\.+/, "")
    .trim();
  if (!cleaned || cleaned === "." || cleaned === "..") return "evidence-file";
  return cleaned.length <= 180 ? cleaned : cleaned.slice(0, 180);
}

export function inferJusticeEvidenceTypeFromMime(
  mimeType: string
): "screenshot" | "other" {
  const mime = mimeType.trim().toLowerCase();
  if (mime.startsWith("image/")) return "screenshot";
  return "other";
}

export function validateJusticeEvidenceUploadFile(input: {
  mimeType: string;
  sizeBytes: number;
  fileName?: string;
}): { ok: true; mimeType: JusticeEvidenceUploadMimeType; fileName: string } | { ok: false; error: string } {
  const mimeType = input.mimeType.trim().toLowerCase();
  if (!isJusticeEvidenceUploadMimeType(mimeType)) {
    return {
      ok: false,
      error: "Unsupported file type. Upload a JPEG, PNG, WebP, GIF, or PDF.",
    };
  }
  if (!Number.isFinite(input.sizeBytes) || input.sizeBytes <= 0) {
    return { ok: false, error: "File is empty or invalid." };
  }
  if (input.sizeBytes > JUSTICE_EVIDENCE_UPLOAD_MAX_BYTES) {
    return {
      ok: false,
      error: `File is too large. Maximum size is ${JUSTICE_EVIDENCE_UPLOAD_MAX_BYTES / (1024 * 1024)} MB.`,
    };
  }
  const fileName = sanitizeJusticeEvidenceUploadFileName(input.fileName ?? "evidence-file");
  return { ok: true, mimeType, fileName };
}

/** Storage object path: justice-evidence/{userId}/{caseId}/{uuid}-{fileName} */
export function buildJusticeEvidenceStoragePath(input: {
  userId: string;
  caseId: string;
  objectId: string;
  fileName: string;
}): string {
  const userId = input.userId.trim().replace(/[/\\]/g, "_");
  const caseId = input.caseId.trim();
  const objectId = input.objectId.trim().replace(/[/\\]/g, "");
  const fileName = sanitizeJusticeEvidenceUploadFileName(input.fileName);
  return `justice-evidence/${userId}/${caseId}/${objectId}-${fileName}`;
}

export function buildChatEvidenceUploadProgressMessage(percent: number): string {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  return `Uploading evidence file… ${clamped}%`;
}

export function buildChatEvidenceUploadSuccessMessage(details: {
  title: string;
  fileName: string;
}): string {
  const title = details.title.trim() || details.fileName.trim() || "your file";
  return `I've attached "${title}" to this case.`;
}

export function buildChatEvidenceUploadFailureMessage(error?: string | null): string {
  const detail = error?.trim();
  return detail
    ? `I couldn't attach that file: ${detail}`
    : "I couldn't attach that file. Try again with a JPEG, PNG, WebP, GIF, or PDF under 10 MB.";
}

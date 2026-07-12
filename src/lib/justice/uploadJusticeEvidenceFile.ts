import {
  buildChatEvidenceUploadFailureMessage,
  validateJusticeEvidenceUploadFile,
} from "@/lib/justice/chatEvidenceUpload";
import type { JusticeCaseEvidenceRow, JusticeEvidenceType } from "@/lib/justice/evidence";
import { isJusticeEvidenceType } from "@/lib/justice/evidence";

export type UploadJusticeEvidenceFileResult =
  | { ok: true; row: JusticeCaseEvidenceRow; timeline?: unknown }
  | { ok: false; error: string; status?: number };

/**
 * Upload an evidence file for an owned case via the production multipart API.
 * Reports progress 0–100 through onProgress when the browser supports upload events.
 */
export function uploadJusticeEvidenceFile(input: {
  caseId: string;
  file: File;
  title?: string;
  evidenceType?: JusticeEvidenceType | string;
  signal?: AbortSignal;
  onProgress?: (percent: number) => void;
}): Promise<UploadJusticeEvidenceFileResult> {
  const caseId = input.caseId.trim();
  if (!caseId) {
    return Promise.resolve({ ok: false, error: "Missing case id." });
  }

  const validated = validateJusticeEvidenceUploadFile({
    mimeType: input.file.type || "application/octet-stream",
    sizeBytes: input.file.size,
    fileName: input.file.name,
  });
  if (!validated.ok) {
    return Promise.resolve({ ok: false, error: validated.error });
  }

  const form = new FormData();
  form.set("case_id", caseId);
  form.set("file", input.file, validated.fileName);
  const title = input.title?.trim();
  if (title) form.set("title", title);
  if (input.evidenceType && isJusticeEvidenceType(input.evidenceType)) {
    form.set("evidence_type", input.evidenceType);
  }

  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/justice/evidence/upload");
    xhr.responseType = "json";

    if (input.signal) {
      if (input.signal.aborted) {
        resolve({ ok: false, error: "Upload cancelled." });
        return;
      }
      input.signal.addEventListener(
        "abort",
        () => {
          xhr.abort();
        },
        { once: true }
      );
    }

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || !input.onProgress) return;
      const percent = (event.loaded / event.total) * 100;
      input.onProgress(percent);
    };

    xhr.onload = () => {
      const payload = xhr.response as unknown;
      if (xhr.status >= 200 && xhr.status < 300) {
        if (payload && typeof payload === "object" && !Array.isArray(payload)) {
          const row = payload as JusticeCaseEvidenceRow;
          if (typeof row.id === "string" && typeof row.title === "string") {
            input.onProgress?.(100);
            resolve({
              ok: true,
              row,
              timeline:
                "timeline" in row
                  ? (payload as { timeline?: unknown }).timeline
                  : undefined,
            });
            return;
          }
        }
        resolve({ ok: false, error: "Unexpected upload response.", status: xhr.status });
        return;
      }

      const err =
        payload && typeof payload === "object" && !Array.isArray(payload)
          ? String((payload as { error?: unknown }).error ?? "")
          : "";
      resolve({
        ok: false,
        error: err || buildChatEvidenceUploadFailureMessage(),
        status: xhr.status,
      });
    };

    xhr.onerror = () => {
      resolve({ ok: false, error: "Network error while uploading evidence." });
    };

    xhr.onabort = () => {
      resolve({ ok: false, error: "Upload cancelled." });
    };

    xhr.send(form);
  });
}

import { describe, expect, it } from "vitest";
import {
  buildChatEvidenceUploadFailureMessage,
  buildChatEvidenceUploadProgressMessage,
  buildChatEvidenceUploadSuccessMessage,
  buildJusticeEvidenceStoragePath,
  inferJusticeEvidenceTypeFromMime,
  sanitizeJusticeEvidenceUploadFileName,
  validateJusticeEvidenceUploadFile,
  JUSTICE_EVIDENCE_UPLOAD_MAX_BYTES,
} from "@/lib/justice/chatEvidenceUpload";

describe("chatEvidenceUpload", () => {
  it("accepts common image and PDF MIME types within size limits", () => {
    expect(
      validateJusticeEvidenceUploadFile({
        mimeType: "image/png",
        sizeBytes: 1024,
        fileName: "refund.png",
      })
    ).toEqual({ ok: true, mimeType: "image/png", fileName: "refund.png" });

    expect(
      validateJusticeEvidenceUploadFile({
        mimeType: "application/pdf",
        sizeBytes: 2048,
        fileName: "order.pdf",
      }).ok
    ).toBe(true);
  });

  it("rejects unsupported types, empty files, and oversized files", () => {
    expect(
      validateJusticeEvidenceUploadFile({
        mimeType: "text/plain",
        sizeBytes: 10,
        fileName: "notes.txt",
      }).ok
    ).toBe(false);

    expect(
      validateJusticeEvidenceUploadFile({
        mimeType: "image/jpeg",
        sizeBytes: 0,
        fileName: "empty.jpg",
      }).ok
    ).toBe(false);

    expect(
      validateJusticeEvidenceUploadFile({
        mimeType: "image/jpeg",
        sizeBytes: JUSTICE_EVIDENCE_UPLOAD_MAX_BYTES + 1,
        fileName: "big.jpg",
      }).ok
    ).toBe(false);
  });

  it("sanitizes file names and builds stable storage paths", () => {
    expect(sanitizeJusticeEvidenceUploadFileName("../evil\\name.pdf")).toBe("name.pdf");
    expect(sanitizeJusticeEvidenceUploadFileName("Refund Receipt.PNG")).toBe("Refund Receipt.PNG");
    expect(
      buildJusticeEvidenceStoragePath({
        userId: "user_123",
        caseId: "550e8400-e29b-41d4-a716-446655440001",
        objectId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
        fileName: "Refund Receipt.PNG",
      })
    ).toBe(
      "justice-evidence/user_123/550e8400-e29b-41d4-a716-446655440001/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee-Refund Receipt.PNG"
    );
  });

  it("infers evidence type and formats chat upload messages", () => {
    expect(inferJusticeEvidenceTypeFromMime("image/webp")).toBe("screenshot");
    expect(inferJusticeEvidenceTypeFromMime("application/pdf")).toBe("other");
    expect(buildChatEvidenceUploadProgressMessage(42.6)).toBe("Uploading evidence file… 43%");
    expect(
      buildChatEvidenceUploadSuccessMessage({ title: "Denial letter", fileName: "denial.pdf" })
    ).toBe('I\'ve attached "Denial letter" to this case.');
    expect(buildChatEvidenceUploadFailureMessage("File is too large.")).toContain("File is too large.");
  });
});

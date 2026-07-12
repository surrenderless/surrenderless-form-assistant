import { describe, expect, it, afterEach, vi } from "vitest";
import {
  assertNoPublicEvidenceSourceUrl,
  buildPacketEvidenceFileLines,
  buildPrivateEvidenceFileAccessPath,
  getRequiredJusticeEvidenceBucket,
  isPublicSupabaseStorageObjectUrl,
  JUSTICE_EVIDENCE_BUCKET_MISSING_ERROR,
  JUSTICE_EVIDENCE_SIGNED_URL_TTL_SECONDS,
  omitEvidenceFilePathFromApiRow,
  omitEvidenceFilePathFromApiRows,
} from "@/lib/justice/evidenceFileAccess";

describe("evidenceFileAccess", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("detects public Supabase storage object URLs", () => {
    expect(
      isPublicSupabaseStorageObjectUrl(
        "https://xyz.supabase.co/storage/v1/object/public/bucket/justice-evidence/u/c/f.png"
      )
    ).toBe(true);
    expect(
      isPublicSupabaseStorageObjectUrl(
        "https://xyz.supabase.co/storage/v1/object/sign/bucket/path?token=abc"
      )
    ).toBe(false);
    expect(assertNoPublicEvidenceSourceUrl(null)).toBe(true);
    expect(JUSTICE_EVIDENCE_SIGNED_URL_TTL_SECONDS).toBeGreaterThan(0);
    expect(JUSTICE_EVIDENCE_BUCKET_MISSING_ERROR).toContain("JUSTICE_EVIDENCE_BUCKET");
  });

  it("requires JUSTICE_EVIDENCE_BUCKET and never falls back to SUPABASE_BUCKET", () => {
    vi.stubEnv("SUPABASE_BUCKET", "public-screenshots");
    vi.stubEnv("JUSTICE_EVIDENCE_BUCKET", "");
    expect(getRequiredJusticeEvidenceBucket()).toBeNull();

    vi.stubEnv("JUSTICE_EVIDENCE_BUCKET", "  justice-evidence-private  ");
    expect(getRequiredJusticeEvidenceBucket()).toBe("justice-evidence-private");
  });

  it("omits file_path from API row payloads", () => {
    const row = {
      id: "550e8400-e29b-41d4-a716-446655440099",
      file_path: "justice-evidence/u/c/secret.png",
      file_name: "secret.png",
      source_url: null,
    };
    expect(omitEvidenceFilePathFromApiRow(row)).toEqual({
      id: "550e8400-e29b-41d4-a716-446655440099",
      file_name: "secret.png",
      source_url: null,
    });
    expect(omitEvidenceFilePathFromApiRows([row])[0]).not.toHaveProperty("file_path");
  });

  it("builds private access paths and packet lines without public URLs", () => {
    const id = "550e8400-e29b-41d4-a716-446655440099";
    expect(buildPrivateEvidenceFileAccessPath(id)).toBe(
      `/api/justice/evidence/${id}/file`
    );
    expect(buildPrivateEvidenceFileAccessPath("not-a-uuid")).toBeNull();

    const lines = buildPacketEvidenceFileLines({
      id,
      file_name: "denial.png",
      mime_type: "image/png",
      file_size_bytes: 2048,
      file_path: "justice-evidence/u/c/obj-denial.png",
    });
    expect(lines.join("\n")).toContain("File: denial.png (image/png)");
    expect(lines.join("\n")).toContain(`Private access (signed-in owner): /api/justice/evidence/${id}/file`);
    expect(lines.join("\n")).not.toMatch(/\/storage\/v1\/object\/public\//i);
    expect(lines.join("\n")).not.toContain("justice-evidence/u/c/obj-denial.png");
  });
});

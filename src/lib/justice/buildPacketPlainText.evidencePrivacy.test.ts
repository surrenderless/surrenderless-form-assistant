import { describe, expect, it } from "vitest";
import { buildPacketPlainText } from "@/lib/justice/buildPacketPlainText";
import type { JusticeCaseEvidenceRow } from "@/lib/justice/evidence";
import type { JusticeIntake } from "@/lib/justice/types";

const baseIntake: JusticeIntake = {
  problem_category: "online_purchase",
  company_name: "Acme Retail",
  company_website: "https://acme.example",
  purchase_or_signup: "Widget",
  story: "Bought an item; merchant refused refund.",
  money_involved: "$50",
  pay_or_order_date: "2026-01-15",
  order_confirmation_details: "ORD-1",
  user_display_name: "Test User",
  reply_email: "test@example.com",
  already_contacted: "yes",
};

const CASE_ID = "660e8400-e29b-41d4-a716-446655440099";

function evidenceRow(partial: Partial<JusticeCaseEvidenceRow>): JusticeCaseEvidenceRow {
  return {
    id: "550e8400-e29b-41d4-a716-446655440099",
    user_id: "user-1",
    case_id: CASE_ID,
    title: "Denial screenshot",
    evidence_type: "screenshot",
    evidence_date: null,
    description: null,
    source_url: null,
    storage_note: "Uploaded file: denial.png",
    file_path: "justice-evidence/u/c/obj-denial.png",
    file_name: "denial.png",
    mime_type: "image/png",
    file_size_bytes: 2048,
    created_at: "2026-06-21T00:00:01.000Z",
    updated_at: "2026-06-21T00:00:01.000Z",
    ...partial,
  };
}

describe("buildPacketPlainText evidence privacy", () => {
  it("includes private access path and omits public storage URLs and storage keys", () => {
    const text = buildPacketPlainText(baseIntake, [], [evidenceRow({})], [], CASE_ID);
    expect(text).toContain("File: denial.png (image/png)");
    expect(text).toContain(
      "Private access (signed-in owner): /api/justice/evidence/550e8400-e29b-41d4-a716-446655440099/file"
    );
    expect(text).not.toMatch(/\/storage\/v1\/object\/public\//i);
    expect(text).not.toContain("Storage path:");
    expect(text).not.toContain("justice-evidence/u/c/obj-denial.png");
  });

  it("strips public object URLs even if present on legacy source_url", () => {
    const text = buildPacketPlainText(
      baseIntake,
      [],
      [
        evidenceRow({
          source_url:
            "https://xyz.supabase.co/storage/v1/object/public/bucket/justice-evidence/u/c/f.png",
        }),
      ],
      [],
      CASE_ID
    );
    expect(text).not.toMatch(/\/storage\/v1\/object\/public\//i);
    expect(text).not.toContain("Source URL:");
  });
});

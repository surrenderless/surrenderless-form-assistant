import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildJusticeIntakeFromParts, defaultBuildJusticeIntakeParts } from "@/lib/justice/buildJusticeIntake";
import { resolveIntendedPreparedAction } from "@/lib/justice/resolveIntendedPreparedAction";

const CASE_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "user_1";

type EvidenceRow = { file_name: string | null; mime_type: string | null; file_size_bytes: number | null };
type Store = { evidence: EvidenceRow[]; failEvidenceLookup?: boolean };

function makeSupabase(store: Store): SupabaseClient {
  const from = (table: string) => {
    if (table !== "justice_case_evidence") throw new Error(`unexpected table ${table}`);
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      limit: async () => {
        if (store.failEvidenceLookup) return { data: null, error: { message: "evidence lookup down" } };
        return { data: store.evidence, error: null };
      },
    };
    return builder as unknown as ReturnType<SupabaseClient["from"]>;
  };
  return { from } as unknown as SupabaseClient;
}

describe("resolveIntendedPreparedAction", () => {
  it("resolves merchant contact when the consumer has not yet contacted the merchant", async () => {
    const intake = buildJusticeIntakeFromParts({
      ...defaultBuildJusticeIntakeParts(),
      problem_category: "online_purchase",
      company_name: "Acme Retail",
      already_contacted: "no",
    });
    const result = await resolveIntendedPreparedAction(makeSupabase({ evidence: [] }), {
      userId: USER_ID,
      caseId: CASE_ID,
      intake,
    });
    expect(result).toEqual({ ok: true, action: { href: "/justice/merchant", label: "Merchant contact", status: "approved", approved_at: expect.any(String) } });
  });

  it("resolves the first routable destination once the merchant has been contacted", async () => {
    const intake = buildJusticeIntakeFromParts({
      ...defaultBuildJusticeIntakeParts(),
      problem_category: "online_purchase",
      company_name: "Acme Retail",
      already_contacted: "yes",
    });
    const result = await resolveIntendedPreparedAction(makeSupabase({ evidence: [] }), {
      userId: USER_ID,
      caseId: CASE_ID,
      intake,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.action.href).toBeTruthy();
      expect(result.action.status).toBe("approved");
    }
  });

  it("is deterministic: identical inputs always resolve to the identical action", async () => {
    const intake = buildJusticeIntakeFromParts({
      ...defaultBuildJusticeIntakeParts(),
      problem_category: "subscription",
      company_name: "Acme Retail",
      already_contacted: "yes",
    });
    const first = await resolveIntendedPreparedAction(makeSupabase({ evidence: [] }), {
      userId: USER_ID,
      caseId: CASE_ID,
      intake,
    });
    const second = await resolveIntendedPreparedAction(makeSupabase({ evidence: [] }), {
      userId: USER_ID,
      caseId: CASE_ID,
      intake,
    });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(first.action.href).toBe(second.action.href);
      expect(first.action.label).toBe(second.action.label);
    }
  });

  it("surfaces an evidence-lookup failure as a structured error rather than throwing", async () => {
    const intake = buildJusticeIntakeFromParts({
      ...defaultBuildJusticeIntakeParts(),
      already_contacted: "yes",
    });
    const result = await resolveIntendedPreparedAction(
      makeSupabase({ evidence: [], failEvidenceLookup: true }),
      { userId: USER_ID, caseId: CASE_ID, intake }
    );
    expect(result).toEqual({ ok: false, reason: "error", error: "evidence lookup down" });
  });

  it("manualFtc only ever narrows eligible destinations — omitting it never fabricates a routable one that wouldn't otherwise exist", async () => {
    const intake = buildJusticeIntakeFromParts({
      ...defaultBuildJusticeIntakeParts(),
      already_contacted: "yes",
    });
    const withoutManualFtc = await resolveIntendedPreparedAction(makeSupabase({ evidence: [] }), {
      userId: USER_ID,
      caseId: CASE_ID,
      intake,
    });
    const withManualFtcFalse = await resolveIntendedPreparedAction(makeSupabase({ evidence: [] }), {
      userId: USER_ID,
      caseId: CASE_ID,
      intake,
      manualFtc: false,
    });
    expect(withoutManualFtc).toEqual(withManualFtcFalse);
  });
});

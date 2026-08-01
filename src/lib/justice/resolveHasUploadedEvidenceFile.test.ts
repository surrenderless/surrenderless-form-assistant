import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveHasUploadedEvidenceFile } from "@/lib/justice/resolveHasUploadedEvidenceFile";

const CASE_ID = "550e8400-e29b-41d4-a716-446655440000";
const USER_ID = "user-owner-1";

function createEvidenceSupabase(
  rows: Array<{ file_name: string | null; mime_type: string | null; file_size_bytes: number | null }> | null,
  error: { message: string } | null = null
): SupabaseClient {
  return {
    from: (table: string) => {
      if (table !== "justice_case_evidence") throw new Error(`unexpected table ${table}`);
      return {
        select: (cols: string) => {
          expect(cols).toContain("file_name");
          return {
            eq: (col1: string, val1: string) => {
              expect(col1).toBe("case_id");
              expect(val1).toBe(CASE_ID);
              return {
                eq: (col2: string, val2: string) => {
                  expect(col2).toBe("user_id");
                  expect(val2).toBe(USER_ID);
                  return {
                    order: () => ({
                      limit: async () => ({ data: rows, error }),
                    }),
                  };
                },
              };
            },
          };
        },
      };
    },
  } as unknown as SupabaseClient;
}

describe("resolveHasUploadedEvidenceFile", () => {
  it("returns true when at least one row has a real uploaded file", async () => {
    const supabase = createEvidenceSupabase([
      { file_name: null, mime_type: null, file_size_bytes: null },
      { file_name: "receipt.png", mime_type: "image/png", file_size_bytes: 1024 },
    ]);
    await expect(resolveHasUploadedEvidenceFile(supabase, CASE_ID, USER_ID)).resolves.toBe(true);
  });

  it("returns false when no rows have a real uploaded file", async () => {
    const supabase = createEvidenceSupabase([
      { file_name: null, mime_type: null, file_size_bytes: null },
      { file_name: "note", mime_type: null, file_size_bytes: 0 },
    ]);
    await expect(resolveHasUploadedEvidenceFile(supabase, CASE_ID, USER_ID)).resolves.toBe(false);
  });

  it("returns false when there are no evidence rows at all", async () => {
    const supabase = createEvidenceSupabase([]);
    await expect(resolveHasUploadedEvidenceFile(supabase, CASE_ID, USER_ID)).resolves.toBe(false);
  });

  it("returns false when data is null", async () => {
    const supabase = createEvidenceSupabase(null);
    await expect(resolveHasUploadedEvidenceFile(supabase, CASE_ID, USER_ID)).resolves.toBe(false);
  });

  it("fails closed to false when the query errors", async () => {
    const supabase = createEvidenceSupabase(
      [{ file_name: "receipt.png", mime_type: "image/png", file_size_bytes: 1024 }],
      { message: "boom" }
    );
    await expect(resolveHasUploadedEvidenceFile(supabase, CASE_ID, USER_ID)).resolves.toBe(false);
  });
});

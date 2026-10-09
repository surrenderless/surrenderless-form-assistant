import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/server/requireUser", () => ({
  getUserOr401: vi.fn(),
}));

type EvidenceRow = {
  id: string;
  user_id: string;
  case_id: string;
  title: string;
  file_path: string | null;
  file_name: string | null;
};

let evidenceStore: EvidenceRow[] = [];
let deleteError: { message: string } | null = null;
const storageFrom = vi.fn();
const storageRemove = vi.fn();

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    from: (table: string) => {
      if (table !== "justice_case_evidence") throw new Error(`unexpected table ${table}`);
      const filters: Record<string, string> = {};
      const builder = {
        delete: () => builder,
        eq: (col: string, val: string) => {
          filters[col] = val;
          return builder;
        },
        select: async () => {
          if (deleteError) return { data: null, error: deleteError };
          const matched = evidenceStore.filter(
            (r) => r.id === filters.id && r.user_id === filters.user_id
          );
          evidenceStore = evidenceStore.filter((r) => !matched.includes(r));
          return { data: matched, error: null };
        },
      };
      return builder;
    },
    storage: {
      from: (bucket: string) => {
        storageFrom(bucket);
        return { remove: storageRemove };
      },
    },
  })),
}));

import { DELETE } from "@/app/api/justice/evidence/[id]/route";
import { getUserOr401 } from "@/server/requireUser";

const OWNER_ID = "user_owner";
const OTHER_USER_ID = "user_other";
const EVIDENCE_ID = "550e8400-e29b-41d4-a716-446655440010";
const CASE_ID = "550e8400-e29b-41d4-a716-446655440001";
const FILE_PATH = `justice-evidence/${OWNER_ID}/${CASE_ID}/obj-receipt.png`;

function buildRequest(id: string) {
  return new NextRequest(new URL(`http://localhost/api/justice/evidence/${id}`), {
    method: "DELETE",
  });
}

function seedRow(overrides: Partial<EvidenceRow> = {}) {
  evidenceStore.push({
    id: EVIDENCE_ID,
    user_id: OWNER_ID,
    case_id: CASE_ID,
    title: "Receipt",
    file_path: FILE_PATH,
    file_name: "receipt.png",
    ...overrides,
  });
}

async function callDelete(id = EVIDENCE_ID) {
  return DELETE(buildRequest(id), { params: Promise.resolve({ id }) });
}

describe("DELETE /api/justice/evidence/[id]", () => {
  beforeEach(() => {
    evidenceStore = [];
    deleteError = null;
    storageRemove.mockResolvedValue({ data: [], error: null });
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-service-role");
    vi.stubEnv("JUSTICE_EVIDENCE_BUCKET", "justice-evidence-private");
    vi.mocked(getUserOr401).mockReturnValue(OWNER_ID);
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("returns 401 when not signed in and removes nothing", async () => {
    vi.mocked(getUserOr401).mockReturnValue(null);
    seedRow();
    const res = await callDelete();
    expect(res.status).toBe(401);
    expect(evidenceStore).toHaveLength(1);
    expect(storageRemove).not.toHaveBeenCalled();
  });

  it("returns 404 for another user's evidence and leaves its file", async () => {
    seedRow();
    vi.mocked(getUserOr401).mockReturnValue(OTHER_USER_ID);
    const res = await callDelete();
    expect(res.status).toBe(404);
    expect(evidenceStore).toHaveLength(1);
    expect(storageRemove).not.toHaveBeenCalled();
  });

  it("removes the stored file from the private evidence bucket after deleting the row", async () => {
    seedRow();
    const res = await callDelete();
    expect(res.status).toBe(200);
    expect(evidenceStore).toHaveLength(0);
    expect(storageFrom).toHaveBeenCalledWith("justice-evidence-private");
    expect(storageRemove).toHaveBeenCalledWith([FILE_PATH]);
  });

  it("never returns file_path to the client", async () => {
    seedRow();
    const res = await callDelete();
    const body = (await res.json()) as { ok: boolean; deleted: Record<string, unknown> };
    expect(body.ok).toBe(true);
    expect(body.deleted.id).toBe(EVIDENCE_ID);
    expect(body.deleted).not.toHaveProperty("file_path");
    expect(JSON.stringify(body)).not.toContain(FILE_PATH);
  });

  it("does not touch storage for a note with no attached file", async () => {
    seedRow({ file_path: null, file_name: null });
    const res = await callDelete();
    expect(res.status).toBe(200);
    expect(storageRemove).not.toHaveBeenCalled();
  });

  it("still reports success when the storage removal fails", async () => {
    seedRow();
    storageRemove.mockResolvedValue({ data: null, error: { message: "storage down" } });
    const res = await callDelete();
    expect(res.status).toBe(200);
    expect(evidenceStore).toHaveLength(0);
    expect(console.warn).toHaveBeenCalled();
  });

  it("still reports success when the storage call throws", async () => {
    seedRow();
    storageRemove.mockRejectedValue(new Error("network"));
    const res = await callDelete();
    expect(res.status).toBe(200);
  });

  it("skips storage removal when the evidence bucket is not configured", async () => {
    vi.stubEnv("JUSTICE_EVIDENCE_BUCKET", "");
    seedRow();
    const res = await callDelete();
    expect(res.status).toBe(200);
    expect(storageRemove).not.toHaveBeenCalled();
  });

  it("does not touch storage when the row delete fails", async () => {
    seedRow();
    deleteError = { message: "db down" };
    const res = await callDelete();
    expect(res.status).toBe(500);
    expect(storageRemove).not.toHaveBeenCalled();
  });
});

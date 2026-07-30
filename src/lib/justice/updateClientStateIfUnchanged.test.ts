import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CLIENT_STATE_UPDATE_CONFLICT_ERROR,
  updateClientStateIfUnchanged,
} from "@/lib/justice/updateClientStateIfUnchanged";

const CASE_ID = "550e8400-e29b-41d4-a716-446655440000";
const USER_ID = "user-owner-1";

type MockState = {
  clientState: Record<string, unknown>;
  updatedAt: string;
  selectFail: boolean;
};

function createCasesSupabase(state: MockState): SupabaseClient {
  return {
    from: (table: string) => {
      if (table !== "justice_cases") {
        throw new Error(`unexpected table ${table}`);
      }
      return {
        update: (patch: Record<string, unknown>) => ({
          eq: (_col: string, _caseId: string) => ({
            eq: (_col2: string, _userId: string) => ({
              eq: (_col3: string, expectedUpdatedAt: string) => ({
                select: () => ({
                  maybeSingle: async () => {
                    if (state.selectFail) {
                      return { data: null, error: { message: "update failed" } };
                    }
                    if (expectedUpdatedAt !== state.updatedAt) {
                      return { data: null, error: null };
                    }
                    state.clientState = patch.client_state as Record<string, unknown>;
                    state.updatedAt = "2026-07-27T00:00:01.000Z";
                    return { data: { id: CASE_ID }, error: null };
                  },
                }),
              }),
            }),
          }),
        }),
      };
    },
  } as unknown as SupabaseClient;
}

describe("updateClientStateIfUnchanged", () => {
  it("writes client_state when updated_at still matches", async () => {
    const state: MockState = {
      clientState: {},
      updatedAt: "2026-07-27T00:00:00.000Z",
      selectFail: false,
    };

    const result = await updateClientStateIfUnchanged(createCasesSupabase(state), {
      caseId: CASE_ID,
      userId: USER_ID,
      expectedUpdatedAt: "2026-07-27T00:00:00.000Z",
      clientState: { approved_next_action: { status: "completed" } },
    });

    expect(result.ok).toBe(true);
    expect(state.clientState).toEqual({ approved_next_action: { status: "completed" } });
  });

  it("returns a 409 conflict without writing when updated_at no longer matches (concurrent writer won the race)", async () => {
    const state: MockState = {
      clientState: { approved_next_action: { status: "approved" } },
      updatedAt: "2026-07-27T00:05:00.000Z", // a concurrent writer already advanced this
      selectFail: false,
    };

    const result = await updateClientStateIfUnchanged(createCasesSupabase(state), {
      caseId: CASE_ID,
      userId: USER_ID,
      expectedUpdatedAt: "2026-07-27T00:00:00.000Z", // stale value read before the race
      clientState: { approved_next_action: { status: "completed" } },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(409);
    expect(result.error).toBe(CLIENT_STATE_UPDATE_CONFLICT_ERROR);
    // The concurrent writer's client_state must survive untouched — this is the actual
    // race-condition fix: a losing writer must fail closed, not silently clobber it.
    expect(state.clientState).toEqual({ approved_next_action: { status: "approved" } });
  });

  it("returns a 500 error when the update itself fails", async () => {
    const state: MockState = {
      clientState: {},
      updatedAt: "2026-07-27T00:00:00.000Z",
      selectFail: true,
    };

    const result = await updateClientStateIfUnchanged(createCasesSupabase(state), {
      caseId: CASE_ID,
      userId: USER_ID,
      expectedUpdatedAt: "2026-07-27T00:00:00.000Z",
      clientState: { approved_next_action: { status: "completed" } },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(500);
    expect(result.error).toBe("update failed");
  });
});

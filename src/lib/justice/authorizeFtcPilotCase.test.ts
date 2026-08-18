import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { authorizeFtcPilotCase } from "@/lib/justice/authorizeFtcPilotCase";
import { parseFtcPilotAuthorizationRecord } from "@/lib/justice/ftcPilotAuthorizationState";
import { upsertFtcOwnedFilingDeliveryNotes } from "@/lib/justice/ftcOwnedFilingDeliveryState";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";

vi.mock("@/server/justiceTimelineAppend", () => ({
  appendCaseTimelineEntry: vi.fn(async (_s, _u, _c, entry) => [entry]),
}));

const CASE_ID = "11111111-1111-4111-8111-111111111111";
const OWNER_USER_ID = "user_consumer_1";
const OPERATOR_USER_ID = "user_operator_1";
const TASK_ID = "22222222-2222-4222-8222-222222222222";

const APPROVED_FTC_CLIENT_STATE = {
  prepared_packet_approved: true,
  approved_next_action: { label: "FTC (consumer complaint)", href: "/justice/ftc", status: "approved" },
};

function chainThenMaybeSingle(data: unknown) {
  const terminal = {
    maybeSingle: async () => ({ data, error: null }),
    then: (resolve: (v: { data: unknown; error: null }) => unknown) =>
      Promise.resolve({ data, error: null }).then(resolve),
  };
  const self: Record<string, unknown> = { eq: () => self, is: () => self, select: () => self, ...terminal };
  return self;
}

function openTask(notes?: string): JusticeCaseTaskRow {
  return {
    id: TASK_ID,
    user_id: OWNER_USER_ID,
    case_id: CASE_ID,
    title: "FTC filing: Acme Retail",
    due_date: null,
    notes: notes ?? `ftc_filing_queue:${CASE_ID}\ndraft:\nFTC DRAFT`,
    completed_at: null,
    created_at: "2026-07-14T00:00:00.000Z",
    updated_at: "2026-07-14T00:00:00.000Z",
  };
}

function makeSupabase(handlers: {
  caseRow?: Record<string, unknown> | null;
  tasks?: JusticeCaseTaskRow[];
  filings?: unknown[];
  onTaskNotesUpdate?: (notes: string) => void;
}): SupabaseClient {
  const caseRow =
    handlers.caseRow === undefined
      ? { user_id: OWNER_USER_ID, client_state: APPROVED_FTC_CLIENT_STATE }
      : handlers.caseRow;
  const tasks = handlers.tasks ?? [openTask()];
  const filings = handlers.filings ?? [];

  return {
    from(table: string) {
      if (table === "justice_cases") {
        return { select: () => chainThenMaybeSingle(caseRow) };
      }
      if (table === "justice_case_tasks") {
        return {
          select: () => chainThenMaybeSingle(tasks),
          update: (payload: { notes: string }) => {
            handlers.onTaskNotesUpdate?.(payload.notes);
            return chainThenMaybeSingle({ ...tasks[0], notes: payload.notes });
          },
        };
      }
      if (table === "justice_case_filings") {
        return { select: () => chainThenMaybeSingle(filings) };
      }
      throw new Error(`unexpected table ${table}`);
    },
  } as unknown as SupabaseClient;
}

describe("authorizeFtcPilotCase", () => {
  it("rejects a blank case_id", async () => {
    const result = await authorizeFtcPilotCase(makeSupabase({}), OPERATOR_USER_ID, "  ");
    expect(result).toMatchObject({ ok: false, status: 400 });
  });

  it("rejects when the case does not exist", async () => {
    const result = await authorizeFtcPilotCase(
      makeSupabase({ caseRow: null }),
      OPERATOR_USER_ID,
      CASE_ID
    );
    expect(result).toMatchObject({ ok: false, status: 404 });
  });

  // Core safety property: the operator's own belief that a case is eligible is never trusted —
  // the system independently re-verifies consumer approval before authorizing anything.
  describe("verifies genuine consumer FTC approval before authorizing — never trusts the caller", () => {
    it("rejects when the packet is not approved", async () => {
      const result = await authorizeFtcPilotCase(
        makeSupabase({
          caseRow: {
            user_id: OWNER_USER_ID,
            client_state: { ...APPROVED_FTC_CLIENT_STATE, prepared_packet_approved: false },
          },
        }),
        OPERATOR_USER_ID,
        CASE_ID
      );
      expect(result).toMatchObject({ ok: false, status: 409 });
    });

    it("rejects when the approved next action is a different destination", async () => {
      const result = await authorizeFtcPilotCase(
        makeSupabase({
          caseRow: {
            user_id: OWNER_USER_ID,
            client_state: {
              prepared_packet_approved: true,
              approved_next_action: { label: "BBB", href: "/justice/bbb", status: "approved" },
            },
          },
        }),
        OPERATOR_USER_ID,
        CASE_ID
      );
      expect(result).toMatchObject({ ok: false, status: 409 });
    });

    it("rejects when FTC is already marked completed", async () => {
      const result = await authorizeFtcPilotCase(
        makeSupabase({
          caseRow: {
            user_id: OWNER_USER_ID,
            client_state: {
              prepared_packet_approved: true,
              approved_next_action: { label: "FTC", href: "/justice/ftc", status: "completed" },
            },
          },
        }),
        OPERATOR_USER_ID,
        CASE_ID
      );
      expect(result).toMatchObject({ ok: false, status: 409 });
    });
  });

  describe("rejects conflicting/ineligible task state", () => {
    it("rejects when there is no open FTC filing task", async () => {
      const result = await authorizeFtcPilotCase(
        makeSupabase({ tasks: [] }),
        OPERATOR_USER_ID,
        CASE_ID
      );
      expect(result).toMatchObject({ ok: false, status: 404 });
    });

    it("rejects when the task is already filed with a recorded confirmation", async () => {
      const result = await authorizeFtcPilotCase(
        makeSupabase({
          filings: [
            {
              id: "f1",
              user_id: OWNER_USER_ID,
              case_id: CASE_ID,
              destination: "FTC (consumer complaint)",
              filed_at: "2026-07-14",
              confirmation_number: "FTC-2026-4455",
              filing_url: null,
              notes: null,
              created_at: "2026-07-14T00:00:00.000Z",
              updated_at: "2026-07-14T00:00:00.000Z",
            },
          ],
        }),
        OPERATOR_USER_ID,
        CASE_ID
      );
      expect(result).toMatchObject({ ok: false, status: 409 });
    });

    it("rejects when the task's own notes already show delivery_state: submitting", async () => {
      const notes = upsertFtcOwnedFilingDeliveryNotes(`ftc_filing_queue:${CASE_ID}\ndraft:\nx`, {
        delivery_state: "submitting",
        provider: "real_ftc_bounded_submit",
      });
      const result = await authorizeFtcPilotCase(
        makeSupabase({ tasks: [openTask(notes)] }),
        OPERATOR_USER_ID,
        CASE_ID
      );
      expect(result).toMatchObject({ ok: false, status: 409 });
    });

    it("rejects when the task's own notes already show delivery_state: filed", async () => {
      const notes = upsertFtcOwnedFilingDeliveryNotes(`ftc_filing_queue:${CASE_ID}\ndraft:\nx`, {
        delivery_state: "filed",
        provider: "real_ftc_bounded_submit",
        confirmation: "FTC-2026-9999",
      });
      const result = await authorizeFtcPilotCase(
        makeSupabase({ tasks: [openTask(notes)] }),
        OPERATOR_USER_ID,
        CASE_ID
      );
      expect(result).toMatchObject({ ok: false, status: 409 });
    });
  });

  it("succeeds for a genuinely eligible case: writes the marker, no consumer data in the result", async () => {
    const noteUpdates: string[] = [];
    const result = await authorizeFtcPilotCase(
      makeSupabase({ onTaskNotesUpdate: (n) => noteUpdates.push(n) }),
      OPERATOR_USER_ID,
      CASE_ID
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.idempotent).toBe(false);
    expect(Object.keys(result)).toEqual(["ok", "task", "authorizedAt", "idempotent"]);

    const written = noteUpdates.at(-1);
    expect(written).toBeDefined();
    const record = parseFtcPilotAuthorizationRecord(written);
    expect(record?.authorized_by).toBe(OPERATOR_USER_ID);
    expect(record?.authorized_at).toBe(result.authorizedAt);
  });

  it("is idempotent: a second call preserves the original authorization instead of overwriting it", async () => {
    const priorNotes = `ftc_filing_queue:${CASE_ID}\ndraft:\nx\n\n---ftc_pilot_authorization---\nauthorized_by: user_operator_original\nauthorized_at: 2026-07-01T00:00:00.000Z`;
    const noteUpdates: string[] = [];
    const result = await authorizeFtcPilotCase(
      makeSupabase({ tasks: [openTask(priorNotes)], onTaskNotesUpdate: (n) => noteUpdates.push(n) }),
      OPERATOR_USER_ID,
      CASE_ID
    );
    expect(result).toMatchObject({ ok: true, idempotent: true, authorizedAt: "2026-07-01T00:00:00.000Z" });
    expect(noteUpdates.length).toBe(0); // no write on the idempotent path
  });
});

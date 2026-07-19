import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ftcOwnedFilingIdempotencyKey,
  ftcOwnedFilingTimelineId,
  isFtcOwnedFilingFailed,
  isFtcOwnedFilingSubmitting,
  parseFtcOwnedFilingDeliveryRecord,
  upsertFtcOwnedFilingDeliveryNotes,
  attemptAutomatedFtcFiling,
} from "@/lib/justice/ftcOwnedFilingDelivery";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";
import type { JusticeIntake } from "@/lib/justice/types";

vi.mock("@/server/justiceTimelineAppend", () => ({
  appendCaseTimelineEntry: vi.fn(async (_s, _u, _c, entry) => [entry]),
}));

vi.mock("@/lib/justice/realFtcAutofillEnabled", () => ({
  isRealFtcComplaintAutofillEnabled: vi.fn(() => true),
}));

vi.mock("@/lib/justice/surrenderlessOwnedStep", () => ({
  shouldSuppressChatManualActionForSurrenderlessOwnedStep: vi.fn(() => true),
}));

import { isRealFtcComplaintAutofillEnabled } from "@/lib/justice/realFtcAutofillEnabled";

const CASE_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "user_1";
const TASK_ID = "22222222-2222-4222-8222-222222222222";

function baseIntake(): JusticeIntake {
  return {
    problem_category: "online_purchase",
    company_name: "Acme Retail",
    company_website: "https://acme.example",
    purchase_or_signup: "widget",
    story: "Never arrived",
    money_involved: "$50",
    pay_or_order_date: "2026-01-01",
    order_confirmation_details: "ORD-1",
    user_display_name: "Pat Consumer",
    reply_email: "pat@example.com",
    already_contacted: "no",
  };
}

function chainThenMaybeSingle(data: unknown) {
  const terminal = {
    maybeSingle: async () => ({ data, error: null }),
    then: (resolve: (v: { data: unknown; error: null }) => unknown) =>
      Promise.resolve({ data, error: null }).then(resolve),
  };
  const self: Record<string, unknown> = {
    eq: () => self,
    select: () => self,
    ...terminal,
  };
  return self;
}

function makeSupabase(handlers: {
  caseRow?: Record<string, unknown> | null;
  tasks?: JusticeCaseTaskRow[];
  filings?: unknown[];
  onTaskNotesUpdate?: (notes: string) => void;
}): SupabaseClient {
  const caseRow =
    handlers.caseRow === undefined
      ? {
          intake: baseIntake(),
          client_state: {
            prepared_packet_approved: true,
            approved_next_action: {
              label: "FTC (consumer complaint)",
              href: "/justice/ftc",
              status: "approved",
            },
          },
          timeline: [],
        }
      : handlers.caseRow;
  const tasks = handlers.tasks ?? [
    {
      id: TASK_ID,
      user_id: USER_ID,
      case_id: CASE_ID,
      title: "FTC filing: Acme Retail",
      due_date: null,
      notes: `ftc_filing_queue:${CASE_ID}\ndraft:\nFTC DRAFT`,
      completed_at: null,
      created_at: "2026-07-14T00:00:00.000Z",
      updated_at: "2026-07-14T00:00:00.000Z",
    },
  ];
  const filings = handlers.filings ?? [];

  return {
    from(table: string) {
      if (table === "justice_cases") {
        return {
          select: () => chainThenMaybeSingle(caseRow),
        };
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
        return {
          select: () => chainThenMaybeSingle(filings),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  } as unknown as SupabaseClient;
}

function taskWithNotes(notes: string): JusticeCaseTaskRow {
  return {
    id: TASK_ID,
    user_id: USER_ID,
    case_id: CASE_ID,
    title: "FTC",
    due_date: null,
    notes,
    completed_at: null,
    created_at: "2026-07-14T00:00:00.000Z",
    updated_at: "2026-07-14T00:00:00.000Z",
  };
}

describe("ftcOwnedFilingDelivery helpers", () => {
  it("round-trips delivery records in task notes without dropping the draft", () => {
    const notes = `ftc_filing_queue:case-1\ndraft:\nFTC DRAFT`;
    const withSubmitting = upsertFtcOwnedFilingDeliveryNotes(notes, {
      delivery_state: "submitting",
      provider: "real_ftc_bounded_submit",
      started_at: "2026-07-14T12:00:00.000Z",
    });
    expect(withSubmitting).toContain("draft:\nFTC DRAFT");
    expect(parseFtcOwnedFilingDeliveryRecord(withSubmitting)).toEqual({
      delivery_state: "submitting",
      provider: "real_ftc_bounded_submit",
      started_at: "2026-07-14T12:00:00.000Z",
    });

    const withFailed = upsertFtcOwnedFilingDeliveryNotes(withSubmitting, {
      delivery_state: "failed",
      provider: "real_ftc_bounded_submit",
      failure_detail: "step cap",
      stop_reason: "max_steps_reached",
    });
    expect(parseFtcOwnedFilingDeliveryRecord(withFailed)?.delivery_state).toBe("failed");
    expect(withFailed).toContain("FTC DRAFT");
  });

  it("detects submitting and failed states on open tasks", () => {
    const submittingTask = taskWithNotes(
      upsertFtcOwnedFilingDeliveryNotes("marker", {
        delivery_state: "submitting",
        provider: "real_ftc_bounded_submit",
      })
    );
    expect(isFtcOwnedFilingSubmitting(submittingTask)).toBe(true);
    expect(isFtcOwnedFilingFailed(submittingTask)).toBe(false);

    const failedTask = taskWithNotes(
      upsertFtcOwnedFilingDeliveryNotes("marker", {
        delivery_state: "failed",
        provider: "real_ftc_bounded_submit",
        failure_detail: "no",
      })
    );
    expect(isFtcOwnedFilingFailed(failedTask)).toBe(true);
  });

  it("builds stable idempotency and timeline ids", () => {
    expect(ftcOwnedFilingIdempotencyKey(CASE_ID)).toBe(`ftc-owned-autofill:${CASE_ID}`);
    expect(ftcOwnedFilingTimelineId(CASE_ID, "filed")).toBe(`ftc_autofill_filed:${CASE_ID}`);
    expect(ftcOwnedFilingTimelineId(CASE_ID, "queued")).toBe(`ftc_autofill_queued:${CASE_ID}`);
  });
});

describe("attemptAutomatedFtcFiling (enqueue only, no Playwright on request path)", () => {
  beforeEach(() => {
    vi.mocked(isRealFtcComplaintAutofillEnabled).mockReturnValue(true);
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://127.0.0.1:3000");
    vi.stubEnv("BBB_DECIDE_ACTION_INTERNAL_SECRET", "test-decide-secret");
    vi.stubEnv("BROWSERLESS_URL", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("enqueues delivery_state: queued and returns immediately (nonblocking dispatch)", async () => {
    const noteUpdates: string[] = [];
    const result = await attemptAutomatedFtcFiling(
      makeSupabase({ onTaskNotesUpdate: (n) => noteUpdates.push(n) }),
      USER_ID,
      CASE_ID
    );
    expect(result).toMatchObject({ status: "queued", idempotent: false });
    expect(noteUpdates.at(-1)).toContain("delivery_state: queued");
    expect(noteUpdates.some((n) => n.includes("delivery_state: submitting"))).toBe(false);
  });

  it("skips when real FTC autofill is disabled (no false submitted state)", async () => {
    vi.mocked(isRealFtcComplaintAutofillEnabled).mockReturnValue(false);
    const noteUpdates: string[] = [];
    const result = await attemptAutomatedFtcFiling(
      makeSupabase({ onTaskNotesUpdate: (n) => noteUpdates.push(n) }),
      USER_ID,
      CASE_ID
    );
    expect(result.status).toBe("skipped");
    expect(noteUpdates.length).toBe(0);
  });

  it("skips without enqueue when production Browserless configuration is missing", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("BROWSERLESS_URL", "");
    const noteUpdates: string[] = [];
    const result = await attemptAutomatedFtcFiling(
      makeSupabase({ onTaskNotesUpdate: (n) => noteUpdates.push(n) }),
      USER_ID,
      CASE_ID
    );
    expect(result).toMatchObject({
      status: "skipped",
      reason: expect.stringContaining("BROWSERLESS_URL"),
    });
    expect(noteUpdates.length).toBe(0);
  });

  it("does not re-enqueue when already queued (idempotent)", async () => {
    const notes = upsertFtcOwnedFilingDeliveryNotes(`ftc_filing_queue:${CASE_ID}\ndraft:\nx`, {
      delivery_state: "queued",
      provider: "real_ftc_bounded_submit",
      started_at: "2026-07-14T00:00:00.000Z",
    });
    const noteUpdates: string[] = [];
    const result = await attemptAutomatedFtcFiling(
      makeSupabase({ tasks: [taskWithNotes(notes)], onTaskNotesUpdate: (n) => noteUpdates.push(n) }),
      USER_ID,
      CASE_ID
    );
    expect(result).toMatchObject({ status: "queued", idempotent: true });
    expect(noteUpdates.length).toBe(0);
  });

  it("skips duplicate enqueue while already submitting (worker in progress)", async () => {
    const notes = upsertFtcOwnedFilingDeliveryNotes(`ftc_filing_queue:${CASE_ID}\ndraft:\nx`, {
      delivery_state: "submitting",
      provider: "real_ftc_bounded_submit",
    });
    const result = await attemptAutomatedFtcFiling(
      makeSupabase({ tasks: [taskWithNotes(notes)] }),
      USER_ID,
      CASE_ID
    );
    expect(result).toMatchObject({
      status: "skipped",
      reason: expect.stringContaining("already submitting"),
    });
  });

  it("short-circuits and never re-dispatches a reconciled failed delivery", async () => {
    const notes = upsertFtcOwnedFilingDeliveryNotes(`ftc_filing_queue:${CASE_ID}\ndraft:\nx`, {
      delivery_state: "failed",
      provider: "real_ftc_bounded_submit",
      failure_detail: "stale reclaimed",
    });
    const noteUpdates: string[] = [];
    const result = await attemptAutomatedFtcFiling(
      makeSupabase({ tasks: [taskWithNotes(notes)], onTaskNotesUpdate: (n) => noteUpdates.push(n) }),
      USER_ID,
      CASE_ID
    );
    expect(result).toMatchObject({
      status: "skipped",
      reason: expect.stringContaining("previously failed"),
    });
    expect(noteUpdates.length).toBe(0);
  });

  it("returns accepted idempotently when the task already recorded a filed confirmation", async () => {
    const notes = upsertFtcOwnedFilingDeliveryNotes(`ftc_filing_queue:${CASE_ID}\ndraft:\nx`, {
      delivery_state: "filed",
      provider: "real_ftc_bounded_submit",
      confirmation: "FTC-2026-4455",
    });
    const result = await attemptAutomatedFtcFiling(
      makeSupabase({ tasks: [taskWithNotes(notes)] }),
      USER_ID,
      CASE_ID
    );
    expect(result).toMatchObject({
      status: "accepted",
      idempotent: true,
      confirmation: "FTC-2026-4455",
    });
  });
});

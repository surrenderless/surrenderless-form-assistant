import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  bbbOwnedFilingIdempotencyKey,
  bbbOwnedFilingTimelineId,
  isBbbOwnedFilingFailed,
  isBbbOwnedFilingSubmitting,
  parseBbbOwnedFilingDeliveryRecord,
  upsertBbbOwnedFilingDeliveryNotes,
  attemptAutomatedBbbFiling,
} from "@/lib/justice/bbbOwnedFilingDelivery";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";
import type { JusticeIntake } from "@/lib/justice/types";

vi.mock("@/server/justiceTimelineAppend", () => ({
  appendCaseTimelineEntry: vi.fn(async (_s, _u, _c, entry) => [entry]),
}));

vi.mock("@/lib/justice/realBbbAutofillEnabled", () => ({
  isRealBbbComplaintAutofillEnabled: vi.fn(() => true),
}));

vi.mock("@/lib/justice/surrenderlessOwnedStep", () => ({
  shouldSuppressChatManualActionForSurrenderlessOwnedStep: vi.fn(() => true),
}));

import { isRealBbbComplaintAutofillEnabled } from "@/lib/justice/realBbbAutofillEnabled";

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
  const self: Record<string, unknown> = { eq: () => self, select: () => self, ...terminal };
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
              label: "Better Business Bureau",
              href: "/justice/bbb",
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
      title: "BBB filing: Acme Retail",
      due_date: null,
      notes: `bbb_filing_queue:${CASE_ID}\ndraft:\nBBB DRAFT`,
      completed_at: null,
      created_at: "2026-07-14T00:00:00.000Z",
      updated_at: "2026-07-14T00:00:00.000Z",
    },
  ];
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

function taskWithNotes(notes: string): JusticeCaseTaskRow {
  return {
    id: TASK_ID,
    user_id: USER_ID,
    case_id: CASE_ID,
    title: "BBB",
    due_date: null,
    notes,
    completed_at: null,
    created_at: "2026-07-14T00:00:00.000Z",
    updated_at: "2026-07-14T00:00:00.000Z",
  };
}

describe("bbbOwnedFilingDelivery helpers", () => {
  it("round-trips delivery records in task notes without dropping the draft", () => {
    const notes = `bbb_filing_queue:case-1\ndraft:\nBBB DRAFT`;
    const withSubmitting = upsertBbbOwnedFilingDeliveryNotes(notes, {
      delivery_state: "submitting",
      provider: "real_bbb_bounded_submit",
      started_at: "2026-07-14T12:00:00.000Z",
    });
    expect(withSubmitting).toContain("draft:\nBBB DRAFT");
    expect(parseBbbOwnedFilingDeliveryRecord(withSubmitting)).toEqual({
      delivery_state: "submitting",
      provider: "real_bbb_bounded_submit",
      started_at: "2026-07-14T12:00:00.000Z",
    });

    const withFailed = upsertBbbOwnedFilingDeliveryNotes(withSubmitting, {
      delivery_state: "failed",
      provider: "real_bbb_bounded_submit",
      failure_detail: "step cap",
      stop_reason: "step_cap",
    });
    expect(parseBbbOwnedFilingDeliveryRecord(withFailed)?.delivery_state).toBe("failed");
    expect(withFailed).toContain("BBB DRAFT");
  });

  it("detects submitting and failed states on open tasks", () => {
    const submittingTask = taskWithNotes(
      upsertBbbOwnedFilingDeliveryNotes("marker", {
        delivery_state: "submitting",
        provider: "real_bbb_bounded_submit",
      })
    );
    expect(isBbbOwnedFilingSubmitting(submittingTask)).toBe(true);
    expect(isBbbOwnedFilingFailed(submittingTask)).toBe(false);

    const failedTask = taskWithNotes(
      upsertBbbOwnedFilingDeliveryNotes("marker", {
        delivery_state: "failed",
        provider: "real_bbb_bounded_submit",
        failure_detail: "no",
      })
    );
    expect(isBbbOwnedFilingFailed(failedTask)).toBe(true);
  });

  it("builds stable idempotency and timeline ids", () => {
    expect(bbbOwnedFilingIdempotencyKey(CASE_ID)).toBe(`bbb-owned-autofill:${CASE_ID}`);
    expect(bbbOwnedFilingTimelineId(CASE_ID, "filed")).toBe(`bbb_autofill_filed:${CASE_ID}`);
    expect(bbbOwnedFilingTimelineId(CASE_ID, "queued")).toBe(`bbb_autofill_queued:${CASE_ID}`);
  });
});

describe("attemptAutomatedBbbFiling (enqueue only, no Playwright on request path)", () => {
  beforeEach(() => {
    vi.mocked(isRealBbbComplaintAutofillEnabled).mockReturnValue(true);
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
    const result = await attemptAutomatedBbbFiling(
      makeSupabase({ onTaskNotesUpdate: (n) => noteUpdates.push(n) }),
      USER_ID,
      CASE_ID
    );
    expect(result).toMatchObject({ status: "queued", idempotent: false });
    expect(noteUpdates.at(-1)).toContain("delivery_state: queued");
    expect(noteUpdates.some((n) => n.includes("delivery_state: submitting"))).toBe(false);
  });

  it("skips when realtime BBB autofill is disabled", async () => {
    vi.mocked(isRealBbbComplaintAutofillEnabled).mockReturnValue(false);
    const noteUpdates: string[] = [];
    const result = await attemptAutomatedBbbFiling(
      makeSupabase({ onTaskNotesUpdate: (n) => noteUpdates.push(n) }),
      USER_ID,
      CASE_ID
    );
    expect(result.status).toBe("skipped");
    expect(noteUpdates.length).toBe(0);
  });

  it("skips without enqueue when production execution readiness fails", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("BROWSERLESS_URL", "");
    const noteUpdates: string[] = [];
    const result = await attemptAutomatedBbbFiling(
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
    const notes = upsertBbbOwnedFilingDeliveryNotes(`bbb_filing_queue:${CASE_ID}\ndraft:\nx`, {
      delivery_state: "queued",
      provider: "real_bbb_bounded_submit",
      started_at: "2026-07-14T00:00:00.000Z",
    });
    const noteUpdates: string[] = [];
    const result = await attemptAutomatedBbbFiling(
      makeSupabase({ tasks: [taskWithNotes(notes)], onTaskNotesUpdate: (n) => noteUpdates.push(n) }),
      USER_ID,
      CASE_ID
    );
    expect(result).toMatchObject({ status: "queued", idempotent: true });
    expect(noteUpdates.length).toBe(0);
  });

  it("skips duplicate enqueue while already submitting (worker in progress)", async () => {
    const notes = upsertBbbOwnedFilingDeliveryNotes(`bbb_filing_queue:${CASE_ID}\ndraft:\nx`, {
      delivery_state: "submitting",
      provider: "real_bbb_bounded_submit",
    });
    const result = await attemptAutomatedBbbFiling(
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
    const notes = upsertBbbOwnedFilingDeliveryNotes(`bbb_filing_queue:${CASE_ID}\ndraft:\nx`, {
      delivery_state: "failed",
      provider: "real_bbb_bounded_submit",
      failure_detail: "stale reclaimed",
    });
    const noteUpdates: string[] = [];
    const result = await attemptAutomatedBbbFiling(
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
});

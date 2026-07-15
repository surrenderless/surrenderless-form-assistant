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

vi.mock("@/lib/justice/runRealBbbBoundedSubmit", () => ({
  runRealBbbBoundedSubmit: vi.fn(),
}));

vi.mock("@/lib/justice/completeBbbOperatorFiling", () => ({
  completeBbbOperatorFiling: vi.fn(),
}));

vi.mock("@/server/justiceTimelineAppend", () => ({
  appendCaseTimelineEntry: vi.fn(async (_s, _u, _c, entry) => [entry]),
}));

vi.mock("@/lib/justice/realBbbAutofillEnabled", () => ({
  isRealBbbComplaintAutofillEnabled: vi.fn(() => true),
}));

vi.mock("@/lib/justice/surrenderlessOwnedStep", () => ({
  shouldSuppressChatManualActionForSurrenderlessOwnedStep: vi.fn(() => true),
}));

import { runRealBbbBoundedSubmit } from "@/lib/justice/runRealBbbBoundedSubmit";
import { completeBbbOperatorFiling } from "@/lib/justice/completeBbbOperatorFiling";
import { isRealBbbComplaintAutofillEnabled } from "@/lib/justice/realBbbAutofillEnabled";
import { runWithBbbOwnedFilingSubmitContext } from "@/lib/justice/bbbOwnedFilingSubmitContext";

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
    const submittingTask: JusticeCaseTaskRow = {
      id: "t1",
      user_id: "u1",
      case_id: "c1",
      title: "BBB",
      due_date: null,
      notes: upsertBbbOwnedFilingDeliveryNotes("marker", {
        delivery_state: "submitting",
        provider: "real_bbb_bounded_submit",
      }),
      completed_at: null,
      created_at: "2026-07-14T00:00:00.000Z",
      updated_at: "2026-07-14T00:00:00.000Z",
    };
    expect(isBbbOwnedFilingSubmitting(submittingTask)).toBe(true);
    expect(isBbbOwnedFilingFailed(submittingTask)).toBe(false);

    const failedTask: JusticeCaseTaskRow = {
      ...submittingTask,
      notes: upsertBbbOwnedFilingDeliveryNotes("marker", {
        delivery_state: "failed",
        provider: "real_bbb_bounded_submit",
        failure_detail: "no",
      }),
    };
    expect(isBbbOwnedFilingFailed(failedTask)).toBe(true);
  });

  it("builds stable idempotency and timeline ids", () => {
    expect(bbbOwnedFilingIdempotencyKey(CASE_ID)).toBe(`bbb-owned-autofill:${CASE_ID}`);
    expect(bbbOwnedFilingTimelineId(CASE_ID, "filed")).toBe(`bbb_autofill_filed:${CASE_ID}`);
  });
});

describe("attemptAutomatedBbbFiling", () => {
  beforeEach(() => {
    vi.mocked(isRealBbbComplaintAutofillEnabled).mockReturnValue(true);
    vi.mocked(runRealBbbBoundedSubmit).mockReset();
    vi.mocked(completeBbbOperatorFiling).mockReset();
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://127.0.0.1:3000");
    vi.stubEnv("BBB_DECIDE_ACTION_INTERNAL_SECRET", "test-decide-secret");
    vi.stubEnv("BROWSERLESS_URL", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("skips when realtime BBB autofill is disabled", async () => {
    vi.mocked(isRealBbbComplaintAutofillEnabled).mockReturnValue(false);
    const result = await attemptAutomatedBbbFiling(makeSupabase({}), USER_ID, CASE_ID);
    expect(result.status).toBe("skipped");
    expect(runRealBbbBoundedSubmit).not.toHaveBeenCalled();
  });

  it("skips without submitting when production execution readiness fails", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("BROWSERLESS_URL", "");
    const result = await attemptAutomatedBbbFiling(makeSupabase({}), USER_ID, CASE_ID);
    expect(result).toMatchObject({
      status: "skipped",
      reason: expect.stringContaining("BROWSERLESS_URL"),
    });
    expect(runRealBbbBoundedSubmit).not.toHaveBeenCalled();
  });

  it("skips duplicate submit while already submitting", async () => {
    const notes = upsertBbbOwnedFilingDeliveryNotes(`bbb_filing_queue:${CASE_ID}\ndraft:\nx`, {
      delivery_state: "submitting",
      provider: "real_bbb_bounded_submit",
    });
    const result = await attemptAutomatedBbbFiling(
      makeSupabase({
        tasks: [
          {
            id: TASK_ID,
            user_id: USER_ID,
            case_id: CASE_ID,
            title: "BBB",
            due_date: null,
            notes,
            completed_at: null,
            created_at: "2026-07-14T00:00:00.000Z",
            updated_at: "2026-07-14T00:00:00.000Z",
          },
        ],
      }),
      USER_ID,
      CASE_ID
    );
    expect(result).toMatchObject({
      status: "skipped",
      reason: expect.stringContaining("already submitting"),
    });
    expect(runRealBbbBoundedSubmit).not.toHaveBeenCalled();
  });

  it("completes only after terminal bounded-submit confirmation", async () => {
    vi.mocked(runRealBbbBoundedSubmit).mockResolvedValue({
      ok: true,
      fillResult: {
        status: "success",
        screenshot: null,
        pageData: null,
        stepsExecuted: 2,
        stopReason: "terminal_confirmation",
        stepLog: [],
      },
    });
    vi.mocked(completeBbbOperatorFiling).mockResolvedValue({
      ok: true,
      filing: {
        id: "f1",
        user_id: USER_ID,
        case_id: CASE_ID,
        destination: "Better Business Bureau",
        filed_at: "2026-07-14",
        confirmation_number: "BBB complaint complete",
        filing_url: null,
        notes: null,
        created_at: "2026-07-14T00:00:00.000Z",
        updated_at: "2026-07-14T00:00:00.000Z",
      },
      task: {
        id: TASK_ID,
        user_id: USER_ID,
        case_id: CASE_ID,
        title: "BBB",
        due_date: null,
        notes: "done",
        completed_at: "2026-07-14T00:00:00.000Z",
        created_at: "2026-07-14T00:00:00.000Z",
        updated_at: "2026-07-14T00:00:00.000Z",
      },
      clientState: {},
      timeline: [],
      advanced: false,
      idempotent: false,
    });

    const noteUpdates: string[] = [];
    const result = await runWithBbbOwnedFilingSubmitContext(
      {
        base: "http://127.0.0.1:3000",
        forwardedHeaders: { "Content-Type": "application/json", cookie: "session=1" },
      },
      () =>
        attemptAutomatedBbbFiling(
          makeSupabase({ onTaskNotesUpdate: (n) => noteUpdates.push(n) }),
          USER_ID,
          CASE_ID
        )
    );

    expect(result.status).toBe("accepted");
    expect(runRealBbbBoundedSubmit).toHaveBeenCalledTimes(1);
    expect(runRealBbbBoundedSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        forwardedHeaders: expect.objectContaining({
          "x-surrenderless-bbb-decide-secret": "test-decide-secret",
          "x-surrenderless-bbb-user-id": USER_ID,
        }),
      })
    );
    expect(completeBbbOperatorFiling).toHaveBeenCalledTimes(1);
    expect(noteUpdates.some((n) => n.includes("delivery_state: submitting"))).toBe(true);
  });

  it("marks failed and leaves task open when bounded submit does not confirm", async () => {
    vi.mocked(runRealBbbBoundedSubmit).mockResolvedValue({
      ok: false,
      error: "did not reach confirmation",
      stopReason: "max_steps_reached",
      stepsExecuted: 8,
      fillResult: {
        screenshot: null,
        pageData: null,
        stepsExecuted: 8,
        stopReason: "max_steps_reached",
        stepLog: [],
      },
      technicalDetails: {},
    });

    const noteUpdates: string[] = [];
    const result = await runWithBbbOwnedFilingSubmitContext(
      {
        base: "http://127.0.0.1:3000",
        forwardedHeaders: { cookie: "session=1", "Content-Type": "application/json" },
      },
      () =>
        attemptAutomatedBbbFiling(
          makeSupabase({ onTaskNotesUpdate: (n) => noteUpdates.push(n) }),
          USER_ID,
          CASE_ID
        )
    );

    expect(result.status).toBe("failed");
    expect(completeBbbOperatorFiling).not.toHaveBeenCalled();
    expect(noteUpdates.at(-1)).toContain("delivery_state: failed");
  });
});

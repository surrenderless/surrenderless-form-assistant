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
  REAL_FTC_FILING_CONFIRMATION_FALLBACK,
} from "@/lib/justice/ftcOwnedFilingDelivery";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";
import type { JusticeIntake } from "@/lib/justice/types";

vi.mock("@/lib/justice/runRealFtcBoundedSubmit", () => ({
  runRealFtcBoundedSubmit: vi.fn(),
}));

vi.mock("@/lib/justice/completeFtcOperatorFiling", () => ({
  completeFtcOperatorFiling: vi.fn(),
}));

vi.mock("@/server/justiceTimelineAppend", () => ({
  appendCaseTimelineEntry: vi.fn(async (_s, _u, _c, entry) => [entry]),
}));

vi.mock("@/lib/justice/realFtcAutofillEnabled", () => ({
  isRealFtcComplaintAutofillEnabled: vi.fn(() => true),
}));

vi.mock("@/lib/justice/surrenderlessOwnedStep", () => ({
  shouldSuppressChatManualActionForSurrenderlessOwnedStep: vi.fn(() => true),
}));

import { runRealFtcBoundedSubmit } from "@/lib/justice/runRealFtcBoundedSubmit";
import { completeFtcOperatorFiling } from "@/lib/justice/completeFtcOperatorFiling";
import { isRealFtcComplaintAutofillEnabled } from "@/lib/justice/realFtcAutofillEnabled";
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

function successBoundedResult(confirmationReference: string | null) {
  return {
    ok: true as const,
    fillResult: {
      status: "success" as const,
      screenshot: "https://storage.example/screenshots/x.png",
      pageData: null,
      confirmationReference,
      stepsExecuted: 3,
      stopReason: "terminal_confirmation" as const,
      stepLog: [],
    },
  };
}

function completedFilingResult() {
  return {
    ok: true as const,
    filing: {
      id: "f1",
      user_id: USER_ID,
      case_id: CASE_ID,
      destination: "FTC (consumer complaint)",
      filed_at: "2026-07-14",
      confirmation_number: "FTC-2026-4455",
      filing_url: null,
      notes: null,
      created_at: "2026-07-14T00:00:00.000Z",
      updated_at: "2026-07-14T00:00:00.000Z",
    },
    task: {
      id: TASK_ID,
      user_id: USER_ID,
      case_id: CASE_ID,
      title: "FTC",
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
    const submittingTask: JusticeCaseTaskRow = {
      id: "t1",
      user_id: "u1",
      case_id: "c1",
      title: "FTC",
      due_date: null,
      notes: upsertFtcOwnedFilingDeliveryNotes("marker", {
        delivery_state: "submitting",
        provider: "real_ftc_bounded_submit",
      }),
      completed_at: null,
      created_at: "2026-07-14T00:00:00.000Z",
      updated_at: "2026-07-14T00:00:00.000Z",
    };
    expect(isFtcOwnedFilingSubmitting(submittingTask)).toBe(true);
    expect(isFtcOwnedFilingFailed(submittingTask)).toBe(false);

    const failedTask: JusticeCaseTaskRow = {
      ...submittingTask,
      notes: upsertFtcOwnedFilingDeliveryNotes("marker", {
        delivery_state: "failed",
        provider: "real_ftc_bounded_submit",
        failure_detail: "no",
      }),
    };
    expect(isFtcOwnedFilingFailed(failedTask)).toBe(true);
  });

  it("builds stable idempotency and timeline ids", () => {
    expect(ftcOwnedFilingIdempotencyKey(CASE_ID)).toBe(`ftc-owned-autofill:${CASE_ID}`);
    expect(ftcOwnedFilingTimelineId(CASE_ID, "filed")).toBe(`ftc_autofill_filed:${CASE_ID}`);
  });
});

describe("attemptAutomatedFtcFiling", () => {
  beforeEach(() => {
    vi.mocked(isRealFtcComplaintAutofillEnabled).mockReturnValue(true);
    vi.mocked(runRealFtcBoundedSubmit).mockReset();
    vi.mocked(completeFtcOperatorFiling).mockReset();
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://127.0.0.1:3000");
    vi.stubEnv("BBB_DECIDE_ACTION_INTERNAL_SECRET", "test-decide-secret");
    vi.stubEnv("BROWSERLESS_URL", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("skips when real FTC autofill is disabled (no false submitted state)", async () => {
    vi.mocked(isRealFtcComplaintAutofillEnabled).mockReturnValue(false);
    const result = await attemptAutomatedFtcFiling(makeSupabase({}), USER_ID, CASE_ID);
    expect(result.status).toBe("skipped");
    expect(runRealFtcBoundedSubmit).not.toHaveBeenCalled();
  });

  it("skips without submitting when production Browserless configuration is missing", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("BROWSERLESS_URL", "");
    const result = await attemptAutomatedFtcFiling(makeSupabase({}), USER_ID, CASE_ID);
    expect(result).toMatchObject({
      status: "skipped",
      reason: expect.stringContaining("BROWSERLESS_URL"),
    });
    expect(runRealFtcBoundedSubmit).not.toHaveBeenCalled();
  });

  it("skips duplicate submit while already submitting (idempotency)", async () => {
    const notes = upsertFtcOwnedFilingDeliveryNotes(`ftc_filing_queue:${CASE_ID}\ndraft:\nx`, {
      delivery_state: "submitting",
      provider: "real_ftc_bounded_submit",
    });
    const result = await attemptAutomatedFtcFiling(
      makeSupabase({
        tasks: [
          {
            id: TASK_ID,
            user_id: USER_ID,
            case_id: CASE_ID,
            title: "FTC",
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
    expect(runRealFtcBoundedSubmit).not.toHaveBeenCalled();
  });

  it("returns accepted idempotently when the task already recorded a filed confirmation", async () => {
    const notes = upsertFtcOwnedFilingDeliveryNotes(`ftc_filing_queue:${CASE_ID}\ndraft:\nx`, {
      delivery_state: "filed",
      provider: "real_ftc_bounded_submit",
      confirmation: "FTC-2026-4455",
    });
    const result = await attemptAutomatedFtcFiling(
      makeSupabase({
        tasks: [
          {
            id: TASK_ID,
            user_id: USER_ID,
            case_id: CASE_ID,
            title: "FTC",
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
      status: "accepted",
      idempotent: true,
      confirmation: "FTC-2026-4455",
    });
    expect(runRealFtcBoundedSubmit).not.toHaveBeenCalled();
  });

  it("completes and persists the real confirmation reference after terminal confirmation", async () => {
    vi.mocked(runRealFtcBoundedSubmit).mockResolvedValue(successBoundedResult("FTC-2026-4455"));
    vi.mocked(completeFtcOperatorFiling).mockResolvedValue(completedFilingResult());

    const noteUpdates: string[] = [];
    const result = await runWithBbbOwnedFilingSubmitContext(
      {
        base: "http://127.0.0.1:3000",
        forwardedHeaders: { "Content-Type": "application/json", cookie: "session=1" },
      },
      () =>
        attemptAutomatedFtcFiling(
          makeSupabase({ onTaskNotesUpdate: (n) => noteUpdates.push(n) }),
          USER_ID,
          CASE_ID
        )
    );

    expect(result).toMatchObject({ status: "accepted", confirmation: "FTC-2026-4455" });
    expect(runRealFtcBoundedSubmit).toHaveBeenCalledTimes(1);
    expect(runRealFtcBoundedSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://reportfraud.ftc.gov/",
        forwardedHeaders: expect.objectContaining({
          "x-surrenderless-bbb-decide-secret": "test-decide-secret",
          "x-surrenderless-bbb-user-id": USER_ID,
        }),
      })
    );
    expect(completeFtcOperatorFiling).toHaveBeenCalledTimes(1);
    expect(completeFtcOperatorFiling).toHaveBeenCalledWith(
      expect.anything(),
      USER_ID,
      expect.objectContaining({
        destination: "FTC (consumer complaint)",
        confirmationNumber: "FTC-2026-4455",
      })
    );
    expect(noteUpdates.some((n) => n.includes("delivery_state: submitting"))).toBe(true);
  });

  it("falls back to a generic confirmation when the portal exposes no readable reference", async () => {
    vi.mocked(runRealFtcBoundedSubmit).mockResolvedValue(successBoundedResult(null));
    vi.mocked(completeFtcOperatorFiling).mockResolvedValue(completedFilingResult());

    const result = await runWithBbbOwnedFilingSubmitContext(
      {
        base: "http://127.0.0.1:3000",
        forwardedHeaders: { "Content-Type": "application/json" },
      },
      () => attemptAutomatedFtcFiling(makeSupabase({}), USER_ID, CASE_ID)
    );

    expect(result).toMatchObject({ status: "accepted" });
    expect(completeFtcOperatorFiling).toHaveBeenCalledWith(
      expect.anything(),
      USER_ID,
      expect.objectContaining({ confirmationNumber: REAL_FTC_FILING_CONFIRMATION_FALLBACK })
    );
  });

  it("marks failed and leaves task open on uncertain portal state (operator fallback)", async () => {
    vi.mocked(runRealFtcBoundedSubmit).mockResolvedValue({
      ok: false,
      error: "assistant returned an invalid next action",
      stopReason: "invalid_decision",
      stepsExecuted: 2,
      fillResult: {
        screenshot: null,
        pageData: null,
        stepsExecuted: 2,
        stopReason: "invalid_decision",
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
        attemptAutomatedFtcFiling(
          makeSupabase({ onTaskNotesUpdate: (n) => noteUpdates.push(n) }),
          USER_ID,
          CASE_ID
        )
    );

    expect(result.status).toBe("failed");
    expect(completeFtcOperatorFiling).not.toHaveBeenCalled();
    expect(noteUpdates.at(-1)).toContain("delivery_state: failed");
  });

  it("marks failed and leaves task open when the provider throws (operator fallback)", async () => {
    vi.mocked(runRealFtcBoundedSubmit).mockRejectedValue(new Error("Browserless connection refused"));

    const noteUpdates: string[] = [];
    const result = await runWithBbbOwnedFilingSubmitContext(
      {
        base: "http://127.0.0.1:3000",
        forwardedHeaders: { cookie: "session=1", "Content-Type": "application/json" },
      },
      () =>
        attemptAutomatedFtcFiling(
          makeSupabase({ onTaskNotesUpdate: (n) => noteUpdates.push(n) }),
          USER_ID,
          CASE_ID
        )
    );

    expect(result).toMatchObject({ status: "failed" });
    expect(completeFtcOperatorFiling).not.toHaveBeenCalled();
    expect(noteUpdates.at(-1)).toContain("delivery_state: failed");
  });
});

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";
import type { JusticeIntake } from "@/lib/justice/types";
import { upsertFtcOwnedFilingDeliveryNotes } from "@/lib/justice/ftcOwnedFilingDeliveryState";
import { REAL_FTC_FILING_CONFIRMATION_FALLBACK } from "@/lib/justice/ftcOwnedFilingDelivery";

vi.mock("@/lib/justice/runRealFtcBoundedSubmit", () => ({
  runRealFtcBoundedSubmit: vi.fn(),
}));
vi.mock("@/lib/justice/completeFtcOperatorFiling", () => ({
  completeFtcOperatorFiling: vi.fn(),
}));
vi.mock("@/server/justiceTimelineAppend", () => ({
  appendCaseTimelineEntry: vi.fn(async (_s, _u, _c, entry) => [entry]),
}));

import { runRealFtcBoundedSubmit } from "@/lib/justice/runRealFtcBoundedSubmit";
import { completeFtcOperatorFiling } from "@/lib/justice/completeFtcOperatorFiling";
import { executeClaimedFtcFiling } from "@/lib/justice/ftcOwnedFilingExecute";

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

function makeSupabase(onTaskNotesUpdate?: (notes: string) => void): SupabaseClient {
  const caseRow = { intake: baseIntake() };
  return {
    from(table: string) {
      if (table === "justice_cases") {
        return { select: () => chainThenMaybeSingle(caseRow) };
      }
      if (table === "justice_case_tasks") {
        return {
          update: (payload: { notes: string }) => {
            onTaskNotesUpdate?.(payload.notes);
            return chainThenMaybeSingle({ id: TASK_ID, notes: payload.notes });
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  } as unknown as SupabaseClient;
}

function claimedTask(): JusticeCaseTaskRow {
  return {
    id: TASK_ID,
    user_id: USER_ID,
    case_id: CASE_ID,
    title: "FTC filing: Acme Retail",
    due_date: null,
    notes: upsertFtcOwnedFilingDeliveryNotes(`ftc_filing_queue:${CASE_ID}\ndraft:\nx`, {
      delivery_state: "submitting",
      provider: "real_ftc_bounded_submit",
      started_at: "2026-07-14T00:00:00.000Z",
    }),
    completed_at: null,
    created_at: "2026-07-14T00:00:00.000Z",
    updated_at: "2026-07-14T00:00:00.000Z",
  };
}

function successBoundedResult(confirmationReference: string | null) {
  return {
    ok: true as const,
    fillResult: {
      status: "success" as const,
      screenshot: "https://storage.example/x.png",
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
    task: { ...claimedTask(), completed_at: "2026-07-14T00:00:00.000Z" },
    clientState: {},
    timeline: [],
    advanced: false,
    idempotent: false,
  };
}

describe("executeClaimedFtcFiling (worker execution off the request path)", () => {
  beforeEach(() => {
    vi.mocked(runRealFtcBoundedSubmit).mockReset();
    vi.mocked(completeFtcOperatorFiling).mockReset();
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://127.0.0.1:3000");
    vi.stubEnv("BBB_DECIDE_ACTION_INTERNAL_SECRET", "test-decide-secret");
    vi.stubEnv("BROWSERLESS_URL", "");
    vi.stubEnv("OWNED_FILING_SUBMIT_ARMED", "true");
    vi.stubEnv("OWNED_FILING_LIVE_CASE_ALLOWLIST", CASE_ID);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("completes and persists the real confirmation reference after terminal confirmation", async () => {
    vi.mocked(runRealFtcBoundedSubmit).mockResolvedValue(successBoundedResult("FTC-2026-4455"));
    vi.mocked(completeFtcOperatorFiling).mockResolvedValue(completedFilingResult());

    const result = await executeClaimedFtcFiling(makeSupabase(), USER_ID, CASE_ID, claimedTask());
    expect(result).toMatchObject({ status: "accepted", confirmation: "FTC-2026-4455" });
    expect(runRealFtcBoundedSubmit).toHaveBeenCalledTimes(1);
    expect(runRealFtcBoundedSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ url: "https://reportfraud.ftc.gov/", mode: "live" })
    );
    expect(completeFtcOperatorFiling).toHaveBeenCalledWith(
      expect.anything(),
      USER_ID,
      expect.objectContaining({
        destination: "FTC (consumer complaint)",
        confirmationNumber: "FTC-2026-4455",
      })
    );
  });

  it("falls back to a generic confirmation when the portal exposes no readable reference", async () => {
    vi.mocked(runRealFtcBoundedSubmit).mockResolvedValue(successBoundedResult(null));
    vi.mocked(completeFtcOperatorFiling).mockResolvedValue(completedFilingResult());

    const result = await executeClaimedFtcFiling(makeSupabase(), USER_ID, CASE_ID, claimedTask());
    expect(result.status).toBe("accepted");
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
    const result = await executeClaimedFtcFiling(
      makeSupabase((n) => noteUpdates.push(n)),
      USER_ID,
      CASE_ID,
      claimedTask()
    );
    expect(result.status).toBe("failed");
    expect(completeFtcOperatorFiling).not.toHaveBeenCalled();
    expect(noteUpdates.at(-1)).toContain("delivery_state: failed");
  });

  it("marks failed when the provider throws (operator fallback)", async () => {
    vi.mocked(runRealFtcBoundedSubmit).mockRejectedValue(new Error("Browserless connection refused"));
    const noteUpdates: string[] = [];
    const result = await executeClaimedFtcFiling(
      makeSupabase((n) => noteUpdates.push(n)),
      USER_ID,
      CASE_ID,
      claimedTask()
    );
    expect(result).toMatchObject({ status: "failed" });
    expect(completeFtcOperatorFiling).not.toHaveBeenCalled();
    expect(noteUpdates.at(-1)).toContain("delivery_state: failed");
  });

  it("refuses live submit when OWNED_FILING_SUBMIT_ARMED is unset (fail closed)", async () => {
    vi.stubEnv("OWNED_FILING_SUBMIT_ARMED", "");
    const noteUpdates: string[] = [];
    const result = await executeClaimedFtcFiling(
      makeSupabase((n) => noteUpdates.push(n)),
      USER_ID,
      CASE_ID,
      claimedTask()
    );
    expect(result.status).toBe("failed");
    expect(runRealFtcBoundedSubmit).not.toHaveBeenCalled();
    expect(completeFtcOperatorFiling).not.toHaveBeenCalled();
    expect(noteUpdates.at(-1)).toContain("delivery_state: failed");
    expect(noteUpdates.at(-1)).toContain("submit_unarmed");
  });

  it("refuses when case_id is not allowlisted (no Playwright)", async () => {
    vi.stubEnv("OWNED_FILING_LIVE_CASE_ALLOWLIST", "99999999-9999-4999-8999-999999999999");
    const noteUpdates: string[] = [];
    const result = await executeClaimedFtcFiling(
      makeSupabase((n) => noteUpdates.push(n)),
      USER_ID,
      CASE_ID,
      claimedTask()
    );
    expect(result.status).toBe("failed");
    expect(runRealFtcBoundedSubmit).not.toHaveBeenCalled();
    expect(completeFtcOperatorFiling).not.toHaveBeenCalled();
    expect(noteUpdates.at(-1)).toContain("delivery_state: failed");
    expect(noteUpdates.at(-1)).toContain("live_case_not_allowlisted");
  });

  it("marks failed without running Playwright when production config is missing", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("BROWSERLESS_URL", "");
    const noteUpdates: string[] = [];
    const result = await executeClaimedFtcFiling(
      makeSupabase((n) => noteUpdates.push(n)),
      USER_ID,
      CASE_ID,
      claimedTask()
    );
    expect(result.status).toBe("failed");
    expect(runRealFtcBoundedSubmit).not.toHaveBeenCalled();
    expect(noteUpdates.at(-1)).toContain("delivery_state: failed");
  });
});

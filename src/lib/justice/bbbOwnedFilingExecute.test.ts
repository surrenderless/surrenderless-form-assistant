import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";
import type { JusticeIntake } from "@/lib/justice/types";
import { upsertBbbOwnedFilingDeliveryNotes } from "@/lib/justice/bbbOwnedFilingDeliveryState";

vi.mock("@/lib/justice/runRealBbbBoundedSubmit", () => ({
  runRealBbbBoundedSubmit: vi.fn(),
}));
vi.mock("@/lib/justice/completeBbbOperatorFiling", () => ({
  completeBbbOperatorFiling: vi.fn(),
}));
vi.mock("@/server/justiceTimelineAppend", () => ({
  appendCaseTimelineEntry: vi.fn(async (_s, _u, _c, entry) => [entry]),
}));

import { runRealBbbBoundedSubmit } from "@/lib/justice/runRealBbbBoundedSubmit";
import { completeBbbOperatorFiling } from "@/lib/justice/completeBbbOperatorFiling";
import { executeClaimedBbbFiling } from "@/lib/justice/bbbOwnedFilingExecute";

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
    title: "BBB filing: Acme Retail",
    due_date: null,
    notes: upsertBbbOwnedFilingDeliveryNotes(`bbb_filing_queue:${CASE_ID}\ndraft:\nx`, {
      delivery_state: "submitting",
      provider: "real_bbb_bounded_submit",
      started_at: "2026-07-14T00:00:00.000Z",
    }),
    completed_at: null,
    created_at: "2026-07-14T00:00:00.000Z",
    updated_at: "2026-07-14T00:00:00.000Z",
  };
}

function successBoundedResult() {
  return {
    ok: true as const,
    fillResult: {
      status: "success" as const,
      screenshot: null,
      pageData: null,
      stepsExecuted: 2,
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
      destination: "Better Business Bureau",
      filed_at: "2026-07-14",
      confirmation_number: "BBB complaint complete",
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

describe("executeClaimedBbbFiling (worker execution off the request path)", () => {
  beforeEach(() => {
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

  it("completes only after terminal bounded-submit confirmation", async () => {
    vi.mocked(runRealBbbBoundedSubmit).mockResolvedValue(successBoundedResult());
    vi.mocked(completeBbbOperatorFiling).mockResolvedValue(completedFilingResult());

    const result = await executeClaimedBbbFiling(makeSupabase(), USER_ID, CASE_ID, claimedTask());
    expect(result.status).toBe("accepted");
    expect(runRealBbbBoundedSubmit).toHaveBeenCalledTimes(1);
    expect(completeBbbOperatorFiling).toHaveBeenCalledTimes(1);
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
    const result = await executeClaimedBbbFiling(
      makeSupabase((n) => noteUpdates.push(n)),
      USER_ID,
      CASE_ID,
      claimedTask()
    );
    expect(result.status).toBe("failed");
    expect(completeBbbOperatorFiling).not.toHaveBeenCalled();
    expect(noteUpdates.at(-1)).toContain("delivery_state: failed");
  });

  it("marks failed when the provider throws (operator fallback)", async () => {
    vi.mocked(runRealBbbBoundedSubmit).mockRejectedValue(new Error("Browserless connection refused"));
    const noteUpdates: string[] = [];
    const result = await executeClaimedBbbFiling(
      makeSupabase((n) => noteUpdates.push(n)),
      USER_ID,
      CASE_ID,
      claimedTask()
    );
    expect(result).toMatchObject({ status: "failed" });
    expect(completeBbbOperatorFiling).not.toHaveBeenCalled();
    expect(noteUpdates.at(-1)).toContain("delivery_state: failed");
  });
});

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
  FTC_OPERATOR_FULFILLMENT_PRIMARY_SKIP_REASON,
  FTC_LIVE_CASE_NOT_PILOT_AUTHORIZED_REASON,
} from "@/lib/justice/ftcOwnedFilingDelivery";
import { OWNED_FILING_LIVE_CASE_NOT_ALLOWLISTED_REASON } from "@/lib/justice/ownedFilingSubmitArmed";
import {
  parseFtcPilotAuthorizationRecord,
  upsertFtcPilotAuthorizationNotes,
} from "@/lib/justice/ftcPilotAuthorizationState";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";
import type { JusticeIntake } from "@/lib/justice/types";

vi.mock("@/server/justiceTimelineAppend", () => ({
  appendCaseTimelineEntry: vi.fn(async (_s, _u, _c, entry) => [entry]),
}));

vi.mock("@/lib/justice/realFtcAutofillEnabled", () => ({
  isRealFtcComplaintAutofillEnabled: vi.fn(() => true),
  isRealFtcOperatorFulfillmentPrimary: vi.fn(() => false),
}));

vi.mock("@/lib/justice/surrenderlessOwnedStep", () => ({
  shouldSuppressChatManualActionForSurrenderlessOwnedStep: vi.fn(() => true),
}));

vi.mock("@/lib/justice/ftcFilingTask", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/justice/ftcFilingTask")>();
  return {
    ...actual,
    ensureFtcFilingTask: vi.fn(actual.ensureFtcFilingTask),
  };
});

import {
  isRealFtcComplaintAutofillEnabled,
  isRealFtcOperatorFulfillmentPrimary,
} from "@/lib/justice/realFtcAutofillEnabled";
import { ensureFtcFilingTask } from "@/lib/justice/ftcFilingTask";

const CASE_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "user_1";
const TASK_ID = "22222222-2222-4222-8222-222222222222";

/**
 * Base task notes WITH a recorded operator pilot-authorization marker. Used as the default fixture
 * because the vast majority of tests in this file exercise a case that IS meant to be fully
 * eligible (allowlisted, harness-enabled) — the same way they already default to allowlisted via
 * OWNED_FILING_LIVE_CASE_ALLOWLIST in beforeEach. Tests specifically proving the pilot-authorization
 * gate use un-authorized base notes explicitly instead.
 */
function authorizedBaseNotes(): string {
  return upsertFtcPilotAuthorizationNotes(`ftc_filing_queue:${CASE_ID}\ndraft:\nFTC DRAFT`, {
    authorized_by: "operator_1",
    authorized_at: "2026-07-13T00:00:00.000Z",
  });
}

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
      notes: authorizedBaseNotes(),
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
    vi.mocked(isRealFtcOperatorFulfillmentPrimary).mockReturnValue(false);
    vi.mocked(ensureFtcFilingTask).mockReset();
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://127.0.0.1:3000");
    vi.stubEnv("BBB_DECIDE_ACTION_INTERNAL_SECRET", "test-decide-secret");
    vi.stubEnv("BROWSERLESS_URL", "");
    // All pre-existing tests in this suite exercise the case that IS meant to reach the harness
    // (the pilot case), so they allowlist CASE_ID by default. The pilot-isolation tests below
    // override this per-test to prove the opposite (a case NOT in the allowlist).
    vi.stubEnv("OWNED_FILING_LIVE_CASE_ALLOWLIST", CASE_ID);
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

  it("routes to operator fulfillment by default without writing autofill delivery_state", async () => {
    vi.mocked(isRealFtcComplaintAutofillEnabled).mockReturnValue(false);
    vi.mocked(isRealFtcOperatorFulfillmentPrimary).mockReturnValue(true);
    const noteUpdates: string[] = [];
    const result = await attemptAutomatedFtcFiling(
      makeSupabase({ onTaskNotesUpdate: (n) => noteUpdates.push(n) }),
      USER_ID,
      CASE_ID
    );
    expect(result).toMatchObject({
      status: "skipped",
      reason: FTC_OPERATOR_FULFILLMENT_PRIMARY_SKIP_REASON,
    });
    expect(noteUpdates.length).toBe(0);
    expect(noteUpdates.some((n) => n.includes("delivery_state: queued"))).toBe(false);
    expect(vi.mocked(ensureFtcFilingTask)).not.toHaveBeenCalled();
  });

  it("ensures an FTC operator task when missing in operator-primary mode", async () => {
    vi.mocked(isRealFtcComplaintAutofillEnabled).mockReturnValue(false);
    vi.mocked(isRealFtcOperatorFulfillmentPrimary).mockReturnValue(true);
    vi.mocked(ensureFtcFilingTask).mockResolvedValue({
      task: taskWithNotes(`ftc_filing_queue:${CASE_ID}\ndraft:\nx`),
      timeline: null,
      created: true,
    });
    const noteUpdates: string[] = [];
    const result = await attemptAutomatedFtcFiling(
      makeSupabase({ tasks: [], onTaskNotesUpdate: (n) => noteUpdates.push(n) }),
      USER_ID,
      CASE_ID
    );
    expect(result).toMatchObject({
      status: "skipped",
      reason: FTC_OPERATOR_FULFILLMENT_PRIMARY_SKIP_REASON,
    });
    expect(vi.mocked(ensureFtcFilingTask)).toHaveBeenCalledOnce();
    expect(noteUpdates.some((n) => n.includes("delivery_state:"))).toBe(false);
  });

  it("skips without enqueue when production Browserless configuration is missing (harness mode)", async () => {
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
    const notes = upsertFtcOwnedFilingDeliveryNotes(authorizedBaseNotes(), {
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
    const notes = upsertFtcOwnedFilingDeliveryNotes(authorizedBaseNotes(), {
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
    const notes = upsertFtcOwnedFilingDeliveryNotes(authorizedBaseNotes(), {
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
    const notes = upsertFtcOwnedFilingDeliveryNotes(authorizedBaseNotes(), {
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

// Pilot isolation: enabling the harness (isRealFtcOperatorFulfillmentPrimary === false) is a
// global switch, but only OWNED_FILING_LIVE_CASE_ALLOWLIST case ids may actually reach live
// claim/execute (claimQueuedOwnedFiling.ts, ftcOwnedFilingExecute.ts). Before this fix, every
// other eligible case still got delivery_state: "queued" written to its task purely because the
// harness was on — an unwanted mutation of cases never meant to be part of the pilot, even though
// they could never actually be claimed or submitted. This suite proves the queued-marker write
// itself is now scoped to the allowlist, matching the claim/execute gates it reuses.
describe("attemptAutomatedFtcFiling pilot isolation (OWNED_FILING_LIVE_CASE_ALLOWLIST)", () => {
  beforeEach(() => {
    vi.mocked(isRealFtcComplaintAutofillEnabled).mockReturnValue(true);
    vi.mocked(isRealFtcOperatorFulfillmentPrimary).mockReturnValue(false);
    vi.mocked(ensureFtcFilingTask).mockReset();
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://127.0.0.1:3000");
    vi.stubEnv("BBB_DECIDE_ACTION_INTERNAL_SECRET", "test-decide-secret");
    vi.stubEnv("BROWSERLESS_URL", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("keeps an unallowlisted case on the operator path and writes no queued delivery-state marker", async () => {
    vi.stubEnv("OWNED_FILING_LIVE_CASE_ALLOWLIST", "99999999-9999-4999-8999-999999999999");
    const noteUpdates: string[] = [];
    const result = await attemptAutomatedFtcFiling(
      makeSupabase({ onTaskNotesUpdate: (n) => noteUpdates.push(n) }),
      USER_ID,
      CASE_ID
    );
    expect(result).toMatchObject({
      status: "skipped",
      reason: OWNED_FILING_LIVE_CASE_NOT_ALLOWLISTED_REASON,
    });
    // Not just "no queued state" — no task write of any kind for the excluded case.
    expect(noteUpdates.length).toBe(0);
  });

  it("also keeps an unallowlisted case on the operator path when the allowlist is empty/unset", async () => {
    vi.stubEnv("OWNED_FILING_LIVE_CASE_ALLOWLIST", "");
    const noteUpdates: string[] = [];
    const result = await attemptAutomatedFtcFiling(
      makeSupabase({ onTaskNotesUpdate: (n) => noteUpdates.push(n) }),
      USER_ID,
      CASE_ID
    );
    expect(result).toMatchObject({
      status: "skipped",
      reason: OWNED_FILING_LIVE_CASE_NOT_ALLOWLISTED_REASON,
    });
    expect(noteUpdates.length).toBe(0);
  });

  it("still ensures the FTC operator task exists for an unallowlisted case when missing", async () => {
    vi.stubEnv("OWNED_FILING_LIVE_CASE_ALLOWLIST", "99999999-9999-4999-8999-999999999999");
    vi.mocked(ensureFtcFilingTask).mockResolvedValue({
      task: taskWithNotes(`ftc_filing_queue:${CASE_ID}\ndraft:\nx`),
      timeline: null,
      created: true,
    });
    const noteUpdates: string[] = [];
    const result = await attemptAutomatedFtcFiling(
      makeSupabase({ tasks: [], onTaskNotesUpdate: (n) => noteUpdates.push(n) }),
      USER_ID,
      CASE_ID
    );
    expect(result).toMatchObject({
      status: "skipped",
      reason: OWNED_FILING_LIVE_CASE_NOT_ALLOWLISTED_REASON,
    });
    expect(vi.mocked(ensureFtcFilingTask)).toHaveBeenCalledOnce();
    // The task the operator path ensures must never carry an autofill delivery marker.
    expect(noteUpdates.some((n) => n.includes("delivery_state:"))).toBe(false);
  });

  it("still reaches the queued/claimable path for the one case that is allowlisted", async () => {
    vi.stubEnv("OWNED_FILING_LIVE_CASE_ALLOWLIST", CASE_ID);
    const noteUpdates: string[] = [];
    const result = await attemptAutomatedFtcFiling(
      makeSupabase({ onTaskNotesUpdate: (n) => noteUpdates.push(n) }),
      USER_ID,
      CASE_ID
    );
    expect(result).toMatchObject({ status: "queued", idempotent: false });
    expect(noteUpdates.at(-1)).toContain("delivery_state: queued");
  });

  it("still reaches the queued/claimable path when the case is one of several allowlisted ids", async () => {
    vi.stubEnv(
      "OWNED_FILING_LIVE_CASE_ALLOWLIST",
      `11111111-0000-4000-8000-000000000000, ${CASE_ID} ,22222222-0000-4000-8000-000000000000`
    );
    const result = await attemptAutomatedFtcFiling(makeSupabase({}), USER_ID, CASE_ID);
    expect(result).toMatchObject({ status: "queued", idempotent: false });
  });

  it("disabled-flag (operator-primary) behavior is unchanged regardless of allowlist contents", async () => {
    // Flag disabled takes precedence: same reason as before this fix, whether or not the case
    // happens to be allowlisted — allowlist state must never leak into operator-primary routing.
    vi.mocked(isRealFtcOperatorFulfillmentPrimary).mockReturnValue(true);
    vi.stubEnv("OWNED_FILING_LIVE_CASE_ALLOWLIST", CASE_ID);
    const noteUpdates: string[] = [];
    const result = await attemptAutomatedFtcFiling(
      makeSupabase({ onTaskNotesUpdate: (n) => noteUpdates.push(n) }),
      USER_ID,
      CASE_ID
    );
    expect(result).toMatchObject({
      status: "skipped",
      reason: FTC_OPERATOR_FULFILLMENT_PRIMARY_SKIP_REASON,
    });
    expect(noteUpdates.length).toBe(0);
  });

  it("disabled-flag behavior is unchanged when the case is also not allowlisted", async () => {
    vi.mocked(isRealFtcOperatorFulfillmentPrimary).mockReturnValue(true);
    vi.stubEnv("OWNED_FILING_LIVE_CASE_ALLOWLIST", "");
    const result = await attemptAutomatedFtcFiling(makeSupabase({}), USER_ID, CASE_ID);
    expect(result).toMatchObject({
      status: "skipped",
      reason: FTC_OPERATOR_FULFILLMENT_PRIMARY_SKIP_REASON,
    });
  });
});

// Pilot authorization is additive on top of the allowlist, not a substitute for it: an allowlisted
// case with no recorded operator authorization marker must stay on the operator path exactly like
// an unallowlisted one — never acquiring a queued autofill marker.
describe("attemptAutomatedFtcFiling pilot authorization (ftcPilotAuthorizationState)", () => {
  beforeEach(() => {
    vi.mocked(isRealFtcComplaintAutofillEnabled).mockReturnValue(true);
    vi.mocked(isRealFtcOperatorFulfillmentPrimary).mockReturnValue(false);
    vi.mocked(ensureFtcFilingTask).mockReset();
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://127.0.0.1:3000");
    vi.stubEnv("BBB_DECIDE_ACTION_INTERNAL_SECRET", "test-decide-secret");
    vi.stubEnv("BROWSERLESS_URL", "");
    vi.stubEnv("OWNED_FILING_LIVE_CASE_ALLOWLIST", CASE_ID);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  function unauthorizedTask(): JusticeCaseTaskRow {
    return {
      id: TASK_ID,
      user_id: USER_ID,
      case_id: CASE_ID,
      title: "FTC filing: Acme Retail",
      due_date: null,
      notes: `ftc_filing_queue:${CASE_ID}\ndraft:\nFTC DRAFT`,
      completed_at: null,
      created_at: "2026-07-14T00:00:00.000Z",
      updated_at: "2026-07-14T00:00:00.000Z",
    };
  }

  it("allowlisted but NOT pilot-authorized: stays on the operator path, no queued marker written", async () => {
    const noteUpdates: string[] = [];
    const result = await attemptAutomatedFtcFiling(
      makeSupabase({ tasks: [unauthorizedTask()], onTaskNotesUpdate: (n) => noteUpdates.push(n) }),
      USER_ID,
      CASE_ID
    );
    expect(result).toMatchObject({
      status: "skipped",
      reason: FTC_LIVE_CASE_NOT_PILOT_AUTHORIZED_REASON,
    });
    // Not just "no queued state" — no task write of any kind for the unauthorized case.
    expect(noteUpdates.length).toBe(0);
  });

  it("still ensures the FTC operator task exists for an allowlisted-but-unauthorized case when missing", async () => {
    vi.mocked(ensureFtcFilingTask).mockResolvedValue({
      task: unauthorizedTask(),
      timeline: null,
      created: true,
    });
    const noteUpdates: string[] = [];
    const result = await attemptAutomatedFtcFiling(
      makeSupabase({ tasks: [], onTaskNotesUpdate: (n) => noteUpdates.push(n) }),
      USER_ID,
      CASE_ID
    );
    expect(result).toMatchObject({
      status: "skipped",
      reason: FTC_LIVE_CASE_NOT_PILOT_AUTHORIZED_REASON,
    });
    expect(vi.mocked(ensureFtcFilingTask)).toHaveBeenCalledOnce();
    // The task the operator path ensures must never carry an autofill delivery marker.
    expect(noteUpdates.some((n) => n.includes("delivery_state:"))).toBe(false);
  });

  it("allowlisted AND pilot-authorized: reaches the queued/claimable path exactly as before", async () => {
    const noteUpdates: string[] = [];
    const result = await attemptAutomatedFtcFiling(
      makeSupabase({ onTaskNotesUpdate: (n) => noteUpdates.push(n) }), // default fixture is authorized
      USER_ID,
      CASE_ID
    );
    expect(result).toMatchObject({ status: "queued", idempotent: false });
    const written = noteUpdates.at(-1);
    expect(written).toContain("delivery_state: queued");
    // The queue write must not have clobbered the authorization marker it depended on.
    expect(parseFtcPilotAuthorizationRecord(written)).toEqual({
      authorized_by: "operator_1",
      authorized_at: "2026-07-13T00:00:00.000Z",
    });
  });

  it("operator-primary (disabled flag) takes precedence over a missing authorization in the reported reason", async () => {
    vi.mocked(isRealFtcOperatorFulfillmentPrimary).mockReturnValue(true);
    const result = await attemptAutomatedFtcFiling(
      makeSupabase({ tasks: [unauthorizedTask()] }),
      USER_ID,
      CASE_ID
    );
    expect(result).toMatchObject({
      status: "skipped",
      reason: FTC_OPERATOR_FULFILLMENT_PRIMARY_SKIP_REASON,
    });
  });

  it("not-allowlisted takes precedence over a missing authorization in the reported reason", async () => {
    vi.stubEnv("OWNED_FILING_LIVE_CASE_ALLOWLIST", "99999999-9999-4999-8999-999999999999");
    const result = await attemptAutomatedFtcFiling(
      makeSupabase({ tasks: [unauthorizedTask()] }),
      USER_ID,
      CASE_ID
    );
    expect(result).toMatchObject({
      status: "skipped",
      reason: OWNED_FILING_LIVE_CASE_NOT_ALLOWLISTED_REASON,
    });
  });
});

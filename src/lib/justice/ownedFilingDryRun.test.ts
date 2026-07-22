import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";
import { upsertBbbOwnedFilingDeliveryNotes } from "@/lib/justice/bbbOwnedFilingDeliveryState";
import { upsertFtcOwnedFilingDeliveryNotes } from "@/lib/justice/ftcOwnedFilingDeliveryState";
import {
  OWNED_FILING_DRY_RUN_BLOCK_MARKER,
  upsertOwnedFilingDryRunNotes,
} from "@/lib/justice/ownedFilingDryRunState";

vi.mock("@/lib/justice/runRealBbbBoundedSubmit", () => ({
  runRealBbbBoundedSubmit: vi.fn(),
}));
vi.mock("@/lib/justice/runRealFtcBoundedSubmit", () => ({
  runRealFtcBoundedSubmit: vi.fn(),
}));
vi.mock("@/lib/justice/bbbOwnedFilingProduction", () => ({
  evaluateOwnedBbbAutofillExecutionReadiness: vi.fn(() => ({
    ok: true,
    base: "http://127.0.0.1:3000",
    forwardedHeaders: {},
  })),
}));
vi.mock("@/lib/justice/bbbOwnedFilingSubmitContext", () => ({
  getBbbOwnedFilingSubmitContext: vi.fn(() => null),
}));

import { runRealBbbBoundedSubmit } from "@/lib/justice/runRealBbbBoundedSubmit";
import { runRealFtcBoundedSubmit } from "@/lib/justice/runRealFtcBoundedSubmit";
import { runOwnedFilingDryRun } from "@/lib/justice/ownedFilingDryRun";

const CASE_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "user_1";
const TASK_ID = "22222222-2222-4222-8222-222222222222";

function bbbTask(notesExtra = ""): JusticeCaseTaskRow {
  const base = upsertBbbOwnedFilingDeliveryNotes(`bbb_filing_queue:${CASE_ID}\ndraft:\nx`, {
    delivery_state: "queued",
    provider: "real_bbb_bounded_submit",
    started_at: "2026-07-14T00:00:00.000Z",
  });
  return {
    id: TASK_ID,
    user_id: USER_ID,
    case_id: CASE_ID,
    title: "BBB filing: Acme",
    due_date: null,
    notes: notesExtra ? `${base}\n\n${notesExtra}` : base,
    completed_at: null,
    created_at: "2026-07-14T00:00:00.000Z",
    updated_at: "2026-07-14T00:00:00.000Z",
  };
}

function ftcTask(): JusticeCaseTaskRow {
  return {
    id: TASK_ID,
    user_id: USER_ID,
    case_id: CASE_ID,
    title: "FTC filing: Acme",
    due_date: null,
    notes: upsertFtcOwnedFilingDeliveryNotes(`ftc_filing_queue:${CASE_ID}\ndraft:\nx`, {
      delivery_state: "queued",
      provider: "real_ftc_bounded_submit",
      started_at: "2026-07-14T00:00:00.000Z",
    }),
    completed_at: null,
    created_at: "2026-07-14T00:00:00.000Z",
    updated_at: "2026-07-14T00:00:00.000Z",
  };
}

function baseIntake() {
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

function makeSupabase(task: JusticeCaseTaskRow, noteUpdates: string[] = []): SupabaseClient {
  let currentNotes = task.notes ?? "";
  return {
    from(table: string) {
      if (table === "justice_cases") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { intake: baseIntake(), user_id: USER_ID },
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      if (table === "justice_case_tasks") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                is: () => ({
                  limit: async () => ({
                    data: [{ ...task, notes: currentNotes, completed_at: null }],
                    error: null,
                  }),
                }),
              }),
            }),
          }),
          update: (payload: { notes: string }) => {
            noteUpdates.push(payload.notes);
            currentNotes = payload.notes;
            const chain: Record<string, unknown> = {};
            chain.eq = () => chain;
            chain.is = () => chain;
            chain.select = () => chain;
            chain.maybeSingle = async () => ({
              data: {
                ...task,
                notes: payload.notes,
                completed_at: null,
              },
              error: null,
            });
            return chain;
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  } as unknown as SupabaseClient;
}

describe("runOwnedFilingDryRun", () => {
  beforeEach(() => {
    vi.mocked(runRealBbbBoundedSubmit).mockReset();
    vi.mocked(runRealFtcBoundedSubmit).mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("BBB dry-run stops at irreversible boundary, persists result, never files", async () => {
    vi.mocked(runRealBbbBoundedSubmit).mockResolvedValue({
      ok: false,
      error: "stopped before irreversible",
      stopReason: "blocked_irreversible_click",
      stepsExecuted: 2,
      fillResult: {
        screenshot: null,
        pageData: { url: "https://www.bbb.org/complain/review", fields: [], buttons: [] },
        stepsExecuted: 2,
        stopReason: "blocked_irreversible_click",
        stepLog: [
          { step: 1, url: "https://www.bbb.org/complain", action: "apply" },
          {
            step: 2,
            url: "https://www.bbb.org/complain/review",
            action: "blocked_irreversible_click",
            detail: "text:Submit complaint",
          },
        ],
      },
      technicalDetails: {},
    });

    const noteUpdates: string[] = [];
    const result = await runOwnedFilingDryRun(
      makeSupabase(bbbTask(), noteUpdates),
      USER_ID,
      CASE_ID,
      "bbb"
    );

    expect(result).toMatchObject({
      ok: true,
      status: "dry_run_blocked_at_submit",
      destination: "bbb",
      case_id: CASE_ID,
      stop_reason: "blocked_irreversible_click",
    });
    expect(runRealBbbBoundedSubmit).toHaveBeenCalledWith(expect.objectContaining({ mode: "dry_run" }));
    expect(noteUpdates.at(-1)).toContain(OWNED_FILING_DRY_RUN_BLOCK_MARKER);
    expect(noteUpdates.at(-1)).toContain("dry_run_blocked_at_submit");
    expect(noteUpdates.at(-1)).toContain("delivery_state: queued");
    expect(noteUpdates.at(-1)).not.toContain("delivery_state: filed");
    expect(noteUpdates.at(-1)).not.toMatch(/completed_at:/);
  });

  it("FTC dry-run stops at irreversible boundary without completing", async () => {
    vi.mocked(runRealFtcBoundedSubmit).mockResolvedValue({
      ok: false,
      error: "stopped",
      stopReason: "blocked_irreversible_click",
      stepsExecuted: 1,
      fillResult: {
        screenshot: null,
        pageData: { url: "https://reportfraud.ftc.gov/review", fields: [], buttons: [] },
        stepsExecuted: 1,
        stopReason: "blocked_irreversible_click",
        stepLog: [
          {
            step: 0,
            url: "https://reportfraud.ftc.gov/review",
            action: "blocked_irreversible_click",
            detail: "text:Submit",
          },
        ],
      },
      technicalDetails: {},
    });

    const noteUpdates: string[] = [];
    const result = await runOwnedFilingDryRun(
      makeSupabase(ftcTask(), noteUpdates),
      USER_ID,
      CASE_ID,
      "ftc"
    );
    expect(result.status).toBe("dry_run_blocked_at_submit");
    expect(runRealFtcBoundedSubmit).toHaveBeenCalledWith(expect.objectContaining({ mode: "dry_run" }));
    expect(noteUpdates.at(-1)).toContain("destination: ftc");
    expect(noteUpdates.at(-1)).toContain("delivery_state: queued");
  });

  it("FTC decide_action_failed dry-run detail uses sanitized decide_failed stepLog entry", async () => {
    const genericLiveError =
      "FTC complaint autofill stopped: could not determine the next form action. You can retry.";
    const sanitized =
      "decide-action failed (500:openai_request_failed:upstream_400)";

    vi.mocked(runRealFtcBoundedSubmit).mockResolvedValue({
      ok: false,
      error: genericLiveError,
      stopReason: "decide_action_failed",
      stepsExecuted: 2,
      fillResult: {
        screenshot: null,
        pageData: {
          url: "https://reportfraud.ftc.gov/assistant",
          fields: [],
          buttons: [],
        },
        stepsExecuted: 2,
        stopReason: "decide_action_failed",
        stepLog: [
          {
            step: 0,
            url: "https://reportfraud.ftc.gov/",
            action: "apply",
            detail: "text:Report Now",
          },
          {
            step: 1,
            url: "https://reportfraud.ftc.gov/assistant",
            action: "apply",
            detail: "id:cat-parent",
          },
          {
            step: 2,
            url: "https://reportfraud.ftc.gov/assistant",
            action: "decide_failed",
            detail: sanitized,
          },
        ],
      },
      technicalDetails: {},
    });

    const noteUpdates: string[] = [];
    const result = await runOwnedFilingDryRun(
      makeSupabase(ftcTask(), noteUpdates),
      USER_ID,
      CASE_ID,
      "ftc"
    );

    expect(result).toMatchObject({
      ok: false,
      status: "dry_run_failed",
      destination: "ftc",
      stop_reason: "decide_action_failed",
      steps_executed: 2,
      detail: sanitized,
    });
    expect(result.detail).not.toBe(genericLiveError);
    expect(result.detail).not.toContain("secret@example.com");
    expect(noteUpdates.at(-1)).toContain(`detail: ${sanitized}`);
    expect(noteUpdates.at(-1)).toContain("decide_failed|");
    expect(noteUpdates.at(-1)).toContain(sanitized);
  });

  it("FTC decide_action_failed falls back to generic error when decide_failed detail is missing", async () => {
    const genericLiveError =
      "FTC complaint autofill stopped: could not determine the next form action. You can retry.";

    vi.mocked(runRealFtcBoundedSubmit).mockResolvedValue({
      ok: false,
      error: genericLiveError,
      stopReason: "decide_action_failed",
      stepsExecuted: 0,
      fillResult: {
        screenshot: null,
        pageData: { url: "https://reportfraud.ftc.gov/assistant", fields: [], buttons: [] },
        stepsExecuted: 0,
        stopReason: "decide_action_failed",
        stepLog: [
          {
            step: 0,
            url: "https://reportfraud.ftc.gov/assistant",
            action: "decide_failed",
          },
        ],
      },
      technicalDetails: {},
    });

    const result = await runOwnedFilingDryRun(makeSupabase(ftcTask()), USER_ID, CASE_ID, "ftc");

    expect(result).toMatchObject({
      ok: false,
      stop_reason: "decide_action_failed",
      detail: genericLiveError,
    });
  });

  it("FTC invalid_decision dry-run detail uses allowlisted validator-failure enum", async () => {
    const genericLiveError =
      "FTC complaint autofill stopped: the assistant returned an invalid next action. You can retry.";

    vi.mocked(runRealFtcBoundedSubmit).mockResolvedValue({
      ok: false,
      error: genericLiveError,
      stopReason: "invalid_decision",
      stepsExecuted: 2,
      fillResult: {
        screenshot: null,
        pageData: {
          url: "https://reportfraud.ftc.gov/assistant",
          fields: [],
          buttons: [],
        },
        stepsExecuted: 2,
        stopReason: "invalid_decision",
        stepLog: [
          {
            step: 2,
            url: "https://reportfraud.ftc.gov/assistant",
            action: "invalid_decision",
            detail: "selector_type",
          },
        ],
      },
      technicalDetails: {},
    });

    const noteUpdates: string[] = [];
    const result = await runOwnedFilingDryRun(
      makeSupabase(ftcTask(), noteUpdates),
      USER_ID,
      CASE_ID,
      "ftc"
    );

    expect(result).toMatchObject({
      ok: false,
      status: "dry_run_failed",
      stop_reason: "invalid_decision",
      steps_executed: 2,
      detail: "selector_type",
    });
    expect(result.detail).not.toBe(genericLiveError);
    expect(noteUpdates.at(-1)).toContain("detail: selector_type");
  });

  it("FTC invalid_decision ignores non-allowlisted step detail", async () => {
    const genericLiveError =
      "FTC complaint autofill stopped: the assistant returned an invalid next action. You can retry.";

    vi.mocked(runRealFtcBoundedSubmit).mockResolvedValue({
      ok: false,
      error: genericLiveError,
      stopReason: "invalid_decision",
      stepsExecuted: 0,
      fillResult: {
        screenshot: null,
        pageData: { url: "https://reportfraud.ftc.gov/assistant", fields: [], buttons: [] },
        stepsExecuted: 0,
        stopReason: "invalid_decision",
        stepLog: [
          {
            step: 0,
            url: "https://reportfraud.ftc.gov/assistant",
            action: "invalid_decision",
            detail: "no unique enabled FTC assistant choice matched issue_type",
          },
        ],
      },
      technicalDetails: {},
    });

    const result = await runOwnedFilingDryRun(makeSupabase(ftcTask()), USER_ID, CASE_ID, "ftc");

    expect(result).toMatchObject({
      ok: false,
      stop_reason: "invalid_decision",
      detail: genericLiveError,
    });
  });

  it("FTC provider throw before first step maps to dry_run_failed with steps_executed 0", async () => {
    vi.mocked(runRealFtcBoundedSubmit).mockRejectedValue(
      new Error("page.evaluate: Target page, context or browser has been closed")
    );

    const noteUpdates: string[] = [];
    const result = await runOwnedFilingDryRun(
      makeSupabase(ftcTask(), noteUpdates),
      USER_ID,
      CASE_ID,
      "ftc"
    );

    expect(result).toMatchObject({
      ok: false,
      status: "dry_run_failed",
      destination: "ftc",
      case_id: CASE_ID,
      task_id: TASK_ID,
      steps_executed: 0,
      stop_reason: "provider",
      detail: "page.evaluate: Target page, context or browser has been closed",
    });
    expect(noteUpdates.at(-1)).toContain("dry_run_failed");
    expect(noteUpdates.at(-1)).toContain("stop_reason: provider");
    expect(noteUpdates.at(-1)).toContain("steps_executed: 0");
    expect(noteUpdates.at(-1)).toContain("delivery_state: queued");
  });

  it("FTC enriched lifecycle provider throw remains fail-closed dry_run_failed", async () => {
    vi.mocked(runRealFtcBoundedSubmit).mockRejectedValue(
      new Error(
        "owned-filing playwright evaluate target closed: elapsed_ms=2100 browser_connected=false page_closed=true first_close_event=page_close context_count=1 page_count=0 page_url=closed original_error=page.evaluate: Target page, context or browser has been closed"
      )
    );

    const result = await runOwnedFilingDryRun(makeSupabase(ftcTask()), USER_ID, CASE_ID, "ftc");

    expect(result).toMatchObject({
      ok: false,
      status: "dry_run_failed",
      destination: "ftc",
      steps_executed: 0,
      stop_reason: "provider",
    });
    expect(result.detail).toContain("elapsed_ms=2100");
    expect(result.detail).toContain("page_url=closed");
    expect(result.detail).toContain("original_error=page.evaluate:");
  });

  it("FTC evaluate_timeout provider failure maps to dry_run_failed without filing", async () => {
    vi.mocked(runRealFtcBoundedSubmit).mockRejectedValue(
      new Error(
        "owned-filing playwright evaluate_timeout after 45000ms (provider/evaluate_timeout) | stages=connect_cdp:10ms:ok;open_session:5ms:ok;goto_1:800ms:ok;ready_1:12ms:ok;evaluate_1:45010ms:fail:evaluate_timeout"
      )
    );

    const noteUpdates: string[] = [];
    const result = await runOwnedFilingDryRun(
      makeSupabase(ftcTask(), noteUpdates),
      USER_ID,
      CASE_ID,
      "ftc"
    );

    expect(result).toMatchObject({
      ok: false,
      status: "dry_run_failed",
      destination: "ftc",
      steps_executed: 0,
      stop_reason: "provider",
    });
    expect(result.detail).toContain("evaluate_timeout");
    expect(result.detail).toContain("stages=");
    expect(result.detail).toContain("evaluate_1:");
    expect(result.detail).not.toContain("pat@example.com");
    expect(noteUpdates.at(-1)).toContain("dry_run_failed");
    expect(noteUpdates.at(-1)).toContain("stages=");
    expect(noteUpdates.at(-1)).toContain("delivery_state: queued");
  });

  it("unknown click is recorded as blocked_at_submit (fail closed)", async () => {
    vi.mocked(runRealBbbBoundedSubmit).mockResolvedValue({
      ok: false,
      error: "unknown",
      stopReason: "blocked_unknown_click",
      stepsExecuted: 0,
      fillResult: {
        screenshot: null,
        pageData: null,
        stepsExecuted: 0,
        stopReason: "blocked_unknown_click",
        stepLog: [
          {
            step: 0,
            url: "https://www.bbb.org/complain",
            action: "blocked_unknown_click",
            detail: "text:Do the thing",
          },
        ],
      },
      technicalDetails: {},
    });
    const result = await runOwnedFilingDryRun(makeSupabase(bbbTask()), USER_ID, CASE_ID, "bbb");
    expect(result.status).toBe("dry_run_blocked_at_submit");
    expect(result.stop_reason).toBe("blocked_unknown_click");
  });

  it("skips duplicate dry-run when prior blocked_at_submit exists", async () => {
    const prior = upsertOwnedFilingDryRunNotes("", {
      status: "dry_run_blocked_at_submit",
      destination: "bbb",
      case_id: CASE_ID,
      task_id: TASK_ID,
      ran_at: "2026-07-19T10:00:00.000Z",
      steps_executed: 2,
    });
    const result = await runOwnedFilingDryRun(
      makeSupabase(bbbTask(prior)),
      USER_ID,
      CASE_ID,
      "bbb"
    );
    expect(result).toMatchObject({
      ok: true,
      status: "dry_run_blocked_at_submit",
      skipped_duplicate: true,
    });
    expect(runRealBbbBoundedSubmit).not.toHaveBeenCalled();
  });

  it("does not skip legacy FTC dry_run_completed + max_steps_reached", async () => {
    const prior = upsertOwnedFilingDryRunNotes("", {
      status: "dry_run_completed",
      destination: "ftc",
      case_id: CASE_ID,
      task_id: TASK_ID,
      ran_at: "2026-07-19T10:00:00.000Z",
      steps_executed: 8,
      stop_reason: "max_steps_reached",
    });
    vi.mocked(runRealFtcBoundedSubmit).mockResolvedValue({
      ok: false,
      error: "max steps",
      stopReason: "max_steps_reached",
      stepsExecuted: 24,
      fillResult: {
        screenshot: null,
        pageData: { url: "https://reportfraud.ftc.gov/assistant", fields: [], buttons: [] },
        stepsExecuted: 24,
        stopReason: "max_steps_reached",
        stepLog: [
          {
            step: 1,
            url: "https://reportfraud.ftc.gov/assistant",
            action: "apply",
            detail: "text:Continue",
          },
        ],
      },
      technicalDetails: {},
    });

    const noteUpdates: string[] = [];
    const result = await runOwnedFilingDryRun(
      makeSupabase(
        {
          ...ftcTask(),
          notes: `${ftcTask().notes}\n\n${prior}`,
        },
        noteUpdates
      ),
      USER_ID,
      CASE_ID,
      "ftc"
    );

    expect(runRealFtcBoundedSubmit).toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: false,
      status: "dry_run_failed",
      stop_reason: "max_steps_reached",
      steps_executed: 24,
    });
    expect(noteUpdates.at(-1)).toContain("dry_run_failed");
    expect(noteUpdates.at(-1)).toContain("stop_reason: max_steps_reached");
    expect(noteUpdates.at(-1)).toContain("step_log:");
    expect(noteUpdates.at(-1)).toContain("apply|text:Continue|");
    expect(noteUpdates.at(-1)).not.toContain("pat@example.com");
  });

  it("skips terminal FTC dry_run_completed (empty_decision)", async () => {
    const prior = upsertOwnedFilingDryRunNotes("", {
      status: "dry_run_completed",
      destination: "ftc",
      case_id: CASE_ID,
      task_id: TASK_ID,
      ran_at: "2026-07-19T10:00:00.000Z",
      steps_executed: 2,
      stop_reason: "empty_decision",
    });
    const result = await runOwnedFilingDryRun(
      makeSupabase({
        ...ftcTask(),
        notes: `${ftcTask().notes}\n\n${prior}`,
      }),
      USER_ID,
      CASE_ID,
      "ftc"
    );
    expect(result).toMatchObject({
      ok: true,
      status: "dry_run_completed",
      skipped_duplicate: true,
    });
    expect(runRealFtcBoundedSubmit).not.toHaveBeenCalled();
  });

  it("persists FTC step_log and treats max_steps_reached as dry_run_failed", async () => {
    vi.mocked(runRealFtcBoundedSubmit).mockResolvedValue({
      ok: false,
      error: "Reached maximum submit steps (24)",
      stopReason: "max_steps_reached",
      stepsExecuted: 24,
      fillResult: {
        screenshot: null,
        pageData: { url: "https://reportfraud.ftc.gov/assistant", fields: [], buttons: [] },
        stepsExecuted: 24,
        stopReason: "max_steps_reached",
        stepLog: [
          {
            step: 0,
            url: "https://reportfraud.ftc.gov/assistant",
            action: "decide",
            detail: "text:Continue",
          },
          {
            step: 1,
            url: "https://reportfraud.ftc.gov/assistant",
            action: "apply",
            detail: "text:Continue",
          },
        ],
      },
      technicalDetails: {},
    });

    const noteUpdates: string[] = [];
    const result = await runOwnedFilingDryRun(
      makeSupabase(ftcTask(), noteUpdates),
      USER_ID,
      CASE_ID,
      "ftc"
    );
    expect(result.status).toBe("dry_run_failed");
    expect(result.ok).toBe(false);
    expect(noteUpdates.at(-1)).toContain(
      "step_log: decide|text:Continue|https://reportfraud.ftc.gov/assistant;apply|text:Continue|https://reportfraud.ftc.gov/assistant"
    );
  });
});

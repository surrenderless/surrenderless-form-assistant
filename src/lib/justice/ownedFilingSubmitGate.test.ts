import { describe, expect, it } from "vitest";
import { classifyOwnedFilingClick } from "@/lib/justice/classifyOwnedFilingClick";
import {
  isOwnedFilingSubmitArmed,
  OWNED_FILING_SUBMIT_UNARMED_REASON,
} from "@/lib/justice/ownedFilingSubmitArmed";
import {
  hasMatchingOwnedFilingDryRunResult,
  OWNED_FILING_DRY_RUN_BLOCK_MARKER,
  parseOwnedFilingDryRunRecord,
  upsertOwnedFilingDryRunNotes,
} from "@/lib/justice/ownedFilingDryRunState";
import {
  parseBbbOwnedFilingDeliveryRecord,
  upsertBbbOwnedFilingDeliveryNotes,
} from "@/lib/justice/bbbOwnedFilingDeliveryState";

describe("isOwnedFilingSubmitArmed (fail closed)", () => {
  it("is false when unset, empty, or falsey", () => {
    expect(isOwnedFilingSubmitArmed({})).toBe(false);
    expect(isOwnedFilingSubmitArmed({ OWNED_FILING_SUBMIT_ARMED: "" })).toBe(false);
    expect(isOwnedFilingSubmitArmed({ OWNED_FILING_SUBMIT_ARMED: "false" })).toBe(false);
    expect(isOwnedFilingSubmitArmed({ OWNED_FILING_SUBMIT_ARMED: "0" })).toBe(false);
    expect(isOwnedFilingSubmitArmed({ OWNED_FILING_SUBMIT_ARMED: "no" })).toBe(false);
  });

  it("is true only for explicit armed values", () => {
    expect(isOwnedFilingSubmitArmed({ OWNED_FILING_SUBMIT_ARMED: "true" })).toBe(true);
    expect(isOwnedFilingSubmitArmed({ OWNED_FILING_SUBMIT_ARMED: "TRUE" })).toBe(true);
    expect(isOwnedFilingSubmitArmed({ OWNED_FILING_SUBMIT_ARMED: "1" })).toBe(true);
    expect(isOwnedFilingSubmitArmed({ OWNED_FILING_SUBMIT_ARMED: "yes" })).toBe(true);
    expect(isOwnedFilingSubmitArmed({ OWNED_FILING_SUBMIT_ARMED: "on" })).toBe(true);
  });

  it("never reads NEXT_PUBLIC_* arming variables", () => {
    expect(
      isOwnedFilingSubmitArmed({
        NEXT_PUBLIC_OWNED_FILING_SUBMIT_ARMED: "true",
        OWNED_FILING_SUBMIT_ARMED: undefined,
      })
    ).toBe(false);
  });

  it("exports a clear unarmed reason", () => {
    expect(OWNED_FILING_SUBMIT_UNARMED_REASON).toContain("OWNED_FILING_SUBMIT_ARMED");
  });
});

describe("classifyOwnedFilingClick", () => {
  it("classifies continue/next as safe", () => {
    expect(classifyOwnedFilingClick({ selectorType: "text", value: "Continue" })).toBe("safe");
    expect(classifyOwnedFilingClick({ selectorType: "text", value: "Next" })).toBe("safe");
    expect(classifyOwnedFilingClick({ selectorType: "id", value: "continue_btn" })).toBe("safe");
  });

  it("classifies submit/file/confirm as irreversible", () => {
    expect(classifyOwnedFilingClick({ selectorType: "text", value: "Submit complaint" })).toBe(
      "irreversible"
    );
    expect(classifyOwnedFilingClick({ selectorType: "type", value: "submit" })).toBe("irreversible");
    expect(classifyOwnedFilingClick({ selectorType: "text", value: "File complaint" })).toBe(
      "irreversible"
    );
    expect(classifyOwnedFilingClick({ selectorType: "text", value: "Confirm" })).toBe("irreversible");
  });

  it("fails closed on unknown or blank buttons", () => {
    expect(classifyOwnedFilingClick(null)).toBe("unknown");
    expect(classifyOwnedFilingClick({ selectorType: "text", value: "" })).toBe("unknown");
    expect(classifyOwnedFilingClick({ selectorType: "text", value: "Magic Button XYZ" })).toBe(
      "unknown"
    );
  });
});

describe("ownedFilingDryRunState (durable + idempotent)", () => {
  const CASE_ID = "11111111-1111-4111-8111-111111111111";
  const TASK_ID = "22222222-2222-4222-8222-222222222222";

  it("upserts dry-run block without mutating delivery_state", () => {
    const withDelivery = upsertBbbOwnedFilingDeliveryNotes("queue\ndraft:\nx", {
      delivery_state: "queued",
      provider: "real_bbb_bounded_submit",
      started_at: "2026-07-14T00:00:00.000Z",
    });
    const next = upsertOwnedFilingDryRunNotes(withDelivery, {
      status: "dry_run_blocked_at_submit",
      destination: "bbb",
      case_id: CASE_ID,
      task_id: TASK_ID,
      ran_at: "2026-07-19T12:00:00.000Z",
      steps_executed: 3,
      stop_reason: "blocked_irreversible_click",
      button_label: "text:Submit",
      button_risk: "irreversible",
    });
    expect(next).toContain(OWNED_FILING_DRY_RUN_BLOCK_MARKER);
    expect(parseBbbOwnedFilingDeliveryRecord(next)?.delivery_state).toBe("queued");
    const parsed = parseOwnedFilingDryRunRecord(next);
    expect(parsed).toMatchObject({
      status: "dry_run_blocked_at_submit",
      destination: "bbb",
      case_id: CASE_ID,
      stop_reason: "blocked_irreversible_click",
    });
  });

  it("replaces prior dry-run block (duplicate-safe upsert)", () => {
    const first = upsertOwnedFilingDryRunNotes("", {
      status: "dry_run_failed",
      destination: "ftc",
      case_id: CASE_ID,
      task_id: TASK_ID,
      ran_at: "2026-07-19T11:00:00.000Z",
      steps_executed: 0,
    });
    const second = upsertOwnedFilingDryRunNotes(first, {
      status: "dry_run_blocked_at_submit",
      destination: "ftc",
      case_id: CASE_ID,
      task_id: TASK_ID,
      ran_at: "2026-07-19T12:00:00.000Z",
      steps_executed: 2,
    });
    expect(second.split(OWNED_FILING_DRY_RUN_BLOCK_MARKER).length).toBe(2);
    expect(parseOwnedFilingDryRunRecord(second)?.status).toBe("dry_run_blocked_at_submit");
  });

  it("detects matching prior successful dry-run for idempotency", () => {
    const notes = upsertOwnedFilingDryRunNotes("", {
      status: "dry_run_blocked_at_submit",
      destination: "bbb",
      case_id: CASE_ID,
      task_id: TASK_ID,
      ran_at: "2026-07-19T12:00:00.000Z",
      steps_executed: 2,
    });
    expect(hasMatchingOwnedFilingDryRunResult(notes, "bbb", "dry_run_blocked_at_submit")).toBe(true);
    expect(hasMatchingOwnedFilingDryRunResult(notes, "ftc", "dry_run_blocked_at_submit")).toBe(false);
    expect(hasMatchingOwnedFilingDryRunResult(notes, "bbb", "dry_run_completed")).toBe(false);
  });
});

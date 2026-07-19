import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { REAL_BBB_COMPLAINT_SUBMISSION_URL } from "@/lib/justice/assistedSubmissionLane";
import { evaluateOwnedBbbAutofillExecutionReadiness } from "@/lib/justice/bbbOwnedFilingProduction";
import { getBbbOwnedFilingSubmitContext } from "@/lib/justice/bbbOwnedFilingSubmitContext";
import { findOpenBbbFilingTask } from "@/lib/justice/bbbFilingTask";
import { parseBbbOwnedFilingDeliveryRecord } from "@/lib/justice/bbbOwnedFilingDeliveryState";
import { findOpenFtcFilingTask } from "@/lib/justice/ftcFilingTask";
import { parseFtcOwnedFilingDeliveryRecord } from "@/lib/justice/ftcOwnedFilingDeliveryState";
import { FTC_OFFICIAL_CONSUMER_COMPLAINT_PORTAL_URL } from "@/lib/justice/ftcOfficialPortal";
import {
  hasMatchingOwnedFilingDryRunResult,
  upsertOwnedFilingDryRunNotes,
  type OwnedFilingDryRunRecord,
  type OwnedFilingDryRunStatus,
} from "@/lib/justice/ownedFilingDryRunState";
import { intakeToRealBbbUserData } from "@/lib/justice/realBbbUserData";
import { intakeToRealFtcUserData } from "@/lib/justice/realFtcUserData";
import { runRealBbbBoundedSubmit } from "@/lib/justice/runRealBbbBoundedSubmit";
import { runRealFtcBoundedSubmit } from "@/lib/justice/runRealFtcBoundedSubmit";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";
import type { JusticeIntake } from "@/lib/justice/types";

const TASK_SELECT =
  "id, user_id, case_id, title, due_date, notes, completed_at, created_at, updated_at" as const;

export type OwnedFilingDryRunDestination = "bbb" | "ftc";

export type OwnedFilingDryRunResult = {
  ok: boolean;
  status: OwnedFilingDryRunStatus;
  destination: OwnedFilingDryRunDestination;
  case_id: string;
  task_id: string;
  steps_executed: number;
  stop_reason?: string;
  button_label?: string;
  page_url?: string;
  detail?: string;
  skipped_duplicate?: boolean;
};

async function patchTaskNotes(
  supabase: SupabaseClient,
  userId: string,
  taskId: string,
  expectedNotes: string,
  nextNotes: string
): Promise<JusticeCaseTaskRow | null> {
  // Compare-and-swap so concurrent dry-runs / workers cannot clobber each other.
  const { data, error } = await supabase
    .from("justice_case_tasks")
    .update({ notes: nextNotes })
    .eq("id", taskId)
    .eq("user_id", userId)
    .eq("notes", expectedNotes)
    .is("completed_at", null)
    .select(TASK_SELECT)
    .maybeSingle();
  if (error || !data) {
    console.warn("owned filing dry-run: patch notes failed", error?.message ?? "cas miss");
    return null;
  }
  return data as JusticeCaseTaskRow;
}

async function loadOpenOwnedFilingTask(
  supabase: SupabaseClient,
  userId: string,
  caseId: string,
  destination: OwnedFilingDryRunDestination
): Promise<{ task: JusticeCaseTaskRow; intake: JusticeIntake } | { error: string }> {
  const { data: caseRow, error: caseErr } = await supabase
    .from("justice_cases")
    .select("intake, user_id")
    .eq("id", caseId)
    .eq("user_id", userId)
    .maybeSingle();
  if (caseErr || !caseRow) return { error: "case not found" };
  const intake = caseRow.intake as JusticeIntake | null;
  if (!intake || typeof intake !== "object") return { error: "invalid intake" };

  const { data: tasks, error: taskErr } = await supabase
    .from("justice_case_tasks")
    .select(TASK_SELECT)
    .eq("user_id", userId)
    .eq("case_id", caseId)
    .is("completed_at", null)
    .limit(50);
  if (taskErr) return { error: taskErr.message };

  const rows = (tasks ?? []) as JusticeCaseTaskRow[];
  const task =
    destination === "bbb" ? findOpenBbbFilingTask(rows, caseId) : findOpenFtcFilingTask(rows, caseId);
  if (!task) return { error: `no open ${destination.toUpperCase()} filing task` };

  const delivery =
    destination === "bbb"
      ? parseBbbOwnedFilingDeliveryRecord(task.notes)
      : parseFtcOwnedFilingDeliveryRecord(task.notes);
  if (delivery?.delivery_state === "filed") {
    return { error: `${destination.toUpperCase()} already filed — dry-run refused` };
  }
  if (delivery?.delivery_state === "submitting") {
    return { error: `${destination.toUpperCase()} is submitting — dry-run refused` };
  }

  return { task, intake };
}

function mapBoundedStopToDryRunStatus(
  stopReason: string | undefined
): OwnedFilingDryRunStatus {
  if (stopReason === "blocked_irreversible_click") return "dry_run_blocked_at_submit";
  if (stopReason === "blocked_unknown_click") return "dry_run_blocked_at_submit";
  if (stopReason === "terminal_confirmation") {
    // Should not happen in dry-run without irreversible click; treat as failed safety violation.
    return "dry_run_failed";
  }
  if (
    stopReason === "max_steps_reached" ||
    stopReason === "empty_decision" ||
    !stopReason
  ) {
    return "dry_run_completed";
  }
  return "dry_run_failed";
}

/**
 * Operator dry-run for a selected case/destination. Uses real intake, Browserless, portal,
 * decide-action, and field fills. Stops before irreversible/unknown clicks. Never marks filed,
 * never completes the task, never advances the ladder. Minute cron must not call this.
 */
export async function runOwnedFilingDryRun(
  supabase: SupabaseClient,
  userId: string,
  caseId: string,
  destination: OwnedFilingDryRunDestination
): Promise<OwnedFilingDryRunResult> {
  const trimmedCaseId = caseId.trim();
  const trimmedUserId = userId.trim();
  if (!trimmedCaseId || !trimmedUserId) {
    return {
      ok: false,
      status: "dry_run_failed",
      destination,
      case_id: trimmedCaseId,
      task_id: "",
      steps_executed: 0,
      detail: "case_id and user_id are required",
    };
  }

  const loaded = await loadOpenOwnedFilingTask(supabase, trimmedUserId, trimmedCaseId, destination);
  if ("error" in loaded) {
    return {
      ok: false,
      status: "dry_run_failed",
      destination,
      case_id: trimmedCaseId,
      task_id: "",
      steps_executed: 0,
      detail: loaded.error,
    };
  }

  const { task, intake } = loaded;

  // Duplicate-safe: identical successful dry-run already recorded → no re-run.
  if (
    hasMatchingOwnedFilingDryRunResult(task.notes, destination, "dry_run_blocked_at_submit") ||
    hasMatchingOwnedFilingDryRunResult(task.notes, destination, "dry_run_completed")
  ) {
    const prior = hasMatchingOwnedFilingDryRunResult(task.notes, destination, "dry_run_blocked_at_submit")
      ? "dry_run_blocked_at_submit"
      : "dry_run_completed";
    return {
      ok: true,
      status: prior,
      destination,
      case_id: trimmedCaseId,
      task_id: task.id,
      steps_executed: 0,
      detail: `prior ${prior} — duplicate skipped`,
      skipped_duplicate: true,
    };
  }

  const readiness = evaluateOwnedBbbAutofillExecutionReadiness(trimmedUserId);
  if (!readiness.ok) {
    return await persistDryRunFailure(
      supabase,
      trimmedUserId,
      task,
      destination,
      trimmedCaseId,
      0,
      readiness.reason,
      "config"
    );
  }

  const overrideBase = getBbbOwnedFilingSubmitContext()?.base?.trim();
  const base = (overrideBase || readiness.base).replace(/\/$/, "");
  const forwardedHeaders = readiness.forwardedHeaders;

  let stepsExecuted = 0;
  let stopReason: string | undefined;
  let buttonLabel: string | undefined;
  let pageUrl: string | undefined;
  let detail: string | undefined;

  try {
    if (destination === "bbb") {
      const bounded = await runRealBbbBoundedSubmit({
        url: REAL_BBB_COMPLAINT_SUBMISSION_URL,
        userData: intakeToRealBbbUserData(intake),
        base,
        forwardedHeaders,
        mode: "dry_run",
      });
      stepsExecuted = bounded.ok ? bounded.fillResult.stepsExecuted : bounded.stepsExecuted;
      pageUrl = bounded.ok
        ? bounded.fillResult.pageData?.url
        : bounded.fillResult.pageData?.url ?? undefined;
      if (bounded.ok) {
        stopReason = "terminal_confirmation";
        detail = "dry-run unexpectedly reached terminal confirmation without submit gate";
      } else {
        stopReason = bounded.stopReason;
        detail = bounded.error;
        const blocked = bounded.fillResult.stepLog
          .slice()
          .reverse()
          .find(
            (e) =>
              e.action === "blocked_irreversible_click" || e.action === "blocked_unknown_click"
          );
        buttonLabel = blocked?.detail;
      }
    } else {
      const bounded = await runRealFtcBoundedSubmit({
        url: FTC_OFFICIAL_CONSUMER_COMPLAINT_PORTAL_URL,
        userData: intakeToRealFtcUserData(intake),
        base,
        forwardedHeaders,
        mode: "dry_run",
      });
      stepsExecuted = bounded.ok ? bounded.fillResult.stepsExecuted : bounded.stepsExecuted;
      pageUrl = bounded.ok
        ? bounded.fillResult.pageData?.url
        : bounded.fillResult.pageData?.url ?? undefined;
      if (bounded.ok) {
        stopReason = "terminal_confirmation";
        detail = "dry-run unexpectedly reached terminal confirmation without submit gate";
      } else {
        stopReason = bounded.stopReason;
        detail = bounded.error;
        const blocked = bounded.fillResult.stepLog
          .slice()
          .reverse()
          .find(
            (e) =>
              e.action === "blocked_irreversible_click" || e.action === "blocked_unknown_click"
          );
        buttonLabel = blocked?.detail;
      }
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return await persistDryRunFailure(
      supabase,
      trimmedUserId,
      task,
      destination,
      trimmedCaseId,
      stepsExecuted,
      message,
      "provider"
    );
  }

  const status = mapBoundedStopToDryRunStatus(stopReason);
  const ranAt = new Date().toISOString();
  const record: OwnedFilingDryRunRecord = {
    status,
    destination,
    case_id: trimmedCaseId,
    task_id: task.id,
    ran_at: ranAt,
    steps_executed: stepsExecuted,
    ...(stopReason ? { stop_reason: stopReason } : {}),
    ...(buttonLabel ? { button_label: buttonLabel, button_risk: stopReason?.includes("unknown") ? "unknown" : "irreversible" } : {}),
    ...(pageUrl ? { page_url: pageUrl } : {}),
    ...(detail ? { detail } : {}),
  };

  const nextNotes = upsertOwnedFilingDryRunNotes(task.notes, record);
  const patched = await patchTaskNotes(supabase, trimmedUserId, task.id, task.notes ?? "", nextNotes);
  if (!patched) {
    // Lost CAS — another writer updated notes; treat as duplicate-safe soft success if marker now matches.
    return {
      ok: status !== "dry_run_failed",
      status,
      destination,
      case_id: trimmedCaseId,
      task_id: task.id,
      steps_executed: stepsExecuted,
      stop_reason: stopReason,
      button_label: buttonLabel,
      page_url: pageUrl,
      detail: detail ? `${detail} (notes CAS miss)` : "notes CAS miss",
    };
  }

  // Ensure delivery_state was not mutated to filed and task not completed.
  const stillOpen = !patched.completed_at?.trim();
  const delivery =
    destination === "bbb"
      ? parseBbbOwnedFilingDeliveryRecord(patched.notes)
      : parseFtcOwnedFilingDeliveryRecord(patched.notes);
  if (!stillOpen || delivery?.delivery_state === "filed") {
    return {
      ok: false,
      status: "dry_run_failed",
      destination,
      case_id: trimmedCaseId,
      task_id: task.id,
      steps_executed: stepsExecuted,
      detail: "safety violation: dry-run must not file or complete the task",
    };
  }

  return {
    ok: status !== "dry_run_failed",
    status,
    destination,
    case_id: trimmedCaseId,
    task_id: task.id,
    steps_executed: stepsExecuted,
    stop_reason: stopReason,
    button_label: buttonLabel,
    page_url: pageUrl,
    detail,
  };
}

async function persistDryRunFailure(
  supabase: SupabaseClient,
  userId: string,
  task: JusticeCaseTaskRow,
  destination: OwnedFilingDryRunDestination,
  caseId: string,
  stepsExecuted: number,
  detail: string,
  stopReason: string
): Promise<OwnedFilingDryRunResult> {
  const ranAt = new Date().toISOString();
  const record: OwnedFilingDryRunRecord = {
    status: "dry_run_failed",
    destination,
    case_id: caseId,
    task_id: task.id,
    ran_at: ranAt,
    steps_executed: stepsExecuted,
    stop_reason: stopReason,
    detail,
  };
  const nextNotes = upsertOwnedFilingDryRunNotes(task.notes, record);
  await patchTaskNotes(supabase, userId, task.id, task.notes ?? "", nextNotes);
  return {
    ok: false,
    status: "dry_run_failed",
    destination,
    case_id: caseId,
    task_id: task.id,
    steps_executed: stepsExecuted,
    stop_reason: stopReason,
    detail,
  };
}

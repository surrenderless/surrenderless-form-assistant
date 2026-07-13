import type { SupabaseClient } from "@supabase/supabase-js";
import { isJusticeIntakePayload } from "@/lib/justice/caseApiValidation";
import {
  parseCfpbFilingTaskDraft,
  taskNotesMatchCfpbFilingMarker,
} from "@/lib/justice/cfpbFilingTask";
import {
  parseDemandLetterFilingTaskDraft,
  taskNotesMatchDemandLetterFilingMarker,
} from "@/lib/justice/demandLetterFilingTask";
import {
  parseDotFilingTaskDraft,
  taskNotesMatchDotFilingMarker,
} from "@/lib/justice/dotFilingTask";
import {
  parseFccFilingTaskDraft,
  taskNotesMatchFccFilingMarker,
} from "@/lib/justice/fccFilingTask";
import {
  parsePaymentDisputeFilingTaskDraft,
  taskNotesMatchPaymentDisputeFilingMarker,
} from "@/lib/justice/paymentDisputeFilingTask";
import {
  parseStateAgFilingTaskDraft,
  taskNotesMatchStateAgFilingMarker,
} from "@/lib/justice/stateAgFilingTask";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";
import type { JusticeIntake } from "@/lib/justice/types";

export type OperatorFulfillmentStep =
  | "state_ag"
  | "demand_letter"
  | "cfpb"
  | "payment_dispute"
  | "fcc"
  | "dot";

export type OperatorFulfillmentQueueItem = {
  case_id: string;
  case_owner_user_id: string;
  task_id: string;
  step: OperatorFulfillmentStep;
  task_title: string;
  company_name: string;
  consumer_us_state: string | null;
  draft_excerpt: string;
};

const TASK_SELECT =
  "id, user_id, case_id, title, due_date, notes, completed_at, created_at, updated_at" as const;

const DRAFT_EXCERPT_MAX = 400;

function truncateDraft(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= DRAFT_EXCERPT_MAX) return trimmed;
  return `${trimmed.slice(0, DRAFT_EXCERPT_MAX - 1)}…`;
}

function classifyOpenOperatorTask(
  task: JusticeCaseTaskRow,
  intake: JusticeIntake
): OperatorFulfillmentQueueItem | null {
  if (task.completed_at?.trim()) return null;
  const caseId = task.case_id.trim();
  if (!caseId) return null;

  if (taskNotesMatchStateAgFilingMarker(task.notes, caseId)) {
    return {
      case_id: caseId,
      case_owner_user_id: task.user_id.trim(),
      task_id: task.id,
      step: "state_ag",
      task_title: task.title?.trim() || "State AG filing",
      company_name: intake.company_name.trim() || "Consumer case",
      consumer_us_state: intake.consumer_us_state?.trim().toUpperCase() || null,
      draft_excerpt: truncateDraft(parseStateAgFilingTaskDraft(task.notes)),
    };
  }

  if (taskNotesMatchDemandLetterFilingMarker(task.notes, caseId)) {
    return {
      case_id: caseId,
      case_owner_user_id: task.user_id.trim(),
      task_id: task.id,
      step: "demand_letter",
      task_title: task.title?.trim() || "Demand letter",
      company_name: intake.company_name.trim() || "Consumer case",
      consumer_us_state: intake.consumer_us_state?.trim().toUpperCase() || null,
      draft_excerpt: truncateDraft(parseDemandLetterFilingTaskDraft(task.notes)),
    };
  }

  if (taskNotesMatchCfpbFilingMarker(task.notes, caseId)) {
    return {
      case_id: caseId,
      case_owner_user_id: task.user_id.trim(),
      task_id: task.id,
      step: "cfpb",
      task_title: task.title?.trim() || "CFPB filing",
      company_name: intake.company_name.trim() || "Consumer case",
      consumer_us_state: intake.consumer_us_state?.trim().toUpperCase() || null,
      draft_excerpt: truncateDraft(parseCfpbFilingTaskDraft(task.notes)),
    };
  }

  if (taskNotesMatchPaymentDisputeFilingMarker(task.notes, caseId)) {
    return {
      case_id: caseId,
      case_owner_user_id: task.user_id.trim(),
      task_id: task.id,
      step: "payment_dispute",
      task_title: task.title?.trim() || "Payment dispute",
      company_name: intake.company_name.trim() || "Consumer case",
      consumer_us_state: intake.consumer_us_state?.trim().toUpperCase() || null,
      draft_excerpt: truncateDraft(parsePaymentDisputeFilingTaskDraft(task.notes)),
    };
  }

  if (taskNotesMatchFccFilingMarker(task.notes, caseId)) {
    return {
      case_id: caseId,
      case_owner_user_id: task.user_id.trim(),
      task_id: task.id,
      step: "fcc",
      task_title: task.title?.trim() || "FCC filing",
      company_name: intake.company_name.trim() || "Consumer case",
      consumer_us_state: intake.consumer_us_state?.trim().toUpperCase() || null,
      draft_excerpt: truncateDraft(parseFccFilingTaskDraft(task.notes)),
    };
  }

  if (taskNotesMatchDotFilingMarker(task.notes, caseId)) {
    return {
      case_id: caseId,
      case_owner_user_id: task.user_id.trim(),
      task_id: task.id,
      step: "dot",
      task_title: task.title?.trim() || "DOT filing",
      company_name: intake.company_name.trim() || "Consumer case",
      consumer_us_state: intake.consumer_us_state?.trim().toUpperCase() || null,
      draft_excerpt: truncateDraft(parseDotFilingTaskDraft(task.notes)),
    };
  }

  return null;
}

export async function resolveCaseOwnerUserIdForOperatorFulfillment(
  supabase: SupabaseClient,
  caseId: string
): Promise<{ ok: true; userId: string } | { ok: false; error: string; status: number }> {
  const trimmedCaseId = caseId.trim();
  const { data, error } = await supabase
    .from("justice_cases")
    .select("user_id")
    .eq("id", trimmedCaseId)
    .maybeSingle();

  if (error) {
    console.warn("operator fulfillment: resolve case owner", error.message);
    return { ok: false, error: error.message, status: 500 };
  }
  if (!data?.user_id?.trim()) {
    return { ok: false, error: "Not found", status: 404 };
  }
  return { ok: true, userId: data.user_id.trim() };
}

export async function listOperatorFulfillmentQueue(
  supabase: SupabaseClient
): Promise<OperatorFulfillmentQueueItem[]> {
  const { data: openTasks, error: tasksErr } = await supabase
    .from("justice_case_tasks")
    .select(TASK_SELECT)
    .is("completed_at", null)
    .order("created_at", { ascending: true });

  if (tasksErr) {
    console.warn("operator fulfillment: list open tasks", tasksErr.message);
    return [];
  }

  const candidateTasks = (openTasks ?? []) as JusticeCaseTaskRow[];
  const operatorTasks = candidateTasks.filter((task) => {
    const caseId = task.case_id?.trim() ?? "";
    if (!caseId) return false;
      return (
        taskNotesMatchStateAgFilingMarker(task.notes, caseId) ||
        taskNotesMatchDemandLetterFilingMarker(task.notes, caseId) ||
        taskNotesMatchCfpbFilingMarker(task.notes, caseId) ||
        taskNotesMatchPaymentDisputeFilingMarker(task.notes, caseId) ||
        taskNotesMatchFccFilingMarker(task.notes, caseId) ||
        taskNotesMatchDotFilingMarker(task.notes, caseId)
      );
  });

  if (operatorTasks.length === 0) return [];

  const caseIds = [...new Set(operatorTasks.map((task) => task.case_id.trim()).filter(Boolean))];
  const { data: caseRows, error: casesErr } = await supabase
    .from("justice_cases")
    .select("id, user_id, intake, archived_at")
    .in("id", caseIds);

  if (casesErr) {
    console.warn("operator fulfillment: list cases", casesErr.message);
    return [];
  }

  const intakeByCaseId = new Map<string, JusticeIntake>();
  for (const row of caseRows ?? []) {
    if (row.archived_at) continue;
    if (!isJusticeIntakePayload(row.intake)) continue;
    intakeByCaseId.set(String(row.id).trim(), row.intake as JusticeIntake);
  }

  const items: OperatorFulfillmentQueueItem[] = [];
  for (const task of operatorTasks) {
    const caseId = task.case_id.trim();
    const intake = intakeByCaseId.get(caseId);
    if (!intake) continue;
    const item = classifyOpenOperatorTask(task, intake);
    if (item) items.push(item);
  }

  return items;
}

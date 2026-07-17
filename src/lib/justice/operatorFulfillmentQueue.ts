import type { SupabaseClient } from "@supabase/supabase-js";
import { isJusticeIntakePayload } from "@/lib/justice/caseApiValidation";
import {
  parseBbbFilingTaskDraft,
  taskNotesMatchBbbFilingMarker,
} from "@/lib/justice/bbbFilingTask";
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
  parseFtcFilingTaskDraft,
  taskNotesMatchFtcFilingMarker,
} from "@/lib/justice/ftcFilingTask";
import {
  parseMerchantContactFilingTaskDraft,
  taskNotesMatchMerchantContactFilingMarker,
} from "@/lib/justice/merchantContactFilingTask";
import {
  parsePaymentDisputeFilingTaskDraft,
  taskNotesMatchPaymentDisputeFilingMarker,
} from "@/lib/justice/paymentDisputeFilingTask";
import {
  parseFollowUpResponseReviewTaskDraft,
  taskNotesMatchFollowUpResponseReviewMarker,
} from "@/lib/justice/followUpResponseReviewTask";
import { taskNotesMatchAnyOperatorFulfillmentMarker } from "@/lib/justice/operatorEvidenceFileAccess";
import { mapOperatorFulfillmentQueueEvidenceRow } from "@/lib/justice/operatorFulfillmentQueueEvidence";
import {
  parseStateAgFilingTaskDraft,
  taskNotesMatchStateAgFilingMarker,
} from "@/lib/justice/stateAgFilingTask";
import {
  buildCfpbOperatorFilingWorkspace,
  type CfpbOperatorFilingWorkspace,
} from "@/lib/justice/cfpbOperatorFilingWorkspace";
import {
  buildBbbOperatorFilingWorkspace,
  type BbbOperatorFilingWorkspace,
} from "@/lib/justice/bbbOperatorFilingWorkspace";
import {
  buildDemandLetterOperatorFilingWorkspace,
  type DemandLetterOperatorFilingWorkspace,
} from "@/lib/justice/demandLetterOperatorFilingWorkspace";
import {
  buildDotOperatorFilingWorkspace,
  type DotOperatorFilingWorkspace,
} from "@/lib/justice/dotOperatorFilingWorkspace";
import {
  buildFccOperatorFilingWorkspace,
  type FccOperatorFilingWorkspace,
} from "@/lib/justice/fccOperatorFilingWorkspace";
import {
  buildFtcOperatorFilingWorkspace,
  type FtcOperatorFilingWorkspace,
} from "@/lib/justice/ftcOperatorFilingWorkspace";
import {
  buildMerchantContactOperatorFilingWorkspace,
  type MerchantContactOperatorFilingWorkspace,
} from "@/lib/justice/merchantContactOperatorFilingWorkspace";
import {
  buildPaymentDisputeOperatorFilingWorkspace,
  type PaymentDisputeOperatorFilingWorkspace,
} from "@/lib/justice/paymentDisputeOperatorFilingWorkspace";
import {
  buildStateAgOperatorFilingWorkspace,
  type StateAgOperatorFilingWorkspace,
} from "@/lib/justice/stateAgOperatorFilingWorkspace";
import {
  mapOperatorWorkspaceEvidence,
  type OperatorWorkspaceEvidenceInput,
  type OperatorWorkspaceEvidenceItem,
} from "@/lib/justice/operatorWorkspaceEvidence";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";
import type { JusticeIntake } from "@/lib/justice/types";

export type OperatorFulfillmentStep =
  | "merchant_contact"
  | "state_ag"
  | "demand_letter"
  | "cfpb"
  | "payment_dispute"
  | "fcc"
  | "dot"
  | "ftc"
  | "bbb"
  | "follow_up_response_review";

export type OperatorFulfillmentQueueItem = {
  case_id: string;
  case_owner_user_id: string;
  task_id: string;
  step: OperatorFulfillmentStep;
  task_title: string;
  company_name: string;
  consumer_us_state: string | null;
  draft_excerpt: string;
  /** Present only for State AG tasks — full guided filing workspace. */
  state_ag_workspace?: StateAgOperatorFilingWorkspace;
  /** Present only for CFPB tasks — full guided filing workspace. */
  cfpb_workspace?: CfpbOperatorFilingWorkspace;
  /** Present only for FCC tasks — full guided filing workspace. */
  fcc_workspace?: FccOperatorFilingWorkspace;
  /** Present only for FTC tasks — full guided filing workspace. */
  ftc_workspace?: FtcOperatorFilingWorkspace;
  /** Present only for DOT tasks — full guided filing workspace. */
  dot_workspace?: DotOperatorFilingWorkspace;
  /** Present only for demand-letter tasks — full guided filing workspace. */
  demand_letter_workspace?: DemandLetterOperatorFilingWorkspace;
  /** Present only for BBB tasks — guided fallback workspace (owned autofill remains primary). */
  bbb_workspace?: BbbOperatorFilingWorkspace;
  /** Present only for merchant-contact tasks — guided fallback workspace (email remains primary). */
  merchant_contact_workspace?: MerchantContactOperatorFilingWorkspace;
  /** Present only for payment-dispute tasks — guided fallback workspace (email remains primary). */
  payment_dispute_workspace?: PaymentDisputeOperatorFilingWorkspace;
  /**
   * Present for follow-up response review — case evidence with View file access
   * via /api/operator/evidence/[id]/file (never includes file_path).
   */
  evidence?: OperatorWorkspaceEvidenceItem[];
};

export type OperatorFulfillmentPanelKind =
  | "state_ag_workspace"
  | "cfpb_workspace"
  | "fcc_workspace"
  | "ftc_workspace"
  | "dot_workspace"
  | "demand_letter_workspace"
  | "bbb_workspace"
  | "merchant_contact_workspace"
  | "payment_dispute_workspace"
  | "follow_up_response_review"
  | "record_form";

/** UI branching for /operator/fulfillment — keeps workspace panels scoped by step. */
export function resolveOperatorFulfillmentPanelKind(
  item: Pick<
    OperatorFulfillmentQueueItem,
    | "step"
    | "state_ag_workspace"
    | "cfpb_workspace"
    | "fcc_workspace"
    | "ftc_workspace"
    | "dot_workspace"
    | "demand_letter_workspace"
    | "bbb_workspace"
    | "merchant_contact_workspace"
    | "payment_dispute_workspace"
  >
): OperatorFulfillmentPanelKind {
  if (item.step === "state_ag" && item.state_ag_workspace) return "state_ag_workspace";
  if (item.step === "cfpb" && item.cfpb_workspace) return "cfpb_workspace";
  if (item.step === "fcc" && item.fcc_workspace) return "fcc_workspace";
  if (item.step === "ftc" && item.ftc_workspace) return "ftc_workspace";
  if (item.step === "dot" && item.dot_workspace) return "dot_workspace";
  if (item.step === "demand_letter" && item.demand_letter_workspace) {
    return "demand_letter_workspace";
  }
  if (item.step === "bbb" && item.bbb_workspace) return "bbb_workspace";
  if (item.step === "merchant_contact" && item.merchant_contact_workspace) {
    return "merchant_contact_workspace";
  }
  if (item.step === "payment_dispute" && item.payment_dispute_workspace) {
    return "payment_dispute_workspace";
  }
  if (item.step === "follow_up_response_review") return "follow_up_response_review";
  return "record_form";
}

/** Steps whose case evidence is loaded into the operator fulfillment queue payload. */
export function operatorFulfillmentStepLoadsCaseEvidence(step: OperatorFulfillmentStep): boolean {
  return (
    step === "state_ag" ||
    step === "cfpb" ||
    step === "fcc" ||
    step === "ftc" ||
    step === "dot" ||
    step === "demand_letter" ||
    step === "bbb" ||
    step === "merchant_contact" ||
    step === "payment_dispute" ||
    step === "follow_up_response_review"
  );
}

/**
 * Attaches mapped evidence inventory to a follow-up response-review queue item.
 * Other steps are unchanged (their evidence lives inside guided workspaces).
 */
export function withFollowUpResponseReviewEvidence(
  item: OperatorFulfillmentQueueItem,
  evidence: readonly OperatorWorkspaceEvidenceInput[]
): OperatorFulfillmentQueueItem {
  if (item.step !== "follow_up_response_review") return item;
  return {
    ...item,
    evidence: mapOperatorWorkspaceEvidence(evidence),
  };
}

const TASK_SELECT =
  "id, user_id, case_id, title, due_date, notes, completed_at, created_at, updated_at" as const;

const DRAFT_EXCERPT_MAX = 400;

function truncateDraft(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= DRAFT_EXCERPT_MAX) return trimmed;
  return `${trimmed.slice(0, DRAFT_EXCERPT_MAX - 1)}…`;
}

/** Classifies an open operator task into a queue item (exported for focused tests). */
export function classifyOpenOperatorTask(
  task: JusticeCaseTaskRow,
  intake: JusticeIntake
): OperatorFulfillmentQueueItem | null {
  if (task.completed_at?.trim()) return null;
  const caseId = task.case_id.trim();
  if (!caseId) return null;

  if (taskNotesMatchFollowUpResponseReviewMarker(task.notes, caseId)) {
    return {
      case_id: caseId,
      case_owner_user_id: task.user_id.trim(),
      task_id: task.id,
      step: "follow_up_response_review",
      task_title: task.title?.trim() || "Follow-up response review",
      company_name: intake.company_name.trim() || "Consumer case",
      consumer_us_state: intake.consumer_us_state?.trim().toUpperCase() || null,
      draft_excerpt: truncateDraft(parseFollowUpResponseReviewTaskDraft(task.notes)),
      evidence: [],
    };
  }

  if (taskNotesMatchMerchantContactFilingMarker(task.notes, caseId)) {
    return {
      case_id: caseId,
      case_owner_user_id: task.user_id.trim(),
      task_id: task.id,
      step: "merchant_contact",
      task_title: task.title?.trim() || "Merchant contact",
      company_name: intake.company_name.trim() || "Consumer case",
      consumer_us_state: intake.consumer_us_state?.trim().toUpperCase() || null,
      draft_excerpt: truncateDraft(parseMerchantContactFilingTaskDraft(task.notes)),
      merchant_contact_workspace: buildMerchantContactOperatorFilingWorkspace({
        intake,
        taskNotes: task.notes,
        evidence: [],
      }),
    };
  }

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
      state_ag_workspace: buildStateAgOperatorFilingWorkspace({
        intake,
        taskNotes: task.notes,
        evidence: [],
      }),
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
      demand_letter_workspace: buildDemandLetterOperatorFilingWorkspace({
        intake,
        taskNotes: task.notes,
        evidence: [],
      }),
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
      cfpb_workspace: buildCfpbOperatorFilingWorkspace({
        intake,
        taskNotes: task.notes,
        evidence: [],
      }),
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
      payment_dispute_workspace: buildPaymentDisputeOperatorFilingWorkspace({
        intake,
        caseId,
        taskNotes: task.notes,
        evidence: [],
      }),
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
      fcc_workspace: buildFccOperatorFilingWorkspace({
        intake,
        taskNotes: task.notes,
        evidence: [],
      }),
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
      dot_workspace: buildDotOperatorFilingWorkspace({
        intake,
        taskNotes: task.notes,
        evidence: [],
      }),
    };
  }

  if (taskNotesMatchFtcFilingMarker(task.notes, caseId)) {
    return {
      case_id: caseId,
      case_owner_user_id: task.user_id.trim(),
      task_id: task.id,
      step: "ftc",
      task_title: task.title?.trim() || "FTC filing",
      company_name: intake.company_name.trim() || "Consumer case",
      consumer_us_state: intake.consumer_us_state?.trim().toUpperCase() || null,
      draft_excerpt: truncateDraft(parseFtcFilingTaskDraft(task.notes)),
      ftc_workspace: buildFtcOperatorFilingWorkspace({
        intake,
        taskNotes: task.notes,
        evidence: [],
      }),
    };
  }

  if (taskNotesMatchBbbFilingMarker(task.notes, caseId)) {
    return {
      case_id: caseId,
      case_owner_user_id: task.user_id.trim(),
      task_id: task.id,
      step: "bbb",
      task_title: task.title?.trim() || "BBB filing",
      company_name: intake.company_name.trim() || "Consumer case",
      consumer_us_state: intake.consumer_us_state?.trim().toUpperCase() || null,
      draft_excerpt: truncateDraft(parseBbbFilingTaskDraft(task.notes)),
      bbb_workspace: buildBbbOperatorFilingWorkspace({
        intake,
        taskNotes: task.notes,
        evidence: [],
      }),
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
    return taskNotesMatchAnyOperatorFulfillmentMarker(task.notes, caseId);
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

  const workspaceCaseIds = [
    ...new Set(
      items
        .filter((item) => operatorFulfillmentStepLoadsCaseEvidence(item.step))
        .map((item) => item.case_id)
    ),
  ];
  if (workspaceCaseIds.length === 0) return items;

  const { data: evidenceRows, error: evidenceErr } = await supabase
    .from("justice_case_evidence")
    .select("id, case_id, title, evidence_type, file_name, evidence_date")
    .in("case_id", workspaceCaseIds)
    .order("created_at", { ascending: true })
    .limit(200);

  if (evidenceErr) {
    console.warn(
      "operator fulfillment: list evidence for guided filing workspaces",
      evidenceErr.message
    );
    return items;
  }

  const evidenceByCaseId = new Map<
    string,
    {
      id: string;
      title: string;
      evidence_type: string;
      file_name: string | null;
      evidence_date: string | null;
    }[]
  >();
  for (const row of evidenceRows ?? []) {
    const mapped = mapOperatorFulfillmentQueueEvidenceRow(row);
    if (!mapped) continue;
    const list = evidenceByCaseId.get(mapped.caseId) ?? [];
    list.push(mapped.evidence);
    evidenceByCaseId.set(mapped.caseId, list);
  }

  return items.map((item) => {
    const intake = intakeByCaseId.get(item.case_id);
    if (!intake) return item;
    const task = operatorTasks.find((t) => t.id === item.task_id);
    const evidence = evidenceByCaseId.get(item.case_id) ?? [];

    if (item.step === "state_ag" && item.state_ag_workspace) {
      return {
        ...item,
        state_ag_workspace: buildStateAgOperatorFilingWorkspace({
          intake,
          taskNotes: task?.notes,
          evidence,
        }),
      };
    }

    if (item.step === "cfpb" && item.cfpb_workspace) {
      return {
        ...item,
        cfpb_workspace: buildCfpbOperatorFilingWorkspace({
          intake,
          taskNotes: task?.notes,
          evidence,
        }),
      };
    }

    if (item.step === "fcc" && item.fcc_workspace) {
      return {
        ...item,
        fcc_workspace: buildFccOperatorFilingWorkspace({
          intake,
          taskNotes: task?.notes,
          evidence,
        }),
      };
    }

    if (item.step === "ftc" && item.ftc_workspace) {
      return {
        ...item,
        ftc_workspace: buildFtcOperatorFilingWorkspace({
          intake,
          taskNotes: task?.notes,
          evidence,
        }),
      };
    }

    if (item.step === "dot" && item.dot_workspace) {
      return {
        ...item,
        dot_workspace: buildDotOperatorFilingWorkspace({
          intake,
          taskNotes: task?.notes,
          evidence,
        }),
      };
    }

    if (item.step === "demand_letter" && item.demand_letter_workspace) {
      return {
        ...item,
        demand_letter_workspace: buildDemandLetterOperatorFilingWorkspace({
          intake,
          taskNotes: task?.notes,
          evidence,
        }),
      };
    }

    if (item.step === "bbb" && item.bbb_workspace) {
      return {
        ...item,
        bbb_workspace: buildBbbOperatorFilingWorkspace({
          intake,
          taskNotes: task?.notes,
          evidence,
        }),
      };
    }

    if (item.step === "merchant_contact" && item.merchant_contact_workspace) {
      return {
        ...item,
        merchant_contact_workspace: buildMerchantContactOperatorFilingWorkspace({
          intake,
          taskNotes: task?.notes,
          evidence,
        }),
      };
    }

    if (item.step === "payment_dispute" && item.payment_dispute_workspace) {
      return {
        ...item,
        payment_dispute_workspace: buildPaymentDisputeOperatorFilingWorkspace({
          intake,
          caseId: item.case_id,
          taskNotes: task?.notes,
          evidence,
        }),
      };
    }

    if (item.step === "follow_up_response_review") {
      return withFollowUpResponseReviewEvidence(item, evidence);
    }

    return item;
  });
}

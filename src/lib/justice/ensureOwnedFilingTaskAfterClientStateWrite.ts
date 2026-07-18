import type { SupabaseClient } from "@supabase/supabase-js";
import { ensureBbbFilingTask, shouldQueueBbbFilingTask } from "@/lib/justice/bbbFilingTask";
import { ensureCfpbFilingTask, shouldQueueCfpbFilingTask } from "@/lib/justice/cfpbFilingTask";
import {
  ensureDemandLetterFilingTask,
  shouldQueueDemandLetterFilingTask,
} from "@/lib/justice/demandLetterFilingTask";
import { attemptAutomatedDemandLetterEmailDeliveryAfterEnsure } from "@/lib/justice/demandLetterEmailDelivery";
import { ensureDotFilingTask, shouldQueueDotFilingTask } from "@/lib/justice/dotFilingTask";
import { ensureFccFilingTask, shouldQueueFccFilingTask } from "@/lib/justice/fccFilingTask";
import { ensureFtcFilingTask, shouldQueueFtcFilingTask } from "@/lib/justice/ftcFilingTask";
import { attemptAutomatedFtcFilingAfterEnsure } from "@/lib/justice/ftcOwnedFilingDelivery";
import {
  ensureMerchantContactFilingTask,
  shouldQueueMerchantContactFilingTask,
} from "@/lib/justice/merchantContactFilingTask";
import {
  ensurePaymentDisputeFilingTask,
  shouldQueuePaymentDisputeFilingTask,
} from "@/lib/justice/paymentDisputeFilingTask";
import { attemptAutomatedPaymentDisputeEmailDeliveryAfterEnsure } from "@/lib/justice/paymentDisputeEmailDelivery";
import {
  ensureStateAgFilingTask,
  shouldQueueStateAgFilingTask,
} from "@/lib/justice/stateAgFilingTask";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";
import type { JusticeIntake, TimelineEntry } from "@/lib/justice/types";

/** Retriable error when client_state requires an owned filing task that could not be ensured. */
export const OWNED_FILING_TASK_ENSURE_RETRYABLE_ERROR =
  "Case updated but the next operator filing task could not be created. Retry to finish handoff.";

export type OwnedFilingTaskKind =
  | "merchant_contact"
  | "payment_dispute"
  | "cfpb"
  | "fcc"
  | "dot"
  | "ftc"
  | "bbb"
  | "state_ag"
  | "demand_letter";

export type EnsureOwnedFilingTaskAfterClientStateWriteResult =
  | {
      ok: true;
      kind: OwnedFilingTaskKind | null;
      timeline: TimelineEntry[] | null;
      created: boolean;
      task: JusticeCaseTaskRow | null;
    }
  | {
      ok: false;
      error: string;
      kind: OwnedFilingTaskKind;
      timeline: TimelineEntry[] | null;
      created: false;
      task: null;
    };

/**
 * Which Surrenderless-owned filing task (if any) client_state currently requires.
 * At most one kind matches — approved_next_action has a single href.
 */
export function resolveRequiredOwnedFilingTaskKind(
  clientState: unknown
): OwnedFilingTaskKind | null {
  if (shouldQueueMerchantContactFilingTask(clientState)) return "merchant_contact";
  if (shouldQueuePaymentDisputeFilingTask(clientState)) return "payment_dispute";
  if (shouldQueueCfpbFilingTask(clientState)) return "cfpb";
  if (shouldQueueFccFilingTask(clientState)) return "fcc";
  if (shouldQueueDotFilingTask(clientState)) return "dot";
  if (shouldQueueFtcFilingTask(clientState)) return "ftc";
  if (shouldQueueBbbFilingTask(clientState)) return "bbb";
  if (shouldQueueStateAgFilingTask(clientState)) return "state_ag";
  if (shouldQueueDemandLetterFilingTask(clientState)) return "demand_letter";
  return null;
}

/**
 * After a successful client_state write, ensure the currently required Surrenderless-owned
 * filing task exists (idempotent marker lookup). Returns ok: false when a required task
 * is still missing after ensure. Does not mark filings submitted/completed.
 */
export async function ensureOwnedFilingTaskAfterClientStateWrite(
  supabase: SupabaseClient,
  params: {
    userId: string;
    caseId: string;
    clientState: unknown;
    intake: JusticeIntake;
    paymentDisputeDraft?: unknown;
    /** When true (default), attempt automated demand-letter email after a successful demand-letter ensure. */
    attemptDemandLetterEmail?: boolean;
    /** When true (default), attempt automated payment-dispute email after a successful payment-dispute ensure. */
    attemptPaymentDisputeEmail?: boolean;
    /** When true (default), attempt automated real FTC bounded submit after a successful FTC ensure. */
    attemptFtcAutofill?: boolean;
  }
): Promise<EnsureOwnedFilingTaskAfterClientStateWriteResult> {
  const userId = params.userId.trim();
  const caseId = params.caseId.trim();
  if (!userId || !caseId) {
    return { ok: true, kind: null, timeline: null, created: false, task: null };
  }

  const kind = resolveRequiredOwnedFilingTaskKind(params.clientState);
  if (!kind) {
    return { ok: true, kind: null, timeline: null, created: false, task: null };
  }

  const intake = params.intake;
  let result: {
    task: JusticeCaseTaskRow | null;
    timeline: TimelineEntry[] | null;
    created: boolean;
  };

  switch (kind) {
    case "merchant_contact":
      result = await ensureMerchantContactFilingTask(supabase, userId, caseId, intake);
      break;
    case "payment_dispute":
      result = await ensurePaymentDisputeFilingTask(
        supabase,
        userId,
        caseId,
        intake,
        params.paymentDisputeDraft
      );
      break;
    case "cfpb":
      result = await ensureCfpbFilingTask(supabase, userId, caseId, intake);
      break;
    case "fcc":
      result = await ensureFccFilingTask(supabase, userId, caseId, intake);
      break;
    case "dot":
      result = await ensureDotFilingTask(supabase, userId, caseId, intake);
      break;
    case "ftc":
      result = await ensureFtcFilingTask(supabase, userId, caseId, intake);
      break;
    case "bbb":
      result = await ensureBbbFilingTask(supabase, userId, caseId, intake);
      break;
    case "state_ag":
      result = await ensureStateAgFilingTask(supabase, userId, caseId, intake);
      break;
    case "demand_letter":
      result = await ensureDemandLetterFilingTask(supabase, userId, caseId, intake);
      break;
  }

  if (!result.task) {
    return {
      ok: false,
      error: OWNED_FILING_TASK_ENSURE_RETRYABLE_ERROR,
      kind,
      timeline: null,
      created: false,
      task: null,
    };
  }

  let timeline = result.timeline;
  if (kind === "demand_letter" && params.attemptDemandLetterEmail !== false) {
    const emailAttempt = await attemptAutomatedDemandLetterEmailDeliveryAfterEnsure(
      supabase,
      userId,
      caseId,
      timeline
    );
    timeline = emailAttempt.timeline;
  }
  if (kind === "payment_dispute" && params.attemptPaymentDisputeEmail !== false) {
    const emailAttempt = await attemptAutomatedPaymentDisputeEmailDeliveryAfterEnsure(
      supabase,
      userId,
      caseId,
      timeline
    );
    timeline = emailAttempt.timeline;
  }
  if (kind === "ftc" && params.attemptFtcAutofill !== false) {
    const autofillAttempt = await attemptAutomatedFtcFilingAfterEnsure(
      supabase,
      userId,
      caseId,
      timeline
    );
    timeline = autofillAttempt.timeline;
  }

  return {
    ok: true,
    kind,
    timeline,
    created: result.created,
    task: result.task,
  };
}

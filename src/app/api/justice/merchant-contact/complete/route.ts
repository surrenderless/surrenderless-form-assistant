import { NextResponse, type NextRequest } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { validate as isUuid } from "uuid";
import { maybeAttemptAutomatedBbbFilingForClientState } from "@/lib/justice/bbbOwnedFilingDelivery";
import { maybeAttemptAutomatedFtcFilingForClientState } from "@/lib/justice/ftcOwnedFilingDelivery";
import {
  buildBbbOwnedFilingSubmitContextFromRequest,
  runWithBbbOwnedFilingSubmitContext,
} from "@/lib/justice/bbbOwnedFilingSubmitContext";
import { completeMerchantContactOperatorFiling } from "@/lib/justice/completeMerchantContactOperatorFiling";
import { resolveCaseOwnerUserIdForOperatorFulfillment } from "@/lib/justice/operatorFulfillmentQueue";
import type { ContactMethod, MerchantResponseType } from "@/lib/justice/types";
import { requireOperatorApiAccess } from "@/server/requireOperatorApiAccess";
import {
  completePlaywrightMockMerchantContactOperatorFiling,
  isPlaywrightMockHumanFulfillmentOperatorFilingCaseId,
  isPlaywrightMockHumanFulfillmentOperatorFilingEnabled,
  resolvePlaywrightMockCaseOwnerUserId,
} from "@/lib/testing/playwrightMockHumanFulfillmentLadderPipeline";

/** Owned BBB autofill may run after ladder completion. */
export const maxDuration = 300;

function getSupabaseAdmin(): SupabaseClient | null {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !supabaseServiceRoleKey) return null;

  return createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch },
  });
}

function supabaseUnavailableResponse() {
  return NextResponse.json(
    { error: "Supabase is not configured on this server." },
    { status: 503 }
  );
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

const CONTACT_METHODS = new Set([
  "email",
  "chat",
  "phone",
  "form",
  "in_person",
  "other",
]);

const MERCHANT_RESPONSE_TYPES = new Set([
  "no_response",
  "refused_help",
  "promised_but_did_not_fix",
  "partial_help",
  "asked_more_info",
  "other",
  "resolved",
]);

export async function POST(req: NextRequest) {
  const auth = await requireOperatorApiAccess(req);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const b = body as Record<string, unknown>;
  const caseId = typeof b.case_id === "string" ? b.case_id.trim() : "";
  const taskId = typeof b.task_id === "string" ? b.task_id.trim() : "";

  if (!isUuid(caseId)) {
    return NextResponse.json({ error: "Invalid case_id" }, { status: 400 });
  }
  if (!isUuid(taskId)) {
    return NextResponse.json({ error: "Invalid task_id" }, { status: 400 });
  }
  if (!nonEmptyString(b.destination)) {
    return NextResponse.json({ error: "destination is required" }, { status: 400 });
  }
  if (!nonEmptyString(b.filed_at)) {
    return NextResponse.json({ error: "filed_at is required" }, { status: 400 });
  }
  if (!nonEmptyString(b.confirmation_number)) {
    return NextResponse.json({ error: "confirmation_number is required" }, { status: 400 });
  }
  if (!nonEmptyString(b.contact_method) || !CONTACT_METHODS.has(b.contact_method.trim())) {
    return NextResponse.json({ error: "Invalid contact_method" }, { status: 400 });
  }
  if (
    !nonEmptyString(b.merchant_response_type) ||
    !MERCHANT_RESPONSE_TYPES.has(b.merchant_response_type.trim())
  ) {
    return NextResponse.json({ error: "Invalid merchant_response_type" }, { status: 400 });
  }

  const notes =
    b.notes === undefined || b.notes === null
      ? null
      : typeof b.notes === "string"
        ? b.notes
        : undefined;
  if (notes === undefined) {
    return NextResponse.json({ error: "Invalid notes" }, { status: 400 });
  }

  const destination = b.destination.trim();
  const filedAt = b.filed_at.trim();
  const confirmationNumber = b.confirmation_number.trim();

  const recipient =
    b.recipient === undefined || b.recipient === null
      ? null
      : typeof b.recipient === "string"
        ? b.recipient
        : undefined;
  if (recipient === undefined) {
    return NextResponse.json({ error: "Invalid recipient" }, { status: 400 });
  }

  const contactMethod = b.contact_method.trim() as ContactMethod;
  const merchantResponseType = b.merchant_response_type.trim() as MerchantResponseType;

  if (
    isPlaywrightMockHumanFulfillmentOperatorFilingEnabled() &&
    isPlaywrightMockHumanFulfillmentOperatorFilingCaseId(caseId)
  ) {
    const mockOwnerId = resolvePlaywrightMockCaseOwnerUserId(caseId);
    if (!mockOwnerId) {
      return NextResponse.json(
        { error: "Case owner not found for mock fulfillment" },
        { status: 404 }
      );
    }
    const mockResult = completePlaywrightMockMerchantContactOperatorFiling({
      caseId,
      userId: mockOwnerId,
      taskId,
      destination,
      filedAt,
      confirmationNumber,
      contactMethod,
      merchantResponseType,
      recipient,
      notes,
    });
    if (!mockResult.ok) {
      return NextResponse.json({ error: mockResult.error }, { status: mockResult.status });
    }
    return NextResponse.json({
      filing: mockResult.filing,
      task: mockResult.task,
      intake: mockResult.intake,
      client_state: mockResult.client_state,
      timeline: mockResult.timeline,
      advanced: mockResult.advanced,
      idempotent: false,
    });
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) return supabaseUnavailableResponse();

  const ownerResult = await resolveCaseOwnerUserIdForOperatorFulfillment(supabase, caseId);
  if (!ownerResult.ok) {
    return NextResponse.json({ error: ownerResult.error }, { status: ownerResult.status });
  }

  const wrapped = await runWithBbbOwnedFilingSubmitContext(
    buildBbbOwnedFilingSubmitContextFromRequest(req),
    async () => {
      const result = await completeMerchantContactOperatorFiling(supabase, ownerResult.userId, {
        caseId,
        taskId,
        destination,
        filedAt,
        confirmationNumber,
        contactMethod,
        merchantResponseType,
        recipient,
        notes,
      });
      if (!result.ok) {
        return { ok: false as const, result };
      }
      const bbbAutofill = await maybeAttemptAutomatedBbbFilingForClientState(
        supabase,
        ownerResult.userId,
        caseId,
        result.clientState,
        result.timeline ?? null
      );
      const ftcAutofill = await maybeAttemptAutomatedFtcFilingForClientState(
        supabase,
        ownerResult.userId,
        caseId,
        result.clientState,
        bbbAutofill.timeline ?? result.timeline ?? null
      );
      return { ok: true as const, result, bbbAutofill, ftcAutofill };
    }
  );

  if (!wrapped.ok) {
    return NextResponse.json({ error: wrapped.result.error }, { status: wrapped.result.status });
  }

  const { result, bbbAutofill, ftcAutofill } = wrapped;
  return NextResponse.json({
    filing: result.filing,
    task: result.task,
    intake: result.intake,
    client_state: result.clientState,
    timeline: ftcAutofill.timeline ?? bbbAutofill.timeline ?? result.timeline,
    advanced: result.advanced,
    idempotent: result.idempotent,
  });
}

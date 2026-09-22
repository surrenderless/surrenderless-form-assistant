import { cfpbLikelyRelevant, fccLikelyRelevant, isValidDocumentedContactDate } from "@/lib/justice/rules";
import {
  appendEscalationUnlockedFromMerchantSaveOnce,
  appendTimelineEvent,
  readTimeline,
  replaceTimelineForCase,
} from "@/lib/justice/timeline";
import type { JusticeIntake, TimelineEntry } from "@/lib/justice/types";
import { STORAGE_CASE_ID, STORAGE_FTC_MANUAL_UNLOCK, STORAGE_INTAKE } from "@/lib/justice/types";
import { patchJusticeCaseIntake } from "@/lib/justice/patchJusticeCaseIntake";
import { refreshLocalIntakeAndVersionFromServer } from "@/lib/justice/hydrateActiveCaseFromServer";

const FTC_MOCK_COMPLETED_KEY = "justice_ftc_mock_completed";

export type MerchantContactDocumentationInput = {
  contactMethod: NonNullable<JusticeIntake["contact_method"]>;
  contactDate: string;
  merchantResponseType: NonNullable<JusticeIntake["merchant_response_type"]>;
  contactProofType: NonNullable<JusticeIntake["contact_proof_type"]>;
  contactProofText: string;
};

export type MerchantContactDocumentationValidationResult =
  | { ok: true }
  | { ok: false; contactDateError?: string; contactProofError?: string };

/**
 * hasUploadedEvidenceFile: whether the case already has a real uploaded evidence record —
 * required before "upload"/"screenshot" proof can be saved, mirroring the text requirement for
 * "none"/"ticket"/"paste" so the form never accepts an unsubstantiated proof claim.
 */
export function validateMerchantContactDocumentation(
  input: MerchantContactDocumentationInput,
  hasUploadedEvidenceFile = false
): MerchantContactDocumentationValidationResult {
  const dateTrimmed = input.contactDate.trim();
  if (!dateTrimmed || !isValidDocumentedContactDate(dateTrimmed)) {
    return { ok: false, contactDateError: "Enter the contact date." };
  }
  if (input.contactProofType === "none" && !input.contactProofText.trim()) {
    return { ok: false, contactProofError: "Describe your contact attempt before saving." };
  }
  if (input.contactProofType === "ticket" && !input.contactProofText.trim()) {
    return { ok: false, contactProofError: "Enter the ticket or case number before saving." };
  }
  if (input.contactProofType === "paste" && !input.contactProofText.trim()) {
    return { ok: false, contactProofError: "Paste the text you have as proof before saving." };
  }
  if (
    (input.contactProofType === "upload" || input.contactProofType === "screenshot") &&
    !hasUploadedEvidenceFile
  ) {
    return {
      ok: false,
      contactProofError:
        "Upload a file as evidence before saving this proof type, or choose a different proof type.",
    };
  }
  return { ok: true };
}

/**
 * Builds documentation-validator input directly from a persisted/incoming JusticeIntake — the
 * server-side counterpart to buildMerchantContactDocumentationInputFromIntakeParts (which works
 * off client-side BuildJusticeIntakeParts). Returns null when the intake is missing any of the
 * fields the documentation form requires, so callers never partially validate.
 */
export function buildMerchantContactDocumentationInputFromIntake(
  intake: JusticeIntake
): MerchantContactDocumentationInput | null {
  if (intake.already_contacted !== "yes") return null;
  if (!intake.contact_method) return null;
  if (!intake.merchant_response_type) return null;
  if (!intake.contact_proof_type) return null;
  const contactDate = intake.contact_date?.trim() ?? "";
  if (!contactDate) return null;
  return {
    contactMethod: intake.contact_method,
    contactDate,
    merchantResponseType: intake.merchant_response_type,
    contactProofType: intake.contact_proof_type,
    contactProofText: intake.contact_proof_text?.trim() ?? "",
  };
}

export function buildUpdatedIntakeAfterMerchantContact(
  intake: JusticeIntake,
  input: MerchantContactDocumentationInput
): JusticeIntake {
  const dateTrimmed = input.contactDate.trim();
  const updated: JusticeIntake = {
    ...intake,
    already_contacted: "yes",
    contact_method: input.contactMethod,
    contact_date: dateTrimmed,
    merchant_response_type: input.merchantResponseType,
    contact_proof_type: input.contactProofType,
  };
  if (input.contactProofText.trim()) {
    updated.contact_proof_text = input.contactProofText.trim();
  } else {
    delete updated.contact_proof_text;
  }
  return updated;
}

function applyMerchantContactTimelineEvents(caseId: string, updated: JusticeIntake): void {
  const companyContact = cfpbLikelyRelevant(updated) || fccLikelyRelevant(updated);
  appendTimelineEvent(caseId, {
    type: "merchant_contact_saved",
    label: companyContact ? "Company contact documented" : "Merchant contact saved",
    detail: `${companyContact ? "Company" : "Merchant"} response: ${updated.merchant_response_type}`,
  });
  appendEscalationUnlockedFromMerchantSaveOnce(caseId, updated);
}

async function logMerchantContactSavedEvent(merchantResponseType: string, caseId: string | null): Promise<void> {
  try {
    await fetch("/api/justice/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event_name: "merchant_contact_saved",
        payload: { case_id: caseId, merchant_response_type: merchantResponseType },
      }),
    });
  } catch {
    /* ignore */
  }
}

export type DocumentMerchantContactParams = {
  intake: JusticeIntake;
  input: MerchantContactDocumentationInput;
  caseId: string | null;
  isLoaded: boolean;
  isSignedIn: boolean;
  logLabel?: string;
  /** Whether the case already has a real uploaded evidence record (see validateMerchantContactDocumentation). */
  hasUploadedEvidenceFile?: boolean;
};

export type DocumentMerchantContactResult =
  | { ok: true; updatedIntake: JusticeIntake }
  | { ok: false; contactDateError?: string; contactProofError?: string }
  | {
      ok: false;
      reason: "conflict";
      error: string;
      current: { intake: unknown; caseVersion: number | null };
    }
  | {
      ok: false;
      reason: "missing_version";
      error: string;
      /** Present when the refresh this triggers succeeds — the caller's reconciliation point,
       * same shape as the conflict case, so both can share one UI. */
      current?: { intake: JusticeIntake; caseVersion: number };
    };

/** Persist merchant/company contact documentation (session, timeline, optional server PATCH). */
export async function documentMerchantContact({
  intake,
  input,
  caseId,
  isLoaded,
  isSignedIn,
  logLabel = "justice merchant",
  hasUploadedEvidenceFile = false,
}: DocumentMerchantContactParams): Promise<DocumentMerchantContactResult> {
  const validation = validateMerchantContactDocumentation(input, hasUploadedEvidenceFile);
  if (!validation.ok) {
    return {
      ok: false,
      contactDateError: validation.contactDateError,
      contactProofError: validation.contactProofError,
    };
  }

  const updated = buildUpdatedIntakeAfterMerchantContact(intake, input);

  if (typeof window !== "undefined") {
    sessionStorage.setItem(STORAGE_INTAKE, JSON.stringify(updated));
    sessionStorage.removeItem(FTC_MOCK_COMPLETED_KEY);
    sessionStorage.removeItem(STORAGE_FTC_MANUAL_UNLOCK);
  }

  const trimmedCaseId = caseId?.trim() ?? "";
  if (trimmedCaseId) {
    applyMerchantContactTimelineEvents(trimmedCaseId, updated);
  }

  if (isLoaded && isSignedIn && trimmedCaseId) {
    const timeline = readTimeline(trimmedCaseId);
    const result = await patchJusticeCaseIntake(trimmedCaseId, updated, { timeline });
    if (result.ok) {
      if (Array.isArray(result.timeline)) {
        replaceTimelineForCase(trimmedCaseId, result.timeline as TimelineEntry[]);
      }
      await logMerchantContactSavedEvent(input.merchantResponseType, trimmedCaseId || null);
      return { ok: true, updatedIntake: result.intake };
    }
    if (result.reason === "conflict") {
      // Never claim success on a 409: the locally-computed `updated` intake was paired with a
      // case_version the server has already moved past, so treating it as saved would let the
      // caller silently discard whatever the winning writer persisted. The helper has already
      // adopted the fresh server intake/version into session storage — propagate the conflict as
      // the caller's own reconciliation point instead of returning ok:true.
      return {
        ok: false,
        reason: "conflict",
        error: result.error,
        current: { intake: result.current.intake, caseVersion: result.current.caseVersion },
      };
    }
    if (result.reason === "missing_version") {
      // No cached version to pair with this write — refresh both content and case_version from
      // the server before any further write is allowed, then surface the failure so the caller
      // re-derives and resubmits this documentation against the fresh baseline.
      const refreshed = await refreshLocalIntakeAndVersionFromServer(trimmedCaseId, updated);
      return {
        ok: false,
        reason: "missing_version",
        error: result.error,
        ...(refreshed ? { current: refreshed } : {}),
      };
    }
    // request_failed / invalid_response: transient/network failure, not a version conflict. The
    // documentation stays local (already written to STORAGE_INTAKE above) until the next save
    // attempt, which still uses the same still-valid cached version.
    console.warn(`${logLabel}: PATCH /api/justice/cases/[id] ${result.reason}`, result.error);
    return { ok: true, updatedIntake: updated };
  }

  await logMerchantContactSavedEvent(input.merchantResponseType, trimmedCaseId || null);

  return { ok: true, updatedIntake: updated };
}

/** Read case id from session when running in the browser. */
export function readSessionCaseIdForMerchantContact(): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem(STORAGE_CASE_ID);
}

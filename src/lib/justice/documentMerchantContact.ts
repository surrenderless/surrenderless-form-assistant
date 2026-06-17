import { cfpbLikelyRelevant, fccLikelyRelevant, isValidDocumentedContactDate } from "@/lib/justice/rules";
import {
  appendEscalationUnlockedFromMerchantSaveOnce,
  appendTimelineEvent,
  readTimeline,
  replaceTimelineForCase,
} from "@/lib/justice/timeline";
import type { JusticeIntake, TimelineEntry } from "@/lib/justice/types";
import { STORAGE_CASE_ID, STORAGE_FTC_MANUAL_UNLOCK, STORAGE_INTAKE } from "@/lib/justice/types";

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

export function validateMerchantContactDocumentation(
  input: MerchantContactDocumentationInput
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
  return { ok: true };
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
};

export type DocumentMerchantContactResult =
  | { ok: true; updatedIntake: JusticeIntake }
  | { ok: false; contactDateError?: string; contactProofError?: string };

/** Persist merchant/company contact documentation (session, timeline, optional server PATCH). */
export async function documentMerchantContact({
  intake,
  input,
  caseId,
  isLoaded,
  isSignedIn,
  logLabel = "justice merchant",
}: DocumentMerchantContactParams): Promise<DocumentMerchantContactResult> {
  const validation = validateMerchantContactDocumentation(input);
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

  let finalIntake = updated;

  if (isLoaded && isSignedIn && trimmedCaseId) {
    try {
      const timeline = readTimeline(trimmedCaseId);
      const res = await fetch(`/api/justice/cases/${encodeURIComponent(trimmedCaseId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intake: updated, timeline }),
      });
      if (res.ok) {
        const data = (await res.json()) as {
          intake?: JusticeIntake;
          timeline?: unknown;
        };
        if (data.intake) {
          finalIntake = data.intake;
          if (typeof window !== "undefined") {
            sessionStorage.setItem(STORAGE_INTAKE, JSON.stringify(data.intake));
          }
        }
        if (Array.isArray(data.timeline)) {
          replaceTimelineForCase(trimmedCaseId, data.timeline as TimelineEntry[]);
        }
      } else {
        console.warn(`${logLabel}: PATCH /api/justice/cases/[id] failed`, res.status);
      }
    } catch (e) {
      console.warn(`${logLabel}: PATCH /api/justice/cases/[id] error`, e);
    }
  }

  await logMerchantContactSavedEvent(input.merchantResponseType, trimmedCaseId || null);

  return { ok: true, updatedIntake: finalIntake };
}

/** Read case id from session when running in the browser. */
export function readSessionCaseIdForMerchantContact(): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem(STORAGE_CASE_ID);
}

import { STORAGE_STAGED_PROOF_NOTES_V1 } from "@/lib/justice/stagedProofNotes";
import { STORAGE_APPROVED_NEXT_ACTION_V1 } from "@/lib/justice/approvedNextActionState";
import { STORAGE_CHAT_BBB_ACCURACY_CONSENTED_V1 } from "@/lib/justice/chatLegalConsentGates";
import {
  STORAGE_CASE_ID,
  STORAGE_FTC_MANUAL_UNLOCK,
  STORAGE_INTAKE,
  STORAGE_PAYMENT_DISPUTE_CHECKLIST_DRAFT_V1,
  STORAGE_TIMELINE_V1,
} from "@/lib/justice/types";

const STORAGE_FTC_MOCK_COMPLETED = "justice_ftc_mock_completed";
const STORAGE_PREPARED_PACKET_APPROVED_V1 = "justice_prepared_packet_approved_v1";
const STORAGE_SUBMISSION_DRAFT_REVIEWED_V1 = "justice_submission_draft_reviewed_v1";

/** Clears local justice session keys only (does not touch Supabase). */
export function clearLocalJusticeSession(): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(STORAGE_CASE_ID);
  sessionStorage.removeItem(STORAGE_INTAKE);
  sessionStorage.removeItem(STORAGE_TIMELINE_V1);
  sessionStorage.removeItem(STORAGE_PAYMENT_DISPUTE_CHECKLIST_DRAFT_V1);
  sessionStorage.removeItem(STORAGE_FTC_MOCK_COMPLETED);
  sessionStorage.removeItem(STORAGE_FTC_MANUAL_UNLOCK);
  sessionStorage.removeItem(STORAGE_STAGED_PROOF_NOTES_V1);
  sessionStorage.removeItem(STORAGE_PREPARED_PACKET_APPROVED_V1);
  sessionStorage.removeItem(STORAGE_SUBMISSION_DRAFT_REVIEWED_V1);
  sessionStorage.removeItem(STORAGE_APPROVED_NEXT_ACTION_V1);
  sessionStorage.removeItem(STORAGE_CHAT_BBB_ACCURACY_CONSENTED_V1);
}

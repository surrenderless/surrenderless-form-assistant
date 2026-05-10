import {
  STORAGE_CASE_ID,
  STORAGE_FTC_MANUAL_UNLOCK,
  STORAGE_INTAKE,
  STORAGE_PAYMENT_DISPUTE_CHECKLIST_DRAFT_V1,
  STORAGE_TIMELINE_V1,
} from "@/lib/justice/types";
const STORAGE_FTC_MOCK_COMPLETED = "justice_ftc_mock_completed";

/** Clears local justice session keys only (does not touch Supabase). */
export function clearLocalJusticeSession(): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(STORAGE_CASE_ID);
  sessionStorage.removeItem(STORAGE_INTAKE);
  sessionStorage.removeItem(STORAGE_TIMELINE_V1);
  sessionStorage.removeItem(STORAGE_PAYMENT_DISPUTE_CHECKLIST_DRAFT_V1);
  sessionStorage.removeItem(STORAGE_FTC_MOCK_COMPLETED);
  sessionStorage.removeItem(STORAGE_FTC_MANUAL_UNLOCK);
}

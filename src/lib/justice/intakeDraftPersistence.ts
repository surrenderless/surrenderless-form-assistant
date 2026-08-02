import type { BuildJusticeIntakeParts } from "@/lib/justice/buildJusticeIntake";

/**
 * Distinct from STORAGE_INTAKE (justice_intake_v1) and STORAGE_CASE_ID: this key holds the
 * pre-commit chat-ai intake conversation only — before a case exists. It is never read or
 * written by commit-time code (commitIntakeToSessionAndServer, hydrateActiveCaseFromServer), so
 * existing commit-time storage semantics are unaffected.
 */
export const STORAGE_INTAKE_DRAFT_V1 = "justice_intake_draft_v1";

export type IntakeDraftMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

export type IntakeDraft = {
  parts: BuildJusticeIntakeParts;
  messages: IntakeDraftMessage[];
  saved_at: string;
};

/** Every BuildJusticeIntakeParts key that is always present and always a string value. */
const REQUIRED_PARTS_STRING_KEYS: readonly (keyof BuildJusticeIntakeParts)[] = [
  "problem_category",
  "company_name",
  "company_website",
  "purchase_or_signup",
  "story",
  "money_amount",
  "desired_resolution",
  "pay_or_order_date",
  "order_confirmation_details",
  "user_display_name",
  "reply_email",
  "already_contacted",
  "contact_method",
  "contact_date",
  "merchant_response_type",
  "contact_proof_type",
  "contact_proof_text",
  "consumer_us_state",
  "company_contact_email",
  "card_issuer_contact_email",
];

/** Optional BuildJusticeIntakeParts keys — string when present, but may be absent. */
const OPTIONAL_PARTS_STRING_KEYS: readonly (keyof BuildJusticeIntakeParts)[] = [
  "company_street_address",
  "company_city",
  "company_state",
  "company_country",
  "company_postal_code",
];

function isValidPartsShape(value: unknown): value is BuildJusticeIntakeParts {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  for (const key of REQUIRED_PARTS_STRING_KEYS) {
    if (typeof record[key] !== "string") return false;
  }
  for (const key of OPTIONAL_PARTS_STRING_KEYS) {
    if (key in record && typeof record[key] !== "string") return false;
  }
  return true;
}

function isValidDraftMessage(value: unknown): value is IntakeDraftMessage {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    (record.role === "user" || record.role === "assistant") &&
    typeof record.text === "string"
  );
}

function isValidMessagesShape(value: unknown): value is IntakeDraftMessage[] {
  return Array.isArray(value) && value.every(isValidDraftMessage);
}

function getSessionStorage(): Storage | null {
  if (typeof window !== "undefined") return window.sessionStorage;
  if (typeof globalThis.sessionStorage !== "undefined") return globalThis.sessionStorage;
  return null;
}

/**
 * Best-effort save of the pre-commit intake draft. Never throws: a full/unavailable storage
 * quota must not interrupt the chat conversation.
 */
export function saveIntakeDraft(draft: {
  parts: BuildJusticeIntakeParts;
  messages: readonly IntakeDraftMessage[];
}): void {
  const storage = getSessionStorage();
  if (!storage) return;
  try {
    const record: IntakeDraft = {
      parts: draft.parts,
      messages: [...draft.messages],
      saved_at: new Date().toISOString(),
    };
    storage.setItem(STORAGE_INTAKE_DRAFT_V1, JSON.stringify(record));
  } catch {
    // Best-effort only — draft persistence must never block the chat conversation.
  }
}

/**
 * Valid draft from sessionStorage, or null if missing / malformed / from an incompatible shape.
 * Fails safe: any parse or shape mismatch is treated as "no draft" and the stored key is cleared
 * so a corrupt/incompatible draft is never retried on every mount.
 */
export function readValidIntakeDraft(): IntakeDraft | null {
  const storage = getSessionStorage();
  if (!storage) return null;
  const raw = storage.getItem(STORAGE_INTAKE_DRAFT_V1);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      storage.removeItem(STORAGE_INTAKE_DRAFT_V1);
      return null;
    }
    const record = parsed as Record<string, unknown>;
    if (
      typeof record.saved_at !== "string" ||
      !isValidPartsShape(record.parts) ||
      !isValidMessagesShape(record.messages)
    ) {
      storage.removeItem(STORAGE_INTAKE_DRAFT_V1);
      return null;
    }
    return { parts: record.parts, messages: record.messages, saved_at: record.saved_at };
  } catch {
    storage.removeItem(STORAGE_INTAKE_DRAFT_V1);
    return null;
  }
}

/** Clears the pre-commit intake draft only — never touches STORAGE_INTAKE/STORAGE_CASE_ID. */
export function clearIntakeDraft(): void {
  const storage = getSessionStorage();
  if (!storage) return;
  storage.removeItem(STORAGE_INTAKE_DRAFT_V1);
}

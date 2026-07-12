import { isJusticeIntakePayload } from "@/lib/justice/caseApiValidation";
import { validate as isUuid } from "uuid";

export type ChatCaseSelectionStatus = "active" | "archived";

export type ChatCaseSelectionListEntry = {
  id: string;
  status: ChatCaseSelectionStatus;
  companyName: string;
  productLabel: string;
  caseLabel: string | null;
  updatedAt: string | null;
};

export type ChatCaseSelectionListRow = {
  id?: string;
  intake?: unknown;
  archived_at?: string | null;
  updated_at?: string | null;
  case_label?: string | null;
};

const STORAGE_CHAT_CASE_SELECTION_OFFER = "justice_chat_case_selection_offer_v1";

function intakeCompanyName(intake: unknown): string {
  if (!isJusticeIntakePayload(intake)) return "";
  return intake.company_name.trim();
}

function intakeProductLabel(intake: unknown): string {
  if (!isJusticeIntakePayload(intake)) return "";
  return intake.purchase_or_signup.trim();
}

/** True when a list row can appear in the chat case-selection list. */
export function isEligibleChatCaseSelectionListRow(
  row: ChatCaseSelectionListRow
): row is ChatCaseSelectionListRow & { id: string; intake: unknown } {
  const id = row.id?.trim() ?? "";
  if (!id || !isUuid(id)) return false;
  return isJusticeIntakePayload(row.intake);
}

export function toChatCaseSelectionListEntry(
  row: ChatCaseSelectionListRow,
  status: ChatCaseSelectionStatus
): ChatCaseSelectionListEntry | null {
  if (!isEligibleChatCaseSelectionListRow(row)) return null;
  const companyName = intakeCompanyName(row.intake);
  if (!companyName) return null;
  return {
    id: row.id.trim(),
    status,
    companyName,
    productLabel: intakeProductLabel(row.intake),
    caseLabel: row.case_label?.trim() || null,
    updatedAt: row.updated_at?.trim() || null,
  };
}

/**
 * Merge active + archived rows into a numbered chat list.
 * Active cases first (API order), then archived (API order). Dedupes by id.
 */
export function buildChatCaseSelectionList(input: {
  activeRows: readonly ChatCaseSelectionListRow[];
  archivedRows: readonly ChatCaseSelectionListRow[];
}): ChatCaseSelectionListEntry[] {
  const seen = new Set<string>();
  const entries: ChatCaseSelectionListEntry[] = [];

  for (const row of input.activeRows) {
    const entry = toChatCaseSelectionListEntry(row, "active");
    if (!entry || seen.has(entry.id)) continue;
    seen.add(entry.id);
    entries.push(entry);
  }
  for (const row of input.archivedRows) {
    const entry = toChatCaseSelectionListEntry(row, "archived");
    if (!entry || seen.has(entry.id)) continue;
    seen.add(entry.id);
    entries.push(entry);
  }
  return entries;
}

export function formatChatCaseSelectionListMessage(
  entries: readonly ChatCaseSelectionListEntry[]
): string {
  if (entries.length === 0) {
    return "I don't see any saved cases for your account yet. Start a new case here in chat when you're ready.";
  }
  const lines = entries.map((entry, index) => {
    const n = index + 1;
    const title = entry.caseLabel || entry.companyName;
    const product = entry.productLabel ? ` (${entry.productLabel})` : "";
    const statusLabel = entry.status === "archived" ? "archived" : "active";
    return `${n}. ${title}${product} — ${statusLabel}`;
  });
  return [
    "Here are your cases:",
    ...lines,
    'Reply with a number (for example, "open case 2") or the company name to continue that case in chat.',
  ].join("\n");
}

function normalizeMatchText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Resolve a numbered or company/label selection against an offered list.
 * Number matches are 1-based. Text matches require a unique company/label/product hit.
 */
export function resolveChatCaseSelectionChoice(
  query: string,
  entries: readonly ChatCaseSelectionListEntry[]
):
  | { kind: "match"; entry: ChatCaseSelectionListEntry }
  | { kind: "ambiguous" }
  | { kind: "none" } {
  const text = normalizeMatchText(query);
  if (!text || entries.length === 0) return { kind: "none" };

  const numberMatch = text.match(/^(?:case\s+)?(\d{1,3})$/);
  if (numberMatch) {
    const index = Number(numberMatch[1]) - 1;
    const entry = entries[index];
    if (!entry) return { kind: "none" };
    return { kind: "match", entry };
  }

  const hits = entries.filter((entry) => {
    const company = normalizeMatchText(entry.companyName);
    const label = normalizeMatchText(entry.caseLabel ?? "");
    const product = normalizeMatchText(entry.productLabel);
    return (
      (company && (text.includes(company) || company.includes(text))) ||
      (label && (text.includes(label) || label.includes(text))) ||
      (product && product.length >= 4 && (text.includes(product) || product.includes(text)))
    );
  });

  if (hits.length === 1) return { kind: "match", entry: hits[0]! };
  if (hits.length > 1) return { kind: "ambiguous" };
  return { kind: "none" };
}

/**
 * Resolve current active/archived status from fresh server lists.
 * Never trust a previously stored offer status — offer is identity/order only.
 * Active list wins if a case id somehow appears in both.
 */
export function resolveChatCaseSelectionLiveStatus(input: {
  caseId: string;
  activeRows: readonly ChatCaseSelectionListRow[];
  archivedRows: readonly ChatCaseSelectionListRow[];
}): ChatCaseSelectionStatus | null {
  const id = input.caseId.trim();
  if (!id || !isUuid(id)) return null;

  for (const row of input.activeRows) {
    if (row.id?.trim() === id) return "active";
  }
  for (const row of input.archivedRows) {
    if (row.id?.trim() === id) return "archived";
  }
  return null;
}

export function writeChatCaseSelectionOffer(
  entries: readonly ChatCaseSelectionListEntry[]
): void {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(STORAGE_CHAT_CASE_SELECTION_OFFER, JSON.stringify(entries));
}

export function readChatCaseSelectionOffer(): ChatCaseSelectionListEntry[] {
  if (typeof window === "undefined") return [];
  const raw = sessionStorage.getItem(STORAGE_CHAT_CASE_SELECTION_OFFER);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((row): row is ChatCaseSelectionListEntry => {
      if (!row || typeof row !== "object") return false;
      const r = row as ChatCaseSelectionListEntry;
      return (
        typeof r.id === "string" &&
        isUuid(r.id.trim()) &&
        (r.status === "active" || r.status === "archived") &&
        typeof r.companyName === "string" &&
        r.companyName.trim().length > 0
      );
    });
  } catch {
    return [];
  }
}

export function clearChatCaseSelectionOffer(): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(STORAGE_CHAT_CASE_SELECTION_OFFER);
}

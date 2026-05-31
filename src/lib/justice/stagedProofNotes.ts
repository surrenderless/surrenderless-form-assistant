import { isJusticeEvidenceType, type JusticeEvidenceType } from "@/lib/justice/evidence";

export const STORAGE_STAGED_PROOF_NOTES_V1 = "justice_staged_proof_notes_v1";

export type StagedProofNote = {
  clientId: string;
  title: string;
  evidence_type: JusticeEvidenceType;
  evidence_date?: string;
  description?: string;
};

function newStagedProofNoteClientId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `staged_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function parseStagedProofNotes(raw: unknown): StagedProofNote[] {
  if (!Array.isArray(raw)) return [];
  const out: StagedProofNote[] = [];
  for (const item of raw) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) continue;
    const o = item as Record<string, unknown>;
    const clientId = typeof o.clientId === "string" ? o.clientId.trim() : "";
    const title = typeof o.title === "string" ? o.title.trim() : "";
    if (!clientId || !title) continue;
    if (typeof o.evidence_type !== "string" || !isJusticeEvidenceType(o.evidence_type)) continue;
    const note: StagedProofNote = {
      clientId,
      title,
      evidence_type: o.evidence_type,
    };
    if (typeof o.evidence_date === "string" && o.evidence_date.trim()) {
      note.evidence_date = o.evidence_date.trim();
    }
    if (typeof o.description === "string" && o.description.trim()) {
      note.description = o.description.trim();
    }
    out.push(note);
  }
  return out;
}

export function readStagedProofNotes(): StagedProofNote[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = sessionStorage.getItem(STORAGE_STAGED_PROOF_NOTES_V1);
    if (!raw) return [];
    return parseStagedProofNotes(JSON.parse(raw));
  } catch {
    return [];
  }
}

function writeStagedProofNotes(notes: StagedProofNote[]): void {
  if (typeof window === "undefined") return;
  if (notes.length === 0) {
    sessionStorage.removeItem(STORAGE_STAGED_PROOF_NOTES_V1);
    return;
  }
  sessionStorage.setItem(STORAGE_STAGED_PROOF_NOTES_V1, JSON.stringify(notes));
}

export function appendStagedProofNote(
  note: Omit<StagedProofNote, "clientId"> & { clientId?: string }
): StagedProofNote[] {
  const staged: StagedProofNote = {
    clientId: note.clientId?.trim() || newStagedProofNoteClientId(),
    title: note.title.trim(),
    evidence_type: note.evidence_type,
    ...(note.evidence_date?.trim() ? { evidence_date: note.evidence_date.trim() } : {}),
    ...(note.description?.trim() ? { description: note.description.trim() } : {}),
  };
  const next = [...readStagedProofNotes(), staged];
  writeStagedProofNotes(next);
  return next;
}

export function removeStagedProofNotesByClientIds(clientIds: string[]): StagedProofNote[] {
  if (clientIds.length === 0) return readStagedProofNotes();
  const drop = new Set(clientIds);
  const next = readStagedProofNotes().filter((n) => !drop.has(n.clientId));
  writeStagedProofNotes(next);
  return next;
}

export function clearStagedProofNotes(): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(STORAGE_STAGED_PROOF_NOTES_V1);
}

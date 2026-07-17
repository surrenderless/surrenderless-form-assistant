import { validate as isUuid } from "uuid";

/** Evidence rows shown in guided operator filing workspaces (never includes file_path). */
export type OperatorWorkspaceEvidenceItem = {
  id: string;
  title: string;
  evidence_type: string;
  file_name: string | null;
  evidence_date: string | null;
};

export type OperatorWorkspaceEvidenceInput = {
  id?: string | null;
  title?: string | null;
  evidence_type?: string | null;
  file_name?: string | null;
  evidence_date?: string | null;
};

export function mapOperatorWorkspaceEvidence(
  rows: readonly OperatorWorkspaceEvidenceInput[]
): OperatorWorkspaceEvidenceItem[] {
  return rows.map((row) => ({
    id: (row.id ?? "").trim(),
    title: (row.title ?? "").trim() || "(untitled)",
    evidence_type: (row.evidence_type ?? "").trim() || "other",
    file_name: row.file_name?.trim() || null,
    evidence_date: row.evidence_date?.trim() || null,
  }));
}

/** Authenticated operator path for short-lived signed access to an evidence file. */
export function buildPrivateOperatorEvidenceFileAccessPath(evidenceId: string): string | null {
  const id = evidenceId.trim();
  if (!id || !isUuid(id)) return null;
  return `/api/operator/evidence/${encodeURIComponent(id)}/file`;
}

/**
 * Props for the shared operator "View file" control.
 * Returns null when there is no attachable file or no valid evidence id.
 */
export function buildOperatorEvidenceViewFileControl(row: {
  id?: string | null;
  file_name?: string | null;
}): { href: string; fileName: string; label: "View file" } | null {
  const fileName = row.file_name?.trim() || "";
  if (!fileName) return null;
  const href = buildPrivateOperatorEvidenceFileAccessPath(row.id ?? "");
  if (!href) return null;
  return { href, fileName, label: "View file" };
}

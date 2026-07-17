/**
 * Maps a justice_case_evidence row into the fulfillment-queue workspace evidence shape.
 * Skips rows without a case id or evidence id (id is required for operator file access).
 */
export function mapOperatorFulfillmentQueueEvidenceRow(row: {
  id?: unknown;
  case_id?: unknown;
  title?: unknown;
  evidence_type?: unknown;
  file_name?: unknown;
  evidence_date?: unknown;
}): {
  caseId: string;
  evidence: {
    id: string;
    title: string;
    evidence_type: string;
    file_name: string | null;
    evidence_date: string | null;
  };
} | null {
  const caseId = String(row.case_id ?? "").trim();
  if (!caseId) return null;
  const id = typeof row.id === "string" ? row.id.trim() : "";
  if (!id) return null;
  return {
    caseId,
    evidence: {
      id,
      title: typeof row.title === "string" ? row.title : "",
      evidence_type: typeof row.evidence_type === "string" ? row.evidence_type : "other",
      file_name: typeof row.file_name === "string" ? row.file_name : null,
      evidence_date: typeof row.evidence_date === "string" ? row.evidence_date : null,
    },
  };
}

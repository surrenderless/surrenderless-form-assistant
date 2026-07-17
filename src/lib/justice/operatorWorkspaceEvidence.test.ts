import { describe, expect, it } from "vitest";
import { mapOperatorFulfillmentQueueEvidenceRow } from "@/lib/justice/operatorFulfillmentQueueEvidence";
import {
  buildOperatorEvidenceViewFileControl,
  buildPrivateOperatorEvidenceFileAccessPath,
  mapOperatorWorkspaceEvidence,
} from "@/lib/justice/operatorWorkspaceEvidence";

const EVIDENCE_ID = "550e8400-e29b-41d4-a716-446655440099";
const CASE_ID = "550e8400-e29b-41d4-a716-446655440000";

describe("mapOperatorFulfillmentQueueEvidenceRow", () => {
  it("includes evidence id in queue-mapped workspace evidence payloads", () => {
    expect(
      mapOperatorFulfillmentQueueEvidenceRow({
        id: EVIDENCE_ID,
        case_id: CASE_ID,
        title: "Order receipt",
        evidence_type: "receipt",
        file_name: "receipt.pdf",
        evidence_date: "2026-05-01",
      })
    ).toEqual({
      caseId: CASE_ID,
      evidence: {
        id: EVIDENCE_ID,
        title: "Order receipt",
        evidence_type: "receipt",
        file_name: "receipt.pdf",
        evidence_date: "2026-05-01",
      },
    });
  });

  it("skips rows without an evidence id so file routes cannot be invented", () => {
    expect(
      mapOperatorFulfillmentQueueEvidenceRow({
        case_id: CASE_ID,
        title: "Order receipt",
        evidence_type: "receipt",
        file_name: "receipt.pdf",
        evidence_date: null,
      })
    ).toBeNull();
  });
});

describe("mapOperatorWorkspaceEvidence", () => {
  it("threads evidence id into workspace evidence items", () => {
    expect(
      mapOperatorWorkspaceEvidence([
        {
          id: EVIDENCE_ID,
          title: "Order receipt",
          evidence_type: "receipt",
          file_name: "receipt.pdf",
          evidence_date: "2026-05-01",
        },
      ])
    ).toEqual([
      {
        id: EVIDENCE_ID,
        title: "Order receipt",
        evidence_type: "receipt",
        file_name: "receipt.pdf",
        evidence_date: "2026-05-01",
      },
    ]);
  });
});

describe("operator evidence View file control", () => {
  it("builds the operator signed-file path and View file label", () => {
    expect(buildPrivateOperatorEvidenceFileAccessPath(EVIDENCE_ID)).toBe(
      `/api/operator/evidence/${EVIDENCE_ID}/file`
    );
    expect(
      buildOperatorEvidenceViewFileControl({
        id: EVIDENCE_ID,
        file_name: "receipt.pdf",
      })
    ).toEqual({
      href: `/api/operator/evidence/${EVIDENCE_ID}/file`,
      fileName: "receipt.pdf",
      label: "View file",
    });
  });

  it("does not expose a View file control without a file or valid id", () => {
    expect(
      buildOperatorEvidenceViewFileControl({ id: EVIDENCE_ID, file_name: null })
    ).toBeNull();
    expect(
      buildOperatorEvidenceViewFileControl({ id: "not-a-uuid", file_name: "x.pdf" })
    ).toBeNull();
    expect(buildPrivateOperatorEvidenceFileAccessPath("")).toBeNull();
  });

  it("never embeds raw storage paths in the View file href", () => {
    const control = buildOperatorEvidenceViewFileControl({
      id: EVIDENCE_ID,
      file_name: "receipt.pdf",
    });
    expect(control?.href).not.toMatch(/file_path|storage\/v1|justice-evidence\//i);
  });
});

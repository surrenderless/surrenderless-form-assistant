import type { DestinationId, JusticeIntake, TimelineEntry } from "@/lib/justice/types";

export type JusticePreviewDraftEvidenceItem = {
  title: string;
  evidence_type: string;
  description?: string;
  evidence_date?: string | null;
};

export type RequestJusticePreviewDraftInput = {
  intake: JusticeIntake;
  destinationId: DestinationId;
  destinationLabel: string;
  caseId?: string;
  evidenceItems?: JusticePreviewDraftEvidenceItem[];
  timeline?: TimelineEntry[];
};

export type RequestJusticePreviewDraftResult =
  | { ok: true; draft: string }
  | { ok: false; error: string; status?: number };

/** Call production POST /api/justice/preview-draft (shared by preview page and chat-ai). */
export async function requestJusticePreviewDraft(
  input: RequestJusticePreviewDraftInput
): Promise<RequestJusticePreviewDraftResult> {
  const timeline = input.timeline ?? [];
  const timeline_summary = timeline.slice(-60).map((e) => ({
    type: e.type,
    label: e.label,
    ts: e.ts,
    ...(e.detail?.trim() ? { detail: e.detail.trim() } : {}),
  }));
  const evidence_items = (input.evidenceItems ?? []).map((e) => ({
    title: e.title,
    evidence_type: e.evidence_type,
    ...(e.description?.trim() ? { description: e.description.trim() } : {}),
    ...(e.evidence_date != null && e.evidence_date !== ""
      ? { evidence_date: e.evidence_date }
      : {}),
  }));

  const caseId = input.caseId?.trim() ?? "";

  try {
    const res = await fetch("/api/justice/preview-draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        intake: input.intake,
        destination_id: input.destinationId,
        destination_label: input.destinationLabel,
        ...(caseId ? { case_id: caseId } : {}),
        evidence_items,
        timeline_summary,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as { draft?: string; error?: string };
    if (!res.ok) {
      return {
        ok: false,
        error: data.error ?? "Could not generate AI-assisted draft.",
        status: res.status,
      };
    }
    if (typeof data.draft === "string" && data.draft.trim()) {
      return { ok: true, draft: data.draft.trim() };
    }
    return { ok: false, error: "Empty response from draft service.", status: res.status };
  } catch {
    return { ok: false, error: "Could not generate AI-assisted draft." };
  }
}

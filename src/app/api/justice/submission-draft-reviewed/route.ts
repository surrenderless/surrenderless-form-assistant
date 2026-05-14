import { NextResponse, type NextRequest } from "next/server";
import { validate as isUuid } from "uuid";
import {
  buildSubmissionDraftReviewedDetail,
  SUBMISSION_DRAFT_REVIEWED_TIMELINE_ID,
} from "@/lib/justice/timeline";
import { userOwnsJusticeCase } from "@/server/justiceCaseOwnership";
import { appendCaseTimelineEntry } from "@/server/justiceTimelineAppend";
import { getUserOr401 } from "@/server/requireUser";

const MAX_DEST_LABEL = 300;

function clampStr(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max);
}

export async function POST(req: NextRequest) {
  const userId = getUserOr401(req);
  if (!userId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const b = body as Record<string, unknown>;
  const caseId = typeof b.case_id === "string" ? b.case_id.trim() : "";
  if (!isUuid(caseId)) {
    return NextResponse.json({ error: "Invalid case_id" }, { status: 400 });
  }

  if (!(await userOwnsJusticeCase(userId, caseId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const destinationLabel =
    typeof b.destination_label === "string" && b.destination_label.trim()
      ? clampStr(b.destination_label.trim(), MAX_DEST_LABEL)
      : undefined;
  const usedAi = b.used_ai === true;

  const detail = buildSubmissionDraftReviewedDetail({
    destinationLabel,
    usedAi,
  });

  const timeline = await appendCaseTimelineEntry(userId, caseId, {
    id: SUBMISSION_DRAFT_REVIEWED_TIMELINE_ID,
    type: "submission_draft_reviewed",
    label: "Submission draft reviewed",
    detail,
  });

  if (!timeline) {
    return NextResponse.json({ error: "Could not update timeline" }, { status: 500 });
  }

  return NextResponse.json({ timeline });
}

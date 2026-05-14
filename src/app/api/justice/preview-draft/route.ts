import { NextResponse, type NextRequest } from "next/server";
import { validate as isUuid } from "uuid";
import { isJusticeIntakePayload } from "@/lib/justice/caseApiValidation";
import {
  buildSubmissionDraftAiMessages,
  type PreviewDraftAiEvidenceItem,
  type PreviewDraftAiTimelineItem,
} from "@/lib/justice/buildSubmissionDraftAiPrompt";
import type { DestinationId, JusticeIntake } from "@/lib/justice/types";
import { userOwnsJusticeCase } from "@/server/justiceCaseOwnership";
import { getUserOr401 } from "@/server/requireUser";
import { rateLimit } from "@/utils/rateLimiter";

const MAX_RAW_BODY = 262_144;
const MAX_DEST_LABEL = 300;
const MAX_TIMELINE_ITEMS = 60;
const MAX_TIMELINE_FIELD = 500;
const MAX_EVIDENCE_ITEMS = 50;
const MAX_EVIDENCE_TITLE = 500;
const MAX_EVIDENCE_DESC = 2000;
const MAX_EVIDENCE_TYPE = 64;

const DESTINATION_IDS = new Set<DestinationId>([
  "merchant_resolution",
  "payment_dispute",
  "ftc",
  "bbb",
  "state_ag",
  "cfpb",
  "fcc",
  "dot",
  "small_claims",
]);

function clampStr(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max);
}

function clampIntake(intake: JusticeIntake): JusticeIntake {
  return {
    ...intake,
    company_name: clampStr(intake.company_name, 500),
    company_website: clampStr(intake.company_website, 500),
    purchase_or_signup: clampStr(intake.purchase_or_signup, 2000),
    story: clampStr(intake.story, 12_000),
    money_involved: clampStr(intake.money_involved, 4000),
    pay_or_order_date: clampStr(intake.pay_or_order_date, 200),
    order_confirmation_details: clampStr(intake.order_confirmation_details, 4000),
    user_display_name: clampStr(intake.user_display_name, 200),
    reply_email: clampStr(intake.reply_email, 320),
    contact_date: intake.contact_date !== undefined ? clampStr(intake.contact_date, 200) : undefined,
    contact_proof_text:
      intake.contact_proof_text !== undefined ? clampStr(intake.contact_proof_text, 8000) : undefined,
    consumer_us_state:
      intake.consumer_us_state !== undefined ? clampStr(intake.consumer_us_state, 8) : undefined,
  };
}

function parseEvidenceItems(v: unknown): PreviewDraftAiEvidenceItem[] {
  if (!Array.isArray(v)) return [];
  const out: PreviewDraftAiEvidenceItem[] = [];
  for (const item of v.slice(0, MAX_EVIDENCE_ITEMS)) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) continue;
    const o = item as Record<string, unknown>;
    const title = typeof o.title === "string" ? clampStr(o.title, MAX_EVIDENCE_TITLE) : "";
    const evidence_type =
      typeof o.evidence_type === "string" ? clampStr(o.evidence_type, MAX_EVIDENCE_TYPE) : undefined;
    const description =
      typeof o.description === "string" ? clampStr(o.description, MAX_EVIDENCE_DESC) : undefined;
    let evidence_date: string | null | undefined;
    if (o.evidence_date === null) evidence_date = null;
    else if (typeof o.evidence_date === "string") evidence_date = clampStr(o.evidence_date, 80);
    else evidence_date = undefined;

    const row: PreviewDraftAiEvidenceItem = {
      title: title || "(untitled)",
      ...(evidence_type !== undefined ? { evidence_type } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(evidence_date !== undefined ? { evidence_date } : {}),
    };
    out.push(row);
  }
  return out;
}

function parseTimelineSummary(v: unknown): PreviewDraftAiTimelineItem[] {
  if (!Array.isArray(v)) return [];
  const out: PreviewDraftAiTimelineItem[] = [];
  for (const item of v.slice(0, MAX_TIMELINE_ITEMS)) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) continue;
    const o = item as Record<string, unknown>;
    const type = typeof o.type === "string" ? clampStr(o.type, 120) : "";
    const label = typeof o.label === "string" ? clampStr(o.label, MAX_TIMELINE_FIELD) : "";
    if (!type || !label) continue;
    const ts = typeof o.ts === "string" ? clampStr(o.ts, 80) : undefined;
    const detail = typeof o.detail === "string" ? clampStr(o.detail, MAX_TIMELINE_FIELD) : undefined;
    out.push({ type, label, ...(ts !== undefined ? { ts } : {}), ...(detail !== undefined ? { detail } : {}) });
  }
  return out;
}

export async function POST(req: NextRequest) {
  try {
    const userId = getUserOr401(req);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
      if (await rateLimit(userId)) {
        return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn("rateLimit failed, allowing:", msg);
    }

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: "OPENAI_API_KEY not configured" }, { status: 500 });
    }

    const cl = req.headers.get("content-length");
    if (cl !== null && cl !== "") {
      const n = Number(cl);
      if (Number.isFinite(n) && n > MAX_RAW_BODY) {
        return NextResponse.json({ error: "Request body too large" }, { status: 413 });
      }
    }

    let raw: string;
    try {
      raw = await req.text();
    } catch {
      return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    }
    if (raw.length > MAX_RAW_BODY) {
      return NextResponse.json({ error: "Request body too large" }, { status: 413 });
    }

    let body: unknown;
    try {
      body = raw.length === 0 ? null : JSON.parse(raw);
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    }

    const b = body as Record<string, unknown>;

    if (!isJusticeIntakePayload(b.intake)) {
      return NextResponse.json({ error: "Invalid intake" }, { status: 400 });
    }

    const destination_id = b.destination_id;
    if (typeof destination_id !== "string" || !DESTINATION_IDS.has(destination_id as DestinationId)) {
      return NextResponse.json({ error: "Invalid destination_id" }, { status: 400 });
    }

    const destination_label = typeof b.destination_label === "string" ? b.destination_label.trim() : "";
    if (!destination_label || destination_label.length > MAX_DEST_LABEL) {
      return NextResponse.json({ error: "Invalid destination_label" }, { status: 400 });
    }

    const case_id = typeof b.case_id === "string" ? b.case_id.trim() : "";
    if (case_id) {
      if (!isUuid(case_id)) {
        return NextResponse.json({ error: "Invalid case_id" }, { status: 400 });
      }
      if (!(await userOwnsJusticeCase(userId, case_id))) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
    }

    const intake = clampIntake(b.intake);
    const evidenceItems = parseEvidenceItems(b.evidence_items);
    const timelineItems = parseTimelineSummary(b.timeline_summary);

    const messages = buildSubmissionDraftAiMessages({
      intake,
      destinationId: destination_id as DestinationId,
      destinationLabel: clampStr(destination_label, MAX_DEST_LABEL),
      evidenceItems,
      timelineItems,
    });

    const gptRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        messages,
        temperature: 0.2,
        max_tokens: 4096,
      }),
    });

    if (!gptRes.ok) {
      const errorText = await gptRes.text();
      console.error("OpenAI preview-draft error:", errorText.slice(0, 500));
      return NextResponse.json({ error: "Draft generation failed" }, { status: 502 });
    }

    const gptJson = (await gptRes.json()) as {
      choices?: { message?: { content?: string | null } }[];
    };
    const draft = gptJson?.choices?.[0]?.message?.content?.trim() ?? "";
    if (!draft) {
      return NextResponse.json({ error: "Empty draft response" }, { status: 502 });
    }

    return NextResponse.json({ draft });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "failed";
    console.error("preview-draft error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

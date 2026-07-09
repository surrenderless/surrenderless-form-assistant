import { NextResponse, type NextRequest } from "next/server";
import { validate as isUuid } from "uuid";
import { parseJusticeCaseChatMessageAppendBatch } from "@/lib/justice/justiceCaseChatMessages";
import {
  appendJusticeCaseChatMessages,
  listJusticeCaseChatMessages,
} from "@/server/justiceCaseChatMessages";
import { getUserOr401 } from "@/server/requireUser";
import {
  buildPlaywrightMockJusticeChatMessagesAppendResponse,
  buildPlaywrightMockJusticeChatMessagesGetResponse,
  isPlaywrightMockJusticeChatMessagesCaseId,
  isPlaywrightMockJusticeChatMessagesPipelineEnabled,
} from "@/lib/testing/playwrightMockJusticeChatMessagesPipeline";

export async function GET(req: NextRequest) {
  const userId = getUserOr401(req);
  if (!userId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const caseId = req.nextUrl.searchParams.get("case_id") ?? "";
  if (!isUuid(caseId)) {
    return NextResponse.json({ error: "Invalid case_id" }, { status: 400 });
  }

  if (
    isPlaywrightMockJusticeChatMessagesPipelineEnabled() &&
    isPlaywrightMockJusticeChatMessagesCaseId(caseId)
  ) {
    const messages = buildPlaywrightMockJusticeChatMessagesGetResponse(caseId, userId);
    if (messages === null) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ messages });
  }

  try {
    const messages = await listJusticeCaseChatMessages(userId, caseId);
    if (messages === null) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ messages });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load chat messages";
    return NextResponse.json({ error: message }, { status: 500 });
  }
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
  const caseId = typeof b.case_id === "string" ? b.case_id : "";
  if (!isUuid(caseId)) {
    return NextResponse.json({ error: "Invalid case_id" }, { status: 400 });
  }

  const messages = parseJusticeCaseChatMessageAppendBatch(b.messages);
  if (!messages) {
    return NextResponse.json({ error: "Invalid messages" }, { status: 400 });
  }

  if (
    isPlaywrightMockJusticeChatMessagesPipelineEnabled() &&
    isPlaywrightMockJusticeChatMessagesCaseId(caseId)
  ) {
    const appended = buildPlaywrightMockJusticeChatMessagesAppendResponse(caseId, userId, messages);
    if (appended === null) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ messages: appended });
  }

  try {
    const appended = await appendJusticeCaseChatMessages(userId, caseId, messages);
    if (appended.length === 0 && messages.length > 0) {
      const ownsCase = await listJusticeCaseChatMessages(userId, caseId);
      if (ownsCase === null) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
    }
    return NextResponse.json({ messages: appended });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save chat messages";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

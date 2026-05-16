import { NextResponse, type NextRequest } from "next/server";
import { buildIntakeChatAiMessages } from "@/lib/justice/buildJusticeIntakeAiPrompt";
import {
  MAX_INTAKE_CHAT_USER_MESSAGE,
  parseIntakeChatConversationHistory,
  parseIntakeChatModelResponse,
  parseRequestBuildJusticeIntakeParts,
} from "@/lib/justice/parseIntakeChatAiResponse";
import { getUserOr401 } from "@/server/requireUser";
import { rateLimit } from "@/utils/rateLimiter";

const MAX_RAW_BODY = 262_144;

function clampStr(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max);
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

    const user_message = typeof b.user_message === "string" ? b.user_message.trim() : "";
    if (!user_message || user_message.length > MAX_INTAKE_CHAT_USER_MESSAGE) {
      return NextResponse.json({ error: "Invalid user_message" }, { status: 400 });
    }

    const parts = parseRequestBuildJusticeIntakeParts(b.parts);
    if (!parts) {
      return NextResponse.json({ error: "Invalid parts" }, { status: 400 });
    }

    const conversation_history = parseIntakeChatConversationHistory(b.conversation_history);

    const messages = buildIntakeChatAiMessages({
      userMessage: clampStr(user_message, MAX_INTAKE_CHAT_USER_MESSAGE),
      parts,
      conversationHistory: conversation_history,
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
        response_format: { type: "json_object" },
      }),
    });

    if (!gptRes.ok) {
      const errorText = await gptRes.text();
      console.error("OpenAI intake-chat error:", errorText.slice(0, 500));
      return NextResponse.json({ error: "Intake chat failed" }, { status: 502 });
    }

    const gptJson = (await gptRes.json()) as {
      choices?: { message?: { content?: string | null } }[];
    };
    const content = gptJson?.choices?.[0]?.message?.content?.trim() ?? "";
    if (!content) {
      return NextResponse.json({ error: "Empty intake chat response" }, { status: 502 });
    }

    const parsed = parseIntakeChatModelResponse(content, parts);
    if (!parsed) {
      return NextResponse.json({ error: "Invalid model JSON" }, { status: 502 });
    }

    return NextResponse.json({
      assistantMessage: parsed.assistantMessage,
      parts: parsed.parts,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "failed";
    console.error("intake-chat error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

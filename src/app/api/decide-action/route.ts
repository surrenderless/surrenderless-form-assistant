import { NextResponse, type NextRequest } from "next/server";
import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { getUserOr401 } from "@/server/requireUser";
import { rateLimit } from "@/utils/rateLimiter";

function getOpenAI(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;
  return new OpenAI({ apiKey });
}

export async function POST(req: NextRequest) {
  const userId = getUserOr401(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    if (await rateLimit(userId)) {
      return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
    }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    console.warn("rateLimit failed, allowing:", message);
  }

  const openai = getOpenAI();
  if (!openai) {
    return NextResponse.json(
      { error: "OpenAI is not configured on this server." },
      { status: 503 }
    );
  }

  const body = await req.json();
  const { pageData, userProfile: userProfileField, userData } = body ?? {};
  const userProfile = userProfileField ?? userData ?? {};

  const messages: ChatCompletionMessageParam[] = [
    {
      role: "system",
      content:
        "You are a step-by-step form submission agent. You must decide how to interact with the page, based on buttons and fields.",
    },
    {
      role: "user",
      content: `Page data: ${JSON.stringify(pageData, null, 2)}\n\nUser data: ${JSON.stringify(userProfile, null, 2)}\n\nWhat should we fill? What button should we click next? Respond like this:\n{\n  fieldsToFill: [ { selector, value } ],\n  nextButton: { selectorType: "text" | "id" | "name", value: "Continue" },\n  waitForNavigation: true\n}`,
    },
  ];

  const completion = await openai.chat.completions.create({
    model: "gpt-4",
    messages,
    temperature: 0,
  });

  const responseText = completion.choices[0].message.content;

  try {
    const parsed = JSON.parse(responseText!);
    return NextResponse.json({ decision: parsed });
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON response from GPT", raw: responseText },
      { status: 500 }
    );
  }
}

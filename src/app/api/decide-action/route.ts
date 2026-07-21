import { NextResponse, type NextRequest } from "next/server";
import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { resolveBbbDecideActionInternalUserId } from "@/lib/justice/bbbOwnedFilingProduction";
import {
  buildPlaywrightMockRealBbbDecideActionDecision,
  isPlaywrightMockRealBbbBoundedSubmitLoopEnabled,
} from "@/lib/testing/playwrightMockRealBbbBoundedSubmitLoop";
import { getUserOr401 } from "@/server/requireUser";
import { rateLimit } from "@/utils/rateLimiter";

/** Enough time for OpenAI decide-action during owned BBB bounded-submit loops. */
export const maxDuration = 300;

function getOpenAI(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;
  return new OpenAI({ apiKey });
}

export async function POST(req: NextRequest) {
  const userId = resolveBbbDecideActionInternalUserId(req) ?? getUserOr401(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    if (await rateLimit(userId)) {
      return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
    }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    console.warn("rateLimit failed, allowing:", message);
  }

  const body = await req.json();
  const { pageData, userProfile: userProfileField, userData } = body ?? {};
  const userProfile = userProfileField ?? userData ?? {};

  if (isPlaywrightMockRealBbbBoundedSubmitLoopEnabled() && pageData) {
    const mockDecision = buildPlaywrightMockRealBbbDecideActionDecision(pageData, userProfile);
    if (mockDecision !== null) {
      return NextResponse.json({ decision: mockDecision });
    }
  }

  const openai = getOpenAI();
  if (!openai) {
    return NextResponse.json(
      { error: "OpenAI is not configured on this server." },
      { status: 503 }
    );
  }

  const messages: ChatCompletionMessageParam[] = [
    {
      role: "system",
      content:
        "You are a step-by-step form submission agent. You must decide how to interact with the page, based on buttons and fields.",
    },
    {
      role: "user",
      content: `Page data: ${JSON.stringify(pageData, null, 2)}\n\nUser data: ${JSON.stringify(userProfile, null, 2)}\n\nWhat should we fill? What button should we click next? When choiceControls exposes a required radio or checkbox, select the required option before Continue using one exact scraped structural key (name, id, or accessibleName) as selector, its exact optionValue as value, the matching choiceSelectorType, and controlKind "radio", "checkbox", or "choice". When optionValue equals accessibleName (FTC category radios omit value attributes), use that exact accessibleName as value and prefer choiceSelectorType "id" with the scraped id when present. Never invent choice metadata. Do not treat Submit, confirm, file, or any final action as Continue.\nRespond like this:\n{\n  fieldsToFill: [ { selector, value, controlKind?: "radio" | "checkbox" | "choice", choiceSelectorType?: "name" | "id" | "accessibleName" } ],\n  nextButton: { selectorType: "text" | "id" | "name", value: "Continue" },\n  waitForNavigation: true\n}`,
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

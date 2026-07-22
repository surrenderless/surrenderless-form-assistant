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

/**
 * Model that supports Chat Completions `response_format: { type: "json_object" }`.
 * Classic `gpt-4` does not; justice routes already use gpt-4.1-mini elsewhere.
 */
const DECIDE_ACTION_MODEL = "gpt-4.1-mini";

function getOpenAI(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;
  return new OpenAI({ apiKey });
}

/**
 * Parses decide-action model output as JSON.
 * Accepts bare JSON, or one complete markdown fence (``` / ```json) whose entire trimmed
 * payload is that fence. Rejects prose wrappers, incomplete fences, and malformed JSON.
 * Kept as a defensive fallback when JSON mode still returns fenced text.
 */
function parseDecideActionModelJson(responseText: string | null | undefined): unknown {
  if (typeof responseText !== "string") {
    throw new SyntaxError("Decide-action model response was empty");
  }
  const trimmed = responseText.trim();
  if (!trimmed) {
    throw new SyntaxError("Decide-action model response was empty");
  }

  let jsonText = trimmed;
  if (trimmed.startsWith("```")) {
    if (!trimmed.endsWith("```") || trimmed.length < 6) {
      throw new SyntaxError("Decide-action model response fence was incomplete");
    }
    const withoutOpen = trimmed.replace(/^```(?:json)?\s*\r?\n?/i, "");
    if (withoutOpen === trimmed) {
      throw new SyntaxError("Decide-action model response fence was invalid");
    }
    const withoutClose = withoutOpen.replace(/\r?\n?\s*```$/u, "");
    if (withoutClose === withoutOpen) {
      throw new SyntaxError("Decide-action model response fence was incomplete");
    }
    jsonText = withoutClose.trim();
    if (!jsonText) {
      throw new SyntaxError("Decide-action model response fence was empty");
    }
  }

  return JSON.parse(jsonText);
}

function invalidModelJsonResponse(): NextResponse {
  // Never echo model text — it can reflect pageData / user case content.
  return NextResponse.json({ error: "Invalid JSON response from GPT" }, { status: 500 });
}

function modelRequestFailedResponse(): NextResponse {
  return NextResponse.json({ error: "decide-action model request failed" }, { status: 500 });
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
        "You are a step-by-step form submission agent. You must decide how to interact with the page, based on buttons and fields. Respond with a single JSON object only.",
    },
    {
      role: "user",
      content: `Page data: ${JSON.stringify(pageData, null, 2)}\n\nUser data: ${JSON.stringify(userProfile, null, 2)}\n\nWhat should we fill? What button should we click next? When choiceControls exposes a required radio or checkbox, select the required option before Continue using one exact scraped structural key (name, id, or accessibleName) as selector, its exact optionValue as value, the matching choiceSelectorType, and controlKind "radio", "checkbox", or "choice". When optionValue equals accessibleName (FTC category radios omit value attributes), use that exact accessibleName as value and prefer choiceSelectorType "id" with the scraped id when present. When a text/textarea/select field has an empty name and id but exposes formControlName, use that exact formControlName as selector. Never invent choice metadata. Do not treat Submit, confirm, file, or any final action as Continue.\nRespond with JSON like this:\n{\n  fieldsToFill: [ { selector, value, controlKind?: "radio" | "checkbox" | "choice", choiceSelectorType?: "name" | "id" | "accessibleName" } ],\n  nextButton: { selectorType: "text" | "id" | "name", value: "Continue" },\n  waitForNavigation: true\n}`,
    },
  ];

  let responseText: string | null | undefined;
  try {
    const completion = await openai.chat.completions.create({
      model: DECIDE_ACTION_MODEL,
      messages,
      temperature: 0,
      // Guarantees machine-parseable JSON on supported models (not classic gpt-4).
      response_format: { type: "json_object" },
    });
    responseText = completion.choices[0]?.message?.content;
  } catch {
    return modelRequestFailedResponse();
  }

  try {
    const parsed = parseDecideActionModelJson(responseText);
    return NextResponse.json({ decision: parsed });
  } catch {
    return invalidModelJsonResponse();
  }
}

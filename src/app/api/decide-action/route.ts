import { NextResponse, type NextRequest } from "next/server";
import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { resolveBbbDecideActionInternalUserId } from "@/lib/justice/bbbOwnedFilingProduction";
import {
  adaptFtcStructuredDecision,
  DECIDE_ACTION_FTC_FORM_MAIN_MODE,
  DECIDE_ACTION_FTC_MODE,
  FTC_STRUCTURED_DECISION_SCHEMA,
} from "@/lib/justice/decideActionFtcStructured";
import { formatFtcFormMainInventoryForPrompt } from "@/lib/justice/ownedFilingFtcFormMainDecision";
import type { AssistedFormPageData } from "@/lib/justice/realBbbBoundedSubmitLoop";
import {
  buildPlaywrightMockRealBbbDecideActionDecision,
  isPlaywrightMockRealBbbBoundedSubmitLoopEnabled,
} from "@/lib/testing/playwrightMockRealBbbBoundedSubmitLoop";
import { getUserOr401 } from "@/server/requireUser";
import { rateLimit } from "@/utils/rateLimiter";

/** Enough time for OpenAI decide-action during owned BBB bounded-submit loops. */
export const maxDuration = 300;

/**
 * Model that supports Chat Completions Structured Outputs (`json_schema` + `strict`).
 * Classic `gpt-4` does not; justice routes already use gpt-4.1-mini elsewhere.
 */
const DECIDE_ACTION_MODEL = "gpt-4.1-mini";

/** Allowlisted decide-action failure categories — never free-form error text. */
export type DecideActionFailureCategory =
  | "openai_request_failed"
  | "empty_model_content"
  | "model_json_parse_failed"
  | "route_exception";

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

function isEmptyModelContent(responseText: string | null | undefined): boolean {
  return typeof responseText !== "string" || !responseText.trim();
}

/** Numeric HTTP status from OpenAI SDK errors only — never messages or bodies. */
function extractOpenAiUpstreamStatus(err: unknown): number | undefined {
  if (!err || typeof err !== "object" || !("status" in err)) return undefined;
  const status = (err as { status: unknown }).status;
  if (typeof status !== "number" || !Number.isFinite(status)) return undefined;
  const code = Math.trunc(status);
  if (code < 100 || code > 599) return undefined;
  return code;
}

function failureResponse(
  category: DecideActionFailureCategory,
  upstreamStatus?: number
): NextResponse {
  const body: { error: DecideActionFailureCategory; upstream_status?: number } = {
    error: category,
  };
  if (upstreamStatus !== undefined) {
    body.upstream_status = upstreamStatus;
  }
  return NextResponse.json(body, { status: 500 });
}

function buildDefaultMessages(
  pageData: unknown,
  userProfile: unknown
): ChatCompletionMessageParam[] {
  return [
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
}

function buildFtcStructuredMessages(
  pageData: unknown,
  userProfile: unknown
): ChatCompletionMessageParam[] {
  return [
    {
      role: "system",
      content:
        "You are a step-by-step FTC ReportFraud form submission agent. Respond with a single JSON object only. Choose exactly one best matching scraped radio candidate from choiceControls. Never return zero fields and never return multiple fields.",
    },
    {
      role: "user",
      content: `Page data: ${JSON.stringify(pageData, null, 2)}\n\nUser data: ${JSON.stringify(userProfile, null, 2)}\n\nSelect exactly one scraped subcategory radio that best matches the case, then Continue. Use the exact scraped id as selector, the exact scraped optionValue as value, controlKind "radio", and choiceSelectorType "id". Never invent choice metadata. Do not treat Submit, confirm, file, or any final action as Continue.\nRespond with JSON like this:\n{\n  "fieldToFill": { "selector": "<scraped id>", "value": "<scraped optionValue>", "controlKind": "radio", "choiceSelectorType": "id" },\n  "nextButton": { "value": "Continue", "selectorType": "text" }\n}`,
    },
  ];
}

function buildFtcFormMainMessages(
  pageData: unknown,
  userProfile: unknown
): ChatCompletionMessageParam[] {
  const inventoryBlock =
    pageData && typeof pageData === "object"
      ? formatFtcFormMainInventoryForPrompt(pageData as AssistedFormPageData)
      : formatFtcFormMainInventoryForPrompt({
          fields: [],
          buttons: [],
          url: "",
        });

  return [
    {
      role: "system",
      content:
        "You are a step-by-step FTC ReportFraud /form/main submission agent. Respond with a single JSON object only. Fill every required visible field needed to unlock Continue on this step, then click Continue. Use only the allowed scraped selectors listed in the user message. Never invent selectors or choice metadata.",
    },
    {
      role: "user",
      content: `Page data: ${JSON.stringify(pageData, null, 2)}\n\nUser data: ${JSON.stringify(userProfile, null, 2)}\n\n${inventoryBlock}\n\nWhat should we fill on this FTC main form step, and which button should we click next?\n- Prefer Continue as nextButton with selectorType "text" when Continue is the safe next action.\n- You may return multiple fieldsToFill entries in one decision.\n- For text/textarea/select controls, use an exact allowed field selector (name, id, or formControlName) and the case value as value (no controlKind).\n- For required radios/checkboxes, use controlKind "radio" | "checkbox" | "choice", the matching choiceSelectorType ("name" | "id" | "accessibleName"), an exact allowed choice key as selector, and the exact scraped optionValue as value.\n- Never invent choice metadata. Do not treat Submit, confirm, file, or any final action as Continue.\nRespond with JSON like this:\n{\n  "fieldsToFill": [\n    { "selector": "comments", "value": "<story>" },\n    { "selector": "yesOrNoMoney", "value": "no", "controlKind": "radio", "choiceSelectorType": "name" }\n  ],\n  "nextButton": { "selectorType": "text", "value": "Continue" },\n  "waitForNavigation": true\n}`,
    },
  ];
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

  try {
    const body = await req.json();
    const { pageData, userProfile: userProfileField, userData, mode } = body ?? {};
    const userProfile = userProfileField ?? userData ?? {};
    const ftcAssistantMode = mode === DECIDE_ACTION_FTC_MODE;
    const ftcFormMainMode = mode === DECIDE_ACTION_FTC_FORM_MAIN_MODE;

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

    const messages = ftcAssistantMode
      ? buildFtcStructuredMessages(pageData, userProfile)
      : ftcFormMainMode
        ? buildFtcFormMainMessages(pageData, userProfile)
        : buildDefaultMessages(pageData, userProfile);

    let responseText: string | null | undefined;
    try {
      const completion = await openai.chat.completions.create({
        model: DECIDE_ACTION_MODEL,
        messages,
        temperature: 0,
        // /assistant: strict single-radio schema. /form/main: json_object (variable optional
        // multi-field metadata is not safely expressible under strict schema without
        // unsupported array-length keywords). BBB/default: json_object.
        response_format: ftcAssistantMode
          ? {
              type: "json_schema",
              json_schema: {
                name: "ftc_structured_decision",
                strict: true,
                schema: FTC_STRUCTURED_DECISION_SCHEMA as unknown as Record<string, unknown>,
              },
            }
          : { type: "json_object" },
      });
      const message = completion.choices[0]?.message;
      if (message && typeof message === "object" && "refusal" in message && message.refusal) {
        return failureResponse("empty_model_content");
      }
      responseText = message?.content;
    } catch (err: unknown) {
      return failureResponse("openai_request_failed", extractOpenAiUpstreamStatus(err));
    }

    if (isEmptyModelContent(responseText)) {
      return failureResponse("empty_model_content");
    }

    try {
      const parsed = parseDecideActionModelJson(responseText);
      if (ftcAssistantMode) {
        const adapted = adaptFtcStructuredDecision(parsed);
        if (!adapted) {
          return failureResponse("model_json_parse_failed");
        }
        return NextResponse.json({ decision: adapted });
      }
      return NextResponse.json({ decision: parsed });
    } catch {
      return failureResponse("model_json_parse_failed");
    }
  } catch {
    return failureResponse("route_exception");
  }
}

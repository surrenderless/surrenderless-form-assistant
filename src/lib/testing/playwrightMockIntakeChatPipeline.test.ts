import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultBuildJusticeIntakeParts } from "@/lib/justice/parseIntakeChatAiResponse";
import {
  buildPlaywrightMockIntakeChatResponse,
  isPlaywrightMockIntakeChatPipelineEnabled,
  PLAYWRIGHT_MOCK_INTAKE_CHAT_ASSISTANT_MESSAGE,
  PLAYWRIGHT_MOCK_INTAKE_CHAT_E2E_SECOND_USER_MESSAGE,
  PLAYWRIGHT_MOCK_INTAKE_CHAT_E2E_USER_MESSAGE,
  PLAYWRIGHT_MOCK_INTAKE_CHAT_SECOND_ASSISTANT_MESSAGE,
} from "@/lib/testing/playwrightMockIntakeChatPipeline";

describe("playwrightMockIntakeChatPipeline", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is disabled unless PLAYWRIGHT_MOCK_INTAKE_CHAT_PIPELINE=1", () => {
    expect(isPlaywrightMockIntakeChatPipelineEnabled()).toBe(false);
    vi.stubEnv("PLAYWRIGHT_MOCK_INTAKE_CHAT_PIPELINE", "1");
    expect(isPlaywrightMockIntakeChatPipelineEnabled()).toBe(true);
  });

  it("is disabled on deployed production even when the flag is set", () => {
    vi.stubEnv("PLAYWRIGHT_MOCK_INTAKE_CHAT_PIPELINE", "1");
    vi.stubEnv("VERCEL_ENV", "production");
    expect(isPlaywrightMockIntakeChatPipelineEnabled()).toBe(false);
  });

  it("returns production route contract for the canonical E2E user message", () => {
    const baseline = defaultBuildJusticeIntakeParts();
    const result = buildPlaywrightMockIntakeChatResponse(
      PLAYWRIGHT_MOCK_INTAKE_CHAT_E2E_USER_MESSAGE,
      baseline
    );

    expect(result.assistantMessage).toBe(PLAYWRIGHT_MOCK_INTAKE_CHAT_ASSISTANT_MESSAGE);
    expect(result.parts.company_name).toBe("Acme Retail");
    expect(result.parts.story).toBe(PLAYWRIGHT_MOCK_INTAKE_CHAT_E2E_USER_MESSAGE);
    expect(result.parts.money_amount).toBe("$49.99");
    expect(result.parts.problem_category).toBe("online_purchase");
    expect(result.parts.purchase_or_signup).toBe("widget order");
  });

  it("preserves turn-one fields and adds email/name on the canonical second message", () => {
    const afterTurnOne = buildPlaywrightMockIntakeChatResponse(
      PLAYWRIGHT_MOCK_INTAKE_CHAT_E2E_USER_MESSAGE,
      defaultBuildJusticeIntakeParts()
    ).parts;

    const turnTwo = buildPlaywrightMockIntakeChatResponse(
      PLAYWRIGHT_MOCK_INTAKE_CHAT_E2E_SECOND_USER_MESSAGE,
      afterTurnOne
    );

    expect(turnTwo.assistantMessage).toBe(PLAYWRIGHT_MOCK_INTAKE_CHAT_SECOND_ASSISTANT_MESSAGE);
    expect(turnTwo.parts.company_name).toBe("Acme Retail");
    expect(turnTwo.parts.story).toBe(PLAYWRIGHT_MOCK_INTAKE_CHAT_E2E_USER_MESSAGE);
    expect(turnTwo.parts.money_amount).toBe("$49.99");
    expect(turnTwo.parts.purchase_or_signup).toBe("widget order");
    expect(turnTwo.parts.reply_email).toBe("e2e-chat@example.com");
    expect(turnTwo.parts.user_display_name).toBe("Jordan Lee");
  });
});

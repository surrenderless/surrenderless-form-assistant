import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CHAT_AI_OPTIONAL_HUB_ESCAPE_HREFS,
  shouldBlockChatAiOffChatNavigation,
  shouldRedirectConsumerActiveCaseOffLegacyLadderPage,
  shouldRedirectConsumerActiveCaseOffOptionalHubEscapePage,
} from "./chatAiLadderNavigation";

describe("chat-only consumer continuity (production merge)", () => {
  it("never allows signed-in consumers to navigate into destination-prep DIY pages", () => {
    for (const href of CHAT_AI_OPTIONAL_HUB_ESCAPE_HREFS) {
      expect(
        shouldBlockChatAiOffChatNavigation({
          isSignedIn: true,
          isLoaded: true,
          caseId: "",
          isUpdatingExistingCase: false,
          targetHref: href,
        })
      ).toBe(true);
      expect(
        shouldRedirectConsumerActiveCaseOffOptionalHubEscapePage({
          escapePageHref: href,
          isSignedIn: true,
          isLoaded: true,
          caseId: "",
          hasResumableCase: false,
        })
      ).toBe(true);
    }
  });

  it("keeps /justice/handling available for operators while redirecting consumers", () => {
    expect(
      shouldRedirectConsumerActiveCaseOffLegacyLadderPage({
        legacyPageHref: "/justice/handling",
        isSignedIn: true,
        isLoaded: true,
        caseId: "case-id",
        hasResumableCase: true,
        allowOperatorAccess: true,
        isOperator: true,
      })
    ).toBe(false);
    expect(
      shouldRedirectConsumerActiveCaseOffLegacyLadderPage({
        legacyPageHref: "/justice/handling",
        isSignedIn: true,
        isLoaded: true,
        caseId: "case-id",
        hasResumableCase: true,
        allowOperatorAccess: true,
        isOperator: false,
      })
    ).toBe(true);
  });

  it("wires FTC prep with the optional-hub redirect guard", () => {
    const ftcPage = readFileSync(join(process.cwd(), "src/app/justice/ftc/page.tsx"), "utf8");
    expect(ftcPage).toContain("useRedirectConsumerActiveCaseOffOptionalHubEscapePage");
    expect(ftcPage).toContain('escapePageHref: "/justice/ftc"');
  });

  it("gates Handling workbench on saved cases to operators", () => {
    const casesPage = readFileSync(join(process.cwd(), "src/app/justice/cases/page.tsx"), "utf8");
    expect(casesPage).toContain("showHandlingWorkbenchLink");
    expect(casesPage).toContain("isOperatorRole");
    expect(casesPage).not.toMatch(/form intake is still available/);
  });
});

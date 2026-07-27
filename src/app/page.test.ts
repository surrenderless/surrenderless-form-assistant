import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { JUSTICE_CHAT_ONLY_ENTRY_PATH } from "@/lib/justice/chatOnlyEntryPaths";

describe("app root entry", () => {
  it("redirects the site root into chat-ai instead of rendering the legacy MVP page", () => {
    const homePage = readFileSync(join(process.cwd(), "src/app/page.tsx"), "utf8");
    expect(homePage).toContain("redirect(");
    expect(homePage).toContain(JUSTICE_CHAT_ONLY_ENTRY_PATH);
    expect(homePage).not.toContain("/api/ask");
    expect(homePage).not.toContain("/api/submit-form");
  });

  it("keeps the retired unauthenticated API surface deleted", () => {
    const apiRoot = join(process.cwd(), "src/app/api");
    expect(existsSync(join(apiRoot, "ask/route.ts"))).toBe(false);
    expect(existsSync(join(apiRoot, "debug/openai/route.ts"))).toBe(false);
    expect(existsSync(join(apiRoot, "debug/env/route.ts"))).toBe(false);
    expect(existsSync(join(apiRoot, "create-checkout-session/route.ts"))).toBe(false);

    // Unrelated routes must stay untouched.
    expect(existsSync(join(apiRoot, "debug/role/route.ts"))).toBe(true);
    expect(existsSync(join(apiRoot, "_archive/ask/route.ts"))).toBe(true);
  });
});

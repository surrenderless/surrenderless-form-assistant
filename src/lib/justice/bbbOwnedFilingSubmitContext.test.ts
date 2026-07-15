import { describe, expect, it } from "vitest";
import {
  buildBbbOwnedFilingSubmitContextFromRequest,
  getBbbOwnedFilingSubmitContext,
  resolveAutomatedBbbFilingBase,
  runWithBbbOwnedFilingSubmitContext,
} from "@/lib/justice/bbbOwnedFilingSubmitContext";
import type { NextRequest } from "next/server";

describe("bbbOwnedFilingSubmitContext", () => {
  it("propagates submit context across awaits", async () => {
    const result = await runWithBbbOwnedFilingSubmitContext(
      { base: "https://app.example", forwardedHeaders: { cookie: "a=1" } },
      async () => {
        await Promise.resolve();
        return getBbbOwnedFilingSubmitContext();
      }
    );
    expect(result).toEqual({
      base: "https://app.example",
      forwardedHeaders: { cookie: "a=1" },
    });
  });

  it("resolves base from env when no store override", () => {
    const prev = process.env.NEXT_PUBLIC_APP_URL;
    process.env.NEXT_PUBLIC_APP_URL = "https://env.example/";
    try {
      expect(resolveAutomatedBbbFilingBase()).toBe("https://env.example");
    } finally {
      if (prev === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
      else process.env.NEXT_PUBLIC_APP_URL = prev;
    }
  });

  it("builds cookie and optional Basic from request", () => {
    const prev = process.env.DEPLOY_PASSWORD;
    process.env.DEPLOY_PASSWORD = "secret";
    try {
      const req = {
        url: "https://localhost:3000/api/justice/cases/x",
        headers: {
          get(name: string) {
            if (name === "cookie") return "clerk=session";
            return null;
          },
        },
      } as unknown as NextRequest;
      const ctx = buildBbbOwnedFilingSubmitContextFromRequest(req);
      expect(ctx.base).toBe("https://localhost:3000");
      expect(ctx.forwardedHeaders.cookie).toBe("clerk=session");
      expect(ctx.forwardedHeaders.authorization).toMatch(/^Basic /);
    } finally {
      if (prev === undefined) delete process.env.DEPLOY_PASSWORD;
      else process.env.DEPLOY_PASSWORD = prev;
    }
  });
});

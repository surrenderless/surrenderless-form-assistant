import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const ERROR_SOURCE = fs.readFileSync(path.join(process.cwd(), "src/app/error.tsx"), "utf8");
const GLOBAL_ERROR_SOURCE = fs.readFileSync(
  path.join(process.cwd(), "src/app/global-error.tsx"),
  "utf8"
);

describe("app/error.tsx", () => {
  it("is a client component matching the Next.js error-boundary prop contract", () => {
    expect(ERROR_SOURCE).toMatch(/^"use client";/m);
    expect(ERROR_SOURCE).toMatch(/error:\s*Error\s*&\s*\{\s*digest\?:\s*string\s*\}/);
    expect(ERROR_SOURCE).toMatch(/reset:\s*\(\)\s*=>\s*void/);
  });

  it("logs the caught error so it isn't silently invisible", () => {
    expect(ERROR_SOURCE).toMatch(/console\.error\(/);
  });

  it("provides a working retry action wired to reset()", () => {
    expect(ERROR_SOURCE).toMatch(/onClick=\{reset\}/);
  });

  it("provides a return-to-chat link back into the case", () => {
    expect(ERROR_SOURCE).toMatch(/href="\/justice\/chat-ai"/);
  });

  it("marks the message region for assistive technology", () => {
    expect(ERROR_SOURCE).toMatch(/role="alert"/);
    expect(ERROR_SOURCE).toMatch(/aria-live="assertive"/);
  });

  it("exports a default component that loads without throwing", async () => {
    const mod = await import("@/app/error");
    expect(typeof mod.default).toBe("function");
  });
});

describe("app/global-error.tsx", () => {
  it("is a client component matching the Next.js error-boundary prop contract", () => {
    expect(GLOBAL_ERROR_SOURCE).toMatch(/^"use client";/m);
    expect(GLOBAL_ERROR_SOURCE).toMatch(/error:\s*Error\s*&\s*\{\s*digest\?:\s*string\s*\}/);
    expect(GLOBAL_ERROR_SOURCE).toMatch(/reset:\s*\(\)\s*=>\s*void/);
  });

  it("renders its own <html> and <body> — required since it replaces the root layout", () => {
    expect(GLOBAL_ERROR_SOURCE).toMatch(/<html lang="en">/);
    expect(GLOBAL_ERROR_SOURCE).toMatch(/<body className="antialiased">/);
  });

  it("imports global styles directly, since the root layout that normally does is bypassed", () => {
    expect(GLOBAL_ERROR_SOURCE).toMatch(/import ["']\.\/globals\.css["']/);
  });

  it("logs the caught error so it isn't silently invisible", () => {
    expect(GLOBAL_ERROR_SOURCE).toMatch(/console\.error\(/);
  });

  it("provides a working retry action wired to reset()", () => {
    expect(GLOBAL_ERROR_SOURCE).toMatch(/onClick=\{reset\}/);
  });

  it("provides a return-to-chat link back into the case", () => {
    expect(GLOBAL_ERROR_SOURCE).toMatch(/href="\/justice\/chat-ai"/);
  });
});

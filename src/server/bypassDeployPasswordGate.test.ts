import { describe, expect, it } from "vitest";
import { shouldBypassDeployPasswordGate } from "@/server/bypassDeployPasswordGate";

describe("shouldBypassDeployPasswordGate", () => {
  it("bypasses cron API paths so Bearer CRON_SECRET can reach the route", () => {
    expect(shouldBypassDeployPasswordGate("/api/cron/process-due-follow-ups")).toBe(true);
    expect(shouldBypassDeployPasswordGate("/api/cron/other")).toBe(true);
  });

  it("does not bypass non-cron API or app paths", () => {
    expect(shouldBypassDeployPasswordGate("/api/cron")).toBe(false);
    expect(shouldBypassDeployPasswordGate("/api/health")).toBe(false);
    expect(shouldBypassDeployPasswordGate("/api/justice/cases")).toBe(false);
    expect(shouldBypassDeployPasswordGate("/justice/chat-ai")).toBe(false);
    expect(shouldBypassDeployPasswordGate("/")).toBe(false);
  });

  it("still bypasses existing asset and healthz paths", () => {
    expect(shouldBypassDeployPasswordGate("/_next/static/chunk.js")).toBe(true);
    expect(shouldBypassDeployPasswordGate("/favicon.ico")).toBe(true);
    expect(shouldBypassDeployPasswordGate("/api/healthz")).toBe(true);
  });
});

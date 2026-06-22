import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isEditingActiveLocalJusticeCase } from "@/lib/justice/hydrateActiveCaseFromServer";
import { STORAGE_CASE_ID, STORAGE_INTAKE } from "@/lib/justice/types";
import type { JusticeIntake } from "@/lib/justice/types";

const UUID = "550e8400-e29b-41d4-a716-446655440000";

const validIntake: JusticeIntake = {
  company_name: "Acme",
  company_website: "",
  problem_category: "online_purchase",
  story: "Charged twice",
  money_involved: "$50",
  pay_or_order_date: "2026-01-01",
  order_confirmation_details: "",
  user_display_name: "User",
  reply_email: "user@example.com",
  purchase_or_signup: "Widget",
  already_contacted: "no",
};

function stubSessionStorage() {
  const store: Record<string, string> = {};
  const sessionStorage = {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      for (const key of Object.keys(store)) delete store[key];
    },
  };
  vi.stubGlobal("sessionStorage", sessionStorage);
  vi.stubGlobal("window", { sessionStorage });
  return sessionStorage;
}

describe("isEditingActiveLocalJusticeCase", () => {
  beforeEach(() => {
    stubSessionStorage();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns false when intake is missing", () => {
    sessionStorage.setItem(STORAGE_CASE_ID, UUID);
    expect(isEditingActiveLocalJusticeCase()).toBe(false);
  });

  it("returns false when case id is not a UUID", () => {
    sessionStorage.setItem(STORAGE_INTAKE, JSON.stringify(validIntake));
    sessionStorage.setItem(STORAGE_CASE_ID, "case_local_123");
    expect(isEditingActiveLocalJusticeCase()).toBe(false);
  });

  it("returns false when intake payload is invalid", () => {
    sessionStorage.setItem(STORAGE_INTAKE, JSON.stringify({ company_name: "Acme" }));
    sessionStorage.setItem(STORAGE_CASE_ID, UUID);
    expect(isEditingActiveLocalJusticeCase()).toBe(false);
  });

  it("returns true when valid intake and UUID case id are in session", () => {
    sessionStorage.setItem(STORAGE_INTAKE, JSON.stringify(validIntake));
    sessionStorage.setItem(STORAGE_CASE_ID, UUID);
    expect(isEditingActiveLocalJusticeCase()).toBe(true);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearLocalJusticeSession } from "@/lib/justice/clearLocalJusticeSession";
import {
  readValidIntakeDraft,
  saveIntakeDraft,
  STORAGE_INTAKE_DRAFT_V1,
} from "@/lib/justice/intakeDraftPersistence";
import { defaultBuildJusticeIntakeParts } from "@/lib/justice/buildJusticeIntake";
import { STORAGE_CASE_ID, STORAGE_INTAKE } from "@/lib/justice/types";

function makeStore() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    get raw() {
      return store;
    },
  };
}

let mockSessionStorage: ReturnType<typeof makeStore>;

beforeEach(() => {
  mockSessionStorage = makeStore();
  vi.stubGlobal("sessionStorage", mockSessionStorage);
  // clearLocalJusticeSession guards on `typeof window === "undefined"` (existing, unmodified
  // behavior) — simulate a real browser window so the function actually runs under Vitest's
  // Node environment for this file.
  vi.stubGlobal("window", { sessionStorage: mockSessionStorage });
});

describe("clearLocalJusticeSession — pre-commit intake draft", () => {
  it("clears an in-progress pre-commit intake draft alongside the rest of local session state", () => {
    saveIntakeDraft({
      parts: defaultBuildJusticeIntakeParts(),
      messages: [{ id: "m1", role: "assistant", text: "Hi" }],
    });
    mockSessionStorage.setItem(STORAGE_INTAKE, JSON.stringify({ company_name: "Acme" }));
    mockSessionStorage.setItem(STORAGE_CASE_ID, "case-123");
    expect(readValidIntakeDraft()).not.toBeNull();

    clearLocalJusticeSession();

    expect(readValidIntakeDraft()).toBeNull();
    expect(mockSessionStorage.raw.has(STORAGE_INTAKE_DRAFT_V1)).toBe(false);
    expect(mockSessionStorage.raw.has(STORAGE_INTAKE)).toBe(false);
    expect(mockSessionStorage.raw.has(STORAGE_CASE_ID)).toBe(false);
  });

  it("is a no-op when no draft was ever saved", () => {
    expect(() => clearLocalJusticeSession()).not.toThrow();
    expect(readValidIntakeDraft()).toBeNull();
  });
});

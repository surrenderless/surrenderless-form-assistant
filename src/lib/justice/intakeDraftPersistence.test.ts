import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultBuildJusticeIntakeParts } from "@/lib/justice/buildJusticeIntake";
import {
  clearIntakeDraft,
  readValidIntakeDraft,
  saveIntakeDraft,
  STORAGE_INTAKE_DRAFT_V1,
  type IntakeDraftMessage,
} from "@/lib/justice/intakeDraftPersistence";
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
});

const MESSAGES: IntakeDraftMessage[] = [
  { id: "m1", role: "assistant", text: "Hi — tell me what happened." },
  { id: "m2", role: "user", text: "Acme Retail double-charged me for a widget." },
];

describe("intakeDraftPersistence — save/restore", () => {
  it("round-trips a saved draft through readValidIntakeDraft", () => {
    const parts = { ...defaultBuildJusticeIntakeParts(), company_name: "Acme Retail" };
    saveIntakeDraft({ parts, messages: MESSAGES });

    const restored = readValidIntakeDraft();
    expect(restored).not.toBeNull();
    expect(restored?.parts).toEqual(parts);
    expect(restored?.messages).toEqual(MESSAGES);
    expect(typeof restored?.saved_at).toBe("string");
  });

  it("persists under the distinct versioned key, not STORAGE_INTAKE or STORAGE_CASE_ID", () => {
    saveIntakeDraft({ parts: defaultBuildJusticeIntakeParts(), messages: MESSAGES });
    expect(STORAGE_INTAKE_DRAFT_V1).toBe("justice_intake_draft_v1");
    expect(mockSessionStorage.raw.has(STORAGE_INTAKE_DRAFT_V1)).toBe(true);
    expect(mockSessionStorage.raw.has(STORAGE_INTAKE)).toBe(false);
    expect(mockSessionStorage.raw.has(STORAGE_CASE_ID)).toBe(false);
  });

  it("overwrites the previous draft on each save (latest state only)", () => {
    saveIntakeDraft({ parts: defaultBuildJusticeIntakeParts(), messages: [MESSAGES[0]] });
    saveIntakeDraft({
      parts: { ...defaultBuildJusticeIntakeParts(), company_name: "Acme Retail" },
      messages: MESSAGES,
    });

    const restored = readValidIntakeDraft();
    expect(restored?.messages).toEqual(MESSAGES);
    expect(restored?.parts.company_name).toBe("Acme Retail");
  });

  it("returns null when nothing has been saved", () => {
    expect(readValidIntakeDraft()).toBeNull();
  });

  it("is a no-op (does not throw) when sessionStorage is unavailable", () => {
    vi.stubGlobal("sessionStorage", undefined);
    expect(() =>
      saveIntakeDraft({ parts: defaultBuildJusticeIntakeParts(), messages: MESSAGES })
    ).not.toThrow();
    expect(() => readValidIntakeDraft()).not.toThrow();
    expect(readValidIntakeDraft()).toBeNull();
  });

  it("is a no-op (never throws) when the storage write itself throws (quota exceeded)", () => {
    vi.stubGlobal("sessionStorage", {
      ...mockSessionStorage,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    });
    expect(() =>
      saveIntakeDraft({ parts: defaultBuildJusticeIntakeParts(), messages: MESSAGES })
    ).not.toThrow();
  });
});

describe("intakeDraftPersistence — fails safe on malformed/incompatible data", () => {
  it("returns null and clears the key for invalid JSON", () => {
    mockSessionStorage.setItem(STORAGE_INTAKE_DRAFT_V1, "{not json");
    expect(readValidIntakeDraft()).toBeNull();
    expect(mockSessionStorage.raw.has(STORAGE_INTAKE_DRAFT_V1)).toBe(false);
  });

  it("returns null and clears the key when parts is missing a required field", () => {
    const { company_name: _drop, ...brokenParts } = defaultBuildJusticeIntakeParts();
    mockSessionStorage.setItem(
      STORAGE_INTAKE_DRAFT_V1,
      JSON.stringify({ parts: brokenParts, messages: MESSAGES, saved_at: "2026-08-01T00:00:00.000Z" })
    );
    expect(readValidIntakeDraft()).toBeNull();
    expect(mockSessionStorage.raw.has(STORAGE_INTAKE_DRAFT_V1)).toBe(false);
  });

  it("returns null when parts has a wrong-typed field", () => {
    const badParts = { ...defaultBuildJusticeIntakeParts(), company_name: 12345 };
    mockSessionStorage.setItem(
      STORAGE_INTAKE_DRAFT_V1,
      JSON.stringify({ parts: badParts, messages: MESSAGES, saved_at: "2026-08-01T00:00:00.000Z" })
    );
    expect(readValidIntakeDraft()).toBeNull();
  });

  it("returns null when messages is not an array", () => {
    mockSessionStorage.setItem(
      STORAGE_INTAKE_DRAFT_V1,
      JSON.stringify({
        parts: defaultBuildJusticeIntakeParts(),
        messages: "not-an-array",
        saved_at: "2026-08-01T00:00:00.000Z",
      })
    );
    expect(readValidIntakeDraft()).toBeNull();
  });

  it("returns null when a message entry has an invalid role", () => {
    mockSessionStorage.setItem(
      STORAGE_INTAKE_DRAFT_V1,
      JSON.stringify({
        parts: defaultBuildJusticeIntakeParts(),
        messages: [{ id: "m1", role: "system", text: "bad role" }],
        saved_at: "2026-08-01T00:00:00.000Z",
      })
    );
    expect(readValidIntakeDraft()).toBeNull();
  });

  it("returns null when saved_at is missing", () => {
    mockSessionStorage.setItem(
      STORAGE_INTAKE_DRAFT_V1,
      JSON.stringify({ parts: defaultBuildJusticeIntakeParts(), messages: MESSAGES })
    );
    expect(readValidIntakeDraft()).toBeNull();
  });

  it("returns null for an old/incompatible shape (e.g. a plain intake record, not a draft)", () => {
    mockSessionStorage.setItem(
      STORAGE_INTAKE_DRAFT_V1,
      JSON.stringify({ company_name: "Acme", story: "..." })
    );
    expect(readValidIntakeDraft()).toBeNull();
  });

  it("returns null for a top-level array or primitive", () => {
    mockSessionStorage.setItem(STORAGE_INTAKE_DRAFT_V1, JSON.stringify([1, 2, 3]));
    expect(readValidIntakeDraft()).toBeNull();
    mockSessionStorage.setItem(STORAGE_INTAKE_DRAFT_V1, JSON.stringify("just a string"));
    expect(readValidIntakeDraft()).toBeNull();
  });
});

describe("intakeDraftPersistence — clear", () => {
  it("removes a saved draft", () => {
    saveIntakeDraft({ parts: defaultBuildJusticeIntakeParts(), messages: MESSAGES });
    expect(readValidIntakeDraft()).not.toBeNull();

    clearIntakeDraft();

    expect(readValidIntakeDraft()).toBeNull();
    expect(mockSessionStorage.raw.has(STORAGE_INTAKE_DRAFT_V1)).toBe(false);
  });

  it("is a no-op when nothing was saved", () => {
    expect(() => clearIntakeDraft()).not.toThrow();
    expect(readValidIntakeDraft()).toBeNull();
  });

  it("never touches STORAGE_INTAKE or STORAGE_CASE_ID", () => {
    mockSessionStorage.setItem(STORAGE_INTAKE, JSON.stringify({ company_name: "Acme" }));
    mockSessionStorage.setItem(STORAGE_CASE_ID, "case-123");
    saveIntakeDraft({ parts: defaultBuildJusticeIntakeParts(), messages: MESSAGES });

    clearIntakeDraft();

    expect(mockSessionStorage.raw.get(STORAGE_INTAKE)).toBe(JSON.stringify({ company_name: "Acme" }));
    expect(mockSessionStorage.raw.get(STORAGE_CASE_ID)).toBe("case-123");
  });
});

import { describe, expect, it } from "vitest";
import { shouldRouteToChatAiAfterIntakeCommit } from "@/lib/justice/commitIntakeToSessionAndServer";

const UUID = "550e8400-e29b-41d4-a716-446655440000";

describe("shouldRouteToChatAiAfterIntakeCommit", () => {
  it("returns false when Clerk is not loaded", () => {
    expect(
      shouldRouteToChatAiAfterIntakeCommit({
        commitResult: { caseId: UUID, serverPersisted: true },
        isLoaded: false,
        isSignedIn: true,
      })
    ).toBe(false);
  });

  it("returns false when user is not signed in", () => {
    expect(
      shouldRouteToChatAiAfterIntakeCommit({
        commitResult: { caseId: UUID, serverPersisted: true },
        isLoaded: true,
        isSignedIn: false,
      })
    ).toBe(false);
  });

  it("returns false when case id is missing or not a UUID", () => {
    expect(
      shouldRouteToChatAiAfterIntakeCommit({
        commitResult: { caseId: "", serverPersisted: true },
        isLoaded: true,
        isSignedIn: true,
      })
    ).toBe(false);
    expect(
      shouldRouteToChatAiAfterIntakeCommit({
        commitResult: { caseId: "case_local_123", serverPersisted: true },
        isLoaded: true,
        isSignedIn: true,
      })
    ).toBe(false);
  });

  it("returns true for signed-in UUID updates even when server persist failed", () => {
    expect(
      shouldRouteToChatAiAfterIntakeCommit({
        commitResult: { caseId: UUID, serverPersisted: false },
        isLoaded: true,
        isSignedIn: true,
        isUpdatingExistingCase: true,
      })
    ).toBe(true);
  });

  it("requires serverPersisted for signed-in UUID create commits", () => {
    expect(
      shouldRouteToChatAiAfterIntakeCommit({
        commitResult: { caseId: UUID, serverPersisted: false },
        isLoaded: true,
        isSignedIn: true,
        isUpdatingExistingCase: false,
      })
    ).toBe(false);
    expect(
      shouldRouteToChatAiAfterIntakeCommit({
        commitResult: { caseId: UUID, serverPersisted: true },
        isLoaded: true,
        isSignedIn: true,
        isUpdatingExistingCase: false,
      })
    ).toBe(true);
  });
});

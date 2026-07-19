import { describe, expect, it } from "vitest";
import {
  resolveSignedInConsumerReplyEmail,
  type ClerkUserEmailSource,
} from "@/lib/justice/resolveSignedInConsumerReplyEmail";

const verified = (emailAddress: string, id = "idp") => ({
  id,
  emailAddress,
  verification: { status: "verified" },
});
const unverified = (emailAddress: string, id = "idp") => ({
  id,
  emailAddress,
  verification: { status: "unverified" },
});

describe("resolveSignedInConsumerReplyEmail", () => {
  it("returns the verified primary email, normalized (trim + lowercase)", () => {
    const user: ClerkUserEmailSource = {
      primaryEmailAddress: verified("  Consumer@Example.COM "),
    };
    expect(resolveSignedInConsumerReplyEmail(user)).toBe("consumer@example.com");
  });

  it("returns null when no user is signed in", () => {
    expect(resolveSignedInConsumerReplyEmail(null)).toBeNull();
    expect(resolveSignedInConsumerReplyEmail(undefined)).toBeNull();
  });

  it("returns null when the primary email is not verified", () => {
    const user: ClerkUserEmailSource = {
      primaryEmailAddress: unverified("consumer@example.com"),
    };
    expect(resolveSignedInConsumerReplyEmail(user)).toBeNull();
  });

  it("falls back to the primaryEmailAddressId entry when primaryEmailAddress is absent", () => {
    const user: ClerkUserEmailSource = {
      primaryEmailAddressId: "id-2",
      emailAddresses: [
        unverified("first@example.com", "id-1"),
        verified("primary@example.com", "id-2"),
      ],
    };
    expect(resolveSignedInConsumerReplyEmail(user)).toBe("primary@example.com");
  });

  it("falls back to the first verified address when no primary is identified", () => {
    const user: ClerkUserEmailSource = {
      emailAddresses: [
        unverified("first@example.com", "id-1"),
        verified("second@example.com", "id-2"),
      ],
    };
    expect(resolveSignedInConsumerReplyEmail(user)).toBe("second@example.com");
  });

  it("returns null when the only addresses are unverified", () => {
    const user: ClerkUserEmailSource = {
      emailAddresses: [unverified("first@example.com"), unverified("second@example.com")],
    };
    expect(resolveSignedInConsumerReplyEmail(user)).toBeNull();
  });

  it("rejects a verified-but-syntactically-invalid email", () => {
    const user: ClerkUserEmailSource = {
      primaryEmailAddress: verified("not-an-email"),
    };
    expect(resolveSignedInConsumerReplyEmail(user)).toBeNull();
  });

  it("returns null for an empty/missing verified email value", () => {
    const user: ClerkUserEmailSource = {
      primaryEmailAddress: { id: "idp", emailAddress: "", verification: { status: "verified" } },
    };
    expect(resolveSignedInConsumerReplyEmail(user)).toBeNull();
  });
});

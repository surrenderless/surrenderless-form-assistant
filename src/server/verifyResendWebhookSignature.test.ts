import { createHmac } from "crypto";
import { describe, expect, it } from "vitest";
import {
  readSvixHeaders,
  verifyResendWebhookSignature,
  type ResendWebhookHeaders,
} from "@/server/verifyResendWebhookSignature";

const RAW_SECRET = Buffer.from("resend-webhook-signing-key-value").toString("base64");
const SECRET = `whsec_${RAW_SECRET}`;

function sign(params: { id: string; timestamp: string; payload: string; secret?: string }): string {
  const key = Buffer.from(params.secret ?? RAW_SECRET, "base64");
  const signed = `${params.id}.${params.timestamp}.${params.payload}`;
  return createHmac("sha256", key).update(signed).digest("base64");
}

function headers(overrides: Partial<ResendWebhookHeaders> = {}): ResendWebhookHeaders {
  return { id: "msg_1", timestamp: "1000", signature: "v1,sig", ...overrides };
}

describe("verifyResendWebhookSignature", () => {
  const nowMs = 1000 * 1000; // timestamp 1000s is "now"
  const payload = JSON.stringify({ type: "email.delivered", data: { email_id: "re_1" } });

  it("accepts a correctly signed payload", () => {
    const sig = sign({ id: "msg_1", timestamp: "1000", payload });
    const ok = verifyResendWebhookSignature({
      payload,
      headers: headers({ signature: `v1,${sig}` }),
      secret: SECRET,
      nowMs,
    });
    expect(ok).toBe(true);
  });

  it("accepts when the header carries multiple space-delimited signatures and one matches", () => {
    const sig = sign({ id: "msg_1", timestamp: "1000", payload });
    const ok = verifyResendWebhookSignature({
      payload,
      headers: headers({ signature: `v1,AAAA v1,${sig} v2,BBBB` }),
      secret: SECRET,
      nowMs,
    });
    expect(ok).toBe(true);
  });

  it("rejects a tampered payload", () => {
    const sig = sign({ id: "msg_1", timestamp: "1000", payload });
    const ok = verifyResendWebhookSignature({
      payload: payload + " ",
      headers: headers({ signature: `v1,${sig}` }),
      secret: SECRET,
      nowMs,
    });
    expect(ok).toBe(false);
  });

  it("rejects a signature made with a different secret", () => {
    const otherKey = Buffer.from("some-other-key").toString("base64");
    const sig = sign({ id: "msg_1", timestamp: "1000", payload, secret: otherKey });
    const ok = verifyResendWebhookSignature({
      payload,
      headers: headers({ signature: `v1,${sig}` }),
      secret: SECRET,
      nowMs,
    });
    expect(ok).toBe(false);
  });

  it("rejects a stale timestamp outside the tolerance window", () => {
    const sig = sign({ id: "msg_1", timestamp: "1000", payload });
    const ok = verifyResendWebhookSignature({
      payload,
      headers: headers({ signature: `v1,${sig}` }),
      secret: SECRET,
      nowMs: (1000 + 10 * 60) * 1000, // 10 minutes later, tolerance is 5
    });
    expect(ok).toBe(false);
  });

  it("rejects when required headers are missing", () => {
    const sig = sign({ id: "msg_1", timestamp: "1000", payload });
    expect(
      verifyResendWebhookSignature({
        payload,
        headers: headers({ id: null, signature: `v1,${sig}` }),
        secret: SECRET,
        nowMs,
      })
    ).toBe(false);
  });

  it("rejects when no secret is configured", () => {
    const sig = sign({ id: "msg_1", timestamp: "1000", payload });
    expect(
      verifyResendWebhookSignature({
        payload,
        headers: headers({ signature: `v1,${sig}` }),
        secret: "",
        nowMs,
      })
    ).toBe(false);
  });
});

describe("readSvixHeaders", () => {
  it("reads svix-* headers and falls back to webhook-* aliases", () => {
    const svix = new Headers({
      "svix-id": "a",
      "svix-timestamp": "1",
      "svix-signature": "v1,x",
    });
    expect(readSvixHeaders(svix)).toEqual({ id: "a", timestamp: "1", signature: "v1,x" });

    const aliased = new Headers({
      "webhook-id": "b",
      "webhook-timestamp": "2",
      "webhook-signature": "v1,y",
    });
    expect(readSvixHeaders(aliased)).toEqual({ id: "b", timestamp: "2", signature: "v1,y" });
  });
});

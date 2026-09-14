import { beforeEach, describe, expect, it, vi } from "vitest";

const sendMock = vi.fn();

vi.mock("resend", () => ({
  Resend: vi.fn().mockImplementation(() => ({
    emails: { send: sendMock },
  })),
}));

import { createResendEmailProvider } from "@/lib/email/resendEmailProvider";

/**
 * These tests exist specifically to back the claim, made in operatorFallbackAlertReconciler.ts's
 * doc comments, that duplicate-delivery prevention for concurrent/retried operator alerts relies
 * on Resend's own idempotency-key contract rather than any application-level lock. That claim is
 * only trustworthy if this adapter genuinely forwards the caller's idempotencyKey to Resend on
 * every attempt, unmodified — which is what's verified here. Whether Resend's server actually
 * collapses two calls sharing a key into one delivered email is an external vendor behavior this
 * adapter cannot prove from source alone; only that our side of the contract is upheld.
 */
describe("createResendEmailProvider", () => {
  beforeEach(() => {
    sendMock.mockReset();
  });

  it("forwards the caller's idempotencyKey to Resend as request options, not the email payload", async () => {
    sendMock.mockResolvedValue({ data: { id: "resend_msg_1" }, error: null });
    const provider = createResendEmailProvider("re_test_key");

    await provider.send({
      from: "ops@surrenderless.test",
      to: "alerts@surrenderless.test",
      subject: "Subject",
      text: "Body",
      idempotencyKey: "operator-queue-alert:task-1:bbb:recurring-1",
    });

    expect(sendMock).toHaveBeenCalledTimes(1);
    const [payload, options] = sendMock.mock.calls[0] as [Record<string, unknown>, Record<string, unknown>];
    expect(payload).toMatchObject({
      from: "ops@surrenderless.test",
      to: "alerts@surrenderless.test",
      subject: "Subject",
      text: "Body",
    });
    expect(payload.idempotencyKey).toBeUndefined();
    expect(options).toEqual({ idempotencyKey: "operator-queue-alert:task-1:bbb:recurring-1" });
  });

  it("two attempts with the identical idempotencyKey both forward it identically — the necessary (not sufficient) condition for Resend's own dedup to apply", async () => {
    sendMock.mockResolvedValue({ data: { id: "resend_msg_1" }, error: null });
    const provider = createResendEmailProvider("re_test_key");

    const request = {
      from: "ops@surrenderless.test",
      to: "alerts@surrenderless.test",
      subject: "Subject",
      text: "Body",
      idempotencyKey: "operator-queue-alert:task-1:bbb:24h",
    };

    await Promise.all([provider.send(request), provider.send(request)]);

    expect(sendMock).toHaveBeenCalledTimes(2);
    const keys = sendMock.mock.calls.map((c) => (c[1] as { idempotencyKey?: string })?.idempotencyKey);
    expect(keys).toEqual([request.idempotencyKey, request.idempotencyKey]);
  });

  it("surfaces a Resend error response as a retryable failure, without synthesizing a message id", async () => {
    sendMock.mockResolvedValue({ data: null, error: { message: "invalid API key" } });
    const provider = createResendEmailProvider("re_test_key");

    const result = await provider.send({
      from: "a@b.test",
      to: "c@d.test",
      subject: "s",
      text: "t",
      idempotencyKey: "k",
    });

    expect(result).toEqual({ ok: false, error: "invalid API key", retryable: true });
  });

  it("treats a missing message id on an ostensibly-successful response as a retryable failure", async () => {
    sendMock.mockResolvedValue({ data: { id: "" }, error: null });
    const provider = createResendEmailProvider("re_test_key");

    const result = await provider.send({
      from: "a@b.test",
      to: "c@d.test",
      subject: "s",
      text: "t",
      idempotencyKey: "k",
    });

    expect(result.ok).toBe(false);
  });

  it("propagates a thrown exception from the SDK as a retryable failure", async () => {
    sendMock.mockRejectedValue(new Error("network down"));
    const provider = createResendEmailProvider("re_test_key");

    const result = await provider.send({
      from: "a@b.test",
      to: "c@d.test",
      subject: "s",
      text: "t",
      idempotencyKey: "k",
    });

    expect(result).toEqual({ ok: false, error: "network down", retryable: true });
  });
});

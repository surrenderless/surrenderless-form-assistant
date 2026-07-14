import { Resend } from "resend";
import type { EmailProvider, EmailSendRequest, EmailSendResult } from "@/lib/email/emailProvider";

/**
 * Resend-backed EmailProvider. Credentials come from the caller (env-validated).
 */
export function createResendEmailProvider(apiKey: string): EmailProvider {
  const client = new Resend(apiKey);
  return {
    name: "resend",
    async send(request: EmailSendRequest): Promise<EmailSendResult> {
      try {
        const { data, error } = await client.emails.send(
          {
            from: request.from,
            to: request.to,
            subject: request.subject,
            text: request.text,
            ...(request.replyTo ? { replyTo: request.replyTo } : {}),
          },
          { idempotencyKey: request.idempotencyKey }
        );

        if (error) {
          const message =
            typeof error === "object" && error && "message" in error
              ? String((error as { message?: unknown }).message ?? "Resend send failed")
              : "Resend send failed";
          return { ok: false, error: message, retryable: true };
        }

        const messageId = typeof data?.id === "string" ? data.id.trim() : "";
        if (!messageId) {
          return { ok: false, error: "Resend accepted the request but returned no message id", retryable: true };
        }
        return { ok: true, messageId };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Resend send failed";
        return { ok: false, error: message, retryable: true };
      }
    },
  };
}

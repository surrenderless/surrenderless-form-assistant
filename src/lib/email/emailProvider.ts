/**
 * Provider-agnostic email send interface for production outreach adapters.
 */

export type EmailSendRequest = {
  from: string;
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
  /** Provider idempotency key — retries must not create duplicate messages. */
  idempotencyKey: string;
};

export type EmailSendSuccess = {
  ok: true;
  messageId: string;
};

export type EmailSendFailure = {
  ok: false;
  error: string;
  retryable?: boolean;
};

export type EmailSendResult = EmailSendSuccess | EmailSendFailure;

export interface EmailProvider {
  readonly name: string;
  send(request: EmailSendRequest): Promise<EmailSendResult>;
}

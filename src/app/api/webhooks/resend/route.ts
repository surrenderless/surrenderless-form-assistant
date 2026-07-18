import { NextResponse, type NextRequest } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  recordConsumerClosedNotificationDeliveryEvent,
  type ResendDeliveryEventType,
} from "@/lib/justice/consumerClosedNotificationDelivery";
import { readSvixHeaders, verifyResendWebhookSignature } from "@/server/verifyResendWebhookSignature";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const HANDLED_EVENT_TYPES: Record<string, ResendDeliveryEventType> = {
  "email.delivered": "email.delivered",
  "email.bounced": "email.bounced",
  "email.complained": "email.complained",
};

function getSupabaseAdmin(): SupabaseClient | null {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !supabaseServiceRoleKey) return null;

  return createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch },
  });
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.RESEND_WEBHOOK_SECRET?.trim() ?? "";
  if (!secret) {
    return NextResponse.json({ error: "Webhook is not configured" }, { status: 503 });
  }

  // Verify against the RAW body before parsing.
  const payload = await req.text();
  if (!verifyResendWebhookSignature({ payload, headers: readSvixHeaders(req.headers), secret })) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let event: unknown;
  try {
    event = JSON.parse(payload);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const eventObj = (event ?? {}) as { type?: unknown; data?: Record<string, unknown> };
  const eventType = HANDLED_EVENT_TYPES[readString(eventObj.type)];
  if (!eventType) {
    // Ack unhandled event types so the provider does not retry.
    return NextResponse.json({ ok: true, status: "ignored_unhandled_type" });
  }

  const data = (eventObj.data ?? {}) as Record<string, unknown>;
  const messageId = readString(data.email_id) || readString(data.id);
  const idempotencyKey = readString(data.idempotency_key);

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase is not configured on this server." }, { status: 503 });
  }

  const result = await recordConsumerClosedNotificationDeliveryEvent(supabase, {
    messageId,
    idempotencyKey,
    eventType,
  });

  // Surface transient DB errors as 5xx so the provider retries; everything else is a 200 ack.
  const status = result.status === "error" ? 500 : 200;
  return NextResponse.json({ ok: result.status !== "error", ...result }, { status });
}

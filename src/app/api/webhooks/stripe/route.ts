import { NextResponse, type NextRequest } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getStripeClient } from "@/lib/stripe/getStripeClient";
import {
  processStripeCheckoutCompletedEvent,
  type StripeWebhookEventLike,
} from "@/lib/stripe/processStripeCheckoutCompletedEvent";
import { resolveStripeWebhookEnv } from "@/lib/stripe/stripeEnv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function getSupabaseAdmin(): SupabaseClient | null {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !supabaseServiceRoleKey) return null;

  return createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch },
  });
}

/**
 * Verifies the Stripe webhook signature server-side against the raw request body — the only
 * source of truth for payment confirmation. Redirect query params and client-reported state are
 * never trusted; entitlement is granted exclusively from here, via
 * processStripeCheckoutCompletedEvent's idempotent, service-role-scoped write.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const env = resolveStripeWebhookEnv();
  if (!env.enabled) {
    return NextResponse.json({ error: "Webhook is not configured" }, { status: 503 });
  }

  const payload = await req.text();
  const signature = req.headers.get("stripe-signature") ?? "";

  let event: StripeWebhookEventLike;
  try {
    const stripe = getStripeClient(env.secretKey);
    event = stripe.webhooks.constructEvent(
      payload,
      signature,
      env.webhookSecret
    ) as unknown as StripeWebhookEventLike;
  } catch (e) {
    console.warn("stripe webhook: signature verification failed", e);
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase is not configured on this server." }, { status: 503 });
  }

  const result = await processStripeCheckoutCompletedEvent(supabase, event);
  // Surface real failures as 5xx so Stripe retries delivery; every other outcome (granted,
  // duplicate, ignored, malformed, case_mismatch) is a definitive 200 ack — Stripe must never
  // retry an event this handler has already durably resolved.
  const status = result.status === "error" ? 500 : 200;
  return NextResponse.json({ ok: result.status !== "error", ...result }, { status });
}

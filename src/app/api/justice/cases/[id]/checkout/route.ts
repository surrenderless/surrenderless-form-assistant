import { NextResponse, type NextRequest } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { validate as isUuid } from "uuid";
import { getStripeClient } from "@/lib/stripe/getStripeClient";
import { resolveStripeCheckoutEnv } from "@/lib/stripe/stripeEnv";
import { getUserOr401 } from "@/server/requireUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CHAT_PATH = "/justice/chat-ai";

function getSupabaseAdmin(): SupabaseClient | null {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !supabaseServiceRoleKey) return null;

  return createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch },
  });
}

function supabaseUnavailableResponse() {
  return NextResponse.json(
    { error: "Supabase is not configured on this server." },
    { status: 503 }
  );
}

function resolveAppBaseUrl(): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (appUrl) return appUrl.replace(/\/$/, "");
  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) {
    const host = vercel.replace(/^https?:\/\//i, "").replace(/\/$/, "");
    if (host) return `https://${host}`;
  }
  return "";
}

function chatReturnUrl(caseId: string, checkoutStatus: "success" | "cancelled"): string {
  const params = new URLSearchParams({ case: caseId, checkout: checkoutStatus });
  return `${resolveAppBaseUrl()}${CHAT_PATH}?${params.toString()}`;
}

type RouteCtx = { params: Promise<{ id: string }> };

/**
 * Creates a one-time Stripe Checkout session for the signed-in consumer's exact owned case.
 * Never accepts or trusts an amount from the client — the Price ID (and therefore amount) comes
 * entirely from STRIPE_PRICE_ID. One payment unlocks the whole case; there is no per-lane or
 * subscription mode here.
 */
export async function POST(req: NextRequest, context: RouteCtx): Promise<NextResponse> {
  const userId = getUserOr401(req);
  if (!userId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { id } = await context.params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "Invalid case id" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) return supabaseUnavailableResponse();

  const { data: caseRow, error: caseErr } = await supabase
    .from("justice_cases")
    .select("id, paid_at")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();

  if (caseErr) {
    console.warn("justice case checkout: select case", caseErr.message);
    return NextResponse.json({ error: caseErr.message }, { status: 500 });
  }
  if (!caseRow) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (caseRow.paid_at) {
    return NextResponse.json({ alreadyPaid: true });
  }

  const env = resolveStripeCheckoutEnv();
  if (!env.enabled) {
    return NextResponse.json(
      { error: "Payments are not configured on this server." },
      { status: 503 }
    );
  }

  const stripe = getStripeClient(env.secretKey);

  // Stable per-case idempotency key: any retry, double-click, or concurrent request within
  // Stripe's 24h idempotency window returns the SAME session object instead of creating a new
  // one — request params are fully deterministic from `id`/env, so they always match. Stripe
  // evicts the key after 24h, the same window a Checkout Session is valid for by default, so an
  // expired/abandoned session can always be safely retried afterward with a genuinely new one.
  const idempotencyKey = `case-checkout:${id}`;

  let session: { url: string | null };
  try {
    session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        line_items: [{ price: env.priceId, quantity: 1 }],
        client_reference_id: id,
        metadata: { case_id: id, user_id: userId },
        success_url: chatReturnUrl(id, "success"),
        cancel_url: chatReturnUrl(id, "cancelled"),
      },
      { idempotencyKey }
    );
  } catch (e) {
    console.warn("justice case checkout: stripe session create failed", e);
    return NextResponse.json({ error: "Could not start checkout" }, { status: 502 });
  }

  if (!session.url) {
    return NextResponse.json({ error: "Could not start checkout" }, { status: 502 });
  }

  return NextResponse.json({ url: session.url });
}

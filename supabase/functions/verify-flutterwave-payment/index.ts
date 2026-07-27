// =====================================================================
// SUPABASE EDGE FUNCTION — verify-flutterwave-payment
//
// Called by the browser right after Flutterwave Inline Checkout reports
// success. We NEVER trust that client-side callback on its own — this
// function re-verifies the transaction directly with Flutterwave using
// your secret key, then (and only then) activates the subscription.
//
// DEPLOY (from a machine with the Supabase CLI + Deno installed):
//   1. mkdir -p supabase/functions/verify-flutterwave-payment
//   2. Save this file as supabase/functions/verify-flutterwave-payment/index.ts
//   3. supabase secrets set FLW_SECRET_KEY=FLWSECK-xxxxxxxx
//   4. supabase functions deploy verify-flutterwave-payment
//
// The client calls it with: supabase.functions.invoke('verify-flutterwave-payment', { body: { transaction_id, tx_ref } })
// (see startCheckout() in uganda-pos-billing.js). The caller's JWT is
// forwarded automatically, which is how we know which business is paying
// — we never trust a client-supplied business_id.
// =====================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGINS = [
  Deno.env.get("APP_ORIGIN") || "http://localhost:3000",
  Deno.env.get("APP_ORIGIN_2") || "",
].filter(Boolean);

function getCorsHeaders(req?: Request): Record<string, string> {
  const origin = req?.headers?.get("origin") || "";
  const allowed = ALLOWED_ORIGINS.includes(origin)
    ? origin
    : ALLOWED_ORIGINS[0] || "*";
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
  };
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FLW_SECRET_KEY = Deno.env.get("FLW_SECRET_KEY")!;

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });

  try {
    const { transaction_id, tx_ref } = await req.json();
    if (!transaction_id || !tx_ref) {
      return json(
        { success: false, error: "transaction_id and tx_ref are required" },
        400,
        corsHeaders,
      );
    }

    // 1. Identify the calling business from their JWT (never trust client input for this)
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user)
      return json(
        { success: false, error: "Not authenticated" },
        401,
        corsHeaders,
      );

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: appUser } = await admin
      .from("app_users")
      .select("business_id")
      .eq("id", userData.user.id)
      .single();
    if (!appUser?.business_id)
      return json(
        { success: false, error: "No business linked to this login" },
        400,
        corsHeaders,
      );
    const businessId = appUser.business_id;

    // 2. Re-verify the transaction with Flutterwave — this is the source of truth.
    const flwRes = await fetch(
      `https://api.flutterwave.com/v3/transactions/${transaction_id}/verify`,
      {
        headers: { Authorization: `Bearer ${FLW_SECRET_KEY}` },
      },
    );
    if (!flwRes.ok) {
      return json(
        {
          success: false,
          error: "Could not reach Flutterwave for verification",
        },
        502,
        corsHeaders,
      );
    }
    const flwData = await flwRes.json();
    const tx = flwData?.data;

    if (
      !tx ||
      flwData.status !== "success" ||
      tx.status !== "successful" ||
      tx.tx_ref !== tx_ref
    ) {
      return json(
        { success: false, error: "Payment could not be verified" },
        402,
        corsHeaders,
      );
    }
    if (tx.currency !== "UGX") {
      return json(
        { success: false, error: `Unexpected currency: ${tx.currency}` },
        402,
        corsHeaders,
      );
    }

    // 3. tx_ref format is SUB_<businessId>_<planCode>_<timestamp> — see uganda-pos-billing.js
    const parts = String(tx_ref).split("_");
    const planCode = parts[2];
    const { data: plan } = await admin
      .from("plans")
      .select("*")
      .eq("code", planCode)
      .single();
    if (!plan)
      return json(
        { success: false, error: "Unknown plan in tx_ref" },
        400,
        corsHeaders,
      );

    if (Number(tx.amount) < Number(plan.price_ugx) - 1) {
      return json(
        { success: false, error: "Amount paid is less than the plan price" },
        402,
        corsHeaders,
      );
    }

    // 4. Idempotency — if we've already processed this tx_ref successfully, don't extend the period twice.
    const { data: existing } = await admin
      .from("subscription_payments")
      .select("id, status")
      .eq("flw_tx_ref", tx_ref)
      .maybeSingle();
    if (existing?.status === "successful") {
      return json({ success: true, alreadyProcessed: true }, 200, corsHeaders);
    }

    // 5. Activate / renew the subscription — extend remaining time if active, else start fresh.
    const { data: currentSub } = await admin
      .from("subscriptions")
      .select("current_period_end, status")
      .eq("business_id", businessId)
      .maybeSingle();
    const now = new Date();
    let periodEnd: Date;
    if (
      currentSub?.status === "active" &&
      currentSub.current_period_end &&
      new Date(currentSub.current_period_end) > now
    ) {
      // Extend from the current period end (prorate remaining time)
      periodEnd = new Date(currentSub.current_period_end);
      periodEnd.setDate(periodEnd.getDate() + 30);
    } else {
      // No active period — start 30 days from now
      periodEnd = new Date(now);
      periodEnd.setDate(periodEnd.getDate() + 30);
    }

    const { data: sub } = await admin
      .from("subscriptions")
      .upsert(
        {
          business_id: businessId,
          plan_id: plan.id,
          status: "active",
          current_period_start: now.toISOString(),
          current_period_end: periodEnd.toISOString(),
          flutterwave_customer_email: tx.customer?.email ?? null,
        },
        { onConflict: "business_id" },
      )
      .select()
      .single();

    // 6. Record the payment (insert or update if the webhook beat us to it).
    if (existing) {
      await admin
        .from("subscription_payments")
        .update({
          status: "successful",
          flw_transaction_id: String(transaction_id),
          paid_at: now.toISOString(),
        })
        .eq("id", existing.id);
    } else {
      await admin.from("subscription_payments").insert({
        subscription_id: sub?.id,
        business_id: businessId,
        plan_id: plan.id,
        amount: tx.amount,
        currency: tx.currency,
        flw_tx_ref: tx_ref,
        flw_transaction_id: String(transaction_id),
        status: "successful",
        paid_at: now.toISOString(),
      });
    }

    return json(
      {
        success: true,
        plan: plan.code,
        current_period_end: periodEnd.toISOString(),
      },
      200,
      corsHeaders,
    );
  } catch (err) {
    console.error(err);
    return json(
      { success: false, error: "Internal error during payment verification" },
      500,
      corsHeaders,
    );
  }
});

function json(
  body: unknown,
  status = 200,
  corsHeaders: Record<string, string> = {},
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

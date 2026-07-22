// =====================================================================
// SUPABASE EDGE FUNCTION — flutterwave-webhook
//
// This is the durable source of truth for subscription payments — unlike
// the inline verify call (uganda-pos-fn-verify-flutterwave-payment.ts),
// Flutterwave calls this directly from their servers, so it still fires
// even if the customer closes their browser right after paying.
//
// DEPLOY:
//   1. mkdir -p supabase/functions/flutterwave-webhook
//   2. Save this file as supabase/functions/flutterwave-webhook/index.ts
//   3. supabase secrets set FLW_SECRET_KEY=FLWSECK-xxxxxxxx FLW_WEBHOOK_HASH=some-long-random-string
//   4. supabase functions deploy flutterwave-webhook --no-verify-jwt
//      (--no-verify-jwt is required: Flutterwave calls this with no Supabase JWT)
//   5. In the Flutterwave Dashboard → Settings → Webhooks:
//      - URL: https://<your-project-ref>.functions.supabase.co/flutterwave-webhook
//      - Secret hash: the same random string you set as FLW_WEBHOOK_HASH above
// =====================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const FLW_SECRET_KEY = Deno.env.get('FLW_SECRET_KEY')!;
const FLW_WEBHOOK_HASH = Deno.env.get('FLW_WEBHOOK_HASH')!;

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

Deno.serve(async (req) => {
  // 1. Verify this call really came from Flutterwave.
  const signature = req.headers.get('verif-hash');
  if (!signature || signature !== FLW_WEBHOOK_HASH) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const payload = await req.json();
    if (payload.event !== 'charge.completed' || payload.data?.status !== 'successful') {
      return new Response('ignored', { status: 200 }); // ack non-payment events so Flutterwave stops retrying
    }

    const { id: transactionId, tx_ref: txRef } = payload.data;

    // 2. Never trust the webhook body alone — re-verify with Flutterwave directly.
    const flwRes = await fetch(`https://api.flutterwave.com/v3/transactions/${transactionId}/verify`, {
      headers: { Authorization: `Bearer ${FLW_SECRET_KEY}` },
    });
    const flwData = await flwRes.json();
    const tx = flwData?.data;
    if (!tx || tx.status !== 'successful' || tx.tx_ref !== txRef || tx.currency !== 'UGX') {
      return new Response('verification failed', { status: 200 }); // ack anyway — nothing to retry
    }

    // 3. tx_ref format: SUB_<businessId>_<planCode>_<timestamp>
    const parts = String(txRef).split('_');
    const businessId = parts[1];
    const planCode = parts[2];

    const { data: plan } = await admin.from('plans').select('*').eq('code', planCode).single();
    if (!plan || Number(tx.amount) < Number(plan.price_ugx) - 1) {
      return new Response('plan/amount mismatch', { status: 200 });
    }

    // 4. Idempotency — the inline verify call may have already processed this tx_ref.
    const { data: existing } = await admin.from('subscription_payments').select('id, status').eq('flw_tx_ref', txRef).maybeSingle();
    if (existing?.status === 'successful') return new Response('already processed', { status: 200 });

    const periodEnd = new Date();
    periodEnd.setDate(periodEnd.getDate() + 30);

    const { data: sub } = await admin.from('subscriptions').upsert({
      business_id: businessId,
      plan_id: plan.id,
      status: 'active',
      current_period_start: new Date().toISOString(),
      current_period_end: periodEnd.toISOString(),
      flutterwave_customer_email: tx.customer?.email ?? null,
    }, { onConflict: 'business_id' }).select().single();

    if (existing) {
      await admin.from('subscription_payments').update({
        status: 'successful', flw_transaction_id: String(transactionId), paid_at: new Date().toISOString(), raw_response: flwData,
      }).eq('id', existing.id);
    } else {
      await admin.from('subscription_payments').insert({
        subscription_id: sub?.id, business_id: businessId, plan_id: plan.id,
        amount: tx.amount, currency: tx.currency, flw_tx_ref: txRef, flw_transaction_id: String(transactionId),
        status: 'successful', paid_at: new Date().toISOString(), raw_response: flwData,
      });
    }

    return new Response('ok', { status: 200 });
  } catch (err) {
    console.error(err);
    return new Response('error', { status: 200 }); // still ack so Flutterwave doesn't hammer retries; check function logs
  }
});

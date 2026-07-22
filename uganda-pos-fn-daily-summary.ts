// =====================================================================
// SUPABASE EDGE FUNCTION — daily-summary
//
// Sends yesterday's sales summary via SMS (Africa's Talking) to every
// business that has turned this on in Settings → Notifications. Meant to
// run once a day on a schedule (pg_cron), not to be called by end users.
//
// DEPLOY:
//   mkdir -p supabase/functions/daily-summary
//   cp uganda-pos-fn-daily-summary.ts supabase/functions/daily-summary/index.ts
//   supabase functions deploy daily-summary --no-verify-jwt
//   supabase secrets set AT_USERNAME=your_africastalking_username AT_API_KEY=your_africastalking_api_key CRON_SECRET=some-long-random-string
//
// Get AT_USERNAME / AT_API_KEY from https://account.africastalking.com
// (use "sandbox" as the username while testing with their simulator).
//
// SCHEDULE — run once in the Supabase SQL editor (needs the pg_cron and
// pg_net extensions, enabled under Database → Extensions):
//
//   select cron.schedule(
//     'uganda-pos-daily-summary',
//     '0 5 * * *',  -- 05:00 UTC = 08:00 Kampala time (EAT, UTC+3)
//     $$
//     select net.http_post(
//       url := 'https://YOUR-PROJECT-REF.supabase.co/functions/v1/daily-summary',
//       headers := jsonb_build_object(
//         'Content-Type', 'application/json',
//         'x-cron-secret', 'SAME-VALUE-AS-THE-CRON_SECRET-SECRET-ABOVE'
//       ),
//       body := '{}'::jsonb
//     );
//     $$
//   );
//
// This function is deployed with --no-verify-jwt because pg_cron calls it
// server-to-server with no user session — the x-cron-secret header is what
// stops randoms from triggering it if they find the URL.
//
// SWAPPING IN WHATSAPP: Twilio's WhatsApp API
// (https://www.twilio.com/docs/whatsapp/api) or Africa's Talking's own
// WhatsApp product both work the same way — POST the composed message to
// their endpoint with your account credentials. Replace the `sendSms()`
// call in the loop below with your own `sendWhatsapp()` for businesses
// where daily_summary_channel = 'whatsapp'; buildMessage() doesn't need
// to change either way.
// =====================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const AT_USERNAME = Deno.env.get('AT_USERNAME') ?? '';
const AT_API_KEY = Deno.env.get('AT_API_KEY') ?? '';
const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? '';

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  if (CRON_SECRET && req.headers.get('x-cron-secret') !== CRON_SECRET) {
    return json({ success: false, error: 'Unauthorized' }, 401);
  }

  try {
    const { data: businesses } = await admin.from('businesses').select('*').eq('daily_summary_enabled', true);
    const results: unknown[] = [];

    for (const business of businesses || []) {
      if (!business.daily_summary_phone) continue;

      const summary = await buildSummary(business.id, business.base_currency || 'UGX');
      const message = buildMessage(business.name, summary);

      const sendResult = business.daily_summary_channel === 'whatsapp'
        ? { success: false, note: 'WhatsApp channel selected but not wired up yet — see the comment block at the top of this file for how to add Twilio/Africa\'s Talking WhatsApp.' }
        : await sendSms(business.daily_summary_phone, message);

      results.push({ business: business.name, phone: business.daily_summary_phone, channel: business.daily_summary_channel, ...sendResult });
    }

    return json({ success: true, processed: results.length, results });
  } catch (err) {
    console.error(err);
    return json({ success: false, error: String(err) }, 500);
  }
});

async function buildSummary(businessId: string, baseCurrency: string) {
  const now = new Date();
  const yStart = new Date(now); yStart.setDate(yStart.getDate() - 1); yStart.setHours(0, 0, 0, 0);
  const yEnd = new Date(now); yEnd.setDate(yEnd.getDate() - 1); yEnd.setHours(23, 59, 59, 999);

  const { data: sales } = await admin.from('sales').select('*, sale_items(*)')
    .eq('business_id', businessId).neq('sale_type', 'quotation').neq('status', 'voided')
    .gte('created_at', yStart.toISOString()).lte('created_at', yEnd.toISOString());

  const rows = sales || [];
  const totalSales = rows.reduce((a, s) => a + Number(s.grand_total_base || 0), 0);
  const txnCount = rows.length;

  const productTally: Record<string, number> = {};
  rows.forEach((s) => (s.sale_items || []).forEach((it: any) => {
    productTally[it.product_name] = (productTally[it.product_name] || 0) + Number(it.quantity || 0);
  }));
  const topProduct = Object.entries(productTally).sort((a, b) => b[1] - a[1])[0];

  const { data: products } = await admin.from('products').select('id, reorder_level').eq('business_id', businessId).eq('is_active', true);
  const productIds = (products || []).map((p: any) => p.id);
  const { data: stock } = productIds.length
    ? await admin.from('product_stock').select('product_id, quantity').in('product_id', productIds)
    : { data: [] };
  const stockByProduct: Record<string, number> = {};
  (stock || []).forEach((s: any) => { stockByProduct[s.product_id] = (stockByProduct[s.product_id] || 0) + Number(s.quantity || 0); });
  const lowStockCount = (products || []).filter((p: any) => (stockByProduct[p.id] || 0) <= Number(p.reorder_level || 0)).length;

  return { totalSales, txnCount, topProduct, lowStockCount, baseCurrency, date: yStart.toISOString().slice(0, 10) };
}

function buildMessage(businessName: string, s: { totalSales: number; txnCount: number; topProduct?: [string, number]; lowStockCount: number; baseCurrency: string; date: string }) {
  const money = (n: number) => `${s.baseCurrency} ${Math.round(n).toLocaleString('en-UG')}`;
  const lines = [
    `${businessName} — ${s.date} summary`,
    `Sales: ${money(s.totalSales)} (${s.txnCount} txns)`,
  ];
  if (s.topProduct) lines.push(`Top seller: ${s.topProduct[0]} (${s.topProduct[1]})`);
  if (s.lowStockCount > 0) lines.push(`⚠ ${s.lowStockCount} product(s) low on stock`);
  lines.push('— Qwickpos');
  return lines.join('\n');
}

async function sendSms(phone: string, message: string) {
  if (!AT_USERNAME || !AT_API_KEY) {
    return { success: false, note: "Africa's Talking credentials not configured (AT_USERNAME / AT_API_KEY secrets)." };
  }
  const body = new URLSearchParams({ username: AT_USERNAME, to: phone, message });
  const res = await fetch('https://api.africastalking.com/version1/messaging', {
    method: 'POST',
    headers: {
      apiKey: AT_API_KEY,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
  });
  const data = await res.json().catch(() => null);
  const recipient = data?.SMSMessageData?.Recipients?.[0];
  const ok = recipient?.status === 'Success';
  return { success: ok, providerStatus: recipient?.status || 'Unknown', cost: recipient?.cost, raw: ok ? undefined : data };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

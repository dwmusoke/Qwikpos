// =====================================================================
// SUPABASE EDGE FUNCTION — efris-submit-invoice
//
// Fiscalises a staged invoice with URA EFRIS via the EFRIS Simplified
// middleware (https://efrissimplified.com/docs/fiscal-invoices). Called
// from the "Submit" button on the EFRIS tab once a business has enabled
// live mode and saved an API key in Settings.
//
// DEPLOY:
//   mkdir -p supabase/functions/efris-submit-invoice
//   cp uganda-pos-fn-efris-submit-invoice.ts supabase/functions/efris-submit-invoice/index.ts
//   supabase functions deploy efris-submit-invoice
//
// This file intentionally duplicates the small registration helper from
// uganda-pos-fn-efris-register-product.ts (rather than importing across
// function folders) so each function stays a simple, independent copy-paste
// deploy — auto-registers any product on the sale that hasn't been sent
// to EFRIS yet before fiscalising the invoice itself.
// =====================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { efrisInvoiceId } = await req.json();
    if (!efrisInvoiceId) return json({ success: false, error: 'efrisInvoiceId is required' }, 400);

    // 1. Identify the calling business from their JWT.
    const authHeader = req.headers.get('Authorization') ?? '';
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ success: false, error: 'Not authenticated' }, 401);

    const { data: appUser } = await admin.from('app_users').select('business_id').eq('id', userData.user.id).single();
    if (!appUser?.business_id) return json({ success: false, error: 'No business linked to this login' }, 400);
    const businessId = appUser.business_id;

    // 2. Load the invoice — the service-role client bypasses RLS, so we
    // MUST manually verify this invoice actually belongs to the caller's
    // business before doing anything with it.
    const { data: invoice } = await admin.from('efris_invoices').select('*').eq('id', efrisInvoiceId).single();
    if (!invoice || invoice.business_id !== businessId) {
      return json({ success: false, error: 'Invoice not found' }, 404);
    }
    if (invoice.status === 'accepted') {
      return json({ success: true, alreadyProcessed: true });
    }

    const { data: business } = await admin.from('businesses').select('*').eq('id', businessId).single();
    if (!business?.tin) return json({ success: false, error: 'Business TIN is not set — add it in Settings first.' }, 400);
    if (!business.efris_live_enabled) return json({ success: false, error: 'Live EFRIS is not enabled for this business.' }, 400);

    const { data: creds } = await admin.from('efris_provider_credentials').select('*').eq('business_id', businessId).eq('is_active', true).maybeSingle();
    if (!creds?.api_key) return json({ success: false, error: 'No EFRIS provider API key configured — add one in Settings.' }, 400);

    const providerBase = creds.provider === 'weaf' ? 'https://api.weafmall.com' : 'https://efrissimplified.com/api/efris';

    // 3. Auto-register any product on this sale that hasn't been sent to EFRIS yet.
    const { data: saleItems } = await admin.from('sale_items').select('product_id').eq('sale_id', invoice.sale_id);
    const productIds = [...new Set((saleItems || []).map((i) => i.product_id).filter(Boolean))];
    if (productIds.length) {
      const { data: products } = await admin.from('products').select('*').in('id', productIds);
      for (const product of products || []) {
        if (product.efris_registered_at) continue;
        if (!product.efris_commodity_category_id) {
          return json({
            success: false,
            error: `"${product.name}" is missing an EFRIS Commodity Category ID — set one in Inventory, then retry.`,
          }, 400);
        }
        const regPayload = {
          goods: [{
            operationType: '101',
            goodsName: product.name,
            goodsCode: product.sku || product.barcode || product.id,
            measureUnit: product.efris_measure_unit || '101',
            unitPrice: String(product.selling_price ?? 0),
            currency: '101',
            commodityCategoryId: product.efris_commodity_category_id,
            haveExciseTax: '102',
            havePieceUnit: '102',
            haveCustomsUnit: '102',
            stockPrewarning: String(product.reorder_level ?? 0),
          }],
        };
        const regRes = await fetch(`${providerBase}/${business.tin}/register-good-or-service`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${creds.api_key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(regPayload),
        });
        const regData = await regRes.json();
        if (regData?.response !== 'OK') {
          return json({ success: false, error: `Could not register "${product.name}" with EFRIS: ${regData?.message || 'unknown error'}` }, 400);
        }
        await admin.from('products').update({ efris_registered_at: new Date().toISOString() }).eq('id', product.id);
      }
    }

    // 4. Fiscalise the invoice — payload_json was already built in the exact
    // shape this endpoint expects by buildEfrisPayload() (uganda-pos-core.js).
    await admin.from('efris_invoices').update({ status: 'queued' }).eq('id', efrisInvoiceId);
    await admin.from('efris_queue').update({ status: 'processing' }).eq('efris_invoice_id', efrisInvoiceId);

    const invRes = await fetch(`${providerBase}/${business.tin}/generate-fiscal-invoice`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${creds.api_key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(invoice.payload_json),
    });
    const invData = await invRes.json();

    if (invData?.response !== 'OK') {
      const errorMessage = invData?.message || 'EFRIS rejected the invoice';
      await admin.from('efris_invoices').update({
        status: 'rejected', error_message: errorMessage, response_json: invData, submitted_at: new Date().toISOString(),
      }).eq('id', efrisInvoiceId);
      await admin.from('efris_queue').update({ status: 'failed', last_error: errorMessage }).eq('efris_invoice_id', efrisInvoiceId);
      return json({ success: false, error: errorMessage }, 400);
    }

    const basic = invData.data?.basicInformation || {};
    const summary = invData.data?.summary || {};
    await admin.from('efris_invoices').update({
      status: 'accepted',
      fiscal_invoice_number: basic.invoiceNo || invoice.fiscal_invoice_number,
      antifake_code: basic.antifakeCode || null,
      qr_code: summary.qrCode || null,
      ura_invoice_id: basic.invoiceId || null,
      response_json: invData,
      error_message: null,
      submitted_at: new Date().toISOString(),
    }).eq('id', efrisInvoiceId);
    await admin.from('efris_queue').update({ status: 'done' }).eq('efris_invoice_id', efrisInvoiceId);

    return json({ success: true, invoiceNo: basic.invoiceNo, antifakeCode: basic.antifakeCode, qrCode: summary.qrCode });
  } catch (err) {
    console.error(err);
    return json({ success: false, error: String(err) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

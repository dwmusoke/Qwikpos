// =====================================================================
// SUPABASE EDGE FUNCTION — efris-register-product
//
// Registers a single product with URA EFRIS (via the EFRIS Simplified
// middleware — https://efrissimplified.com/docs/good-registration)
// before it can appear on a fiscal invoice. Called automatically by
// efris-submit-invoice.ts for any unregistered product on a sale, or
// directly from Inventory's "Register with EFRIS" button.
//
// DEPLOY:
//   mkdir -p supabase/functions/efris-register-product
//   cp uganda-pos-fn-efris-register-product.ts supabase/functions/efris-register-product/index.ts
//   supabase functions deploy efris-register-product
//
// No extra secrets needed beyond the auto-provided SUPABASE_* ones — the
// EFRIS API key is stored per-business in the `efris_provider_credentials`
// table (never in an edge function secret, since every vendor has their
// own EFRIS account/TIN).
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
    const { productId } = await req.json();
    if (!productId) return json({ success: false, error: 'productId is required' }, 400);

    const authHeader = req.headers.get('Authorization') ?? '';
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ success: false, error: 'Not authenticated' }, 401);

    const { data: appUser } = await admin.from('app_users').select('business_id').eq('id', userData.user.id).single();
    if (!appUser?.business_id) return json({ success: false, error: 'No business linked to this login' }, 400);

    const result = await registerProduct(admin, appUser.business_id, productId);
    return json(result, result.success ? 200 : 400);
  } catch (err) {
    console.error(err);
    return json({ success: false, error: String(err) }, 500);
  }
});

// Exported as a plain function (not just the HTTP handler) so
// efris-submit-invoice.ts can copy/reuse this same logic inline.
export async function registerProduct(admin: ReturnType<typeof createClient>, businessId: string, productId: string) {
  const { data: business } = await admin.from('businesses').select('*').eq('id', businessId).single();
  if (!business?.tin) return { success: false, error: 'Business TIN is not set — add it in Settings first.' };
  if (!business.efris_live_enabled) return { success: false, error: 'Live EFRIS is not enabled for this business yet.' };

  const { data: creds } = await admin.from('efris_provider_credentials').select('*').eq('business_id', businessId).eq('is_active', true).maybeSingle();
  if (!creds?.api_key) return { success: false, error: 'No EFRIS provider API key configured — add one in Settings.' };

  const { data: product } = await admin.from('products').select('*').eq('id', productId).eq('business_id', businessId).single();
  if (!product) return { success: false, error: 'Product not found' };
  if (!product.efris_commodity_category_id) {
    return { success: false, error: `"${product.name}" is missing an EFRIS Commodity Category ID — set one in Inventory before registering.` };
  }

  const goodsCode = product.sku || product.barcode || product.id;
  const payload = {
    goods: [{
      operationType: product.efris_registered_at ? '102' : '101',
      goodsName: product.name,
      goodsCode,
      measureUnit: product.efris_measure_unit || '101',
      unitPrice: String(product.selling_price ?? 0),
      currency: '101', // UGX in EFRIS's currencyType dictionary
      commodityCategoryId: product.efris_commodity_category_id,
      haveExciseTax: '102',
      havePieceUnit: '102',
      haveCustomsUnit: '102',
      stockPrewarning: String(product.reorder_level ?? 0),
    }],
  };

  const providerBase = creds.provider === 'weaf' ? 'https://api.weafmall.com' : 'https://efrissimplified.com/api/efris';
  const res = await fetch(`${providerBase}/${business.tin}/register-good-or-service`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${creds.api_key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();

  if (data?.response !== 'OK') {
    return { success: false, error: data?.message || 'EFRIS rejected the goods registration', raw: data };
  }

  await admin.from('products').update({ efris_registered_at: new Date().toISOString() }).eq('id', productId);
  return { success: true, goodsCode };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

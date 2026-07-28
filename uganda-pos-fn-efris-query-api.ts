// =====================================================================
// SUPABASE EDGE FUNCTION — efris-query-api
//
// High-level REST API for EFRIS query operations.
// Mirrors WEAF EFRIS query endpoints (search-taxpayer, excise-duty,
// registration-details, measure-units, goods-and-services,
// sync-products, invoice-receipt-query, invoice-details).
//
// Delegates heavy S2S crypto to the existing efris-s2s function.
//
// DEPLOY:
//   mkdir -p supabase/functions/efris-query-api
//   cp uganda-pos-fn-efris-query-api.ts supabase/functions/efris-query-api/index.ts
//   supabase functions deploy efris-query-api
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

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Call the efris-s2s edge function internally using service-role auth
async function callS2s(action: string, payload?: any, credentialId?: string) {
  const s2sUrl = `${SUPABASE_URL}/functions/v1/efris-s2s`;
  const resp = await fetch(s2sUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({
      action,
      credential_id: credentialId,
      payload: payload || {},
    }),
  });
  return resp.json();
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });

  try {
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

    const { data: appUser } = await admin
      .from("app_users")
      .select("business_id, role")
      .eq("id", userData.user.id)
      .single();
    if (!appUser?.business_id)
      return json(
        { success: false, error: "No business linked to this login" },
        400,
        corsHeaders,
      );

    const businessId = appUser.business_id;

    const body = await req.json().catch(() => ({}));
    const { action, credential_id } = body;
    if (!action)
      return json(
        { success: false, error: "action is required" },
        400,
        corsHeaders,
      );

    // Load business + optional credential
    const { data: business } = await admin
      .from("businesses")
      .select("*")
      .eq("id", businessId)
      .single();

    let credId = credential_id;
    if (!credId) {
      const { data: cred } = await admin
        .from("efris_credentials")
        .select("id")
        .eq("business_id", businessId)
        .eq("status", "active")
        .limit(1)
        .maybeSingle();
      if (cred) credId = cred.id;
    }

    let result: any;

    switch (action) {
      // ---------------------------------------------------------------
      // SEARCH TAXPAYER — query taxpayer info by TIN (T119)
      // Body: { action: "search_taxpayer", tin: "..." }
      // ---------------------------------------------------------------
      case "search_taxpayer": {
        const { tin } = body;
        if (!tin)
          return json(
            { success: false, error: "tin is required" },
            400,
            corsHeaders,
          );

        if (credId) {
          const s2sResp = await callS2s("raw", {
            interfaceCode: "T119",
            content: { tin },
            encrypt: false,
          }, credId);
          result = {
            success: s2sResp.success,
            data: s2sResp.raw?.data?.content || s2sResp,
          };
        } else {
          // No S2S credentials — return error
          result = {
            success: false,
            error:
              "EFRIS S2S credentials required for taxpayer search. Configure them in Settings first.",
          };
        }
        break;
      }

      // ---------------------------------------------------------------
      // EXCISE DUTY — retrieve excise duty information (T115 dictionary)
      // Body: { action: "excise_duty", ... }
      // ---------------------------------------------------------------
      case "excise_duty": {
        if (credId) {
          // Query T115 for excise duty related codes
          const s2sResp = await callS2s("system_dictionary", {
            dictionaryType: "excise_duty",
          }, credId);
          result = {
            success: s2sResp.success,
            data: s2sResp.data || s2sResp,
          };
        } else {
          // Return available tax categories from local DB as fallback
          const { data: taxCategories } = await admin
            .from("tax_categories")
            .select("*")
            .eq("business_id", businessId)
            .eq("is_active", true);
          result = {
            success: true,
            data: (taxCategories || []).map((t: any) => ({
              id: t.id,
              name: t.name,
              rate: t.default_rate,
              type: t.type || "VAT",
            })),
            source: "local",
          };
        }
        break;
      }

      // ---------------------------------------------------------------
      // REGISTRATION DETAILS — get business EFRIS registration info
      // Body: { action: "registration_details" }
      // ---------------------------------------------------------------
      case "registration_details": {
        const { data: creds } = await admin
          .from("efris_credentials")
          .select("*")
          .eq("business_id", businessId)
          .eq("status", "active")
          .maybeSingle();

        const { data: providerCreds } = await admin
          .from("efris_provider_credentials")
          .select("*")
          .eq("business_id", businessId)
          .eq("is_active", true)
          .maybeSingle();

        result = {
          success: true,
          data: {
            business_name: business?.name || "",
            tin: business?.tin || "",
            efris_live_enabled: !!business?.efris_live_enabled,
            efris_mode: creds?.efris_mode || "sandbox",
            device_number: creds?.device_number || "",
            brn: creds?.brn || "",
            provider: providerCreds?.provider || null,
            provider_configured: !!providerCreds?.api_key,
            direct_s2s_configured: !!creds,
            registration_date: creds?.created_at || null,
            last_used_at: creds?.last_used_at || null,
          },
        };
        break;
      }

      // ---------------------------------------------------------------
      // MEASURE UNITS — get available measure units (T115 dictionary or local)
      // Body: { action: "measure_units" }
      // ---------------------------------------------------------------
      case "measure_units": {
        if (credId) {
          const s2sResp = await callS2s("system_dictionary", {
            dictionaryType: "measure_unit",
          }, credId);
          result = {
            success: s2sResp.success,
            data: s2sResp.data || s2sResp,
            source: "efris",
          };
        } else {
          // Fallback: return local units of measure
          const { data: units } = await admin
            .from("units")
            .select("*")
            .eq("business_id", businessId);
          result = {
            success: true,
            data: (units || []).map((u: any) => ({
              code: u.code || u.id,
              name: u.name,
              description: u.description || "",
            })),
            source: "local",
          };
        }
        break;
      }

      // ---------------------------------------------------------------
      // GOODS AND SERVICES — get company products from EFRIS (T127)
      // Body: { action: "goods_and_services" }
      // ---------------------------------------------------------------
      case "goods_and_services": {
        if (credId) {
          const s2sResp = await callS2s("raw", {
            interfaceCode: "T127",
            content: body.payload || {},
            encrypt: true,
          }, credId);
          result = {
            success: s2sResp.success,
            data: s2sResp.raw?.data?.content || s2sResp,
            source: "efris",
          };
        } else {
          // Return local products
          const { data: products } = await admin
            .from("products")
            .select(
              "id, name, sku, barcode, selling_price, cost_price, efris_registered_at, efris_commodity_category_id, efris_measure_unit",
            )
            .eq("business_id", businessId);
          result = {
            success: true,
            data: (products || []).map((p: any) => ({
              id: p.id,
              name: p.name,
              goodsCode: p.sku || p.barcode || p.id,
              unitPrice: Number(p.selling_price || 0),
              costPrice: Number(p.cost_price || 0),
              commodityCategoryId: p.efris_commodity_category_id || "",
              measureUnit: p.efris_measure_unit || "101",
              registeredWithEfris: !!p.efris_registered_at,
              efrisRegisteredAt: p.efris_registered_at,
            })),
            source: "local",
          };
        }
        break;
      }

      // ---------------------------------------------------------------
      // SYNC PRODUCTS — fetch products from EFRIS and upsert into local DB
      // Body: { action: "sync_products" }
      // ---------------------------------------------------------------
      case "sync_products": {
        if (!credId)
          return json(
            {
              success: false,
              error:
                "EFRIS S2S credentials required. Configure them in Settings first.",
            },
            400,
            corsHeaders,
          );

        const s2sResp = await callS2s("raw", {
          interfaceCode: "T127",
          content: body.payload || {},
          encrypt: true,
        }, credId);

        if (!s2sResp.success) {
          result = { success: false, error: "Failed to fetch from EFRIS" };
          break;
        }

        const efrisGoods = s2sResp.raw?.data?.content?.goodsList ||
          s2sResp.raw?.data?.content || [];
        const synced: any[] = [];
        const errors: any[] = [];

        if (Array.isArray(efrisGoods)) {
          for (const good of efrisGoods) {
            const goodsCode = good.goodsCode || good.goods_code || "";
            if (!goodsCode) continue;

            // Find matching local product by SKU or barcode
            const { data: existing } = await admin
              .from("products")
              .select("id")
              .eq("business_id", businessId)
              .or(`sku.eq.${goodsCode},barcode.eq.${goodsCode}`)
              .maybeSingle();

            if (existing) {
              // Update EFRIS registration status
              await admin
                .from("products")
                .update({
                  efris_registered_at:
                    good.registrationDate || new Date().toISOString(),
                  efris_commodity_category_id:
                    good.commodityCategoryId ||
                    good.commodity_category_id ||
                    undefined,
                  efris_measure_unit:
                    good.measureUnit || good.measure_unit || undefined,
                })
                .eq("id", existing.id);
              synced.push({
                product_id: existing.id,
                goodsCode,
                status: "updated",
              });
            } else {
              errors.push({
                goodsCode,
                status: "skipped",
                reason: "No matching local product found by SKU or barcode",
              });
            }
          }
        }

        result = {
          success: true,
          data: {
            synced_count: synced.length,
            error_count: errors.length,
            synced,
            errors,
          },
        };
        break;
      }

      // ---------------------------------------------------------------
      // QUERY INVOICES — query invoice receipts from EFRIS (T106)
      // Body: { action: "query_invoices", payload: { ... } }
      // ---------------------------------------------------------------
      case "query_invoices": {
        if (!credId)
          return json(
            {
              success: false,
              error:
                "EFRIS S2S credentials required. Configure them in Settings first.",
            },
            400,
            corsHeaders,
          );

        const queryPayload = {
          ...(body.payload || {}),
        };

        const s2sResp = await callS2s("query_invoices", queryPayload, credId);
        result = {
          success: s2sResp.success,
          data: s2sResp.data || s2sResp,
        };
        break;
      }

      // ---------------------------------------------------------------
      // INVOICE DETAILS — get invoice details from EFRIS (T108)
      // Body: { action: "invoice_details", invoiceNo: "..." }
      // ---------------------------------------------------------------
      case "invoice_details": {
        const { invoiceNo } = body;
        if (!invoiceNo)
          return json(
            { success: false, error: "invoiceNo is required" },
            400,
            corsHeaders,
          );

        if (credId) {
          const s2sResp = await callS2s("invoice_details", { invoiceNo }, credId);
          result = {
            success: s2sResp.success,
            data: s2sResp.data || s2sResp,
          };
        } else {
          // Fallback: look up in our local efris_invoices table
          const { data: localInvoice } = await admin
            .from("efris_invoices")
            .select("*")
            .eq("business_id", businessId)
            .eq("fiscal_invoice_number", invoiceNo)
            .maybeSingle();

          if (localInvoice) {
            result = {
              success: true,
              data: localInvoice,
              source: "local",
            };
          } else {
            result = {
              success: false,
              error: "Invoice not found locally and no S2S credentials configured",
            };
          }
        }
        break;
      }

      default:
        return json(
          {
            success: false,
            error: `Unknown action: ${action}. Supported: search_taxpayer, excise_duty, registration_details, measure_units, goods_and_services, sync_products, query_invoices, invoice_details`,
          },
          400,
          corsHeaders,
        );
    }

    return json(result, 200, corsHeaders);
  } catch (err) {
    console.error("efris-query-api error:", err);
    return json(
      { success: false, error: "Internal error" },
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

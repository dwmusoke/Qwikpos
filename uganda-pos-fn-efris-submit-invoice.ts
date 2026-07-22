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

// Validate that the EFRIS payload has the required structure
function validateEfrisPayload(payload: any): {
  valid: boolean;
  error?: string;
} {
  if (!payload || typeof payload !== "object")
    return { valid: false, error: "Payload must be a JSON object" };
  const inv = payload.invoice;
  if (!inv || typeof inv !== "object")
    return { valid: false, error: "Missing invoice object" };

  // Required seller details
  if (!inv.sellerDetails?.tin)
    return { valid: false, error: "Missing sellerDetails.tin" };
  if (!inv.sellerDetails?.legalName)
    return { valid: false, error: "Missing sellerDetails.legalName" };

  // Required basic information
  if (!inv.basicInformation)
    return { valid: false, error: "Missing basicInformation" };
  if (!inv.basicInformation.deviceNo)
    return { valid: false, error: "Missing basicInformation.deviceNo" };
  if (!inv.basicInformation.currency)
    return { valid: false, error: "Missing basicInformation.currency" };

  // Required goods details
  if (!Array.isArray(inv.goodsDetails) || inv.goodsDetails.length === 0) {
    return { valid: false, error: "goodsDetails must be a non-empty array" };
  }
  for (let i = 0; i < inv.goodsDetails.length; i++) {
    const item = inv.goodsDetails[i];
    if (!item.item)
      return { valid: false, error: `goodsDetails[${i}].item is required` };
    if (!item.qty || Number(item.qty) <= 0)
      return { valid: false, error: `goodsDetails[${i}].qty must be > 0` };
    if (!item.unitPrice || Number(item.unitPrice) <= 0)
      return {
        valid: false,
        error: `goodsDetails[${i}].unitPrice must be > 0`,
      };
  }

  // Required tax details
  if (!Array.isArray(inv.taxDetails))
    return { valid: false, error: "Missing taxDetails array" };

  // Required summary
  if (!inv.summary) return { valid: false, error: "Missing summary" };
  if (!inv.summary.grossAmount || Number(inv.summary.grossAmount) <= 0) {
    return { valid: false, error: "summary.grossAmount must be > 0" };
  }

  return { valid: true };
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });

  try {
    const { efrisInvoiceId } = await req.json();
    if (!efrisInvoiceId)
      return json(
        { success: false, error: "efrisInvoiceId is required" },
        400,
        corsHeaders,
      );

    // 1. Identify the calling business from their JWT.
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
    // Only admin/manager can submit EFRIS invoices
    if (!["admin", "manager"].includes(appUser.role) && !appUser.business_id) {
      return json(
        { success: false, error: "Insufficient permissions" },
        403,
        corsHeaders,
      );
    }
    const businessId = appUser.business_id;

    // 2. Load the invoice — the service-role client bypasses RLS, so we
    // MUST manually verify this invoice actually belongs to the caller's
    // business before doing anything with it.
    const { data: invoice } = await admin
      .from("efris_invoices")
      .select("*")
      .eq("id", efrisInvoiceId)
      .single();
    if (!invoice || invoice.business_id !== businessId) {
      return json(
        { success: false, error: "Invoice not found" },
        404,
        corsHeaders,
      );
    }
    if (invoice.status === "accepted") {
      return json({ success: true, alreadyProcessed: true }, 200, corsHeaders);
    }

    const { data: business } = await admin
      .from("businesses")
      .select("*")
      .eq("id", businessId)
      .single();
    if (!business?.tin)
      return json(
        {
          success: false,
          error: "Business TIN is not set — add it in Settings first.",
        },
        400,
        corsHeaders,
      );
    if (!business.efris_live_enabled)
      return json(
        {
          success: false,
          error: "Live EFRIS is not enabled for this business.",
        },
        400,
        corsHeaders,
      );

    const { data: creds } = await admin
      .from("efris_provider_credentials")
      .select("*")
      .eq("business_id", businessId)
      .eq("is_active", true)
      .maybeSingle();
    if (!creds?.api_key)
      return json(
        {
          success: false,
          error: "No EFRIS provider API key configured — add one in Settings.",
        },
        400,
        corsHeaders,
      );

    const providerBase =
      creds.provider === "weaf"
        ? "https://api.weafmall.com"
        : "https://efrissimplified.com/api/efris";

    // 3. Auto-register any product on this sale that hasn't been sent to EFRIS yet.
    const { data: saleItems } = await admin
      .from("sale_items")
      .select("product_id")
      .eq("sale_id", invoice.sale_id);
    const productIds = [
      ...new Set((saleItems || []).map((i) => i.product_id).filter(Boolean)),
    ];
    if (productIds.length) {
      const { data: products } = await admin
        .from("products")
        .select("*")
        .in("id", productIds);
      for (const product of products || []) {
        if (product.efris_registered_at) continue;
        if (!product.efris_commodity_category_id) {
          return json(
            {
              success: false,
              error: `"${product.name}" is missing an EFRIS Commodity Category ID — set one in Inventory, then retry.`,
            },
            400,
            corsHeaders,
          );
        }
        const regPayload = {
          goods: [
            {
              operationType: "101",
              goodsName: product.name,
              goodsCode:
                product.sku ||
                product.barcode ||
                `PROD-${product.id.slice(0, 8)}`,
              measureUnit: product.efris_measure_unit || "101",
              unitPrice: String(product.selling_price ?? 0),
              currency: "101",
              commodityCategoryId: product.efris_commodity_category_id,
              haveExciseTax: "102",
              havePieceUnit: "102",
              haveCustomsUnit: "102",
              stockPrewarning: String(product.reorder_level ?? 0),
            },
          ],
        };
        const regRes = await fetch(
          `${providerBase}/${business.tin}/register-good-or-service`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${creds.api_key}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(regPayload),
          },
        );
        const regData = await regRes.json();
        if (regData?.response !== "OK") {
          return json(
            {
              success: false,
              error: `Could not register "${product.name}" with EFRIS: ${regData?.message || "unknown error"}`,
            },
            400,
            corsHeaders,
          );
        }
        await admin
          .from("products")
          .update({ efris_registered_at: new Date().toISOString() })
          .eq("id", product.id);
      }
    }

    // 4. Validate the EFRIS payload structure server-side before submission
    const validation = validateEfrisPayload(invoice.payload_json);
    if (!validation.valid) {
      return json(
        { success: false, error: `Invalid EFRIS payload: ${validation.error}` },
        400,
        corsHeaders,
      );
    }

    // 5. Fiscalise the invoice
    await admin
      .from("efris_invoices")
      .update({ status: "queued" })
      .eq("id", efrisInvoiceId);
    await admin
      .from("efris_queue")
      .update({ status: "processing" })
      .eq("efris_invoice_id", efrisInvoiceId);

    const invRes = await fetch(
      `${providerBase}/${business.tin}/generate-fiscal-invoice`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${creds.api_key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(invoice.payload_json),
      },
    );
    const invData = await invRes.json();

    if (invData?.response !== "OK") {
      const errorMessage = invData?.message || "EFRIS rejected the invoice";
      await admin
        .from("efris_invoices")
        .update({
          status: "rejected",
          error_message: errorMessage,
          response_json: invData,
          submitted_at: new Date().toISOString(),
        })
        .eq("id", efrisInvoiceId);
      await admin
        .from("efris_queue")
        .update({ status: "failed", last_error: errorMessage })
        .eq("efris_invoice_id", efrisInvoiceId);
      return json({ success: false, error: errorMessage }, 400, corsHeaders);
    }

    const basic = invData.data?.basicInformation || {};
    const summary = invData.data?.summary || {};
    await admin
      .from("efris_invoices")
      .update({
        status: "accepted",
        fiscal_invoice_number: basic.invoiceNo || invoice.fiscal_invoice_number,
        antifake_code: basic.antifakeCode || null,
        qr_code: summary.qrCode || null,
        ura_invoice_id: basic.invoiceId || null,
        response_json: invData,
        error_message: null,
        submitted_at: new Date().toISOString(),
      })
      .eq("id", efrisInvoiceId);
    await admin
      .from("efris_queue")
      .update({ status: "done" })
      .eq("efris_invoice_id", efrisInvoiceId);

    return json(
      {
        success: true,
        invoiceNo: basic.invoiceNo,
        antifakeCode: basic.antifakeCode,
        qrCode: summary.qrCode,
      },
      200,
      corsHeaders,
    );
  } catch (err) {
    console.error(err);
    return json(
      { success: false, error: "Internal error during EFRIS submission" },
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

// =====================================================================
// SUPABASE EDGE FUNCTION — efris-sandbox-api
//
// Standalone mock EFRIS Simplified API for third-party POS/ERP/accounting
// vendors to test their URA EFRIS integration without a real account.
//
// Mirrors the EFRIS Simplified middleware interface exactly:
//   POST /{TIN}/register-good-or-service
//   POST /{TIN}/generate-fiscal-invoice
//   GET  /{TIN}/invoices
//   GET  /{TIN}/invoices/{id}
//
// Auth: Authorization: Bearer <sandbox_api_key>
//
// DEPLOY:
//   mkdir -p supabase/functions/efris-sandbox-api
//   cp uganda-pos-fn-efris-sandbox-api.ts supabase/functions/efris-sandbox-api/index.ts
//   supabase functions deploy efris-sandbox-api --no-verify-jwt
// =====================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ALLOWED_ORIGINS = [
  Deno.env.get("APP_ORIGIN") || "",
  Deno.env.get("APP_ORIGIN_2") || "",
  "https://sandbox.qwickpos.ug",
].filter(Boolean);
const MAX_BODY_BYTES = 1024 * 1024; // 1MB max request body
const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// SHA-256 hash a string (used to hash API keys before DB lookup)
async function hashKey(key: string): Promise<string> {
  const data = new TextEncoder().encode(key);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------------
// Validation helpers (mirrors efris-submit-invoice.ts)
// ---------------------------------------------------------------------
function validateInvoicePayload(payload: any): { valid: boolean; error?: string } {
  if (!payload || typeof payload !== "object") return { valid: false, error: "Payload must be a JSON object" };
  const inv = payload.invoice;
  if (!inv || typeof inv !== "object") return { valid: false, error: "Missing invoice object" };

  if (!inv.sellerDetails?.tin) return { valid: false, error: "Missing sellerDetails.tin" };
  if (!inv.sellerDetails?.legalName) return { valid: false, error: "Missing sellerDetails.legalName" };
  if (!inv.basicInformation) return { valid: false, error: "Missing basicInformation" };
  if (!inv.basicInformation.deviceNo) return { valid: false, error: "Missing basicInformation.deviceNo" };
  if (!inv.basicInformation.currency) return { valid: false, error: "Missing basicInformation.currency" };

  if (!Array.isArray(inv.goodsDetails) || inv.goodsDetails.length === 0) {
    return { valid: false, error: "goodsDetails must be a non-empty array" };
  }
  for (let i = 0; i < inv.goodsDetails.length; i++) {
    const item = inv.goodsDetails[i];
    if (!item.item) return { valid: false, error: `goodsDetails[${i}].item is required` };
    if (!item.qty || Number(item.qty) <= 0) return { valid: false, error: `goodsDetails[${i}].qty must be > 0` };
    if (!item.unitPrice || Number(item.unitPrice) <= 0) return { valid: false, error: `goodsDetails[${i}].unitPrice must be > 0` };
  }

  if (!Array.isArray(inv.taxDetails)) return { valid: false, error: "Missing taxDetails array" };
  if (!inv.summary) return { valid: false, error: "Missing summary" };
  if (!inv.summary.grossAmount || Number(inv.summary.grossAmount) <= 0) {
    return { valid: false, error: "summary.grossAmount must be > 0" };
  }

  return { valid: true };
}

function validateGoodsPayload(payload: any): { valid: boolean; error?: string } {
  if (!payload || typeof payload !== "object") return { valid: false, error: "Payload must be a JSON object" };
  if (!Array.isArray(payload.goods) || payload.goods.length === 0) {
    return { valid: false, error: "goods must be a non-empty array" };
  }
  for (let i = 0; i < payload.goods.length; i++) {
    const g = payload.goods[i];
    if (!g.goodsName) return { valid: false, error: `goods[${i}].goodsName is required` };
    if (!g.goodsCode) return { valid: false, error: `goods[${i}].goodsCode is required` };
    if (!g.commodityCategoryId) return { valid: false, error: `goods[${i}].commodityCategoryId is required` };
  }
  return { valid: true };
}

// ---------------------------------------------------------------------
// Response builders
// ---------------------------------------------------------------------
function generateFiscalNumber(): string {
  const seq = Math.floor(Math.random() * 999999) + 1;
  return `SFDN-${String(seq).padStart(6, "0")}`;
}

function generateAntiFakeCode(): string {
  return "SAF" + Math.random().toString(36).slice(2, 14).toUpperCase();
}

function generateInvoiceId(): string {
  return crypto.randomUUID();
}

function generateQrCode(invoiceNo: string, tin: string, amount: number): string {
  const data = `URA\n${invoiceNo}\n${tin}\n${amount.toFixed(2)}`;
  return `data:text/plain;base64,${btoa(data)}`;
}

// ---------------------------------------------------------------------
// Tier limits
// ---------------------------------------------------------------------
const TIER_LIMITS: Record<string, { rateLimit: number; dailyLimit: number }> = {
  free: { rateLimit: 100, dailyLimit: 100 },
  starter: { rateLimit: 500, dailyLimit: 5000 },
  pro: { rateLimit: 2000, dailyLimit: 50000 },
};

// ---------------------------------------------------------------------
// Rate limiting check
// ---------------------------------------------------------------------
async function checkRateLimit(apiKeyId: string, tier: string): Promise<{ allowed: boolean; error?: string }> {
  const limits = TIER_LIMITS[tier] || TIER_LIMITS.free;
  const oneHourAgo = new Date(Date.now() - 3600000).toISOString();

  const { count } = await admin
    .from("sandbox_usage")
    .select("id", { count: "exact", head: true })
    .eq("api_key_id", apiKeyId)
    .gte("created_at", oneHourAgo)
    .neq("status", "rate_limited");

  if ((count || 0) >= limits.rateLimit) {
    return { allowed: false, error: `Rate limit exceeded (${limits.rateLimit} req/hr). Upgrade your tier for higher limits.` };
  }

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const { count: dailyCount } = await admin
    .from("sandbox_usage")
    .select("id", { count: "exact", head: true })
    .eq("api_key_id", apiKeyId)
    .eq("endpoint", "generate-invoice")
    .gte("created_at", todayStart.toISOString())
    .eq("status", "accepted");

  if ((dailyCount || 0) >= limits.dailyLimit) {
    return { allowed: false, error: `Daily invoice limit reached (${limits.dailyLimit}/day). Upgrade your tier for more.` };
  }

  return { allowed: true };
}

// ---------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------
Deno.serve(async (req) => {
  const origin = req.headers.get("origin") || "";
  const allowedOrigin = ALLOWED_ORIGINS.length
    ? ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]
    : "*";
  const corsHeaders = {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  };

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Enforce request body size limit
  const contentLength = parseInt(req.headers.get("content-length") || "0");
  if (req.method === "POST" && contentLength > MAX_BODY_BYTES) {
    return json({ response: "ERROR", message: "Request body too large (max 1MB)" }, 413, corsHeaders);
  }

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/efris-sandbox/, "");

  // Auth: extract Bearer token
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return json({ response: "ERROR", message: "Missing Authorization header. Use: Authorization: Bearer <api_key>" }, 401, corsHeaders);
  }

  // Hash the key and look up by hash (never store/compare plaintext)
  const keyHash = await hashKey(token);
  const { data: apiKey } = await admin
    .from("sandbox_api_keys")
    .select("*")
    .eq("api_key_hash", keyHash)
    .eq("is_active", true)
    .maybeSingle();

  if (!apiKey) {
    return json({ response: "ERROR", message: "Invalid or inactive API key" }, 401, corsHeaders);
  }

  // Update last_used_at
  await admin.from("sandbox_api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", apiKey.id);

  // Check rate limit
  const rl = await checkRateLimit(apiKey.id, apiKey.tier);
  if (!rl.allowed) {
    await admin.from("sandbox_usage").insert({ api_key_id: apiKey.id, endpoint: "rate_check", tin: null, status: "rate_limited" });
    return json({ response: "ERROR", message: rl.error }, 429, corsHeaders);
  }

  // Route matching
  // POST /{TIN}/register-good-or-service
  const registerMatch = path.match(/^\/([A-Z0-9]+)\/register-good-or-service$/);
  if (registerMatch && req.method === "POST") {
    const tin = registerMatch[1];
    const start = Date.now();
    try {
      const payload = await req.json();
      const validation = validateGoodsPayload(payload);
      if (!validation.valid) {
        await admin.from("sandbox_usage").insert({ api_key_id: apiKey.id, endpoint: "register-good", tin, status: "rejected" });
        return json({ response: "ERROR", message: validation.error }, 400, corsHeaders);
      }

      // Simulate ~5% rejection for realism
      const rejected = Math.random() < 0.05;
      if (rejected) {
        const msg = "Simulated rejection: product already registered or invalid commodity category";
        await admin.from("sandbox_usage").insert({ api_key_id: apiKey.id, endpoint: "register-good", tin, status: "rejected", response_time_ms: Date.now() - start });
        return json({ response: "ERROR", message: msg }, 200, corsHeaders);
      }

      await admin.from("sandbox_usage").insert({ api_key_id: apiKey.id, endpoint: "register-good", tin, status: "accepted", response_time_ms: Date.now() - start });
      return json({ response: "OK", message: "Product registered successfully" }, 200, corsHeaders);
    } catch (e) {
      await admin.from("sandbox_usage").insert({ api_key_id: apiKey.id, endpoint: "register-good", tin, status: "error", response_time_ms: Date.now() - start });
      return json({ response: "ERROR", message: "Invalid JSON payload" }, 400, corsHeaders);
    }
  }

  // POST /{TIN}/generate-fiscal-invoice
  const invoiceMatch = path.match(/^\/([A-Z0-9]+)\/generate-fiscal-invoice$/);
  if (invoiceMatch && req.method === "POST") {
    const tin = invoiceMatch[1];
    const start = Date.now();
    try {
      const payload = await req.json();
      const validation = validateInvoicePayload(payload);
      if (!validation.valid) {
        await admin.from("sandbox_usage").insert({ api_key_id: apiKey.id, endpoint: "generate-invoice", tin, status: "rejected" });
        return json({ response: "ERROR", message: validation.error }, 400, corsHeaders);
      }

      const grossAmount = Number(payload.invoice.summary.grossAmount);
      const taxAmount = Number(payload.invoice.summary.taxAmount || 0);
      const invoiceNo = generateFiscalNumber();
      const antifakeCode = generateAntiFakeCode();
      const invoiceId = generateInvoiceId();
      const qrCode = generateQrCode(invoiceNo, tin, grossAmount);

      // Simulate ~5% rejection
      const rejected = Math.random() < 0.05;
      if (rejected) {
        const msg = "Simulated rejection: verify buyer TIN and retry";
        await admin.from("sandbox_invoices").insert({
          api_key_id: apiKey.id, business_id: apiKey.business_id, tin,
          fiscal_invoice_number: invoiceNo, invoice_type: payload.invoice.basicInformation?.invoiceType || "1",
          status: "rejected", gross_amount: grossAmount, vat_amount: taxAmount,
          currency_code: payload.invoice.basicInformation?.currency || "UGX",
          payload_json: payload, response_json: { response: "ERROR", message: msg }, error_message: msg,
        });
        await admin.from("sandbox_usage").insert({ api_key_id: apiKey.id, endpoint: "generate-invoice", tin, status: "rejected", response_time_ms: Date.now() - start });
        return json({ response: "ERROR", message: msg }, 200, corsHeaders);
      }

      const responseData = {
        response: "OK",
        data: {
          basicInformation: { invoiceNo, antifakeCode, invoiceId },
          summary: { qrCode },
        },
      };

      await admin.from("sandbox_invoices").insert({
        api_key_id: apiKey.id, business_id: apiKey.business_id, tin,
        fiscal_invoice_number: invoiceNo, invoice_type: payload.invoice.basicInformation?.invoiceType || "1",
        status: "accepted", gross_amount: grossAmount, vat_amount: taxAmount,
        currency_code: payload.invoice.basicInformation?.currency || "UGX",
        payload_json: payload, response_json: responseData,
      });
      await admin.from("sandbox_usage").insert({ api_key_id: apiKey.id, endpoint: "generate-invoice", tin, status: "accepted", response_time_ms: Date.now() - start });

      return json(responseData, 200, corsHeaders);
    } catch (e) {
      await admin.from("sandbox_usage").insert({ api_key_id: apiKey.id, endpoint: "generate-invoice", tin, status: "error", response_time_ms: Date.now() - start });
      return json({ response: "ERROR", message: "Invalid JSON payload" }, 400, corsHeaders);
    }
  }

  // GET /{TIN}/invoices
  const listMatch = path.match(/^\/([A-Z0-9]+)\/invoices$/);
  if (listMatch && req.method === "GET") {
    const tin = listMatch[1];
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "50"), 200);
    const offset = parseInt(url.searchParams.get("offset") || "0");
    const status = url.searchParams.get("status");

    let query = admin
      .from("sandbox_invoices")
      .select("id, tin, fiscal_invoice_number, invoice_type, status, gross_amount, vat_amount, currency_code, created_at", { count: "exact" })
      .eq("api_key_id", apiKey.id)
      .eq("tin", tin)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (status) query = query.eq("status", status);

    const { data, count } = await query;
    await admin.from("sandbox_usage").insert({ api_key_id: apiKey.id, endpoint: "list-invoices", tin, status: "accepted" });

    return json({ invoices: data || [], total: count || 0, limit, offset }, 200, corsHeaders);
  }

  // GET /{TIN}/invoices/{id}
  const detailMatch = path.match(/^\/([A-Z0-9]+)\/invoices\/([a-f0-9-]+)$/);
  if (detailMatch && req.method === "GET") {
    const tin = detailMatch[1];
    const invoiceId = detailMatch[2];

    const { data: invoice } = await admin
      .from("sandbox_invoices")
      .select("*")
      .eq("api_key_id", apiKey.id)
      .eq("tin", tin)
      .eq("id", invoiceId)
      .maybeSingle();

    if (!invoice) {
      return json({ response: "ERROR", message: "Invoice not found" }, 404, corsHeaders);
    }

    await admin.from("sandbox_usage").insert({ api_key_id: apiKey.id, endpoint: "get-invoice", tin, status: "accepted" });
    return json(invoice, 200, corsHeaders);
  }

  // GET / (root) — API status / health check
  if (path === "" || path === "/") {
    return json({
      service: "EFRIS Sandbox API",
      version: "1.0.0",
      status: "operational",
      tier: apiKey.tier,
      endpoints: [
        `POST /{TIN}/register-good-or-service`,
        `POST /{TIN}/generate-fiscal-invoice`,
        `GET  /{TIN}/invoices`,
        `GET  /{TIN}/invoices/{id}`,
      ],
    }, 200, corsHeaders);
  }

  return json({ response: "ERROR", message: `Unknown endpoint: ${req.method} ${path}` }, 404, corsHeaders);
});

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

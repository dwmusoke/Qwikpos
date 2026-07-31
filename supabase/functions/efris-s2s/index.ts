// =====================================================================
// SUPABASE EDGE FUNCTION — efris-s2s
//
// Direct System-to-System integration with URA EFRIS.
// Handles RSA/AES encryption, digital signatures, and all URA
// interface codes (T101–T187).
//
// Flow:
//   1. Vendor calls with action + payload
//   2. Function loads credentials from efris_credentials
//   3. Fetches/caches AES key via T104 (RSA-decrypted)
//   4. Encrypts payload (AES-ECB + PKCS7)
//   5. Signs (RSA-SHA1)
//   6. Sends to URA
//   7. Decrypts response
//   8. Returns result
// =====================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { KEYUTIL } from "https://esm.sh/jsrsasign@10.9.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const URA_SANDBOX = "https://efristest.ura.go.ug/efrisws/ws/taapp/getInformation";
const URA_PROD = "https://efrisws.ura.go.ug/ws/taapp/getInformation";

// -------------------------------------------------------------------
// CORS
// -------------------------------------------------------------------
const ALLOWED_ORIGINS = [
  Deno.env.get("APP_ORIGIN") || "",
  Deno.env.get("APP_ORIGIN_2") || "",
].filter(Boolean);

function corsHeaders(req?: Request): Record<string, string> {
  const origin = req?.headers?.get("origin") || "";
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0] || "*";
  return { "Access-Control-Allow-Origin": allowed, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json" } });
}

// ====================================================================
// CRYPTO: AES-ECB + PKCS7 + RSA-SHA1 (URA EFRIS protocol)
// ====================================================================

const AES_BLOCK = 16;

function pkcs7Pad(data: Uint8Array): Uint8Array {
  const padLen = AES_BLOCK - (data.length % AES_BLOCK);
  const padded = new Uint8Array(data.length + padLen);
  padded.set(data);
  for (let i = data.length; i < padded.length; i++) padded[i] = padLen;
  return padded;
}

function pkcs7Unpad(data: Uint8Array): Uint8Array {
  if (data.length === 0) throw new Error("Cannot unpad empty data");
  const padLen = data[data.length - 1];
  if (padLen < 1 || padLen > AES_BLOCK) throw new Error(`Invalid PKCS7 padding: ${padLen}`);
  return data.slice(0, data.length - padLen);
}

function normalizeAesKey(key: string): Uint8Array {
  if (/^[0-9a-fA-F]+$/.test(key) && key.length % 2 === 0) {
    const decoded = hexToBytes(key);
    if ([16, 24, 32].includes(decoded.length)) return decoded;
  }
  return new TextEncoder().encode(key);
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** AES-ECB encrypt with PKCS7 padding — returns Base64 */
async function aesEncrypt(plaintext: string, keyHex: string): Promise<string> {
  const keyBytes = normalizeAesKey(keyHex);
  const dataBytes = new TextEncoder().encode(plaintext);
  const padded = pkcs7Pad(dataBytes);

  const cryptoKey = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-ECB" }, false, ["encrypt"]);
  const encrypted = await crypto.subtle.encrypt({ name: "AES-ECB" }, cryptoKey, padded);
  return btoa(String.fromCharCode(...new Uint8Array(encrypted)));
}

/** AES-ECB decrypt with PKCS7 unpadding — returns plaintext */
async function aesDecrypt(ciphertextB64: string, keyHex: string): Promise<string> {
  const keyBytes = normalizeAesKey(keyHex);
  const encryptedBytes = Uint8Array.from(atob(ciphertextB64), (c) => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-ECB" }, false, ["decrypt"]);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-ECB" }, cryptoKey, encryptedBytes);
  return new TextDecoder().decode(pkcs7Unpad(new Uint8Array(decrypted)));
}

/** Import a PEM private key and return a CryptoKey for signing */
async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const pemBody = pem.replace(/-----BEGIN (RSA )?PRIVATE KEY-----/, "").replace(/-----END (RSA )?PRIVATE KEY-----/, "").replace(/\s/g, "");
  const der = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey("pkcs8", der, { name: "RSA-SHA1", hash: "SHA-1" }, false, ["sign"]);
}

/**
 * RSA/ECB/PKCS1Padding decrypt — the URA EFRIS spec. URA encrypts the T104
 * AES key with our RSA public key using PKCS#1 v1.5 padding. Web Crypto's
 * RSA-OAEP cannot read that, so use jsrsasign's classic RSA decrypt.
 */
async function rsaDecryptPKCS1(ciphertext: Uint8Array, privateKeyPem: string): Promise<Uint8Array> {
  const key = KEYUTIL.getKey(privateKeyPem);
  const plainBin = key.decrypt(bytesToHex(ciphertext));
  if (plainBin == null) throw new Error("PKCS#1 v1.5 padding check failed (wrong key or padding)");
  return Uint8Array.from(plainBin, (c) => c.charCodeAt(0));
}

/** RSA-OAEP decrypt — fallback for any flow that used OAEP instead of PKCS#1 v1.5 */
async function rsaDecryptOAEP(ciphertext: Uint8Array, privateKeyPem: string): Promise<Uint8Array> {
  const key = KEYUTIL.getKey(privateKeyPem);
  const plainBin = key.decryptOAEP(bytesToHex(ciphertext), "sha1");
  if (plainBin == null) throw new Error("RSA-OAEP decrypt failed (wrong key or padding)");
  return Uint8Array.from(plainBin, (c) => c.charCodeAt(0));
}

/** RSA-SHA1 sign — returns Base64 signature */
async function rsaSign(data: string, privateKeyPem: string): Promise<string> {
  const key = await importPrivateKey(privateKeyPem);
  const sig = await crypto.subtle.sign("RSA-SHA1", key, new TextEncoder().encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

/** RSA decrypt (for T104 AES key extraction) — PKCS#1 v1.5 first, OAEP fallback */
async function rsaDecrypt(ciphertext: Uint8Array, privateKeyPem: string): Promise<Uint8Array> {
  try {
    return await rsaDecryptPKCS1(ciphertext, privateKeyPem);
  } catch (e: any) {
    console.warn("PKCS#1 v1.5 decrypt failed, trying RSA-OAEP:", e?.message || e);
    return await rsaDecryptOAEP(ciphertext, privateKeyPem);
  }
}

// ====================================================================
// URA ENVELOPE BUILDERS
// ====================================================================

function ugandaTimestamp(): string {
  return new Date().toLocaleString("sv-SE", { timeZone: "Africa/Kampala" }).replace("T", " ");
}

function buildGlobalInfo(interfaceCode: string, tin: string, deviceNo: string, brn = "", taxpayerId = "1") {
  return {
    appId: "AP04",
    version: "1.1.20191201",
    dataExchangeId: crypto.randomUUID().replace(/-/g, "").toUpperCase(),
    interfaceCode,
    requestCode: "TP",
    requestTime: ugandaTimestamp(),
    responseCode: "TA",
    userName: "admin",
    deviceMAC: "FFFFFFFFFFFF",
    deviceNo,
    tin,
    brn,
    taxpayerID: taxpayerId,
    longitude: "32.5825",
    latitude: "0.3476",
    agentType: "0",
    extendField: {
      responseDateFormat: "dd/MM/yyyy",
      responseTimeFormat: "dd/MM/yyyy HH:mm:ss",
      referenceNo: "",
      operatorName: "admin",
      offlineInvoiceException: { errorCode: "", errorMsg: "" },
    },
  };
}

async function buildEncryptedRequest(content: any, aesKey: string, interfaceCode: string, tin: string, deviceNo: string, brn: string, privateKeyPem: string, taxpayerId = "1") {
  const jsonStr = JSON.stringify(content);
  const encrypted = await aesEncrypt(jsonStr, aesKey);
  const signature = await rsaSign(encrypted, privateKeyPem);

  return {
    data: { content: encrypted, signature, dataDescription: { codeType: "1", encryptCode: "2", zipCode: "0" } },
    globalInfo: buildGlobalInfo(interfaceCode, tin, deviceNo, brn, taxpayerId),
    returnStateInfo: { returnCode: "", returnMessage: "" },
  };
}

function buildUnencryptedRequest(content: any, interfaceCode: string, tin: string, deviceNo: string, brn: string, privateKeyPem: string, taxpayerId = "1") {
  let contentB64 = "";
  let signature = "";

  if (content && (typeof content === "object" ? Object.keys(content).length > 0 : true)) {
    contentB64 = btoa(JSON.stringify(content));
    // Signature will be added asynchronously if needed
  }

  return {
    data: { content: contentB64, signature, dataDescription: { codeType: "0", encryptCode: "1", zipCode: "0" } },
    globalInfo: buildGlobalInfo(interfaceCode, tin, deviceNo, brn, taxpayerId),
    returnStateInfo: { returnCode: "", returnMessage: "" },
  };
}

async function buildSignedUnencryptedRequest(content: any, interfaceCode: string, tin: string, deviceNo: string, brn: string, privateKeyPem: string, taxpayerId = "1") {
  const contentB64 = content && (typeof content === "object" ? Object.keys(content).length > 0 : true) ? btoa(JSON.stringify(content)) : "";
  const signature = contentB64 ? await rsaSign(contentB64, privateKeyPem) : "";

  return {
    data: { content: contentB64, signature, dataDescription: { codeType: "0", encryptCode: "1", zipCode: "0" } },
    globalInfo: buildGlobalInfo(interfaceCode, tin, deviceNo, brn, taxpayerId),
    returnStateInfo: { returnCode: "", returnMessage: "" },
  };
}

async function unwrapResponse(respJson: any, aesKeyHex?: string): Promise<any> {
  const dataSection = respJson.data || {};
  const contentB64 = dataSection.content || "";
  if (!contentB64) return respJson;

  const dataDesc = dataSection.dataDescription || {};
  const codeType = dataDesc.codeType || "0";
  const encryptCode = dataDesc.encryptCode || "0";

  try {
    let contentStr: string;
    if (codeType === "1") {
      if (!aesKeyHex) throw new Error("Encrypted response but no AES key");
      contentStr = await aesDecrypt(contentB64, aesKeyHex);
    } else {
      contentStr = atob(contentB64);
    }
    respJson.data.content = JSON.parse(contentStr);
  } catch (e: any) {
    console.error("Response unwrap failed:", e.message);
  }
  return respJson;
}

// ====================================================================
// AES KEY MANAGEMENT (T104)
// ====================================================================

async function fetchAesKey(cred: any): Promise<string> {
  // Check for cached, non-expired AES key
  const { data: session } = await admin
    .from("efris_sessions")
    .select("aes_key_hex")
    .eq("credential_id", cred.id)
    .eq("is_active", true)
    .gt("expires_at", new Date().toISOString())
    .order("fetched_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (session?.aes_key_hex) return session.aes_key_hex;

  // T104: fetch fresh AES key from URA
  const endpoint = cred.efris_mode === "live" ? URA_PROD : URA_SANDBOX;
  const request = await buildSignedUnencryptedRequest(
    [], "T104", cred.tin, cred.device_number || "", cred.brn || "",
    cred.private_key_pem
  );

  const resp = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  const respJson = await resp.json();

  const returnMsg = respJson.returnStateInfo?.returnMessage || "";
  if (returnMsg !== "SUCCESS") {
    const msg = respJson.returnStateInfo?.returnMessage || "T104 failed";
    throw new Error(`T104 failed: ${msg}`);
  }

  // Extract AES key: base64-decode content → parse JSON → get RSA-encrypted AES key
  const contentB64 = respJson.data?.content || "";
  const contentJson = JSON.parse(atob(contentB64));
  const encryptedAesB64 = contentJson.passowrdDes || contentJson.passwordDes;
  if (!encryptedAesB64) throw new Error("Missing AES key in T104 response");

  // RSA-decrypt the AES key using our private key
  const encryptedAesBytes = Uint8Array.from(atob(encryptedAesB64), (c) => c.charCodeAt(0));
  const aesKeyRaw = await rsaDecrypt(encryptedAesBytes, cred.private_key_pem);

  // The raw RSA-decrypted value is a Base64-encoded AES key
  let aesKeyBytes: Uint8Array;
  try {
    const decoded = Uint8Array.from(atob(new TextDecoder().decode(aesKeyRaw)), (c) => c.charCodeAt(0));
    aesKeyBytes = decoded.length > 0 ? decoded : aesKeyRaw;
  } catch {
    aesKeyBytes = aesKeyRaw;
  }

  // Normalize to 16-byte AES-128
  let aesKey: Uint8Array;
  if (aesKeyBytes.length === 8) {
    aesKey = new Uint8Array(16);
    aesKey.set(aesKeyBytes);
    aesKey.set(aesKeyBytes, 8);
  } else if ([16, 24, 32].includes(aesKeyBytes.length)) {
    aesKey = aesKeyBytes;
  } else {
    aesKey = aesKeyBytes.slice(0, 16);
  }

  const aesKeyHex = bytesToHex(aesKey);

  // Cache the key (23hr TTL)
  const expiresAt = new Date(Date.now() + 23 * 60 * 60 * 1000).toISOString();
  await admin.from("efris_sessions").insert({
    credential_id: cred.id,
    aes_key_hex: aesKeyHex,
    expires_at: expiresAt,
  });

  return aesKeyHex;
}

// ====================================================================
// SEND TO URA
// ====================================================================

async function sendToUra(cred: any, interfaceCode: string, content: any, encrypt = true): Promise<any> {
  const endpoint = cred.efris_mode === "live" ? URA_PROD : URA_SANDBOX;
  let request: any;

  if (encrypt) {
    const aesKey = await fetchAesKey(cred);
    request = await buildEncryptedRequest(
      content, aesKey, interfaceCode, cred.tin, cred.device_number || "",
      cred.brn || "", cred.private_key_pem
    );
  } else {
    request = await buildSignedUnencryptedRequest(
      content, interfaceCode, cred.tin, cred.device_number || "",
      cred.brn || "", cred.private_key_pem
    );
  }

  const resp = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });

  if (!resp.ok) {
    throw new Error(`URA HTTP ${resp.status}: ${await resp.text()}`);
  }

  const respJson = await resp.json();

  // Decrypt response if it's encrypted
  const codeType = respJson.data?.dataDescription?.codeType;
  if (codeType === "1" && encrypt) {
    const aesKey = await fetchAesKey(cred);
    return unwrapResponse(respJson, aesKey);
  }
  return unwrapResponse(respJson);
}

// ====================================================================
// PAYLOAD TRANSFORMATION: EFRIS Simplified → URA Direct T109
// ====================================================================

/** Convert a middleware-format invoice payload to the direct URA T109 shape */
function transformToUraFormat(src: any, biz: any, cred: any): any {
  if (!src) throw new Error("Empty invoice payload");

  const goodsDetails = (src.goodsDetails || []).map((g: any, idx: number) => ({
    goodsName: g.item || g.goodsName || "",
    goodsCode: g.itemCode || g.goodsCode || "",
    qty: String(g.qty || "1"),
    unitPrice: String(g.unitPrice || "0"),
    goodsCategoryId: g.goodsCategoryId || g.commodityCategoryId || "",
    taxRate: g.taxRate || "0.18",
    taxAmount: g.tax || g.taxAmount || "0",
    discountFlag: g.discountFlag || "2",
    measurementUnit: g.unitOfMeasure || g.measurementUnit || "101",
    orderNumber: g.orderNumber || String(idx),
    exciseFlag: g.exciseFlag || "2",
    deemedFlag: g.deemedFlag || "2",
    barCode: "",
  }));

  const taxDetails = (src.taxDetails || []).map((t: any) => ({
    taxCategoryCode: t.taxCategoryCode || "01",
    taxRate: t.taxRate || "0.18",
    grossAmount: String(t.grossAmount || "0"),
    netAmount: String(t.netAmount || "0"),
    taxAmount: String(t.taxAmount || "0"),
  }));

  const summary = src.summary || {};
  const payWay = (src.payWay || []).map((p: any) => ({
    paymentMode: p.paymentMode || "102",
    paymentAmount: String(p.paymentAmount || "0"),
    orderNumber: p.orderNumber || "a",
  }));

  const deviceNo = cred.device_number || biz.efris_device_no || (biz.tin ? `${biz.tin}_01` : "");

  return {
    invoice: {
      sellerDetails: {
        tin: biz.tin || "",
        legalName: biz.name || "",
        businessName: biz.name || "",
        emailAddress: biz.email || "",
        telephoneNo: biz.phone || "",
        referenceNo: src.sellerDetails?.referenceNo || "",
        isCheckReferenceNo: src.sellerDetails?.isCheckReferenceNo || "0",
      },
      basicInformation: {
        invoiceNo: "",
        antifakeCode: "",
        deviceNo,
        issuedDate: src.basicInformation?.issuedDate || new Date().toISOString().slice(0, 19).replace("T", " "),
        operator: src.basicInformation?.operator || "admin",
        currency: src.basicInformation?.currency || "UGX",
        invoiceType: src.basicInformation?.invoiceType || "1",
        invoiceKind: src.basicInformation?.invoiceKind || "1",
        dataSource: src.basicInformation?.dataSource || "103",
      },
      buyerDetails: src.buyerDetails || { buyerType: "1", buyerLegalName: "Walk-in Customer" },
      goodsDetails,
      taxDetails,
      summary: {
        netAmount: String(summary.netAmount || "0"),
        taxAmount: String(summary.taxAmount || "0"),
        grossAmount: String(summary.grossAmount || "0"),
        itemCount: String(summary.itemCount || goodsDetails.length),
        modeCode: summary.modeCode || "1",
        remarks: summary.remarks || "Thank you for your business",
      },
      payWay: payWay.length ? payWay : [{ paymentMode: "102", paymentAmount: summary.grossAmount || "0", orderNumber: "a" }],
    },
  };
}

// ====================================================================
// INTERFACE CODES
// ====================================================================

// Interface code map (T-codes)
const IFACE: Record<string, string> = {
  server_time: "T101", client_init: "T102", sign_in: "T103",
  get_aes_key: "T104", system_dictionary: "T115",
  billing_upload: "T109", batch_upload: "T129",
  invoice_query: "T106", invoice_normal_query: "T107",
  invoice_details: "T108", invoice_reconcile: "T117",
  credit_application: "T110", credit_note_query: "T111",
  credit_note_details: "T112", credit_note_approval: "T113",
  credit_note_cancel: "T114",
  goods_upload: "T130", goods_inquiry: "T127",
  query_stock: "T128", stock_maintain: "T131",
  query_taxpayer: "T119", check_taxpayer_type: "T137",
  get_branches: "T138", exchange_rate: "T121",
};

// ====================================================================
// MAIN HANDLER
// ====================================================================

Deno.serve(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ success: false, error: "Not authenticated" }, 401, cors);

    const { data: appUser } = await admin.from("app_users").select("business_id, role").eq("id", userData.user.id).single();
    if (!appUser?.business_id) return json({ success: false, error: "No business linked" }, 400, cors);

    const body = await req.json();
    const { action, credential_id, payload } = body;
    if (!action) return json({ success: false, error: "action is required" }, 400, cors);

    // Load credential
    let cred;
    if (credential_id) {
      const { data } = await admin.from("efris_credentials").select("*").eq("id", credential_id).single();
      cred = data;
    } else {
      const { data } = await admin.from("efris_credentials").select("*").eq("business_id", appUser.business_id).eq("status", "active").limit(1).maybeSingle();
      cred = data;
    }

    if (!cred) return json({ success: false, error: "No EFRIS credentials found. Set up credentials first." }, 400, cors);
    if (cred.business_id !== appUser.business_id && !["admin", "superadmin"].includes(appUser.role)) {
      return json({ success: false, error: "Credential does not belong to your business" }, 403, cors);
    }

    let result: any;

    switch (action) {
      // ---- T104: Get AES key ----
      case "get_aes_key": {
        const aesKey = await fetchAesKey(cred);
        await admin.from("efris_credentials").update({ last_used_at: new Date().toISOString() }).eq("id", cred.id);
        result = { aes_key_fetched: true, key_length: aesKey.length / 2 * 8 + "-bit" };
        break;
      }

      // ---- T109: Submit invoice (raw payload) ----
      case "submit_invoice": {
        if (!payload) return json({ success: false, error: "payload required" }, 400, cors);
        const resp = await sendToUra(cred, "T109", payload, true);
        const returnMsg = resp.returnStateInfo?.returnMessage || "";
        const returnCode = resp.returnStateInfo?.returnCode || "";
        const content = resp.data?.content;

        if (returnMsg === "SUCCESS" && content) {
          result = { success: true, data: content, returnCode, returnMessage: returnMsg };
        } else {
          result = { success: false, error: returnMsg, returnCode, raw: resp };
        }
        await admin.from("efris_credentials").update({ last_used_at: new Date().toISOString() }).eq("id", cred.id);
        break;
      }

      // ---- High-level: fiscalise an efris_invoices row via direct S2S ----
      // Loads the invoice, auto-registers products via T130, transforms
      // the EFRIS Simplified payload to URA format, submits via T109,
      // and updates efris_invoices + efris_queue.
      case "fiscalise_invoice": {
        const efrisInvoiceId = payload?.efris_invoice_id;
        if (!efrisInvoiceId) return json({ success: false, error: "efris_invoice_id required" }, 400, cors);

        // Load the staged invoice
        const { data: invoice, error: invErr } = await admin
          .from("efris_invoices").select("*").eq("id", efrisInvoiceId).single();
        if (invErr || !invoice) return json({ success: false, error: "Invoice not found" }, 400, cors);
        if (invoice.business_id !== appUser.business_id) return json({ success: false, error: "Invoice belongs to another business" }, 403, cors);
        if (invoice.status === "accepted") return json({ success: true, alreadyProcessed: true }, 200, cors);

        // Load the business
        const { data: biz } = await admin.from("businesses").select("*").eq("id", appUser.business_id).single();
        if (!biz?.tin) return json({ success: false, error: "Business TIN not set" }, 400, cors);

        // Auto-register any unregistered products via T130
        const { data: saleItems } = await admin.from("sale_items").select("product_id").eq("sale_id", invoice.sale_id);
        const productIds = [...new Set((saleItems || []).map((i: any) => i.product_id).filter(Boolean))];
        if (productIds.length) {
          const { data: products } = await admin.from("products").select("*").in("id", productIds);
          for (const product of products || []) {
            if (product.efris_registered_at) continue;
            if (!product.efris_commodity_category_id) {
              return json({ success: false, error: `"${product.name}" is missing an EFRIS Commodity Category ID — set it in Inventory.` }, 400, cors);
            }
            const goodsPayload = [{
              operationType: "101",
              goodsName: product.name,
              goodsCode: product.sku || product.barcode || `PROD-${product.id.slice(0, 8)}`,
              measureUnit: product.efris_measure_unit || "101",
              unitPrice: String(product.selling_price ?? 0),
              currency: "101",
              commodityCategoryId: product.efris_commodity_category_id,
              haveExciseTax: "102",
              havePieceUnit: "102",
              haveCustomsUnit: "102",
              stockPrewarning: String(product.reorder_level ?? 0),
            }];
            const regResp = await sendToUra(cred, "T130", goodsPayload, true);
            const regMsg = regResp.returnStateInfo?.returnMessage || "";
            if (regMsg !== "SUCCESS") {
              return json({ success: false, error: `Could not register "${product.name}" with EFRIS: ${regMsg}` }, 400, cors);
            }
            await admin.from("products").update({ efris_registered_at: new Date().toISOString() }).eq("id", product.id);
          }
        }

        // Transform the EFRIS Simplified payload to direct URA T109 format
        const srcPayload = invoice.payload_json?.invoice || invoice.payload_json;
        const transformedPayload = transformToUraFormat(srcPayload, biz, cred);

        // Mark as queued
        await admin.from("efris_invoices").update({ status: "queued" }).eq("id", efrisInvoiceId);
        await admin.from("efris_queue").update({ status: "processing" }).eq("efris_invoice_id", efrisInvoiceId);

        // Submit via T109
        const resp = await sendToUra(cred, "T109", transformedPayload, true);
        const returnMsg = resp.returnStateInfo?.returnMessage || "";
        const returnCode = resp.returnStateInfo?.returnCode || "";
        const content = resp.data?.content;

        if (returnMsg === "SUCCESS" && content) {
          // Parse the decrypted content for fiscal number etc.
          let fiscalData: any = {};
          try {
            const contentStr = typeof content === "string" ? atob(content) : JSON.stringify(content);
            fiscalData = typeof contentStr === "string" ? JSON.parse(contentStr) : content;
          } catch { fiscalData = content; }

          const invoiceNo = fiscalData.invoiceNo || fiscalData.invoice_no || "";
          const antifakeCode = fiscalData.antifakeCode || fiscalData.antifake_code || "";
          const uraInvoiceId = fiscalData.invoiceId || fiscalData.invoice_id || "";

          await admin.from("efris_invoices").update({
            status: "accepted",
            fiscal_invoice_number: invoiceNo || invoice.fiscal_invoice_number,
            antifake_code: antifakeCode || null,
            ura_invoice_id: uraInvoiceId || null,
            response_json: resp,
            error_message: null,
            submitted_at: new Date().toISOString(),
          }).eq("id", efrisInvoiceId);
          await admin.from("efris_queue").update({ status: "done" }).eq("efris_invoice_id", efrisInvoiceId);

          result = { success: true, invoiceNo, antifakeCode, returnCode };
        } else {
          // Handle retry logic
          const { data: queueEntry } = await admin
            .from("efris_queue").select("retries, max_retries").eq("efris_invoice_id", efrisInvoiceId).single();
          const currentRetries = queueEntry?.retries || 0;
          const maxRetries = queueEntry?.max_retries || 3;

          if (currentRetries < maxRetries) {
            const backoffMs = 30000 * Math.pow(2, currentRetries);
            const nextRetryAt = new Date(Date.now() + backoffMs).toISOString();
            await admin.from("efris_queue").update({
              status: "pending", last_error: returnMsg, retries: currentRetries + 1, next_retry_at: nextRetryAt,
            }).eq("efris_invoice_id", efrisInvoiceId);
            await admin.from("efris_invoices").update({
              status: "queued", error_message: `Retry ${currentRetries + 1}/${maxRetries}: ${returnMsg}`, response_json: resp,
            }).eq("id", efrisInvoiceId);
            result = { success: false, error: returnMsg, retryScheduled: true, nextRetryAt, retriesLeft: maxRetries - currentRetries - 1 };
          } else {
            await admin.from("efris_invoices").update({
              status: "rejected", error_message: returnMsg, response_json: resp, submitted_at: new Date().toISOString(),
            }).eq("id", efrisInvoiceId);
            await admin.from("efris_queue").update({ status: "failed", last_error: returnMsg, retries: currentRetries + 1 }).eq("efris_invoice_id", efrisInvoiceId);
            result = { success: false, error: returnMsg, returnCode };
          }
        }
        await admin.from("efris_credentials").update({ last_used_at: new Date().toISOString() }).eq("id", cred.id);
        break;
      }

      // ---- T130: Upload goods ----
      case "upload_goods": {
        if (!payload) return json({ success: false, error: "payload required" }, 400, cors);
        const resp = await sendToUra(cred, "T130", payload, true);
        const returnMsg = resp.returnStateInfo?.returnMessage || "";
        const content = resp.data?.content;
        result = returnMsg === "SUCCESS"
          ? { success: true, data: content, returnMessage: returnMsg }
          : { success: false, error: returnMsg, raw: resp };
        await admin.from("efris_credentials").update({ last_used_at: new Date().toISOString() }).eq("id", cred.id);
        break;
      }

      // ---- T106: Query invoices ----
      case "query_invoices": {
        const resp = await sendToUra(cred, "T106", payload || {}, true);
        const content = resp.data?.content;
        result = { success: true, data: content, raw: resp };
        break;
      }

      // ---- T108: Invoice details ----
      case "invoice_details": {
        if (!payload?.invoiceNo) return json({ success: false, error: "invoiceNo required" }, 400, cors);
        const resp = await sendToUra(cred, "T108", payload, true);
        const content = resp.data?.content;
        result = { success: true, data: content, raw: resp };
        break;
      }

      // ---- T110: Credit/debit note ----
      case "credit_note": {
        if (!payload) return json({ success: false, error: "payload required" }, 400, cors);
        const resp = await sendToUra(cred, "T110", payload, true);
        const returnMsg = resp.returnStateInfo?.returnMessage || "";
        const content = resp.data?.content;
        result = returnMsg === "SUCCESS"
          ? { success: true, data: content, returnMessage: returnMsg }
          : { success: false, error: returnMsg, raw: resp };
        break;
      }

      // ---- T101: Server time ----
      case "server_time": {
        const resp = await sendToUra(cred, "T101", {}, false);
        result = { success: true, data: resp.data?.content || resp };
        break;
      }

      // ---- T115: System dictionary ----
      case "system_dictionary": {
        const resp = await sendToUra(cred, "T115", payload || {}, false);
        const content = resp.data?.content;
        result = { success: true, data: content };
        break;
      }

      // ---- Raw: send any interface code ----
      case "raw": {
        if (!payload?.interfaceCode || !payload?.content) {
          return json({ success: false, error: "interfaceCode and content required" }, 400, cors);
        }
        const resp = await sendToUra(cred, payload.interfaceCode, payload.content, payload.encrypt !== false);
        result = { success: true, raw: resp };
        break;
      }

      default:
        return json({ success: false, error: `Unknown action: ${action}` }, 400, cors);
    }

    return json(result, 200, cors);
  } catch (err: any) {
    console.error("EFRIS S2S error:", err);
    return json({ success: false, error: err.message || "Internal error" }, 500, cors);
  }
});

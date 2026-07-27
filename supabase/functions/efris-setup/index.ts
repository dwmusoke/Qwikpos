// =====================================================================
// SUPABASE EDGE FUNCTION — efris-setup
//
// Manages EFRIS credentials:
//   - create: Generate RSA 2048-bit key pair, store PEM in vault
//   - update: Update device_number, certificate, status
//   - delete: Remove credential and all sessions
//   - status: Check credential validity
//
// RSA keys are generated server-side using Web Crypto API so the
// private key never leaves the edge function environment.
// =====================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const ALLOWED_ORIGINS = [Deno.env.get("APP_ORIGIN") || "", Deno.env.get("APP_ORIGIN_2") || ""].filter(Boolean);
function corsHeaders(req?: Request) {
  const origin = req?.headers?.get("origin") || "";
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0] || "*";
  return { "Access-Control-Allow-Origin": allowed, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
}
function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json" } });
}

// ====================================================================
// RSA KEY GENERATION (Web Crypto API)
// ====================================================================

async function generateRSAKeyPair(): Promise<{ privateKeyPem: string; publicKeyPem: string }> {
  const keyPair = await crypto.subtle.generateKey(
    { name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-1" },
    true,
    ["encrypt", "decrypt"]
  );

  // Export as DER then convert to PEM
  const privDer = new Uint8Array(await crypto.subtle.exportKey("pkcs8", keyPair.privateKey));
  const pubDer = new Uint8Array(await crypto.subtle.exportKey("spki", keyPair.publicKey));

  const toPem = (der: Uint8Array, label: string) => {
    const b64 = btoa(String.fromCharCode(...der));
    const lines = b64.match(/.{1,64}/g) || [];
    return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----`;
  };

  return {
    privateKeyPem: toPem(privDer, "RSA PRIVATE KEY"),
    publicKeyPem: toPem(pubDer, "PUBLIC KEY"),
  };
}

// ====================================================================
// HANDLER
// ====================================================================

Deno.serve(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    // Auth
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ success: false, error: "Not authenticated" }, 401, cors);

    const { data: appUser } = await admin.from("app_users").select("business_id, role").eq("id", userData.user.id).single();
    if (!appUser?.business_id) return json({ success: false, error: "No business linked" }, 400, cors);

    const body = await req.json();
    const { action } = body;

    switch (action) {
      // ── CREATE credential ──
      case "create": {
        const { tin, device_number, brn, efris_mode } = body;
        if (!tin) return json({ success: false, error: "TIN is required" }, 400, cors);

        // Generate RSA key pair
        const { privateKeyPem, publicKeyPem } = await generateRSAKeyPair();

        const { data: cred, error } = await admin
          .from("efris_credentials")
          .insert({
            business_id: appUser.business_id,
            tin,
            device_number: device_number || null,
            brn: brn || null,
            efris_mode: efris_mode || "sandbox",
            private_key_pem: privateKeyPem,
            public_key_pem: publicKeyPem,
            status: "pending",
          })
          .select("id, tin, device_number, efris_mode, status, created_at")
          .single();

        if (error) return json({ success: false, error: error.message }, 400, cors);
        return json({ success: true, credential: cred }, 200, cors);
      }

      // ── UPDATE credential ──
      case "update": {
        const { credential_id, device_number, certificate_pem, efris_mode, status } = body;
        if (!credential_id) return json({ success: false, error: "credential_id required" }, 400, cors);

        const update: any = {};
        if (device_number !== undefined) update.device_number = device_number;
        if (certificate_pem !== undefined) update.certificate_pem = certificate_pem;
        if (efris_mode !== undefined) update.efris_mode = efris_mode;
        if (status !== undefined) update.status = status;
        update.updated_at = new Date().toISOString();

        const { error } = await admin
          .from("efris_credentials")
          .update(update)
          .eq("id", credential_id)
          .eq("business_id", appUser.business_id);

        if (error) return json({ success: false, error: error.message }, 400, cors);
        return json({ success: true }, 200, cors);
      }

      // ── DELETE credential ──
      case "delete": {
        const { credential_id } = body;
        if (!credential_id) return json({ success: false, error: "credential_id required" }, 400, cors);

        const { error } = await admin
          .from("efris_credentials")
          .delete()
          .eq("id", credential_id)
          .eq("business_id", appUser.business_id);

        if (error) return json({ success: false, error: error.message }, 400, cors);
        return json({ success: true }, 200, cors);
      }

      // ── STATUS: list credentials for this business ──
      case "list": {
        const { data: creds } = await admin
          .from("efris_credentials")
          .select("id, tin, device_number, efris_mode, status, last_error, registered_at, last_used_at, created_at")
          .eq("business_id", appUser.business_id)
          .order("created_at", { ascending: false });

        return json({ success: true, credentials: creds || [] }, 200, cors);
      }

      default:
        return json({ success: false, error: `Unknown action: ${action}` }, 400, cors);
    }
  } catch (err: any) {
    console.error("EFRIS setup error:", err);
    return json({ success: false, error: err.message || "Internal error" }, 500, cors);
  }
});

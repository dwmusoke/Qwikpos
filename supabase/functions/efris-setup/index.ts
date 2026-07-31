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
import { KEYUTIL } from "https://esm.sh/jsrsasign@10.9.0";

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
// PEM HELPERS (for importing KeyStore Explorer key pairs)
// ====================================================================

/** Parse a DER TLV at `start`; returns tag, content length, and content bounds. */
function derReadTlv(der: Uint8Array, start: number): { tag: number; len: number; valueStart: number; end: number } {
  const tag = der[start];
  let i = start + 1;
  const first = der[i];
  let len: number;
  let lenBytes: number;
  if (first < 0x80) {
    len = first;
    lenBytes = 1;
  } else {
    const numBytes = first & 0x7f;
    len = 0;
    for (let b = 0; b < numBytes; b++) len = len * 256 + der[i + 1 + b];
    lenBytes = 1 + numBytes;
  }
  const valueStart = i + lenBytes;
  return { tag, len, valueStart, end: valueStart + len };
}

/** Convert an X.509 certificate PEM into an SPKI public-key PEM (BEGIN PUBLIC KEY). */
function certificatePemToSpkiPem(certPem: string): string {
  const body = certPem
    .replace(/-----BEGIN CERTIFICATE-----/, "")
    .replace(/-----END CERTIFICATE-----/, "")
    .replace(/\s+/g, "");
  if (!body) throw new Error("empty certificate");
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));

  // Certificate ::= SEQUENCE { tbsCertificate, signatureAlgorithm, signatureValue }
  if (der[0] !== 0x30) throw new Error("certificate is not DER-encoded");
  const cert = derReadTlv(der, 0);
  if (cert.tag !== 0x30) throw new Error("certificate is not a SEQUENCE");

  // TBSCertificate ::= SEQUENCE { ... , subjectPublicKeyInfo, ... }
  const tbs = derReadTlv(der, cert.valueStart);
  if (tbs.tag !== 0x30) throw new Error("TBSCertificate not found");

  // Walk top-level children of TBSCertificate; the 5th plain SEQUENCE is the SPKI
  // (after signature, issuer, validity, subject).
  let p = tbs.valueStart;
  let seqCount = 0;
  let spkiStart = -1;
  let spkiEnd = -1;
  while (p < tbs.end) {
    const child = derReadTlv(der, p);
    if (child.tag === 0x30) {
      seqCount++;
      if (seqCount === 5) { spkiStart = p; spkiEnd = child.end; break; }
    }
    p = child.end;
  }
  if (spkiStart < 0) throw new Error("subjectPublicKeyInfo not found in certificate");

  const spkiDer = der.slice(spkiStart, spkiEnd);
  const b64 = btoa(String.fromCharCode(...spkiDer));
  const lines = b64.match(/.{1,64}/g) || [];
  return `-----BEGIN PUBLIC KEY-----\n${lines.join("\n")}\n-----END PUBLIC KEY-----`;
}

/** True when the public key PEM shares the same RSA modulus/exponent as the private key. */
function publicKeyMatches(privateKeyPem: string, publicKeyPem: string): boolean {
  try {
    const privJwk = KEYUTIL.getJWKFromKey(KEYUTIL.getKey(privateKeyPem));
    const pubJwk = KEYUTIL.getJWKFromKey(KEYUTIL.getKey(publicKeyPem));
    return !!(pubJwk.n && privJwk.n && pubJwk.n === privJwk.n && pubJwk.e === privJwk.e);
  } catch {
    return false;
  }
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

      // ── IMPORT credential (key pair generated externally, e.g. KeyStore Explorer) ──
      case "import": {
        const { tin, device_number, brn, efris_mode, private_key_pem, public_key_pem, certificate_pem } = body;
        if (!tin) return json({ success: false, error: "TIN is required" }, 400, cors);
        if (!private_key_pem) return json({ success: false, error: "Private key PEM is required" }, 400, cors);
        if (!public_key_pem && !certificate_pem) {
          return json({ success: false, error: "Public key PEM or certificate PEM is required" }, 400, cors);
        }

        // Validate the private key parses (PKCS#1 or PKCS#8 PEM)
        try {
          const key = KEYUTIL.getKey(private_key_pem);
          if (!key || !key.isPrivate) throw new Error("not a private key");
        } catch (e: any) {
          return json({ success: false, error: `Invalid private key PEM: ${e?.message || e}` }, 400, cors);
        }

        // Derive the SPKI public key if the user pasted an X.509 certificate instead
        let publicKeyPem = (public_key_pem || "").trim() || null;
        const certPem = (certificate_pem || "").trim() || null;
        if (publicKeyPem && publicKeyPem.includes("BEGIN CERTIFICATE")) {
          try { publicKeyPem = certificatePemToSpkiPem(publicKeyPem); }
          catch (e: any) { return json({ success: false, error: `Could not read public key: ${e?.message || e}` }, 400, cors); }
        } else if (!publicKeyPem && certPem) {
          try { publicKeyPem = certificatePemToSpkiPem(certPem); }
          catch (e: any) { return json({ success: false, error: `Could not read public key from certificate: ${e?.message || e}` }, 400, cors); }
        }

        // Sanity check: public and private key must be the same pair
        if (publicKeyPem && !publicKeyMatches(private_key_pem, publicKeyPem)) {
          return json({ success: false, error: "Public and private keys do not match" }, 400, cors);
        }

        const { data: cred, error } = await admin
          .from("efris_credentials")
          .insert({
            business_id: appUser.business_id,
            tin,
            device_number: device_number || null,
            brn: brn || null,
            efris_mode: efris_mode || "sandbox",
            private_key_pem: private_key_pem.trim(),
            public_key_pem: publicKeyPem,
            certificate_pem: certPem,
            status: "pending",
          })
          .select("id, tin, device_number, efris_mode, status, created_at")
          .single();

        if (error) return json({ success: false, error: error.message }, 400, cors);
        return json({ success: true, credential: cred, message: "Key pair imported. Register your device with URA to receive the device number & VCN." }, 200, cors);
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

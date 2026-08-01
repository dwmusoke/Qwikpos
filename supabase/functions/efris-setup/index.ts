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
import { KEYUTIL, KJUR } from "https://esm.sh/jsrsasign@10.9.0";

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
// PKCS#12 PBE DECRYPTION (KeyStore Explorer / OpenSSL "-v1" keys)
//
// jsrsasign's KEYUTIL.getKey() only understands PBES2 (PBKDF2)
// encrypted PKCS#8 keys. Keys exported from KeyStore Explorer or
// OpenSSL with `openssl pkcs8 -topk8 -v1 PBE-SHA1-3DES` / `-v2
// PBE-SHA1-RC4-128` use the older PKCS#12 PBE scheme:
//
//   pbeWithSHAAnd128BitRC4           1.2.840.113549.1.12.1.1  (RC4-128)
//   pbeWithSHAAnd40BitRC4            1.2.840.113549.1.12.1.2  (RC4-40)
//   pbeWithSHAAnd3-KeyTripleDES-CBC  1.2.840.113549.1.12.1.3  (3DES)
//   pbeWithSHAAnd2-KeyTripleDES-CBC  1.2.840.113549.1.12.1.4  (2-key 3DES)
//
// We implement the RFC 7292 Appendix B key derivation ourselves and
// decrypt with RC4 (hand-rolled — unavailable in WebCrypto/jsrsasign)
// or 3DES-CBC (jsrsasign KJUR.crypto.Cipher).
// ====================================================================

const OID_PKCS12_RC4_128 = "1.2.840.113549.1.12.1.1";
const OID_PKCS12_RC4_40 = "1.2.840.113549.1.12.1.2";
const OID_PKCS12_3DES = "1.2.840.113549.1.12.1.3";
const OID_PKCS12_3DES_2KEY = "1.2.840.113549.1.12.1.4";

/** Decode a DER OBJECT IDENTIFIER value (without tag/length) to dotted string. */
function oidBytesToString(bytes: Uint8Array): string {
  let out = "";
  let value = 0;
  let first = true;
  for (let i = 0; i < bytes.length; i++) {
    if (first) {
      out += Math.floor(bytes[i] / 40) + "." + (bytes[i] % 40);
      first = false;
    } else {
      value = value * 128 + (bytes[i] & 0x7f);
      if ((bytes[i] & 0x80) === 0) {
        out += "." + value;
        value = 0;
      }
    }
  }
  return out;
}

/** Parse an `EncryptedPrivateKeyInfo` PEM into its PBE params and ciphertext. */
function parseEncryptedPrivateKeyPem(
  pem: string
): { oid: string; salt: Uint8Array; iterations: number; ciphertext: Uint8Array } {
  const body = pem
    .replace(/-----BEGIN ENCRYPTED PRIVATE KEY-----/, "")
    .replace(/-----END ENCRYPTED PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  if (!body) throw new Error("empty encrypted private key PEM");
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));

  // EncryptedPrivateKeyInfo ::= SEQUENCE { encryptionAlgorithm, encryptedData }
  const outer = derReadTlv(der, 0);
  if (outer.tag !== 0x30) throw new Error("encrypted private key is not DER");
  const algStart = outer.valueStart;
  const algSeq = derReadTlv(der, algStart);
  const dataTlv = derReadTlv(der, algSeq.end);

  // AlgorithmIdentifier ::= SEQUENCE { algorithm OID, parameters }
  const oidTlv = derReadTlv(der, algSeq.valueStart);
  if (oidTlv.tag !== 0x06) throw new Error("algorithm identifier missing");
  const oid = oidBytesToString(der.slice(oidTlv.valueStart, oidTlv.end));

  // pkcs-12PbeParams ::= SEQUENCE { salt OCTET STRING, iterations INTEGER }
  const paramsSeq = derReadTlv(der, oidTlv.end);
  const saltTlv = derReadTlv(der, paramsSeq.valueStart);
  const salt = der.slice(saltTlv.valueStart, saltTlv.end);
  const iterTlv = derReadTlv(der, saltTlv.end);
  let iterations = 0;
  for (let i = iterTlv.valueStart; i < iterTlv.end; i++) iterations = iterations * 256 + der[i];

  return { oid, salt, iterations, ciphertext: der.slice(dataTlv.valueStart, dataTlv.end) };
}

/** True when this PEM is a PKCS#12 PBE-encrypted private key we can decrypt. */
function isPkcs12EncryptedPem(pem: string): boolean {
  try {
    const { oid } = parseEncryptedPrivateKeyPem(pem);
    return oid === OID_PKCS12_RC4_128 || oid === OID_PKCS12_RC4_40 ||
      oid === OID_PKCS12_3DES || oid === OID_PKCS12_3DES_2KEY;
  } catch {
    return false;
  }
}

function bytesConcat(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(total);
  let p = 0;
  for (const a of arrays) { out.set(a, p); p += a.length; }
  return out;
}

/** Repeat `input` to exactly `len` bytes (RFC 7292 B.2 S/P construction). */
function repeatToLen(input: Uint8Array, len: number): Uint8Array {
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) out[i] = input[i % input.length];
  return out;
}

/** RFC 7292 B.2 step 6C: I_j = (I_j + B + 1) mod 2^v for each v-bit block j. */
function pkcs12UpdateI(I: Uint8Array, B: Uint8Array, v: number): Uint8Array {
  const out = new Uint8Array(I);
  const blocks = I.length / v;
  for (let j = 0; j < blocks; j++) {
    let carry = 1;
    for (let i = v - 1; i >= 0; i--) {
      const idx = j * v + i;
      const s = out[idx] + B[i] + carry;
      out[idx] = s & 0xff;
      carry = s >> 8;
    }
  }
  return out;
}

async function sha1Digest(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-1", data as unknown as BufferSource));
}

/**
 * PKCS#12 key derivation (RFC 7292 Appendix B.2).
 * Password is treated as a BMPString: UTF-16BE + a 0x0000 terminator.
 * @param id 1 = key material, 2 = IV
 * @param n  desired output length in bytes
 */
async function pkcs12Kdf(
  password: string,
  salt: Uint8Array,
  iterations: number,
  id: number,
  n: number
): Promise<Uint8Array> {
  const u = 20; // SHA-1 output size
  const v = 64; // SHA-1 block size

  // D = v bytes of ID
  const D = new Uint8Array(v).fill(id);
  // S = salt repeated to a multiple of v
  const S = repeatToLen(salt, v);
  // P = BMPString password repeated to a multiple of v
  const pwBytes: number[] = [];
  for (let i = 0; i < password.length; i++) {
    const c = password.charCodeAt(i);
    pwBytes.push((c >> 8) & 0xff, c & 0xff);
  }
  pwBytes.push(0, 0);
  const P = repeatToLen(new Uint8Array(pwBytes), v);

  let I = bytesConcat(S, P);
  const c = Math.ceil(n / u);
  let out: Uint8Array = new Uint8Array(0);

  for (let i = 0; i < c; i++) {
    let block = bytesConcat(D, I);
    for (let j = 0; j < iterations; j++) block = await sha1Digest(block);
    const A = block;
    // B = A repeated to v bytes
    const B = repeatToLen(A, v);
    I = pkcs12UpdateI(I, B, v);
    out = bytesConcat(out, A);
  }
  return out.slice(0, n);
}

/** RC4 keystream XOR (symmetric; also used to decrypt). */
function rc4Crypt(key: Uint8Array, data: Uint8Array): Uint8Array {
  const S = new Uint8Array(256);
  for (let i = 0; i < 256; i++) S[i] = i;
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + S[i] + key[i % key.length]) & 0xff;
    const t = S[i]; S[i] = S[j]; S[j] = t;
  }
  const out = new Uint8Array(data.length);
  let i = 0;
  j = 0;
  for (let k = 0; k < data.length; k++) {
    i = (i + 1) & 0xff;
    j = (j + S[i]) & 0xff;
    const t = S[i]; S[i] = S[j]; S[j] = t;
    out[k] = data[k] ^ S[(S[i] + S[j]) & 0xff];
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex;
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/^0x/i, "");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** 3DES-CBC decrypt using jsrsasign's bundled CryptoJS (des-EDE3-CBC). */
function des3CbcDecrypt(key: Uint8Array, iv: Uint8Array, data: Uint8Array): Uint8Array {
  const hexOut = KJUR.crypto.Cipher.decrypt(bytesToHex(data), bytesToHex(key), "des-EDE3-CBC", {
    iv: bytesToHex(iv),
  });
  return hexToBytes(hexOut);
}

/**
 * Decrypt a PKCS#12 PBE `EncryptedPrivateKeyInfo` PEM with the given
 * password, returning the unencrypted PKCS#8 `PrivateKeyInfo` DER.
 */
async function pkcs12DecryptPem(pem: string, password: string): Promise<Uint8Array> {
  const { oid, salt, iterations, ciphertext } = parseEncryptedPrivateKeyPem(pem);
  if (oid === OID_PKCS12_RC4_128 || oid === OID_PKCS12_RC4_40) {
    const keyLen = oid === OID_PKCS12_RC4_128 ? 16 : 5;
    const key = await pkcs12Kdf(password, salt, iterations, 1, keyLen);
    return rc4Crypt(key, ciphertext);
  } else if (oid === OID_PKCS12_3DES || oid === OID_PKCS12_3DES_2KEY) {
    const key = await pkcs12Kdf(password, salt, iterations, 1, 24);
    const iv = await pkcs12Kdf(password, salt, iterations, 2, 8);
    return des3CbcDecrypt(key, iv, ciphertext);
  }
  throw new Error(`unsupported PKCS#12 PBE algorithm: ${oid}`);
}

function derToPem(der: Uint8Array, label: string): string {
  const b64 = btoa(String.fromCharCode(...der));
  const lines = b64.match(/.{1,64}/g) || [];
  return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----`;
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
        const { tin, device_number, brn, efris_mode, private_key_pem, public_key_pem, certificate_pem, private_key_password } = body;
        if (!tin) return json({ success: false, error: "TIN is required" }, 400, cors);
        if (!private_key_pem) return json({ success: false, error: "Private key PEM is required" }, 400, cors);
        if (!public_key_pem && !certificate_pem) {
          return json({ success: false, error: "Public key PEM or certificate PEM is required" }, 400, cors);
        }

        // Validate the private key parses (PKCS#1 or PKCS#8 PEM, optionally password-encrypted)
        let privateKeyPem = private_key_pem.trim();
        try {
          let key;
          if (isPkcs12EncryptedPem(privateKeyPem)) {
            // KeyStore Explorer / OpenSSL "-v1" PKCS#12 PBE key: decrypt it ourselves,
            // then hand the unencrypted PKCS#8 to jsrsasign.
            const der = await pkcs12DecryptPem(privateKeyPem, private_key_password || "");
            if (der.length === 0 || der[0] !== 0x30) {
              throw new Error("decrypted data is not a DER SEQUENCE (wrong password?)");
            }
            privateKeyPem = derToPem(der, "PRIVATE KEY");
            key = KEYUTIL.getKey(privateKeyPem);
          } else {
            // Plain PKCS#1/PKCS#8, or PBES2 (PBKDF2) encrypted — jsrsasign handles these.
            key = KEYUTIL.getKey(privateKeyPem, private_key_password || undefined);
          }
          if (!key || !key.isPrivate) throw new Error("not a private key");
          // Normalize to unencrypted PKCS#8 so the efris-s2s function can use it
          // without needing a password on every call.
          privateKeyPem = KEYUTIL.getPEM(key, "PKCS8PRV");
        } catch (e: any) {
          return json({ success: false, error: `Invalid private key PEM or wrong password: ${e?.message || e}` }, 400, cors);
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
        if (publicKeyPem && !publicKeyMatches(privateKeyPem, publicKeyPem)) {
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
            private_key_pem: privateKeyPem,
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

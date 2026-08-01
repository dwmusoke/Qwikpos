// =====================================================================
// SHARED — AES-256-GCM at-rest encryption for EFRIS RSA private keys.
//
// The private key is the crown jewel of the EFRIS S2S integration, so it
// is encrypted at rest in PostgreSQL with AES-256-GCM. The key-encryption
// key (KEK) comes from the KEY_ENCRYPTION_KEY environment secret (32 raw
// bytes, Base64-encoded) and never touches the database.
//
// Storage format for encrypted values:
//   QWKENC1:<base64(iv)>:<base64(authTag)>:<base64(ciphertext)>
//
// Values that do NOT start with the QWKENC1 prefix are treated as legacy
// plaintext PEM (rows created before this feature shipped) and returned
// as-is so existing credentials keep working without a migration.
//
// Imported via `../_shared/keys.ts` by edge functions that manage or use
// EFRIS credentials. Web Crypto (crypto.subtle) is available in the Deno
// runtime used by Supabase Edge Functions.
// =====================================================================

const KEY_ENC_PREFIX = "QWKENC1:";

/** Base64 → bytes. */
function b64ToBytes(b64: string) {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

/** bytes → Base64. */
function bytesToB64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

/** Load the 32-byte AES-256 key-encryption key from the environment secret. */
function getKek() {
  const b64 = Deno.env.get("KEY_ENCRYPTION_KEY") || "";
  if (!b64) {
    throw new Error("KEY_ENCRYPTION_KEY is not set — refusing to write unencrypted private keys. Set it with: supabase secrets set KEY_ENCRYPTION_KEY=<base64-32-bytes>");
  }
  let bytes;
  try {
    bytes = b64ToBytes(b64);
  } catch {
    throw new Error("KEY_ENCRYPTION_KEY is not valid Base64");
  }
  if (bytes.length !== 32) {
    throw new Error("KEY_ENCRYPTION_KEY must be exactly 32 bytes (Base64 of a 256-bit AES key)");
  }
  return bytes;
}

/** True when a stored value uses the at-rest encryption format. */
export function isEncryptedStoredKey(value: string): boolean {
  return typeof value === "string" && value.startsWith(KEY_ENC_PREFIX);
}

/**
 * Encrypt a private-key PEM for storage. Throws if KEY_ENCRYPTION_KEY is
 * missing or malformed — better to fail loudly than silently weaken security.
 */
export async function encryptPrivateKeyPem(pem: string): Promise<string> {
  const kek = getKek();
  const iv = crypto.getRandomValues(new Uint8Array(12));  const cryptoKey = await crypto.subtle.importKey("raw", kek, { name: "AES-GCM" }, false, ["encrypt"]);
  const sealed = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, tagLength: 128 },
    cryptoKey,
    new TextEncoder().encode(pem),
  );

  // Web Crypto appends the 16-byte GCM auth tag to the ciphertext.
  const sealedBytes = new Uint8Array(sealed);
  const tag = sealedBytes.slice(sealedBytes.length - 16);
  const body = sealedBytes.slice(0, sealedBytes.length - 16);

  return `${KEY_ENC_PREFIX}${bytesToB64(iv)}:${bytesToB64(tag)}:${bytesToB64(body)}`;
}

/**
 * Decrypt a stored private key back to plaintext PEM.
 * Legacy plaintext PEM values pass through untouched.
 */
export async function decryptStoredPrivateKey(stored: string): Promise<string> {
  if (!isEncryptedStoredKey(stored)) return stored;

  const rest = stored.slice(KEY_ENC_PREFIX.length);
  const parts = rest.split(":");
  if (parts.length !== 3) {
    throw new Error("Malformed encrypted private key (expected iv:authTag:ciphertext)");
  }

  const iv = b64ToBytes(parts[0]);
  const tag = b64ToBytes(parts[1]);
  const body = b64ToBytes(parts[2]);

  const sealed = new Uint8Array(body.length + tag.length);
  sealed.set(body);
  sealed.set(tag, body.length);

  const cryptoKey = await crypto.subtle.importKey("raw", getKek(), { name: "AES-GCM" }, false, ["decrypt"]);
  try {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv, tagLength: 128 }, cryptoKey, sealed);
    return new TextDecoder().decode(plain);
  } catch {
    throw new Error("Failed to decrypt private key — KEY_ENCRYPTION_KEY does not match the one used when it was encrypted");
  }
}

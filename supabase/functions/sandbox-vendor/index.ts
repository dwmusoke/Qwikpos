// =====================================================================
// SUPABASE EDGE FUNCTION — sandbox-vendor
//
// Self-service vendor registration and API key management for the
// EFRIS Sandbox API. Vendors sign up with email/password, get an
// API key instantly, and can manage it from their dashboard.
//
// Actions:
//   signup  — Create Supabase Auth user + business + API key
//   login   — Authenticate and return API key info
//   keys    — List vendor's API keys
//   create_key — Generate a new API key
//   revoke_key — Deactivate an API key
//   usage   — Get usage stats for a key
// =====================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const ALLOWED_ORIGINS = [
  Deno.env.get("APP_ORIGIN") || "",
  Deno.env.get("APP_ORIGIN_2") || "",
].filter(Boolean);

function corsHeaders(req?: Request): Record<string, string> {
  const origin = req?.headers?.get("origin") || "";
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0] || "*";
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

// Generate a random API key: sk_sbx_<32 hex chars>
function generateApiKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
  return `sk_sbx_${hex}`;
}

// SHA-256 hash
async function hashKey(key: string): Promise<string> {
  const data = new TextEncoder().encode(key);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const body = await req.json();
    const { action } = body;

    switch (action) {
      // ── SIGNUP: create vendor account + business + API key ──
      case "signup": {
        const { email, password, business_name, contact_name, phone } = body;
        if (!email || !password || !business_name) {
          return json({ success: false, error: "email, password, and business_name are required" }, 400, cors);
        }
        if (password.length < 8) {
          return json({ success: false, error: "Password must be at least 8 characters" }, 400, cors);
        }

        // Check if email already exists
        const { data: existingUsers } = await admin.auth.admin.listUsers();
        if (existingUsers?.users?.some((u) => u.email === email)) {
          return json({ success: false, error: "An account with this email already exists" }, 400, cors);
        }

        // Create Supabase Auth user
        const { data: authData, error: authErr } = await admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
        });
        if (authErr) return json({ success: false, error: authErr.message }, 400, cors);

        const userId = authData.user.id;

        // Create a sandbox business
        const { data: biz, error: bizErr } = await admin
          .from("businesses")
          .insert({
            name: business_name,
            email,
            phone: phone || null,
            tin: null,
            base_currency: "UGX",
            efris_mode: "sandbox",
          })
          .select("id")
          .single();
        if (bizErr) return json({ success: false, error: bizErr.message }, 400, cors);

        // Link user to business as admin
        await admin.from("app_users").insert({
          id: userId,
          business_id: biz.id,
          full_name: contact_name || business_name,
          role: "admin",
        });

        // Generate API key
        const plainKey = generateApiKey();
        const keyHash = await hashKey(plainKey);
        const label = `${business_name} — Sandbox`;

        const { data: apiKey, error: keyErr } = await admin
          .from("sandbox_api_keys")
          .insert({
            business_id: biz.id,
            api_key_hash: keyHash,
            label,
            tier: "free",
            is_active: true,
          })
          .select("id, label, tier, created_at")
          .single();
        if (keyErr) return json({ success: false, error: keyErr.message }, 400, cors);

        // Sign in the user to get a JWT
        const { data: signInData, error: signInErr } = await admin.auth.signInWithPassword({
          email,
          password,
        });
        if (signInErr) return json({ success: false, error: signInErr.message }, 400, cors);

        return json({
          success: true,
          api_key: plainKey,
          key_info: apiKey,
          session: signInData.session,
          message: "Account created! Save your API key — it won't be shown again.",
        }, 201, cors);
      }

      // ── LOGIN: authenticate and return key info ──
      case "login": {
        const { email, password } = body;
        if (!email || !password) {
          return json({ success: false, error: "email and password are required" }, 400, cors);
        }

        const { data: signInData, error: signInErr } = await admin.auth.signInWithPassword({
          email,
          password,
        });
        if (signInErr) return json({ success: false, error: "Invalid email or password" }, 401, cors);

        // Get user's business
        const { data: appUser } = await admin
          .from("app_users")
          .select("business_id")
          .eq("id", signInData.user.id)
          .single();

        if (!appUser?.business_id) {
          return json({ success: false, error: "No business linked to this account" }, 400, cors);
        }

        // Get API keys
        const { data: keys } = await admin
          .from("sandbox_api_keys")
          .select("id, label, tier, is_active, last_used_at, created_at")
          .eq("business_id", appUser.business_id)
          .order("created_at", { ascending: false });

        return json({
          success: true,
          session: signInData.session,
          keys: keys || [],
        }, 200, cors);
      }

      // ── Authenticated actions (require JWT) ──
      default: {
        // Verify auth
        const authHeader = req.headers.get("Authorization") ?? "";
        const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
          global: { headers: { Authorization: authHeader } },
        });
        const { data: userData, error: userErr } = await userClient.auth.getUser();
        if (userErr || !userData?.user) return json({ success: false, error: "Not authenticated" }, 401, cors);

        const { data: appUser } = await admin
          .from("app_users")
          .select("business_id, role")
          .eq("id", userData.user.id)
          .single();
        if (!appUser?.business_id) return json({ success: false, error: "No business linked" }, 400, cors);

        switch (action) {
          // ── LIST keys ──
          case "keys": {
            const { data: keys } = await admin
              .from("sandbox_api_keys")
              .select("id, label, tier, is_active, last_used_at, created_at")
              .eq("business_id", appUser.business_id)
              .order("created_at", { ascending: false });
            return json({ success: true, keys: keys || [] }, 200, cors);
          }

          // ── CREATE new key ──
          case "create_key": {
            const { label, tier } = body;
            const plainKey = generateApiKey();
            const keyHash = await hashKey(plainKey);

            const { data: apiKey, error } = await admin
              .from("sandbox_api_keys")
              .insert({
                business_id: appUser.business_id,
                api_key_hash: keyHash,
                label: label || "Sandbox API Key",
                tier: tier || "free",
                is_active: true,
              })
              .select("id, label, tier, created_at")
              .single();
            if (error) return json({ success: false, error: error.message }, 400, cors);

            return json({
              success: true,
              api_key: plainKey,
              key_info: apiKey,
              message: "Key created! Save it now — it won't be shown again.",
            }, 201, cors);
          }

          // ── REVOKE key ──
          case "revoke_key": {
            const { key_id } = body;
            if (!key_id) return json({ success: false, error: "key_id required" }, 400, cors);

            const { error } = await admin
              .from("sandbox_api_keys")
              .update({ is_active: false })
              .eq("id", key_id)
              .eq("business_id", appUser.business_id);
            if (error) return json({ success: false, error: error.message }, 400, cors);

            return json({ success: true, message: "Key revoked" }, 200, cors);
          }

          // ── USAGE stats ──
          case "usage": {
            const { key_id } = body;
            let query = admin
              .from("sandbox_usage")
              .select("id, endpoint, status, tin, response_time_ms, created_at")
              .order("created_at", { ascending: false })
              .limit(200);

            if (key_id) {
              query = query.eq("api_key_id", key_id);
            } else {
              // Get all keys for this business
              const { data: keys } = await admin
                .from("sandbox_api_keys")
                .select("id")
                .eq("business_id", appUser.business_id);
              const keyIds = (keys || []).map((k: any) => k.id);
              if (keyIds.length) {
                query = query.in("api_key_id", keyIds);
              } else {
                return json({ success: true, usage: [], stats: {} }, 200, cors);
              }
            }

            const { data: usage } = await query;

            // Aggregate stats
            const totalRequests = usage?.length || 0;
            const accepted = usage?.filter((u: any) => u.status === "accepted").length || 0;
            const rejected = usage?.filter((u: any) => u.status === "rejected").length || 0;
            const errors = usage?.filter((u: any) => u.status === "error").length || 0;
            const avgResponseTime = totalRequests
              ? Math.round((usage || []).reduce((a: number, u: any) => a + (u.response_time_ms || 0), 0) / totalRequests)
              : 0;

            // Today's usage
            const todayStart = new Date();
            todayStart.setHours(0, 0, 0, 0);
            const todayRequests = usage?.filter((u: any) => new Date(u.created_at) >= todayStart).length || 0;

            return json({
              success: true,
              usage: usage || [],
              stats: { totalRequests, accepted, rejected, errors, avgResponseTime, todayRequests },
            }, 200, cors);
          }

          default:
            return json({ success: false, error: `Unknown action: ${action}` }, 400, cors);
        }
      }
    }
  } catch (err: any) {
    console.error("Sandbox vendor error:", err);
    return json({ success: false, error: err.message || "Internal error" }, 500, cors);
  }
});

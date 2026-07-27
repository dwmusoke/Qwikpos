// =====================================================================
// SUPABASE EDGE FUNCTION — manage-user
//
// Updates user details including auth email (requires service role).
// Actions:
//   update_email  — Update auth user email + app_users
//   update_user   — Update app_users fields (name, phone, role, active)
//   delete_user   — Soft-delete: deactivate in app_users
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
    if (!["admin", "superadmin"].includes(appUser.role)) return json({ success: false, error: "Only admins can manage users" }, 403, cors);

    const body = await req.json();
    const { action, user_id, email, full_name, phone, role, is_active } = body;

    if (!user_id) return json({ success: false, error: "user_id required" }, 400, cors);

    // Verify the target user belongs to the same business
    const { data: targetUser } = await admin.from("app_users").select("business_id").eq("id", user_id).single();
    if (targetUser?.business_id !== appUser.business_id) {
      return json({ success: false, error: "User does not belong to your business" }, 403, cors);
    }

    switch (action) {
      // ── LIST: fetch app_users + auth emails ──
      case "list": {
        const { data: appUsers, error: appErr } = await admin
          .from("app_users").select("*").eq("business_id", appUser.business_id).order("created_at", { ascending: false });
        if (appErr) return json({ success: false, error: appErr.message }, 400, cors);

        const userIds = (appUsers || []).map((u: any) => u.id);
        const emailMap: Record<string, string> = {};
        for (const uid of userIds) {
          const { data: authUser } = await admin.auth.admin.getUserById(uid);
          if (authUser?.user?.email) emailMap[uid] = authUser.user.email;
        }

        const merged = (appUsers || []).map((u: any) => ({ ...u, email: emailMap[u.id] || "" }));
        return json({ success: true, users: merged }, 200, cors);
      }

      // ── CREATE: create auth user + app_user record ──
      case "create_user": {
        const { email, password, full_name, phone, role } = body;
        if (!email || !password || !full_name) {
          return json({ success: false, error: "email, password, and full_name required" }, 400, cors);
        }

        const { data: authData, error: authErr } = await admin.auth.admin.createUser({
          email, password, email_confirm: true,
        });
        if (authErr) return json({ success: false, error: authErr.message }, 400, cors);

        const branchId = body.branch_id || null;
        const { error: userErr } = await admin.from("app_users").insert({
          id: authData.user.id,
          business_id: appUser.business_id,
          branch_id: branchId,
          full_name,
          phone: phone || null,
          role: role || "cashier",
          is_active: true,
        });
        if (userErr) {
          // Rollback: delete the auth user if app_users insert fails
          await admin.auth.admin.deleteUser(authData.user.id);
          return json({ success: false, error: userErr.message }, 400, cors);
        }

        return json({ success: true, user_id: authData.user.id }, 200, cors);
      }

      case "update_email": {
        if (!email || !email.includes("@")) return json({ success: false, error: "Valid email required" }, 400, cors);
        const { error } = await admin.auth.admin.updateUserById(user_id, { email });
        if (error) return json({ success: false, error: error.message }, 400, cors);
        return json({ success: true }, 200, cors);
      }

      case "reset_password": {
        const { password } = body;
        if (!password || password.length < 8) return json({ success: false, error: "Password must be at least 8 characters" }, 400, cors);
        const { error } = await admin.auth.admin.updateUserById(user_id, { password });
        if (error) return json({ success: false, error: error.message }, 400, cors);
        return json({ success: true }, 200, cors);
      }

      case "update_user": {
        const updates: any = {};
        if (full_name !== undefined) updates.full_name = full_name;
        if (phone !== undefined) updates.phone = phone || null;
        if (role !== undefined) updates.role = role;
        if (is_active !== undefined) updates.is_active = is_active;
        if (Object.keys(updates).length === 0) return json({ success: false, error: "No fields to update" }, 400, cors);
        const { error } = await admin.from("app_users").update(updates).eq("id", user_id);
        if (error) return json({ success: false, error: error.message }, 400, cors);
        return json({ success: true }, 200, cors);
      }

      case "delete_user": {
        const { error } = await admin.from("app_users").update({ is_active: false }).eq("id", user_id);
        if (error) return json({ success: false, error: error.message }, 400, cors);
        return json({ success: true }, 200, cors);
      }

      default:
        return json({ success: false, error: `Unknown action: ${action}` }, 400, cors);
    }
  } catch (err: any) {
    console.error("manage-user error:", err);
    return json({ success: false, error: err.message || "Internal error" }, 500, cors);
  }
});

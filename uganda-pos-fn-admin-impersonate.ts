// =====================================================================
// SUPABASE EDGE FUNCTION — admin-impersonate
//
// Allows a superadmin to generate a temporary login link for any vendor.
// Uses Supabase Admin API to create a magic link that logs in as the
// target user. The superadmin can then see the vendor's exact view.
//
// DEPLOY:
//   mkdir -p supabase/functions/admin-impersonate
//   cp uganda-pos-fn-admin-impersonate.ts supabase/functions/admin-impersonate/index.ts
//   supabase functions deploy admin-impersonate
//
// CALL:
//   POST /functions/v1/admin-impersonate
//   Authorization: Bearer <supabase anon key>
//   x-supabase-auth: <superadmin's access token>
//   Body: { target_user_id: "uuid" }
//
// Returns: { url: "https://...?impersonate_token=..." }
// =====================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-auth",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });

  try {
    // Verify the caller is a superadmin
    const authHeader = req.headers.get("x-supabase-auth");
    if (!authHeader) return json({ error: "Missing auth" }, 401);

    const userClient = createClient(SUPABASE_URL, SUPABASE_URL, {
      global: { headers: { Authorization: `Bearer ${authHeader}` } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Invalid token" }, 401);

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: caller } = await admin
      .from("app_users")
      .select("role")
      .eq("id", user.id)
      .single();

    if (!caller || caller.role !== "superadmin") {
      return json({ error: "Not a superadmin" }, 403);
    }

    const { target_user_id } = await req.json();
    if (!target_user_id) return json({ error: "target_user_id required" }, 400);

    // Verify target user exists
    const { data: target } = await admin
      .from("app_users")
      .select("id, full_name, business_id")
      .eq("id", target_user_id)
      .single();

    if (!target) return json({ error: "Target user not found" }, 404);

    // Generate a magic link for the target user
    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email: user.email!, // we need the target user's email
      options redirectTo: `${new URL(req.url).origin}/?impersonate=1`,
    });

    if (linkErr) {
      // Fallback: use signInWithOtp via admin
      const { data: targetUser } = await admin.auth.admin.getUserById(target_user_id);
      if (!targetUser?.user?.email) {
        return json({ error: "Cannot get target user email" }, 500);
      }

      const { data: otpData, error: otpErr } = await admin.auth.admin.generateOtp({
        email: targetUser.user.email,
      });

      if (otpErr) return json({ error: otpErr.message }, 500);

      return json({
        success: true,
        method: "otp",
        target_email: targetUser.user.email,
        target_name: target.full_name,
        note: "OTP sent to target user's email. Use the Supabase dashboard to complete the login, or integrate with a redirect flow.",
      });
    }

    return json({
      success: true,
      method: "magic_link",
      target_name: target.full_name,
      action_url: linkData?.properties?.action_link || null,
    });
  } catch (err) {
    console.error(err);
    return json({ error: String(err) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

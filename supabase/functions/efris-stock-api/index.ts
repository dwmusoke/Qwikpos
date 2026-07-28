// =====================================================================
// SUPABASE EDGE FUNCTION — efris-stock-api
//
// RESTful API for stock management operations.
// Mirrors the WEAF EFRIS stock endpoints (increase-stock,
// decrease-stock, transfer-stock) plus set-stock.
//
// DEPLOY:
//   mkdir -p supabase/functions/efris-stock-api
//   cp uganda-pos-fn-efris-stock-api.ts supabase/functions/efris-stock-api/index.ts
//   supabase functions deploy efris-stock-api
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

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });

  try {
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
      .select("business_id, role, id")
      .eq("id", userData.user.id)
      .single();
    if (!appUser?.business_id)
      return json(
        { success: false, error: "No business linked to this login" },
        400,
        corsHeaders,
      );

    const body = await req.json().catch(() => ({}));
    const { action } = body;
    if (!action)
      return json(
        { success: false, error: "action is required" },
        400,
        corsHeaders,
      );

    const businessId = appUser.business_id;
    let result: any;

    switch (action) {
      // ---------------------------------------------------------------
      // INCREASE STOCK — add quantity to a product at a branch
      // POST /functions/v1/efris-stock-api
      // Body: { action: "increase_stock", product_id, branch_id, quantity, notes? }
      // ---------------------------------------------------------------
      case "increase_stock":
      case "decrease_stock":
      case "set_stock": {
        const { product_id, branch_id, quantity, notes } = body;
        if (!product_id || !branch_id || quantity == null)
          return json(
            {
              success: false,
              error: "product_id, branch_id, and quantity are required",
            },
            400,
            corsHeaders,
          );

        const qty = Number(quantity);
        if (isNaN(qty) || qty < 0)
          return json(
            { success: false, error: "quantity must be a non-negative number" },
            400,
            corsHeaders,
          );

        // Verify the product belongs to this business
        const { data: product } = await admin
          .from("products")
          .select("id")
          .eq("id", product_id)
          .eq("business_id", businessId)
          .single();
        if (!product)
          return json(
            { success: false, error: "Product not found" },
            404,
            corsHeaders,
          );

        // Get current stock
        const { data: currentStock } = await admin
          .from("product_stock")
          .select("quantity")
          .eq("product_id", product_id)
          .eq("branch_id", branch_id)
          .maybeSingle();
        const currentQty = Number(currentStock?.quantity || 0);

        let newQty: number;
        if (action === "increase_stock") {
          newQty = currentQty + qty;
        } else if (action === "decrease_stock") {
          if (qty > currentQty)
            return json(
              {
                success: false,
                error: `Insufficient stock: have ${currentQty}, need ${qty}`,
              },
              400,
              corsHeaders,
            );
          newQty = currentQty - qty;
        } else {
          newQty = qty;
        }

        // Update stock via RPC
        const { error: rpcErr } = await admin.rpc("upsert_product_stock", {
          p_product_id: product_id,
          p_branch_id: branch_id,
          p_quantity: newQty,
        });
        if (rpcErr)
          return json(
            { success: false, error: rpcErr.message },
            500,
            corsHeaders,
          );

        // Record movement
        const movementType =
          action === "increase_stock"
            ? "in"
            : action === "decrease_stock"
              ? "out"
              : "adjust";
        const movementQty =
          action === "set_stock" ? newQty - currentQty : qty;
        const movementNotes =
          notes ||
          `${action.replace("_", " ")} (${movementQty >= 0 ? "+" : ""}${movementQty})`;

        if (movementQty !== 0) {
          await admin.rpc("insert_stock_movement", {
            p_business_id: businessId,
            p_branch_id: branch_id,
            p_product_id: product_id,
            p_type: movementType,
            p_quantity: movementQty,
            p_notes: movementNotes,
            p_created_by: appUser.id,
          }).catch(() => {});
        }

        result = {
          success: true,
          data: {
            product_id,
            branch_id,
            previous_quantity: currentQty,
            new_quantity: newQty,
            change: newQty - currentQty,
          },
        };
        break;
      }

      // ---------------------------------------------------------------
      // TRANSFER STOCK — move quantity between branches
      // Body: { action: "transfer_stock", product_id, from_branch_id, to_branch_id, quantity, notes? }
      // ---------------------------------------------------------------
      case "transfer_stock": {
        const { product_id, from_branch_id, to_branch_id, quantity, notes } =
          body;
        if (!product_id || !from_branch_id || !to_branch_id || quantity == null)
          return json(
            {
              success: false,
              error:
                "product_id, from_branch_id, to_branch_id, and quantity are required",
            },
            400,
            corsHeaders,
          );

        const qty = Number(quantity);
        if (isNaN(qty) || qty <= 0)
          return json(
            { success: false, error: "quantity must be a positive number" },
            400,
            corsHeaders,
          );

        if (from_branch_id === to_branch_id)
          return json(
            { success: false, error: "from_branch and to_branch must differ" },
            400,
            corsHeaders,
          );

        // Verify product
        const { data: product } = await admin
          .from("products")
          .select("id")
          .eq("id", product_id)
          .eq("business_id", businessId)
          .single();
        if (!product)
          return json(
            { success: false, error: "Product not found" },
            404,
            corsHeaders,
          );

        // Check source stock
        const { data: fromStock } = await admin
          .from("product_stock")
          .select("quantity")
          .eq("product_id", product_id)
          .eq("branch_id", from_branch_id)
          .maybeSingle();
        const fromQty = Number(fromStock?.quantity || 0);
        if (qty > fromQty)
          return json(
            {
              success: false,
              error: `Insufficient stock at source: have ${fromQty}, need ${qty}`,
            },
            400,
            corsHeaders,
          );

        // Deduct from source
        await admin.rpc("upsert_product_stock", {
          p_product_id: product_id,
          p_branch_id: from_branch_id,
          p_quantity: fromQty - qty,
        });

        // Add to destination
        const { data: toStock } = await admin
          .from("product_stock")
          .select("quantity")
          .eq("product_id", product_id)
          .eq("branch_id", to_branch_id)
          .maybeSingle();
        const toQty = Number(toStock?.quantity || 0);

        await admin.rpc("upsert_product_stock", {
          p_product_id: product_id,
          p_branch_id: to_branch_id,
          p_quantity: toQty + qty,
        });

        // Record movements
        const transferNotes = notes || `Transfer from ${from_branch_id} to ${to_branch_id}`;
        await admin.rpc("insert_stock_movement", {
          p_business_id: businessId,
          p_branch_id: from_branch_id,
          p_product_id: product_id,
          p_type: "transfer_out",
          p_quantity: -qty,
          p_notes: transferNotes,
          p_created_by: appUser.id,
        }).catch(() => {});
        await admin.rpc("insert_stock_movement", {
          p_business_id: businessId,
          p_branch_id: to_branch_id,
          p_product_id: product_id,
          p_type: "transfer_in",
          p_quantity: qty,
          p_notes: transferNotes,
          p_created_by: appUser.id,
        }).catch(() => {});

        result = {
          success: true,
          data: {
            product_id,
            from_branch_id,
            to_branch_id,
            quantity: qty,
            from_new_quantity: fromQty - qty,
            to_new_quantity: toQty + qty,
          },
        };
        break;
      }

      default:
        return json(
          {
            success: false,
            error: `Unknown action: ${action}. Supported: increase_stock, decrease_stock, set_stock, transfer_stock`,
          },
          400,
          corsHeaders,
        );
    }

    return json(result, 200, corsHeaders);
  } catch (err) {
    console.error("efris-stock-api error:", err);
    return json(
      { success: false, error: "Internal error" },
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

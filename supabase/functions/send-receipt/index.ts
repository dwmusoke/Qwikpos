// =====================================================================
// SUPABASE EDGE FUNCTION — send-receipt
//
// Sends an SMS or WhatsApp receipt to a customer after a sale completes.
// Called by the POS client after a successful sale (optional — the sale
// is already saved regardless).
//
// DEPLOY:
//   mkdir -p supabase/functions/send-receipt
//   cp uganda-pos-fn-send-receipt.ts supabase/functions/send-receipt/index.ts
//   supabase functions deploy send-receipt
//   supabase secrets set AT_USERNAME=your_africastalking_username AT_API_KEY=your_africastalking_api_key
//
// The client calls this with:
//   POST /functions/v1/send-receipt
//   Authorization: Bearer <supabase anon key>
//   Body: { sale_id, channel: "sms" | "whatsapp" }
// =====================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const AT_USERNAME = Deno.env.get("AT_USERNAME") ?? "";
const AT_API_KEY = Deno.env.get("AT_API_KEY") ?? "";

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });

  try {
    const { sale_id, channel = "sms" } = await req.json();
    if (!sale_id) return json({ error: "sale_id required" }, 400);

    // Fetch sale with customer, items, business, and payments
    const { data: sale, error: saleErr } = await admin
      .from("sales")
      .select(
        "*, customer:customers(*), business:businesses(*), items:sale_items(*), payments(*)",
      )
      .eq("id", sale_id)
      .single();

    if (saleErr || !sale) return json({ error: "Sale not found" }, 404);
    if (!sale.customer?.phone)
      return json({ error: "Customer has no phone number" }, 400);

    const message = buildReceiptMessage(sale);

    if (channel === "whatsapp") {
      // Placeholder — integrate Twilio WhatsApp or Africa's Talking WhatsApp here
      return json({
        success: false,
        note: "WhatsApp not yet wired. Configure Twilio/Africa's Talking WhatsApp in this function.",
        message_preview: message,
      });
    }

    const sendResult = await sendSms(sale.customer.phone, message);
    return json({ success: sendResult.success, ...sendResult });
  } catch (err) {
    console.error(err);
    return json({ error: String(err) }, 500);
  }
});

function buildReceiptMessage(sale: any) {
  const biz = sale.business;
  const customer = sale.customer;
  const items = sale.items || [];
  const payments = sale.payments || [];

  const money = (n: number) =>
    `${sale.currency_code} ${Math.round(n).toLocaleString("en-UG")}`;

  const lines: string[] = [
    `${biz?.name || "Receipt"}`,
    `Date: ${new Date(sale.created_at).toLocaleString("en-UG")}`,
    `Invoice: ${sale.sale_number}`,
    `Customer: ${customer?.name || "Walk-in"}`,
    "",
    "--- Items ---",
  ];

  for (const it of items) {
    lines.push(`${it.product_name} x${it.quantity}  ${money(it.line_total)}`);
  }

  lines.push("");
  lines.push(`Total: ${money(sale.grand_total)}`);

  for (const p of payments) {
    lines.push(`Paid (${p.method}): ${money(p.amount)}`);
  }

  if (sale.payment_status === "credit") {
    const paid = payments.reduce(
      (a: number, p: any) => a + Number(p.amount || 0),
      0,
    );
    lines.push(`Balance due: ${money(sale.grand_total - paid)}`);
  }

  lines.push("");
  lines.push("Thank you for your business!");
  lines.push("— Qwickpos");

  return lines.join("\n");
}

async function sendSms(phone: string, message: string) {
  if (!AT_USERNAME || !AT_API_KEY) {
    return {
      success: false,
      note: "Africa's Talking credentials not configured.",
    };
  }
  const body = new URLSearchParams({
    username: AT_USERNAME,
    to: phone,
    message,
  });
  const res = await fetch("https://api.africastalking.com/version1/messaging", {
    method: "POST",
    headers: {
      apiKey: AT_API_KEY,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: body.toString(),
  });
  const data = await res.json().catch(() => null);
  const recipient = data?.SMSMessageData?.Recipients?.[0];
  return {
    success: recipient?.status === "Success",
    providerStatus: recipient?.status || "Unknown",
    cost: recipient?.cost,
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// =====================================================================
// SUPABASE EDGE FUNCTION — ai-notifications
//
// AI-powered notification features:
//   • summarize   — AI daily/weekly digest of unread notifications
//   • generate_template — write a notification template from plain language
//   • smart_priority — auto-tag notifications high/medium/low priority
//
// DEPLOY:
//   supabase functions deploy ai-notifications
//
// SECRETS:
//   supabase secrets set AI_API_KEY=your_openai_or_anthropic_key
//   supabase secrets set AI_PROVIDER=openai   (openai | anthropic | none)
// =====================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const AI_API_KEY = Deno.env.get("AI_API_KEY") ?? "";
const AI_PROVIDER = (Deno.env.get("AI_PROVIDER") ?? "none").toLowerCase();

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function callAI(systemPrompt: string, userPrompt: string): Promise<string> {
  if (!AI_API_KEY || AI_PROVIDER === "none") {
    throw new Error("AI not configured — set AI_API_KEY and AI_PROVIDER secrets");
  }

  if (AI_PROVIDER === "openai") {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${AI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.4,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });
    const data = await res.json();
    return data.choices?.[0]?.message?.content || "";
  }

  if (AI_PROVIDER === "anthropic") {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": AI_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-3-haiku-20240307",
        max_tokens: 1000,
        temperature: 0.4,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });
    const data = await res.json();
    return data.content?.[0]?.text || "";
  }

  throw new Error(`Unknown AI provider: ${AI_PROVIDER}`);
}

/* ------------------------------------------------------------------ */
/* Rule-based fallbacks (no AI key needed)                            */
/* ------------------------------------------------------------------ */

function ruleBasedSummary(notifs: any[]): string {
  const byType: Record<string, number> = {};
  const unread = notifs.filter((n) => !n.is_read);
  for (const n of notifs) byType[n.type] = (byType[n.type] || 0) + 1;
  const parts: string[] = [];
  if (unread.length) parts.push(`${unread.length} unread`);
  const typeList = Object.entries(byType)
    .map(([t, c]) => `${c} ${t}`)
    .join(", ");
  return `You have ${notifs.length} notifications (${typeList}). ${unread.length} need your attention.`;
}

function ruleBasedPriority(title: string, body: string, type: string): "high" | "medium" | "low" {
  const text = (title + " " + body).toLowerCase();
  const high = ["low stock", "expired", "expiring", "payment failed", "overdue", "critical", "urgent", "error", "failed"];
  const med = ["reminder", "reorder", "approaching", "warning", "pending"];
  for (const w of high) if (text.includes(w)) return "high";
  for (const w of med) if (text.includes(w)) return "medium";
  return "low";
}

/* ------------------------------------------------------------------ */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const { action } = body;

  /* ---------------------------------------------------------------- */
  if (action === "summarize") {
    const { notifications, period = "today" } = body;
    if (!Array.isArray(notifications)) return json({ error: "notifications array required" }, 400);

    try {
      const aiText = await callAI(
        `You are an assistant that summarizes business notifications. Given a list of notifications for a retail/POS business, write a short, friendly daily digest (2-4 sentences). Highlight what needs attention. Be concise. Use plain language.`,
        `Notifications (${period}):\n${notifications.map((n: any) => `- [${n.type}] ${n.title}: ${n.body || ""}`).join("\n")}\n\nWrite the digest:`,
      );
      return json({ summary: aiText, source: "ai" });
    } catch (e) {
      return json({ summary: ruleBasedSummary(notifications), source: "rule-based", note: String(e.message) });
    }
  }

  /* ---------------------------------------------------------------- */
  if (action === "generate_template") {
    const { description, channel = "email", name } = body;
    if (!description) return json({ error: "description required" }, 400);

    try {
      const aiText = await callAI(
        `You are an assistant that writes notification templates for a POS/retail business. Given a plain-language description, produce: (1) a short subject line (for email) and (2) a body template using handlebars-style placeholders like {{customer_name}}, {{amount}}, {{invoice_number}}, {{date}}, {{business_name}}. Output ONLY: Subject: <subject>\n\nBody: <body>`,
        `Channel: ${channel}\nTemplate name: ${name || "Untitled"}\nDescription: ${description}`,
      );
      const lines = aiText.split("\n");
      let subject = "";
      let bodyTpl = "";
      let inBody = false;
      for (const line of lines) {
        if (line.startsWith("Subject:")) subject = line.replace(/^Subject:\s*/i, "").trim();
        else if (line.startsWith("Body:")) { inBody = true; bodyTpl = line.replace(/^Body:\s*/i, "").trim(); }
        else if (inBody) bodyTpl += "\n" + line;
      }
      return json({ name: name || "AI Generated", channel, subject, body_template: bodyTpl || aiText, source: "ai" });
    } catch (e) {
      return json({ name: name || "AI Generated", channel, subject: "", body_template: description, source: "rule-based", note: String(e.message) });
    }
  }

  /* ---------------------------------------------------------------- */
  if (action === "smart_priority") {
    const { notifications } = body;
    if (!Array.isArray(notifications)) return json({ error: "notifications array required" }, 400);

    try {
      const aiText = await callAI(
        `You are an assistant that assigns priority (high/medium/low) to business notifications. Reply with ONLY a JSON array of objects: {id, priority}. Be strict: high = needs immediate action (low stock, payment failed, expired), medium = reminder/warning, low = FYI/info.`,
        `Notifications:\n${JSON.stringify(notifications.map((n: any) => ({ id: n.id, title: n.title, body: n.body, type: n.type })))}`,
      );
      let priorities: any[] = [];
      try { priorities = JSON.parse(aiText); } catch {
        // try to extract JSON array from text
        const m = aiText.match(/\[[\s\S]*\]/);
        if (m) priorities = JSON.parse(m[0]);
      }
      if (!priorities.length) throw new Error("No priorities parsed");
      return json({ priorities, source: "ai" });
    } catch (e) {
      const priorities = notifications.map((n: any) => ({
        id: n.id,
        priority: ruleBasedPriority(n.title, n.body, n.type),
      }));
      return json({ priorities, source: "rule-based", note: String(e.message) });
    }
  }

  return json({ error: "Unknown action" }, 400);
});

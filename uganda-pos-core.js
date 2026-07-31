// =====================================================================
// QWICKPOS — CORE (config, supabase client, shared state, utilities)
// =====================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ---------------------------------------------------------------------
// 1. CONFIG — replace with your own Supabase project credentials.
//    Supabase Dashboard > Project Settings > API
// ---------------------------------------------------------------------
export const SUPABASE_URL = "https://ixntllvgntshbfocwuur.supabase.co";
export const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml4bnRsbHZnbnRzaGJmb2N3dXVyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ3MTczMjUsImV4cCI6MjEwMDI5MzMyNX0.-UnMGcxju5wgSol35U9dP8sI4e9qSiAosFGfgeprSaM";

// Flutterwave PUBLIC key only (safe for the browser) — from Flutterwave
// Dashboard > Settings > API. Never put your SECRET key here; it belongs
// only in the edge functions' environment (see uganda-pos-fn-*.ts).
// TODO: Replace with your actual Flutterwave public key
export const FLW_PUBLIC_KEY = "FLWPUBK-c674c3734489ef0493fc36474af983a1-X";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
});

// ---------------------------------------------------------------------
// 2. SHARED STATE (singleton — every module imports the same object)
// ---------------------------------------------------------------------
export const STATE = {
  session: null,
  appUser: null, // row from app_users
  business: null, // row from businesses
  branch: null, // current branch row
  branches: [],
  currencies: [], // rows from currencies
  rates: {}, // code -> rate_to_base (latest)
  categories: [],
  products: [],
  stockByProduct: {}, // productId -> qty in current branch
  customers: [],
  suppliers: [],
  taxCategories: [],
  brands: [],
  units: [],
  cart: [], // { productId, name, qty, unitPriceBase, taxCode, discount }
  cartCustomerId: null,
  cartCouponCode: null,
  cartCouponDiscount: 0,
  displayCurrency: "UGX",
  theme: localStorage.getItem("ugpos_theme") || "light",
  route: "dashboard",
  subscription: null, // row from subscriptions, joined with its plan
  plan: null, // row from plans (current active/trialing plan)
  isSuperadmin: false,
  notifications: [],
  unreadCount: 0,
};

// ---------------------------------------------------------------------
// 3. DOM / UI UTILITIES
// ---------------------------------------------------------------------
export const $ = (id) => document.getElementById(id);
export const qsa = (sel, root = document) =>
  Array.from(root.querySelectorAll(sel));

export function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function uid() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function toast(message, type = "default", ms = 3200) {
  const stack = $("toast-stack");
  if (!stack) return;
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = message;
  stack.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

export function openModal(innerHtml, { large = false, onMount } = {}) {
  const root = $("modal-root");
  root.innerHTML = `
    <div class="modal-overlay" id="active-modal-overlay">
      <div class="modal ${large ? "modal-lg" : ""}">${innerHtml}</div>
    </div>`;
  const overlay = $("active-modal-overlay");
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeModal();
  });
  qsa("[data-close-modal]", root).forEach((b) =>
    b.addEventListener("click", closeModal),
  );
  if (onMount) onMount(root);
}

export function closeModal() {
  const root = $("modal-root");
  if (root) root.innerHTML = "";
}

// ---------------------------------------------------------------------
// 4. CURRENCY HELPERS
//    rate_to_base means: 1 unit of `code` == rate_to_base units of base currency (UGX by default)
// ---------------------------------------------------------------------
export function toBase(amount, code) {
  const rate = STATE.rates[code] ?? 1;
  return round2(amount * rate);
}

export function fromBase(amountBase, code) {
  const rate = STATE.rates[code] ?? 1;
  return round2(amountBase / rate);
}

export function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function currencyMeta(code) {
  return (
    STATE.currencies.find((c) => c.code === code) || {
      symbol: code,
      decimal_places: 2,
    }
  );
}

export function fmtMoney(amountBase, code = STATE.displayCurrency) {
  const meta = currencyMeta(code);
  const amount = fromBase(amountBase, code);
  const formatted = amount.toLocaleString("en-UG", {
    minimumFractionDigits: meta.decimal_places,
    maximumFractionDigits: meta.decimal_places,
  });
  return `${meta.symbol} ${formatted}`;
}

export function fmtMoneyRaw(amount, code = STATE.displayCurrency) {
  const meta = currencyMeta(code);
  return `${meta.symbol} ${amount.toLocaleString("en-UG", {
    minimumFractionDigits: meta.decimal_places,
    maximumFractionDigits: meta.decimal_places,
  })}`;
}

export function fmtDate(d) {
  return new Date(d).toLocaleString("en-UG", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

// Sanitize a value for CSV export to prevent formula injection attacks.
// Prefixes dangerous characters (=, +, -, @, \t, \n) with a single quote.
export function sanitizeCsvValue(v) {
  const s = String(v ?? "");
  if (/^[=+\-@\t\r\n]/.test(s)) return "'" + s;
  return s;
}

export function emptyStateHtml(icon, title, description, ctaLabel, ctaAction) {
  return `<div class="empty-state" style="padding:60px 24px;">
    <span class="big-icon" style="font-size:52px;display:block;margin-bottom:16px;">${icon}</span>
    <h3 style="margin:0 0 8px;font-size:18px;font-weight:700;">${escapeHtml(title)}</h3>
    <p style="margin:0 auto 20px;color:var(--text-muted);max-width:360px;line-height:1.6;">${escapeHtml(description)}</p>
    ${ctaLabel && ctaAction ? `<button class="btn btn-primary" id="empty-cta">${ctaLabel}</button>` : ""}
  </div>`;
}

export function wireEmptyCta(action) {
  const btn = document.getElementById("empty-cta");
  if (btn && action) btn.addEventListener("click", action);
}

export function statusBadgeHtml(status, size = "sm") {
  const s = (status || "").toLowerCase().replace(/[\s_]+/g, "_");
  const map = {
    paid: { cls: "badge-green", icon: "✓" },
    unpaid: { cls: "badge-red", icon: "✗" },
    pending: { cls: "badge-yellow", icon: "⏳" },
    partial: { cls: "badge-yellow", icon: "◐" },
    credit: { cls: "badge-blue", icon: "📝" },
    completed: { cls: "badge-green", icon: "✓" },
    processing: { cls: "badge-blue", icon: "⚙" },
    cancelled: { cls: "badge-red", icon: "✕" },
    voided: { cls: "badge-gray", icon: "⊘" },
    returned: { cls: "badge-red", icon: "↩" },
    trialing: { cls: "badge-blue", icon: "★" },
    active: { cls: "badge-green", icon: "●" },
    expired: { cls: "badge-red", icon: "⚠" },
    past_due: { cls: "badge-yellow", icon: "⚠" },
    draft: { cls: "badge-gray", icon: "✎" },
    ordered: { cls: "badge-blue", icon: "📦" },
    received: { cls: "badge-green", icon: "📥" },
    converted: { cls: "badge-green", icon: "✓" },
    open: { cls: "badge-blue", icon: "○" },
    successful: { cls: "badge-green", icon: "✓" },
    failed: { cls: "badge-red", icon: "✗" },
    low: { cls: "badge-red", icon: "↓" },
    in_stock: { cls: "badge-green", icon: "↑" },
    expiring: { cls: "badge-yellow", icon: "⏰" },
    expired: { cls: "badge-red", icon: "⚠" },
  };
  const entry = map[s] || { cls: "badge-gray", icon: "?" };
  const isSmall = size === "sm";
  return `<span class="badge ${entry.cls}" style="${isSmall ? 'font-size:10px;padding:2px 7px;' : 'font-size:11px;padding:3px 10px;'}">${entry.icon} ${escapeHtml(status)}</span>`;
}

export function printHtml(html, title = "Print") {
  const w = window.open("", "_blank");
  if (!w) { toast("Popup blocked. Allow popups to print.", "error", 4000); return; }
  w.document.write(`<!doctype html><html><head><title>${escapeHtml(title)}</title><style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap');
    *{box-sizing:border-box;margin:0;padding:0;}
    body{font-family:'Inter',-apple-system,sans-serif;background:#f3f4f6;padding:20px;color:#111827;-webkit-font-smoothing:antialiased;}
    .doc-wrap{max-width:800px;margin:0 auto;background:#fff;border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,0.08);padding:40px;}
    table{width:100%;border-collapse:collapse;}
    th{background:#f9fafb;padding:10px 12px;text-align:left;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#6b7280;border-bottom:2px solid #e5e7eb;}
    td{padding:10px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;}
    .text-right{text-align:right;}
    .font-bold{font-weight:700;}
    .text-muted{color:#6b7280;font-size:12px;}
    .divider{border:none;border-top:1px solid #e5e7eb;margin:8px 0;}
    h2{font-size:22px;font-weight:800;letter-spacing:-0.02em;}
  </style></head><body><div class="doc-wrap">${html}</div></body></html>`);
  w.document.close();
  w.onload = () => { w.focus(); w.print(); w.close(); };
}

export function professionalDocHtml(opts = {}) {
  const {
    title = "RECEIPT", docNumber = "", date = "", businessName = "", businessInfo = "",
    customerName = "", customerInfo = "", items = [], totals = [], footer = "",
    logoUrl = "", qrData = "",
  } = opts;
  const totalRows = totals.map((t) =>
    `<div class="row ${t.grand ? 'grand' : ''}"><span>${escapeHtml(t.label)}</span><span>${escapeHtml(t.value)}</span></div>`
  ).join("");
  return `
    ${qrData ? `<div class="doc-qr"><img src="${escapeHtml(qrData)}" alt="QR" /></div>` : ""}
    <div class="doc-header">
      <div>${logoUrl ? `<img src="${escapeHtml(logoUrl)}" class="doc-logo" alt="logo" />` : `<h2>${escapeHtml(businessName || title)}</h2>`}</div>
      <div class="doc-title">${escapeHtml(title)}</div>
    </div>
    <div class="doc-meta">
      <div>${docNumber ? `<div class="label">Document No.</div><div class="value">${escapeHtml(docNumber)}</div>` : ""}
        <div class="label">Date</div><div class="value">${escapeHtml(date)}</div>
        ${customerName ? `<div class="label">Customer</div><div class="value">${escapeHtml(customerName)}</div>` : ""}
        ${customerInfo ? `<div class="value">${escapeHtml(customerInfo)}</div>` : ""}
      </div>
      <div>${businessInfo ? `<div class="label">Business</div><div class="value">${escapeHtml(businessInfo)}</div>` : ""}</div>
    </div>
    ${items.length ? `<table class="doc-items"><thead><tr><th>Item</th><th class="text-right">Qty</th><th class="text-right">Price</th><th class="text-right">Total</th></tr></thead><tbody>
      ${items.map((it) => `<tr><td>${escapeHtml(it.name)}</td><td class="text-right">${it.qty}</td><td class="text-right">${escapeHtml(it.price)}</td><td class="text-right font-bold">${escapeHtml(it.total)}</td></tr>`).join("")}
    </tbody></table>` : ""}
    ${totals.length ? `<div class="doc-totals">${totalRows}</div>` : ""}
    ${footer ? `<div class="doc-footer">${escapeHtml(footer)}</div>` : ""}
  `;
}

// =====================================================================
// THERMAL RECEIPT HTML — optimized for 80mm/58mm thermal printers
// =====================================================================
export function thermalReceiptHtml(opts = {}) {
  const {
    sale,
    business,
    docLabel = "RECEIPT",
    footNote = "",
    currencyCode = "UGX",
    width = 80, // mm
    template = null, // custom template from settings
  } = opts;

  const tpl = template || getReceiptTemplate();
  const color = tpl.primaryColor || "#0f6b4a";
  const textColor = tpl.secondaryColor || "#333333";
  const fontSize = tpl.fontSize || "12";
  const fmtMoney = (amt) => `${currencyCode} ${Number(amt || 0).toLocaleString()}`;

  const { lines, subtotal, discountTotal, vatTotal, grandTotal } = cartTotalsSnapshot(sale);
  const customer = sale.customer || {};
  const payment = sale.payments?.[0] || {};

  const logoHtml = tpl.showLogo && (tpl.logoUrl || business.logo_url)
    ? `<div class="center"><img src="${escapeHtml(tpl.logoUrl || business.logo_url)}" style="max-height:35px;max-width:100%;" /></div>`
    : "";
  const headerHtml = tpl.headerText ? `<div class="center small" style="color:#999;">${escapeHtml(tpl.headerText)}</div>` : "";
  const businessNameHtml = tpl.showBusinessName ? `<div class="center bold" style="color:${color};font-size:${parseInt(fontSize)+2}px;">${escapeHtml(business.name)}</div>` : "";
  const addressHtml = tpl.showAddress && business.address ? `<div class="center small">${escapeHtml(business.address)}</div>` : "";
  const tinHtml = tpl.showTin && business.tin ? `<div class="center small">TIN: ${escapeHtml(business.tin)}</div>` : "";
  const phoneHtml = tpl.showPhone && business.phone ? `<div class="center small">${escapeHtml(business.phone)}</div>` : "";
  const emailHtml = tpl.showEmail && business.email ? `<div class="center small">${escapeHtml(business.email)}</div>` : "";

  const invoiceTitle = tpl.invoiceTitle || docLabel;
  const invoiceNumberHtml = tpl.showInvoiceNumber ? `<div>No: ${escapeHtml(sale.sale_number)}</div>` : "";
  const dateHtml = tpl.showDate ? `<div>Date: ${new Date(sale.created_at || Date.now()).toLocaleString("en-UG")}</div>` : "";
  const serverHtml = tpl.showServerName ? `<div>Served by: ${escapeHtml(STATE.appUser?.full_name || "Cashier")}</div>` : "";
  const customerHtml = customer.name ? `<div>Customer: ${escapeHtml(customer.name)}</div>` : "";
  const customerTinHtml = customer.tin ? `<div>Customer TIN: ${escapeHtml(customer.tin)}</div>` : "";
  const paymentMethodHtml = payment.method ? `<div>Payment: ${escapeHtml(payment.method)}</div>` : "";

  const itemRows = lines.map((l) => `
    <tr><td colspan="2">${escapeHtml(l.name)}</td></tr>
    <tr><td>${l.qty} x ${fmtMoney(l.unitPrice)}</td><td class="text-right">${fmtMoney(l.lineGross)}</td></tr>
  `).join("");

  const subtotalRow = `<tr><td>Subtotal</td><td class="text-right">${fmtMoney(subtotal)}</td></tr>`;
  const discountRow = tpl.showDiscount && discountTotal > 0 ? `<tr><td>Discount</td><td class="text-right">- ${fmtMoney(discountTotal)}</td></tr>` : "";
  const vatRow = tpl.showTaxBreakdown ? `<tr><td>VAT (incl.)</td><td class="text-right">${fmtMoney(vatTotal)}</td></tr>` : "";
  const totalRow = `<tr><td class="bold" style="border-top:1px solid #000;">TOTAL</td><td class="text-right bold" style="border-top:1px solid #000;color:${color};">${fmtMoney(grandTotal)}</td></tr>`;

  const footerHtml = tpl.showFooter ? `<div class="center small" style="margin-top:6px;">${escapeHtml(footNote || tpl.footerText)}</div>` : "";
  const verifyHtml = business.efris_live_enabled && sale.fiscal_invoice_number
    ? `<div class="center small" style="margin-top:4px;color:#0f6b4a;">EFRIS Verified: ${escapeHtml(sale.fiscal_invoice_number)}</div>`
    : "";

  return `
    <div class="receipt" style="font-size:${fontSize}px; color:${textColor}; width:${width}mm;">
      ${logoHtml}
      ${headerHtml}
      ${businessNameHtml}
      ${addressHtml}
      ${tinHtml}
      ${phoneHtml}
      ${emailHtml}
      <hr style="border-color:${color};" />
      <div class="center bold" style="color:${color};">${escapeHtml(invoiceTitle)}</div>
      ${invoiceNumberHtml}
      ${dateHtml}
      ${serverHtml}
      <hr style="border-color:${color};" />
      ${customerHtml}
      ${customerTinHtml}
      ${paymentMethodHtml}
      <hr style="border-color:${color};" />
      <table>
        ${itemRows}
      </table>
      <hr style="border-color:${color};" />
      <table>
        ${subtotalRow}
        ${discountRow}
        ${vatRow}
        ${totalRow}
      </table>
      <hr style="border-color:${color};" />
      ${verifyHtml}
      ${footerHtml}
      <div class="cut-line">✂ ──────────────────── ✂</div>
    </div>
  `;
}

// Helper to get receipt template from localStorage (set in Settings)
export function getReceiptTemplate() {
  try {
    const stored = localStorage.getItem("ugpos_receipt_template");
    if (stored) return JSON.parse(stored);
  } catch {}
  return {
    primaryColor: "#0f6b4a",
    secondaryColor: "#333333",
    fontSize: "12",
    showLogo: true,
    showBusinessName: true,
    showAddress: true,
    showTin: true,
    showPhone: true,
    showEmail: false,
    showInvoiceNumber: true,
    showDate: true,
    showServerName: true,
    showDiscount: true,
    showTaxBreakdown: true,
    showFooter: true,
    invoiceTitle: "RECEIPT",
    footerText: "Thank you for your business!",
    headerText: "",
    logoUrl: "",
  };
}

// Re-export core sales functions from POS module
export { submitSaleToSupabase } from "./uganda-pos-view-pos.js";
export { submitQuotationToSupabase } from "./uganda-pos-view-pos.js";
export { receiptHtml } from "./uganda-pos-view-pos.js";
export { printHtml as posPrintHtml } from "./uganda-pos-view-pos.js";
export { cartTotalsSnapshot } from "./uganda-pos-view-pos.js";

// ---------------------------------------------------------------------
// 5. PAGINATION HELPER
// ---------------------------------------------------------------------
export function makePaginationState(pageSize = 50) {
  return { page: 0, pageSize, hasMore: true, loading: false };
}

export function paginationHtml(pState) {
  const total = pState.total || 0;
  const from = pState.page * pState.pageSize + 1;
  const to = Math.min((pState.page + 1) * pState.pageSize, total);
  return `
    <div class="pagination-bar">
      <span class="text-muted" style="font-size:12px;">${from}-${to} of ${total}</span>
      <div class="flex gap" style="align-items:center;">
        <button class="btn btn-ghost btn-sm" data-page="prev" ${pState.page === 0 ? "disabled" : ""}>← Prev</button>
        <span class="text-muted" style="font-size:12px;">Page ${pState.page + 1}</span>
        <button class="btn btn-ghost btn-sm" data-page="next" ${!pState.hasMore ? "disabled" : ""}>Next →</button>
      </div>
    </div>
  `;
}

export function wirePagination(pState, loadFn) {
  qsa("[data-page]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (pState.loading) return;
      if (btn.dataset.page === "next" && pState.hasMore) { pState.page++; loadFn(); }
      else if (btn.dataset.page === "prev" && pState.page > 0) { pState.page--; loadFn(); }
    });
  });
}

// ---------------------------------------------------------------------
// 6. DATA LOADERS
// ---------------------------------------------------------------------
export async function loadBootstrapData() {
  const { data: authData } = await supabase.auth.getSession();
  STATE.session = authData?.session || null;
  if (!STATE.session) return false;

  const uidUser = STATE.session.user.id;

  // Try to load app_user via the security-definer RPC (bypasses RLS).
  // If the RPC doesn't exist yet (schema not updated), fall back to a
  // direct query with maybeSingle() and the fixed policy.
  let appUser = null;
  let appUserErr = null;

  try {
    const { data: raw, error: rpcErr } = await supabase.rpc("get_my_app_user");
    if (rpcErr) throw rpcErr;
    if (raw)
      appUser =
        typeof raw === "object" && !Array.isArray(raw) ? raw : JSON.parse(raw);
  } catch (rpcErr) {
    console.warn(
      "get_my_app_user RPC failed, falling back to direct query:",
      rpcErr.message,
    );
    // Fallback: direct query — works with schema v8's fixed policy
    const result = await supabase
      .from("app_users")
      .select("*")
      .eq("id", uidUser)
      .maybeSingle();
    appUser = result.data;
    appUserErr = result.error;
  }

  if (!appUser) {
    console.warn(
      "App user not found for auth id:",
      uidUser,
      "error:",
      appUserErr?.message,
    );
    console.warn("Auth user email:", STATE.session?.user?.email);
    return false;
  }
  STATE.appUser = appUser;
  STATE.isSuperadmin = appUser.role === "superadmin";

  // Auto-activate user on login — if they can authenticate, they're active
  if (!appUser.is_active) {
    await supabase.from("app_users").update({ is_active: true }).eq("id", appUser.id);
    appUser.is_active = true;
    STATE.appUser.is_active = true;
  }

  // A superadmin with no business_id manages the whole platform from the
  // Admin console instead of a single vendor's dashboard — nothing else
  // to bootstrap for them.
  if (!appUser.business_id) {
    return true;
  }

  let business,
    branches,
    currencies,
    rates,
    categories,
    taxCategories,
    brands,
    units;
  try {
    [
      { data: business },
      { data: branches },
      { data: currencies },
      { data: rates },
      { data: categories },
      { data: taxCategories },
      { data: brands },
      { data: units },
    ] = await Promise.all([
      supabase
        .from("businesses")
        .select("*")
        .eq("id", appUser.business_id)
        .maybeSingle(),
      supabase
        .from("branches")
        .select("*")
        .eq("business_id", appUser.business_id),
      supabase.from("currencies").select("*").eq("is_active", true),
      supabase
        .from("exchange_rates")
        .select("*")
        .order("effective_at", { ascending: false }),
      supabase
        .from("categories")
        .select("*")
        .eq("business_id", appUser.business_id),
      supabase.from("tax_categories").select("*"),
      supabase
        .from("brands")
        .select("*")
        .eq("business_id", appUser.business_id),
      supabase.from("units").select("*").eq("is_active", true),
    ]);
  } catch (e) {
    console.error("Bootstrap query failed:", e);
    // If .single() threw PGRST116 (no rows), the business was deleted.
    // Allow proceeding — STATE.business stays null and navigateTo
    // will show "No Business Context" with an impersonate prompt.
    if (e?.code === "PGRST116") { business = null; }
    else { toast("Failed to load business data — please refresh.", "error", 8000); return false; }
  }

  STATE.business = business;
  STATE.branches = branches || [];
  STATE.branch =
    branches?.find((b) => b.id === appUser.branch_id) || branches?.[0] || null;
  const DEFAULT_CURRENCIES = [
    { code: "UGX", name: "Ugandan Shilling", symbol: "USh", is_base: false, is_active: true },
    { code: "KES", name: "Kenyan Shilling", symbol: "KSh", is_base: false, is_active: true },
    { code: "TZS", name: "Tanzanian Shilling", symbol: "TSh", is_base: false, is_active: true },
    { code: "USD", name: "US Dollar", symbol: "$", is_base: false, is_active: true },
    { code: "EUR", name: "Euro", symbol: "€", is_base: false, is_active: true },
    { code: "GBP", name: "British Pound", symbol: "£", is_base: false, is_active: true },
  ];
  STATE.currencies = (currencies && currencies.length > 0) ? currencies : DEFAULT_CURRENCIES;
  STATE.categories = categories || [];
  const DEFAULT_TAX_CATEGORIES = [
    { code: "VAT", name: "VAT Standard", rate: 18 },
    { code: "VAT0", name: "VAT Zero Rated", rate: 0 },
    { code: "VATE", name: "VAT Exempt", rate: 0 },
    { code: "NONE", name: "No Tax", rate: 0 },
  ];
  STATE.taxCategories = (taxCategories && taxCategories.length > 0) ? taxCategories : DEFAULT_TAX_CATEGORIES;
  STATE.brands = brands || [];
  STATE.units = units || [];
  STATE.variantTypes = [];
  STATE.displayCurrency = business?.base_currency || "UGX";

  // latest rate per currency
  const latest = {};
  (rates || []).forEach((r) => {
    if (!(r.currency_code in latest))
      latest[r.currency_code] = Number(r.rate_to_base);
  });
  STATE.rates = latest;

  await Promise.all([
    refreshProducts().catch((e) => console.warn("refreshProducts failed:", e)),
    refreshCustomers().catch((e) =>
      console.warn("refreshCustomers failed:", e),
    ),
    refreshSuppliers().catch((e) =>
      console.warn("refreshSuppliers failed:", e),
    ),
    refreshBrands().catch((e) => console.warn("refreshBrands failed:", e)),
    refreshUnits().catch((e) => console.warn("refreshUnits failed:", e)),
    refreshVariantTypes().catch((e) => console.warn("refreshVariantTypes failed:", e)),
    refreshCoupons().catch((e) => console.warn("refreshCoupons failed:", e)),
    loadSubscription().catch((e) =>
      console.warn("loadSubscription failed:", e),
    ),
  ]);

  // Generate inventory notifications (low stock, expiry alerts)
  generateInventoryNotifications().catch((e) =>
    console.warn("generateInventoryNotifications failed:", e),
  );

  return true;
}

// ---------------------------------------------------------------------
// 5b. SUBSCRIPTION / BILLING (plans, trial, feature gating)
// ---------------------------------------------------------------------
export async function loadSubscription() {
  if (!STATE.business) return;
  const { data } = await supabase
    .from("subscriptions")
    .select("*, plans(*)")
    .eq("business_id", STATE.business.id)
    .maybeSingle();
  STATE.subscription = data || null;
  STATE.plan = data?.plans || null;
}

// True while the business can use the app: still inside its trial window,
// or has an active paid period that hasn't lapsed yet.
export function applyTheme() {
  const color = STATE.business?.theme_color || localStorage.getItem("ugpos_theme_color") || "#0f6b4a";
  const root = document.documentElement;
  root.style.setProperty("--brand", color);
  root.style.setProperty("--brand-dark", shadeColor(color, -20));
  root.style.setProperty("--brand-darker", shadeColor(color, -35));
  root.style.setProperty("--brand-light", color + "18");
  root.style.setProperty("--brand-lighter", color + "0a");
  root.style.setProperty("--brand-glow", color + "1e");

  // Derive sidebar background from the brand color
  const isDark = root.dataset.theme === "dark";
  const sidebarBg = isDark ? shadeColor(color, -65) : shadeColor(color, -50);
  root.style.setProperty("--sidebar-bg", sidebarBg);
  root.style.setProperty("--sidebar-bg-glow", sidebarBg + "cc");

  const fontSize = STATE.business?.theme_font_size || localStorage.getItem("ugpos_theme_font_size") || "15px";
  root.style.fontSize = fontSize;

  // Flash the sidebar with the new brand color
  const sidebar = document.getElementById("sidebar");
  if (sidebar) {
    sidebar.classList.remove("sidebar-flash");
    void sidebar.offsetWidth; // Trigger reflow to restart animation
    sidebar.classList.add("sidebar-flash");
    setTimeout(() => sidebar.classList.remove("sidebar-flash"), 800);
  }
}

function shadeColor(col, pct) {
  const hex = col.replace("#", "");
  const num = parseInt(hex, 16);
  const r = Math.max(0, Math.min(255, ((num >> 16) & 0xff) + pct));
  const g = Math.max(0, Math.min(255, ((num >> 8) & 0xff) + pct));
  const b = Math.max(0, Math.min(255, (num & 0xff) + pct));
  return "#" + ((r << 16) | (g << 8) | b).toString(16).padStart(6, "0");
}

export function isSubscriptionActive() {
  if (STATE.isSuperadmin) return true;
  const sub = STATE.subscription;
  if (!sub) return false;
  const now = new Date();
  if (sub.status === "trialing")
    return !sub.trial_ends_at || new Date(sub.trial_ends_at) > now;
  if (sub.status === "active")
    return !sub.current_period_end || new Date(sub.current_period_end) > now;
  return false; // past_due, cancelled, expired
}

export function trialDaysLeft() {
  if (!STATE.subscription?.trial_ends_at) return 0;
  const diffMs = new Date(STATE.subscription.trial_ends_at) - new Date();
  return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
}

// Checks a boolean/number flag on the current plan's `features` jsonb —
// e.g. hasFeature('multi_currency'), hasFeature('efris'), hasFeature('reports_export').
export function hasFeature(key) {
  if (STATE.isSuperadmin) return true;
  return !!(STATE.plan?.features && STATE.plan.features[key]);
}

export async function refreshProducts() {
  if (!STATE.business) return;
  const { data: products } = await supabase
    .from("products")
    .select("*")
    .eq("business_id", STATE.business.id)
    .eq("is_active", true)
    .order("name");
  STATE.products = products || [];

  if (STATE.branch) {
    const { data: stock } = await supabase
      .from("product_stock")
      .select("*")
      .eq("branch_id", STATE.branch.id);
    const map = {};
    (stock || []).forEach((s) => {
      map[s.product_id] = Number(s.quantity);
    });
    STATE.stockByProduct = map;
  }
}

export async function refreshCustomers() {
  if (!STATE.business) return;
  const { data } = await supabase
    .from("customers")
    .select("*")
    .eq("business_id", STATE.business.id)
    .order("name");
  STATE.customers = data || [];
}

export async function refreshSuppliers() {
  if (!STATE.business) return;
  const { data } = await supabase
    .from("suppliers")
    .select("*")
    .eq("business_id", STATE.business.id)
    .order("name");
  STATE.suppliers = data || [];
}

export async function refreshCoupons() {
  if (!STATE.business) return;
  const { data, error } = await supabase
    .from("coupons")
    .select("*")
    .eq("business_id", STATE.business.id)
    .eq("is_active", true);
  if (error && error.message?.includes("does not exist")) {
    console.warn("coupons table not found — run uganda-pos-schema-v8d.sql");
    STATE.coupons = [];
    return;
  }
  STATE.coupons = data || [];
}

export async function refreshBrands() {
  if (!STATE.business) return;
  const { data } = await supabase
    .from("brands")
    .select("*")
    .eq("business_id", STATE.business.id)
    .order("name");
  STATE.brands = data || [];
}

export async function refreshUnits() {
  const { data } = await supabase
    .from("units")
    .select("*")
    .eq("is_active", true)
    .order("name");
  STATE.units = data || [];
}

export async function refreshVariantTypes() {
  if (!STATE.business) return;
  const { data } = await supabase
    .from("variant_types")
    .select("*")
    .eq("business_id", STATE.business.id)
    .order("sort_order");
  STATE.variantTypes = data || [];
}

export function stockFor(productId) {
  return STATE.stockByProduct[productId] ?? 0;
}

export function lowStockProducts() {
  return STATE.products.filter(
    (p) => stockFor(p.id) <= Number(p.reorder_level ?? 0),
  );
}

// ---------------------------------------------------------------------
// 6b. NOTIFICATIONS
// ---------------------------------------------------------------------
let _notifChannel = null;

export async function loadNotifications() {
  if (!STATE.business || !STATE.appUser) return;
  const { data } = await supabase
    .from("notifications")
    .select("*")
    .or(
      `user_id.eq.${STATE.appUser.id},and(user_id.is.null,business_id.eq.${STATE.business.id})`,
    )
    .order("created_at", { ascending: false })
    .limit(50);
  STATE.notifications = data || [];
  STATE.unreadCount = STATE.notifications.filter((n) => !n.is_read).length;
}

export function subscribeToNotifications(onNew) {
  if (!STATE.business || !STATE.appUser) return;
  if (_notifChannel) supabase.removeChannel(_notifChannel);

  _notifChannel = supabase
    .channel(`notifications:${STATE.appUser.id}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "notifications",
        filter: `business_id=eq.${STATE.business.id}`,
      },
      (payload) => {
        const n = payload.new;
        if (n.user_id && n.user_id !== STATE.appUser.id) return;
        STATE.notifications.unshift(n);
        if (!n.is_read) STATE.unreadCount++;
        if (onNew) onNew(n);
      },
    )
    .subscribe();
}

export async function markNotificationRead(id) {
  await supabase.from("notifications").update({ is_read: true }).eq("id", id);
  const n = STATE.notifications.find((x) => x.id === id);
  if (n && !n.is_read) {
    n.is_read = true;
    STATE.unreadCount = Math.max(0, STATE.unreadCount - 1);
  }
}

export async function markAllNotificationsRead() {
  if (!STATE.business) return;
  await supabase
    .from("notifications")
    .update({ is_read: true })
    .eq("business_id", STATE.business.id)
    .is("user_id", null)
    .eq("is_read", false);
  await supabase
    .from("notifications")
    .update({ is_read: true })
    .eq("user_id", STATE.appUser.id)
    .eq("is_read", false);
  STATE.notifications.forEach((n) => (n.is_read = true));
  STATE.unreadCount = 0;
}

export async function createNotification({
  title,
  body,
  type = "info",
  route = null,
  userId = null,
}) {
  if (!STATE.business) return;
  await supabase.rpc("insert_notification", {
    p_business_id: STATE.business.id,
    p_user_id: userId,
    p_title: title,
    p_body: body,
    p_type: type,
    p_route: route,
  });
}

// ---------------------------------------------------------------------
// 6b. INVENTORY NOTIFICATIONS (low stock, expiry alerts)
// ---------------------------------------------------------------------
export async function generateInventoryNotifications() {
  if (!STATE.business || !STATE.branch) return;
  const now = new Date();
  const sevenDays = new Date(now.getTime() + 7 * 86400000);
  const thirtyDays = new Date(now.getTime() + 30 * 86400000);

  // 1. Low stock alerts
  const low = lowStockProducts();
  if (low.length > 0) {
    const names = low.slice(0, 3).map(p => p.name).join(", ");
    const suffix = low.length > 3 ? ` and ${low.length - 3} more` : "";
    await createNotification({
      title: `${low.length} product(s) low on stock`,
      body: `${names}${suffix} are at or below reorder level`,
      type: "stock",
      route: "inventory",
    }).catch(() => {});
  }

  // 2. Expiring batches (within 7 days)
  const { data: expiringSoon } = await supabase
    .from("stock_batches")
    .select("id, batch_number, expiry_date, product:products(name)")
    .eq("business_id", STATE.business.id)
    .eq("branch_id", STATE.branch.id)
    .gt("quantity", 0)
    .not("expiry_date", "is", null)
    .lte("expiry_date", sevenDays.toISOString().slice(0, 10))
    .gte("expiry_date", now.toISOString().slice(0, 10));

  if (expiringSoon?.length) {
    const names = expiringSoon.slice(0, 3).map(b => `${b.product?.name} (${b.batch_number})`).join(", ");
    const suffix = expiringSoon.length > 3 ? ` and ${expiringSoon.length - 3} more` : "";
    await createNotification({
      title: `${expiringSoon.length} batch(es) expiring soon`,
      body: `${names}${suffix} expire within 7 days`,
      type: "warning",
      route: "inventory",
    }).catch(() => {});
  }

  // 3. Expired batches
  const { data: expired } = await supabase
    .from("stock_batches")
    .select("id, batch_number, expiry_date, product:products(name)")
    .eq("business_id", STATE.business.id)
    .eq("branch_id", STATE.branch.id)
    .gt("quantity", 0)
    .not("expiry_date", "is", null)
    .lt("expiry_date", now.toISOString().slice(0, 10));

  if (expired?.length) {
    const names = expired.slice(0, 3).map(b => `${b.product?.name} (${b.batch_number})`).join(", ");
    const suffix = expired.length > 3 ? ` and ${expired.length - 3} more` : "";
    await createNotification({
      title: `${expired.length} batch(es) expired`,
      body: `${names}${suffix} have passed their expiry date`,
      type: "error",
      route: "inventory",
    }).catch(() => {});
  }
}

// ---------------------------------------------------------------------
// 6c. PUSH NOTIFICATIONS (Web Push API)
// ---------------------------------------------------------------------
const VAPID_PUBLIC_KEY = null; // Set your VAPID public key here when ready

export async function registerPushSubscription() {
  if (
    !("serviceWorker" in navigator) ||
    !("PushManager" in window) ||
    !VAPID_PUBLIC_KEY
  )
    return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
    const keys = sub.toJSON().keys;
    await supabase.from("push_subscriptions").upsert(
      {
        user_id: STATE.appUser.id,
        business_id: STATE.business.id,
        endpoint: sub.endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
      },
      { onConflict: "endpoint" },
    );
  } catch (e) {
    console.warn("Push subscription failed:", e.message);
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

// ---------------------------------------------------------------------
// 7. ROLE GUARD
// ---------------------------------------------------------------------
export function hasRole(...roles) {
  return STATE.appUser && roles.includes(STATE.appUser.role);
}

// ---------------------------------------------------------------------
// 8. OFFLINE QUEUE (localStorage-backed — sales made while offline are
//    queued here and pushed to Supabase once the connection returns)
// ---------------------------------------------------------------------
const OFFLINE_KEY = "ugpos_offline_sales";

export function queueOfflineSale(payload) {
  let list = [];
  try {
    list = JSON.parse(localStorage.getItem(OFFLINE_KEY) || "[]");
  } catch (e) {
    list = [];
  }
  list.push(payload);
  localStorage.setItem(OFFLINE_KEY, JSON.stringify(list));
}

export function offlineQueueCount() {
  try {
    return JSON.parse(localStorage.getItem(OFFLINE_KEY) || "[]").length;
  } catch (e) {
    return 0;
  }
}

export async function flushOfflineQueue(insertSaleFn) {
  const list = JSON.parse(localStorage.getItem(OFFLINE_KEY) || "[]");
  if (!list.length) return;
  const remaining = [];
  let synced = 0;
  for (const payload of list) {
    try {
      await insertSaleFn(payload);
      synced++;
    } catch (e) {
      console.warn("Offline sale sync failed, will retry:", e.message || e);
      remaining.push(payload);
    }
  }
  localStorage.setItem(OFFLINE_KEY, JSON.stringify(remaining));
  if (remaining.length === 0 && synced > 0) {
    toast(
      `Offline sales synced successfully (${synced} sale${synced > 1 ? "s" : ""}).`,
      "success",
    );
  } else if (remaining.length > 0 && synced > 0) {
    toast(
      `${synced} of ${list.length} offline sales synced. ${remaining.length} will retry.`,
      "default",
      5000,
    );
  } else if (remaining.length > 0) {
    toast(
      `Could not sync ${remaining.length} offline sale(s) — will retry when online.`,
      "error",
      5000,
    );
  }
}

// ---------------------------------------------------------------------
// 8b. OFFLINE EFRIS QUEUE (EFRIS payloads staged while offline are
//     submitted automatically once the connection returns)
// ---------------------------------------------------------------------
const EFRIS_OFFLINE_KEY = "ugpos_offline_efris";

export function queueOfflineEfris(efrisPayload) {
  let list = [];
  try {
    list = JSON.parse(localStorage.getItem(EFRIS_OFFLINE_KEY) || "[]");
  } catch (e) {
    list = [];
  }
  list.push(efrisPayload);
  localStorage.setItem(EFRIS_OFFLINE_KEY, JSON.stringify(list));
}

export function offlineEfrisQueueCount() {
  try {
    return JSON.parse(localStorage.getItem(EFRIS_OFFLINE_KEY) || "[]").length;
  } catch (e) {
    return 0;
  }
}

export async function flushOfflineEfrisQueue() {
  const list = JSON.parse(localStorage.getItem(EFRIS_OFFLINE_KEY) || "[]");
  if (!list.length) return;
  const remaining = [];
  let synced = 0;
  const isS2S = STATE.business?.efris_provider === 'direct_s2s';
  for (const entry of list) {
    try {
      const fnName = isS2S ? "efris-s2s" : "efris-submit-invoice";
      const body = isS2S
        ? { action: "fiscalise_invoice", payload: { efris_invoice_id: entry.efrisInvoiceId } }
        : { efrisInvoiceId: entry.efrisInvoiceId };
      const { data, error } = await supabase.functions.invoke(fnName, { body });
      if (error || !data?.success) {
        remaining.push(entry);
      } else {
        synced++;
      }
    } catch (e) {
      remaining.push(entry);
    }
  }
  localStorage.setItem(EFRIS_OFFLINE_KEY, JSON.stringify(remaining));
  if (remaining.length === 0 && synced > 0) {
    toast(`Offline EFRIS invoices submitted (${synced}).`, "success");
  } else if (remaining.length > 0 && synced > 0) {
    toast(`${synced} of ${list.length} offline EFRIS invoices submitted. ${remaining.length} will retry.`, "default", 5000);
  } else if (remaining.length > 0) {
    toast(`Could not submit ${remaining.length} offline EFRIS invoice(s) — will retry when online.`, "error", 5000);
  }
}

// ---------------------------------------------------------------------
// 9. EFRIS (URA E-INVOICING) HELPERS
//
// buildEfrisPayload() emits the exact request shape the EFRIS Simplified
// middleware API expects for a standard invoice (see
// https://efrissimplified.com/docs/fiscal-invoices, scenario A) — the
// same JSON also works as a faithful *simulated* payload when no live
// provider is connected yet (see uganda-pos-view-efris.js).
//
// Simplifications made here (documented so you know exactly where to
// extend this if you need them):
//   - Cart-level discounts are folded into each line's effective unit
//     price rather than emitted as separate EFRIS "discount lines" —
//     net/tax/gross are still exactly correct, you just won't see a
//     separate discount line item on the printed invoice.
//   - Excise duty, exports, deemed VAT, imported services, and
//     airline/fuel invoice types are not built — those are rarer for a
//     typical retail/pharmacy/supermarket till. See the "Fiscal
//     Invoices" doc link above for those payload shapes if you need them.
// ---------------------------------------------------------------------

const EFRIS_TAX_CODE = { VAT: "01", STD: "01", ZERO: "02", EXEMPT: "03", DEEMED: "04" };
const EFRIS_TAX_RATE = { VAT: "0.18", STD: "0.18", ZERO: "0", EXEMPT: "-", DEEMED: "0.18" };

// Uganda TIN format: 9 digits followed by a single check letter (e.g. "1000123456X").
export function isValidUgandaTin(tin) {
  if (!tin) return false;
  return /^\d{9}[A-Za-z]$/.test(String(tin).trim());
}

// Returns an error message if `tin` is provided but not a valid Uganda TIN, else "".
export function tinValidationError(tin) {
  const t = String(tin || "").trim();
  if (!t) return "";
  return isValidUgandaTin(t)
    ? ""
    : "TIN must be 9 digits followed by a letter (e.g. 1000123456X)";
}

const PAYMENT_MODE_CODE = {
  credit: "101",
  cash: "102",
  mobile_money: "105",
  card: "106",
  bank: "107",
};

function efrisNow() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function buildEfrisPayload({
  sale,
  items,
  business,
  customer,
  payments = [],
  operator,
}) {
  const goodsDetails = items.map((it, idx) => {
    const product = STATE.products.find((p) => p.id === it.product_id);
    const taxCode = EFRIS_TAX_CODE[it.tax_category_code] || "01";
    const taxRate = EFRIS_TAX_RATE[it.tax_category_code] ?? "0.18";
    const qty = Number(it.quantity) || 0;
    const effectiveUnitPrice = qty
      ? round2(Number(it.line_total) / qty)
      : Number(it.unit_price);
    return {
      item: it.product_name,
      itemCode: product?.sku || product?.barcode || it.product_id,
      qty: String(qty),
      unitOfMeasure: product?.efris_measure_unit || "101",
      unitPrice: String(effectiveUnitPrice),
      total: String(it.line_total),
      taxRate,
      tax: taxRate === "-" ? "0" : String(it.vat_amount),
      orderNumber: String(idx),
      discountFlag: "2",
      deemedFlag: "2",
      exciseFlag: "2",
      goodsCategoryId: product?.efris_commodity_category_id || "",
      _taxCode: taxCode, // internal only, stripped before sending — used to group taxDetails below
    };
  });

  const taxGroups = {};
  goodsDetails.forEach((g) => {
    const key = g._taxCode;
    const gross = Number(g.total);
    const tax = g.taxRate === "-" ? 0 : Number(g.tax);
    if (!taxGroups[key])
      taxGroups[key] = { taxRate: g.taxRate, gross: 0, tax: 0 };
    taxGroups[key].gross += gross;
    taxGroups[key].tax += tax;
  });

  const taxDetails = Object.entries(taxGroups).map(([code, g]) => ({
    taxCategoryCode: code,
    netAmount: round2(g.gross - g.tax).toFixed(2),
    taxRate: g.taxRate,
    taxAmount: round2(g.tax).toFixed(2),
    grossAmount: round2(g.gross).toFixed(2),
  }));

  const netAmount = taxDetails.reduce((a, t) => a + Number(t.netAmount), 0);
  const taxAmount = taxDetails.reduce((a, t) => a + Number(t.taxAmount), 0);
  const grossAmount = taxDetails.reduce((a, t) => a + Number(t.grossAmount), 0);

  const payWay = payments.map((p, idx) => ({
    paymentMode: PAYMENT_MODE_CODE[p.method] || "102",
    paymentAmount: String(p.amount),
    orderNumber: String.fromCharCode(97 + idx), // 'a', 'b', 'c'...
  }));

  return {
    invoice: {
      sellerDetails: {
        tin: business?.tin || "",
        legalName: business?.name || "",
        businessName: business?.name || "",
        emailAddress: business?.email || "",
        referenceNo: sale.sale_number || "",
        isCheckReferenceNo: "0",
      },
      basicInformation: {
        invoiceNo: "",
        antifakeCode: "",
        deviceNo:
          business?.efris_device_no ||
          (business?.tin ? `${business.tin}_01` : ""),
        issuedDate: efrisNow(),
        operator: operator || "Cashier",
        currency: sale.currency_code || "UGX",
        invoiceType: "1",
        invoiceKind: "1",
        dataSource: "103",
      },
      buyerDetails: customer?.tin
        ? {
            buyerType: "0",
            buyerLegalName: customer?.name || "Customer",
            buyerTin: customer.tin,
          }
        : {
            buyerType: "1",
            buyerLegalName: customer?.name || "Walk-in Customer",
          },
      goodsDetails: goodsDetails.map(({ _taxCode, ...g }) => g),
      taxDetails,
      summary: {
        netAmount: netAmount.toFixed(2),
        taxAmount: taxAmount.toFixed(2),
        grossAmount: grossAmount.toFixed(2),
        itemCount: String(goodsDetails.length),
        modeCode: "1",
        remarks: "Thank you for your business",
      },
      payWay: payWay.length
        ? payWay
        : [
            {
              paymentMode: "102",
              paymentAmount: grossAmount.toFixed(2),
              orderNumber: "a",
            },
          ],
    },
  };
}

// Build a credit/debit note payload referencing a previously fiscalised invoice.
// invoiceType: "2" = credit note (refund/reduction), "3" = debit note (additional charge)
export function buildEfrisCreditDebitPayload({
  originalInvoice,
  returnItems,
  business,
  customer,
  reason,
  invoiceType = "2",
  operator,
}) {
  const goodsDetails = returnItems.map((it, idx) => {
    const product = STATE.products.find((p) => p.id === it.product_id);
    const taxCode = EFRIS_TAX_CODE[it.tax_category_code] || "01";
    const taxRate = EFRIS_TAX_RATE[it.tax_category_code] ?? "0.18";
    const qty = Math.abs(Number(it.quantity) || 0);
    const unitPrice = Number(it.unit_price) || 0;
    const lineTotal = round2(qty * unitPrice);
    const vatAmount = taxRate === "-" ? 0 : round2(lineTotal * Number(taxRate));
    return {
      item: it.product_name || product?.name || "Item",
      itemCode: product?.sku || product?.barcode || it.product_id || "",
      qty: String(qty),
      unitOfMeasure: product?.efris_measure_unit || "101",
      unitPrice: String(unitPrice),
      total: String(lineTotal),
      taxRate,
      tax: String(vatAmount),
      orderNumber: String(idx),
      discountFlag: "2",
      deemedFlag: "2",
      exciseFlag: "2",
      goodsCategoryId: product?.efris_commodity_category_id || "",
      _taxCode: taxCode,
    };
  });

  const taxGroups = {};
  goodsDetails.forEach((g) => {
    const key = g._taxCode;
    const gross = Number(g.total);
    const tax = g.taxRate === "-" ? 0 : Number(g.tax);
    if (!taxGroups[key]) taxGroups[key] = { taxRate: g.taxRate, gross: 0, tax: 0 };
    taxGroups[key].gross += gross;
    taxGroups[key].tax += tax;
  });

  const taxDetails = Object.entries(taxGroups).map(([code, g]) => ({
    taxCategoryCode: code,
    netAmount: round2(g.gross - g.tax).toFixed(2),
    taxRate: g.taxRate,
    taxAmount: round2(g.tax).toFixed(2),
    grossAmount: round2(g.gross).toFixed(2),
  }));

  const grossAmount = taxDetails.reduce((a, t) => a + Number(t.grossAmount), 0);
  const taxAmount = taxDetails.reduce((a, t) => a + Number(t.taxAmount), 0);

  return {
    invoice: {
      sellerDetails: {
        tin: business?.tin || "",
        legalName: business?.name || "",
        businessName: business?.name || "",
        emailAddress: business?.email || "",
        referenceNo: originalInvoice?.fiscal_invoice_number || "",
        isCheckReferenceNo: "1",
      },
      basicInformation: {
        invoiceNo: "",
        antifakeCode: "",
        deviceNo:
          business?.efris_device_no ||
          (business?.tin ? `${business.tin}_01` : ""),
        issuedDate: efrisNow(),
        operator: operator || "Cashier",
        currency: originalInvoice?.currency_code || "UGX",
        invoiceType,
        invoiceKind: "1",
        dataSource: "103",
      },
      buyerDetails: customer?.tin
        ? {
            buyerType: "0",
            buyerLegalName: customer?.name || "Customer",
            buyerTin: customer.tin,
          }
        : {
            buyerType: "1",
            buyerLegalName: customer?.name || "Walk-in Customer",
          },
      goodsDetails: goodsDetails.map(({ _taxCode, ...g }) => g),
      taxDetails,
      summary: {
        netAmount: round2(grossAmount - taxAmount).toFixed(2),
        taxAmount: taxAmount.toFixed(2),
        grossAmount: grossAmount.toFixed(2),
        itemCount: String(goodsDetails.length),
        modeCode: "1",
        remarks: reason || (invoiceType === "2" ? "Credit note" : "Debit note"),
      },
      payWay: [
        {
          paymentMode: "102",
          paymentAmount: grossAmount.toFixed(2),
          orderNumber: "a",
        },
      ],
    },
  };
}

// ── Image resize utility ──
export function resizeImage(file, maxSize = 400, quality = 0.7) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let w = img.width, h = img.height;
        if (w > maxSize || h > maxSize) {
          const ratio = Math.min(maxSize / w, maxSize / h);
          w = Math.round(w * ratio);
          h = Math.round(h * ratio);
        }
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob((blob) => {
          resolve(new File([blob], file.name, { type: blob.type || "image/jpeg", lastModified: Date.now() }));
        }, "image/jpeg", quality);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// =====================================================================
// THERMAL RECEIPT PRINT — 80mm / 58mm paper sizes with auto-print
// =====================================================================
export function printThermalReceipt(html, opts = {}) {
  const { width = 80, title = "Receipt" } = opts; // width in mm
  const w = window.open("", "_blank");
  if (!w) { toast("Popup blocked. Allow popups to print.", "error", 4000); return; }
  w.document.write(`<!doctype html>
<html>
<head>
  <title>${escapeHtml(title)}</title>
  <style>
    @media print {
      @page { size: ${width}mm auto; margin: 0; }
      html, body { margin: 0; padding: 0; width: ${width}mm; background: white; }
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: monospace, 'Courier New', monospace; font-size: 12px; width: ${width}mm; padding: 4mm; color: #000; background: white; }
    .center { text-align: center; }
    .bold { font-weight: bold; }
    .large { font-size: 14px; }
    .small { font-size: 10px; }
    hr { border: none; border-top: 1px dashed #000; margin: 4px 0; }
    .row { display: flex; justify-content: space-between; margin: 3px 0; }
    .qr { display: block; margin: 6px auto; }
    table { width: 100%; border-collapse: collapse; font-size: 11px; }
    td { padding: 2px 0; vertical-align: top; }
    .text-right { text-align: right; }
    .cut-line { text-align: center; margin-top: 12px; color: #999; font-size: 9px; }
  </style>
</head>
<body>${html}</body>
</html>`);
  w.document.close();
  w.onload = () => { w.focus(); w.print(); };
}

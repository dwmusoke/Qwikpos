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

export function printHtml(html, title = "Print") {
  const w = window.open("", "_blank");
  if (!w) { toast("Popup blocked. Allow popups to print.", "error", 4000); return; }
  w.document.write(`<!doctype html><html><head><title>${escapeHtml(title)}</title><style>
    body { font-family: Arial, sans-serif; padding: 20px; margin: 0; }
    table { width: 100%; border-collapse: collapse; }
  </style></head><body>${html}</body></html>`);
  w.document.close();
  w.onload = () => { w.focus(); w.print(); w.close(); };
}

// Re-export core sales functions from POS module
export { submitSaleToSupabase } from "./uganda-pos-view-pos.js";
export { submitQuotationToSupabase } from "./uganda-pos-view-pos.js";
export { receiptHtml } from "./uganda-pos-view-pos.js";
export { printHtml as posPrintHtml } from "./uganda-pos-view-pos.js";

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
        .single(),
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
    toast("Failed to load business data — please refresh.", "error", 8000);
    return false;
  }

  STATE.business = business;
  STATE.branches = branches || [];
  STATE.branch =
    branches?.find((b) => b.id === appUser.branch_id) || branches?.[0] || null;
  STATE.currencies = currencies || [];
  STATE.categories = categories || [];
  STATE.taxCategories = taxCategories || [];
  STATE.brands = brands || [];
  STATE.units = units || [];
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
    loadSubscription().catch((e) =>
      console.warn("loadSubscription failed:", e),
    ),
  ]);
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
  const color = STATE.business?.theme_color || "#0f6b4a";
  const root = document.documentElement;
  root.style.setProperty("--brand", color);
  root.style.setProperty("--brand-dark", shadeColor(color, -20));
  root.style.setProperty("--brand-darker", shadeColor(color, -35));
  root.style.setProperty("--brand-light", color + "18");
  root.style.setProperty("--brand-lighter", color + "0a");
  root.style.setProperty("--brand-glow", color + "1e");
  const fontSize = STATE.business?.theme_font_size || "15px";
  root.style.fontSize = fontSize;
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

const EFRIS_TAX_CODE = { STD: "01", ZERO: "02", EXEMPT: "03", DEEMED: "04" };
const EFRIS_TAX_RATE = { STD: "0.18", ZERO: "0", EXEMPT: "-", DEEMED: "0.18" };

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

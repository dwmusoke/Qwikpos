// =====================================================================
// QWICKPOS — APP BOOTSTRAP (auth, router, shell wiring)
// =====================================================================
import {
  supabase,
  STATE,
  $,
  qsa,
  escapeHtml,
  toast,
  openModal,
  closeModal,
  fmtDate,
  fmtMoney,
  hasFeature,
  hasRole,
  lowStockProducts,
  loadNotifications,
  subscribeToNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  submitSaleToSupabase,
  offlineQueueCount,
  flushOfflineQueue,
  loadBootstrapData,
  isSubscriptionActive,
  applyTheme,
} from "./uganda-pos-core.js";
import { renderNotifications } from "./uganda-pos-view-notifications.js";
import { renderAuditLogs } from "./uganda-pos-view-audit.js";
import { renderNotificationsCenter } from "./uganda-pos-view-notifications-center.js";
import { renderLeads } from "./uganda-pos-view-leads.js";
import { renderDeliveries } from "./uganda-pos-view-deliveries.js";
import { renderHRM } from "./uganda-pos-view-hrm.js";
import { renderTemplateSettings } from "./uganda-pos-view-templates.js";
import { renderBackupRestore } from "./uganda-pos-view-backup.js";
import {
  getLang,
  setLang,
  getAvailableLanguages,
  translatePage,
  t,
} from "./uganda-pos-i18n.js";
import { renderDashboard } from "./uganda-pos-view-dashboard.js";
import { renderPOS } from "./uganda-pos-view-pos.js";
import { renderQuotations } from "./uganda-pos-view-quotations.js";
import { renderProductsModule } from "./uganda-pos-view-products.js";
import { renderInventory } from "./uganda-pos-view-inventory.js";
import { renderSalesModule } from "./uganda-pos-view-sales.js";
import { renderPurchasesModule } from "./uganda-pos-view-purchases.js";
import { renderCustomers } from "./uganda-pos-view-customers.js";
import { renderSuppliers } from "./uganda-pos-view-suppliers.js";
import { renderEfris } from "./uganda-pos-view-efris.js";
import { renderReports } from "./uganda-pos-view-reports.js";
import { renderAccounting } from "./uganda-pos-view-accounting.js";
import { renderSettings } from "./uganda-pos-view-settings.js";
import { renderChat } from "./uganda-pos-view-chat.js";
import { renderAdmin } from "./uganda-pos-view-admin.js";
import { renderBilling } from "./uganda-pos-view-billing.js";
import { renderCoupons } from "./uganda-pos-view-coupons.js";
import { renderOrders } from "./uganda-pos-view-orders.js";
import { renderProfile } from "./uganda-pos-view-profile.js";
import {
  initSignupScreen,
  finishPendingSignupIfAny,
} from "./uganda-pos-view-signup.js";

// ---------------------------------------------------------------------
// Service worker (offline app shell caching)
// ---------------------------------------------------------------------
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./uganda-pos-sw.js").catch(() => {});
  });
}

// ---------------------------------------------------------------------
// Routes — `feature` gates on the current plan (see uganda-pos-core.js
// hasFeature); routes with no `feature` just need an active subscription.
// ---------------------------------------------------------------------
const ROUTES = {
  dashboard: { title: "Dashboard", render: renderDashboard },
  pos: { title: "Sell (POS)", render: renderPOS },
  quotations: { title: "Quotations", render: renderQuotations },
  products: { title: "Products", render: renderProductsModule },
  inventory: { title: "Inventory", render: renderInventory },
  sales: { title: "Sales", render: renderSalesModule },
  purchases: { title: "Purchases", render: renderPurchasesModule },
  customers: { title: "Customers", render: renderCustomers },
  suppliers: { title: "Suppliers", render: renderSuppliers },
  efris: { title: "EFRIS", render: renderEfris, feature: "efris" },
  reports: {
    title: "Reports",
    render: renderReports,
    feature: "reports_export",
  },
  accounting: {
    title: "Accounting",
    render: renderAccounting,
    feature: "accounting",
  },
  settings: { title: "Settings", render: renderSettings },
  chat: { title: "Team Chat", render: renderChat },
  notifications: { title: "Notifications", render: renderNotifications },
  audit: { title: "Audit Logs", render: renderAuditLogs },
  notifications_center: {
    title: "Notifications Center",
    render: renderNotificationsCenter,
  },
  leads: { title: "Lead Management", render: renderLeads },
  deliveries: { title: "Deliveries", render: renderDeliveries },
  hrm: { title: "HRM", render: renderHRM },
  templates: { title: "Document Templates", render: renderTemplateSettings },
  backup: { title: "Backup & Restore", render: renderBackupRestore },
  coupons: { title: "Coupons & Gift Cards", render: renderCoupons },
  orders: { title: "Orders", render: renderOrders },
  profile: { title: "My Profile", render: renderProfile },
  billing: {
    title: "Billing",
    render: (root) => renderBilling(root, { paywall: false }),
  },
  admin: { title: "Platform Admin", render: renderAdmin, superadminOnly: true },
};

async function navigateTo(route) {
  if (!ROUTES[route])
    route = STATE.isSuperadmin && !STATE.business ? "admin" : "dashboard";

  // Superadmin without business: let them navigate freely (sections show empty states)

  // Everyone else needs an active trial/subscription for anything but Billing.
  if (!STATE.isSuperadmin && route !== "billing" && !isSubscriptionActive()) {
    route = "billing";
  }

  // Feature-gated routes redirect to Billing with an upsell nudge.
  const def = ROUTES[route];
  if (def?.feature && !hasFeature(def.feature)) {
    toast(`Upgrade your plan to unlock ${def.title}.`, "default", 4000);
    route = "billing";
  }

  STATE.route = route;
  $("page-title").textContent = ROUTES[route].title;
  qsa(".nav-link").forEach((l) =>
    l.classList.toggle("active", l.dataset.route === route),
  );
  closeSidebarOnMobile();
  const root = $("view-root");
  root.innerHTML = `<div class="empty-state">Loading…</div>`;
  try {
    if (route === "billing" && !STATE.isSuperadmin && !isSubscriptionActive()) {
      await renderBilling(root, { paywall: true });
    } else {
      await ROUTES[route].render(root);
    }
  } catch (e) {
    console.error("Render failed for", route, e);
    root.innerHTML = `<div class="empty-state"><span class="big-icon" style="font-size:48px;display:block;margin-bottom:12px;">⚠️</span><h3 style="margin:0 0 8px;font-size:17px;font-weight:700;">Page Error</h3><p style="color:var(--text-muted);max-width:380px;margin:0 auto;line-height:1.5;font-size:13px;">${escapeHtml(e.message || "Something went wrong")}</p></div>`;
  }
  try {
    translatePage();
  } catch (e) {
    console.error("translatePage after render failed:", e);
  }
}

function closeSidebarOnMobile() {
  $("sidebar").classList.remove("open");
  $("sidebar-backdrop").classList.remove("show");
}

// ---------------------------------------------------------------------
// Shell wiring (sidebar, topbar, theme, logout)
// ---------------------------------------------------------------------
function wireShell() {
  qsa(".nav-link").forEach((link) => {
    const route = link.dataset.route;
    const roles = link.dataset.role;
    const isSuperadminLink = link.dataset.superadmin === "true";

    if (isSuperadminLink && !STATE.isSuperadmin) {
      link.style.display = "none";
      return;
    }
    if (roles && !hasRole(...roles.split(","))) {
      link.style.display = "none";
      return;
    }

    const def = ROUTES[route];
    if (def?.feature && !hasFeature(def.feature)) {
      link.classList.add("nav-link-locked");
      link.title = "Upgrade your plan to unlock this";
    }

    link.addEventListener("click", () => navigateTo(route));
  });

  $("menu-btn").addEventListener("click", () => {
    $("sidebar").classList.add("open");
    $("sidebar-backdrop").classList.add("show");
  });
  $("sidebar-backdrop").addEventListener("click", closeSidebarOnMobile);

  $("theme-toggle").addEventListener("click", () => {
    const html = document.documentElement;
    const next = html.dataset.theme === "dark" ? "light" : "dark";
    html.dataset.theme = next;
    STATE.theme = next;
    localStorage.setItem("ugpos_theme", next);
    $("theme-toggle").textContent = next === "dark" ? "☀️" : "🌙";
  });
  document.documentElement.dataset.theme = STATE.theme;
  $("theme-toggle").textContent = STATE.theme === "dark" ? "☀️" : "🌙";

  $("logout-btn").addEventListener("click", async () => {
    await supabase.auth.signOut();
    window.location.reload();
  });

  if (!STATE.business) return; // superadmin with no vendor business — nothing currency/business-scoped to wire

  const picker = $("currency-picker");
  const currencyOptions = hasFeature("multi_currency")
    ? STATE.currencies
    : STATE.currencies.filter((c) => c.code === STATE.business.base_currency);
  picker.classList.remove("hidden");
  picker.innerHTML = currencyOptions
    .map(
      (c) =>
        `<option value="${c.code}" ${c.code === STATE.displayCurrency ? "selected" : ""}>${c.code}</option>`,
    )
    .join("");
  picker.disabled = !hasFeature("multi_currency");
  picker.title = hasFeature("multi_currency")
    ? ""
    : "Upgrade to Growth or Pro for multi-currency";
  picker.addEventListener("change", (e) => {
    STATE.displayCurrency = e.target.value;
    navigateTo(STATE.route);
  });

  // Language picker
  const langPicker = $("lang-picker");
  if (langPicker) {
    langPicker.value = getLang();
    langPicker.addEventListener("change", (e) => {
      setLang(e.target.value);
      translatePage();
      toast("Language updated", "default", 2000);
    });
  }
}

function updateLogo() {
  const logoEl = $("sidebar-logo");
  if (logoEl) {
    logoEl.src = STATE.business?.logo_url || "./uganda-pos-icon.svg";
  }
}

function populateUserChip() {
  const initials = (STATE.appUser.full_name || "U")
    .split(" ")
    .map((s) => s[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  $("user-avatar").textContent = initials;
  $("user-name").textContent = STATE.appUser.full_name;
  $("user-role").textContent = STATE.appUser.role.replace("_", " ");

  if (!STATE.business) {
    $("sidebar-business-name").textContent = "Platform Admin";
    $("sidebar-branch-name").textContent = "";
    return;
  }
  $("sidebar-business-name").textContent = STATE.business.name;
  $("sidebar-branch-name").textContent = STATE.branch?.name || "";

  const trialPill = $("trial-pill");
  trialPill.classList.remove("show", "offline-pill-danger");
  if (STATE.subscription?.status === "trialing" && isSubscriptionActive()) {
    trialPill.textContent = `🎁 Trial — ${trialDaysLeftSafe()} day(s) left`;
    trialPill.classList.add("show");
  } else if (!isSubscriptionActive()) {
    trialPill.textContent = "⚠️ Subscription inactive";
    trialPill.classList.add("show", "offline-pill-danger");
  }
}

function trialDaysLeftSafe() {
  if (!STATE.subscription?.trial_ends_at) return 0;
  const diffMs = new Date(STATE.subscription.trial_ends_at) - new Date();
  return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
}

function updateBadges() {
  if (!STATE.business) return;
  const low = lowStockProducts().length;
  const lowBadge = $("low-stock-badge");
  lowBadge.textContent = low;
  lowBadge.classList.toggle("hidden", low === 0);

  // Notification sidebar badge
  const notifBadge = $("notif-sidebar-badge");
  if (notifBadge) {
    notifBadge.textContent = STATE.unreadCount || 0;
    notifBadge.classList.toggle("hidden", !STATE.unreadCount);
  }

  supabase
    .from("efris_invoices")
    .select("id", { count: "exact", head: true })
    .eq("business_id", STATE.business.id)
    .in("status", ["pending", "queued"])
    .then(({ count }) => {
      const badge = $("efris-badge");
      badge.textContent = count || 0;
      badge.classList.toggle("hidden", !count);
    });
}

// ---------------------------------------------------------------------
// Online / offline handling
// ---------------------------------------------------------------------
function wireConnectivity() {
  const pill = $("offline-pill");
  const update = () => {
    const online = navigator.onLine;
    pill.classList.toggle("show", !online || offlineQueueCount() > 0);
    if (online && offlineQueueCount() > 0) {
      flushOfflineQueue(submitSaleToSupabase).then(() => {
        pill.classList.toggle("show", offlineQueueCount() > 0);
      });
    }
  };
  window.addEventListener("online", update);
  window.addEventListener("offline", update);
  update();
}

// ---------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------
async function wireNotifications() {
  if (!STATE.business) return;
  await loadNotifications();
  renderNotifBadge();

  const bell = $("notif-bell");
  const dropdown = $("notif-dropdown");
  const markAllBtn = $("notif-mark-all");

  bell.addEventListener("click", (e) => {
    e.stopPropagation();
    dropdown.classList.toggle("hidden");
    if (!dropdown.classList.contains("hidden")) renderNotifList();
  });

  document.addEventListener("click", (e) => {
    if (!$("notif-wrapper")?.contains(e.target)) {
      dropdown.classList.add("hidden");
    }
  });

  markAllBtn.addEventListener("click", async () => {
    await markAllNotificationsRead();
    renderNotifBadge();
    renderNotifList();
  });

  subscribeToNotifications((n) => {
    renderNotifBadge();
    renderSidebarNotifBadge();
    if (!$("notif-dropdown")?.classList.contains("hidden")) renderNotifList();
    toast(
      `${n.title}: ${n.body || ""}`,
      n.type === "error" ? "error" : "default",
      4000,
    );
  });
}

function renderNotifBadge() {
  const badge = $("notif-badge");
  if (!badge) return;
  badge.textContent = STATE.unreadCount;
  badge.classList.toggle("hidden", STATE.unreadCount === 0);
}

function renderSidebarNotifBadge() {
  const badge = $("notif-sidebar-badge");
  if (!badge) return;
  badge.textContent = STATE.unreadCount || 0;
  badge.classList.toggle("hidden", !STATE.unreadCount);
}

function renderNotifList() {
  const list = $("notif-list");
  if (!list) return;
  if (!STATE.notifications.length) {
    list.innerHTML = `<div class="empty-state" style="padding:24px">No notifications yet</div>`;
    return;
  }
  const iconMap = {
    sale: "🧾",
    stock: "📦",
    subscription: "💳",
    chat: "💬",
    error: "❌",
    warning: "⚠️",
    success: "✅",
    info: "ℹ️",
  };
  list.innerHTML = STATE.notifications
    .slice(0, 30)
    .map(
      (n) => `
    <div class="notif-item ${n.is_read ? "" : "unread"}" data-notif-id="${n.id}" data-route="${n.route || ""}">
      <div class="notif-icon">${iconMap[n.type] || "ℹ️"}</div>
      <div class="notif-body">
        <div class="notif-title">${escapeHtml(n.title)}</div>
        ${n.body ? `<div class="notif-text">${escapeHtml(n.body)}</div>` : ""}
        <div class="notif-time">${fmtDate(n.created_at)}</div>
      </div>
    </div>
  `,
    )
    .join("");

  list.querySelectorAll(".notif-item").forEach((el) => {
    el.addEventListener("click", async () => {
      const id = el.dataset.notifId;
      const route = el.dataset.route;
      await markNotificationRead(id);
      renderNotifBadge();
      el.classList.remove("unread");
      if (route) {
        $("notif-dropdown").classList.add("hidden");
        navigateTo(route);
      }
    });
  });
}

// ---------------------------------------------------------------------
// Impersonation
// ---------------------------------------------------------------------
function wireImpersonation() {
  const banner = $("impersonate-banner");
  const nameEl = $("impersonate-name");
  const stopBtn = $("impersonate-stop");

  if (window._impersonating && STATE._impersonate) {
    banner.classList.remove("hidden");
    nameEl.textContent = STATE._impersonate.targetUserId
      ? `${STATE.appUser.full_name} (${STATE.business?.name || ""})`
      : "";
  }

  stopBtn?.addEventListener("click", async () => {
    const imp = STATE._impersonate;
    if (!imp) return;

    // Restore original state
    STATE.appUser = imp.originalUser;
    STATE.business = imp.originalBusiness;
    STATE.branch = imp.originalBranch;
    STATE._impersonate = null;
    window._impersonating = false;

    // Reload full bootstrap data
    await loadBootstrapData();
    banner.classList.add("hidden");
    toast("Returned to Platform Admin", "success");
    navigateTo("admin");
  });
}

// ---------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------
function showLoginScreen() {
  $("login-screen").classList.remove("hidden");
  $("signup-screen").classList.add("hidden");
  $("reset-screen").classList.add("hidden");
  $("create-business-screen").classList.add("hidden");
  $("app-shell").classList.add("hidden");
}

function showSignupScreen() {
  $("signup-screen").classList.remove("hidden");
  $("login-screen").classList.add("hidden");
  $("reset-screen").classList.add("hidden");
  $("create-business-screen").classList.add("hidden");
  $("app-shell").classList.add("hidden");
}

function handleLandingHash() {
  const hash = window.location.hash;
  if (hash === "#signup") {
    showSignupScreen();
    window.history.replaceState(null, "", window.location.pathname);
  } else if (hash === "#login") {
    showLoginScreen();
    window.history.replaceState(null, "", window.location.pathname);
  }
}

function showCreateBusinessScreen() {
  $("login-screen").classList.add("hidden");
  $("signup-screen").classList.add("hidden");
  $("reset-screen").classList.add("hidden");
  $("create-business-screen").classList.remove("hidden");
  $("app-shell").classList.add("hidden");
}

// ---------------------------------------------------------------------
// Create Business (for users with auth but no app_users row)
// ---------------------------------------------------------------------
async function initCreateBusinessScreen() {
  const form = $("create-business-form");
  const btn = $("cb-submit");
  const errEl = $("cb-error");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errEl.style.display = "none";
    btn.disabled = true;
    btn.textContent = "Creating…";

    const businessName = $("cb-business-name").value.trim();
    const fullName = $("cb-full-name").value.trim();
    const phone = $("cb-phone").value.trim();
    const currency = $("cb-currency").value;

    if (!businessName || !fullName) {
      errEl.textContent = "Business name and your name are required.";
      errEl.style.display = "block";
      btn.disabled = false;
      btn.textContent = "Create Business & Start Trial";
      return;
    }

    try {
      const { data: plan } = await supabase
        .from("plans")
        .select("*")
        .eq("code", "starter")
        .eq("is_active", true)
        .single();

      if (!plan) throw new Error("Starter plan not found");

      // Create business
      const { data: business, error: bizErr } = await supabase
        .from("businesses")
        .insert({
          name: businessName,
          base_currency: currency,
          primary_phone: phone || null,
        })
        .select()
        .single();

      if (bizErr) throw bizErr;

      // Create default branch
      const { data: branch, error: branchErr } = await supabase
        .from("branches")
        .insert({ business_id: business.id, name: "Main Branch" })
        .select()
        .single();

      if (branchErr) throw branchErr;

      // Link current auth user to the business as admin
      const { error: userErr } = await supabase.from("app_users").insert({
        id: STATE.session.user.id,
        business_id: business.id,
        branch_id: branch.id,
        full_name: fullName,
        phone: phone || null,
        role: "admin",
        is_active: true,
      });

      if (userErr) throw userErr;

      // Create subscription (14-day trial)
      const trialEnds = new Date();
      trialEnds.setDate(trialEnds.getDate() + 14);
      const { error: subErr } = await supabase.from("subscriptions").insert({
        business_id: business.id,
        plan_id: plan.id,
        status: "trialing",
        trial_ends_at: trialEnds.toISOString(),
        current_period_end: trialEnds.toISOString(),
      });

      if (subErr) throw subErr;

      toast("Business created! Starting your 14-day trial…", "success", 4000);
      await boot();
    } catch (err) {
      console.error("Create business failed:", err);
      errEl.textContent = err.message || "Failed to create business";
      errEl.style.display = "block";
      btn.disabled = false;
      btn.textContent = "Create Business & Start Trial";
    }
  });
}

async function boot() {
  let ok = await loadBootstrapData();

  // Session exists but no app_users row yet — most likely this device just
  // confirmed its email after signing up. Finish creating the business now.
  if (!ok && STATE.session) {
    const result = await finishPendingSignupIfAny();
    if (result.ok && !result.skipped) {
      ok = await loadBootstrapData();
    } else if (result.skipped) {
      // No pending signup data (e.g., password reset user) — show create business screen
      showCreateBusinessScreen();
      return;
    }
  }

  if (!ok) {
    console.warn(
      "boot(): loadBootstrapData returned false — showing login screen. Session exists:",
      !!STATE.session,
    );
    showLoginScreen();
    handleLandingHash();
    return;
  }

  $("login-screen").classList.add("hidden");
  $("signup-screen").classList.add("hidden");
  $("app-shell").classList.remove("hidden");
  try { applyTheme(); } catch (e) { console.error("applyTheme:", e); }
  try {
    wireShell();
  } catch (e) {
    console.error("wireShell failed:", e);
  }
  try {
    translatePage();
  } catch (e) {
    console.error("translatePage failed:", e);
  }
  try {
    populateUserChip();
  } catch (e) {
    console.error("populateUserChip failed:", e);
  }
  try { updateLogo(); } catch (e) { console.error("updateLogo:", e); }
  try {
    updateBadges();
  } catch (e) {
    console.error("updateBadges failed:", e);
  }
  try {
    wireConnectivity();
  } catch (e) {
    console.error("wireConnectivity failed:", e);
  }
  try {
    await wireNotifications();
  } catch (e) {
    console.error("wireNotifications failed:", e);
  }
  try {
    wireImpersonation();
  } catch (e) {
    console.error("wireImpersonation failed:", e);
  }

  if (STATE.isSuperadmin && !STATE.business) {
    navigateTo("admin");
  } else {
    navigateTo(isSubscriptionActive() ? "dashboard" : "billing");
  }
}

$("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("login-email").value.trim();
  const password = $("login-password").value;
  const btn = $("login-submit");
  const errEl = $("login-error");
  errEl.style.display = "none";
  btn.disabled = true;
  btn.textContent = "Signing in…";

  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    btn.disabled = false;
    btn.textContent = "Sign In";
    errEl.textContent = error.message;
    errEl.style.display = "block";
    return;
  }

  try {
    await boot();
  } catch (err) {
    console.error("Boot failed:", err);
    btn.disabled = false;
    btn.textContent = "Sign In";
    errEl.textContent =
      "Failed to load the application: " + (err.message || "Unknown error");
    errEl.style.display = "block";
  }

  // If boot() returned but we're still on the login screen, something
  // failed silently (e.g. no app_users row). Show a visible message.
  if (!$("login-screen").classList.contains("hidden")) {
    btn.disabled = false;
    btn.textContent = "Sign In";
    if (!errEl.textContent || errEl.textContent === "") {
      errEl.innerHTML =
        "Login succeeded but could not load your account.<br><br>" +
        "Possible fix: <b>Run schema SQL files</b> (v1–v8) in the Supabase SQL Editor to ensure all tables and RLS policies exist.<br><br>" +
        "If this is a new account, make sure <b>email confirmation is disabled</b> in Supabase Auth settings.";
      errEl.style.display = "block";
    }
  }
});

$("show-signup-link")?.addEventListener("click", (e) => {
  e.preventDefault();
  $("login-screen").classList.add("hidden");
  $("signup-screen").classList.remove("hidden");
});
$("show-login-link")?.addEventListener("click", (e) => {
  e.preventDefault();
  $("signup-screen").classList.add("hidden");
  $("login-screen").classList.remove("hidden");
});

// ---------------------------------------------------------------------
// Forgot / Reset Password
// ---------------------------------------------------------------------
$("show-forgot-link")?.addEventListener("click", (e) => {
  e.preventDefault();
  $("login-screen").classList.add("hidden");
  $("reset-screen").classList.remove("hidden");
});

$("show-login-from-reset")?.addEventListener("click", (e) => {
  e.preventDefault();
  $("reset-screen").classList.add("hidden");
  $("login-screen").classList.remove("hidden");
});

$("reset-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("reset-email").value.trim();
  const btn = $("reset-submit");
  const errEl = $("reset-error");
  const successEl = $("reset-success");
  errEl.style.display = "none";
  successEl.style.display = "none";

  if (!email) {
    errEl.textContent = "Please enter your email address.";
    errEl.style.display = "block";
    return;
  }

  btn.disabled = true;
  btn.textContent = "Sending…";

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin,
  });

  btn.disabled = false;
  btn.textContent = "Send Reset Link";

  if (error) {
    errEl.textContent = error.message;
    errEl.style.display = "block";
  } else {
    successEl.textContent = "Password reset link sent! Check your email inbox.";
    successEl.style.display = "block";
    $("reset-email").value = "";
  }
});

// ---------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------
// Handle Supabase password recovery redirect (hash contains access_token & type=recovery)
const hash = window.location.hash;
if (hash && hash.includes("type=recovery")) {
  // Supabase client processes the hash automatically.
  // Show a simple prompt for the new password.
  $("login-screen").classList.add("hidden");
  $("app-shell").classList.add("hidden");

  const resetCard = document.createElement("div");
  resetCard.className = "login-wrap";
  resetCard.innerHTML = `
    <div class="login-card">
      <div class="flag-strip"></div>
      <div class="login-logo">
        <img src="./uganda-pos-icon.svg" alt="Qwickpos" />
        <h1>Set New Password</h1>
        <p>Enter your new password below.</p>
      </div>
      <form id="recovery-form">
        <div class="field">
          <label for="recovery-password">New Password</label>
          <input id="recovery-password" type="password" required placeholder="At least 6 characters" minlength="6" />
        </div>
        <div class="field">
          <label for="recovery-password2">Confirm Password</label>
          <input id="recovery-password2" type="password" required placeholder="Repeat password" minlength="6" />
        </div>
        <button class="btn btn-primary btn-block" type="submit" id="recovery-submit">Set Password</button>
        <p id="recovery-error" class="help-text" style="color:var(--danger);display:none;margin-top:10px"></p>
        <p id="recovery-success" class="help-text" style="color:var(--success);display:none;margin-top:10px"></p>
      </form>
    </div>
  `;
  document.body.appendChild(resetCard);

  $("recovery-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const pw = $("recovery-password").value;
    const pw2 = $("recovery-password2").value;
    const errEl = $("recovery-error");
    const successEl = $("recovery-success");
    errEl.style.display = "none";
    successEl.style.display = "none";

    if (pw.length < 6) {
      errEl.textContent = "Password must be at least 6 characters.";
      errEl.style.display = "block";
      return;
    }
    if (pw !== pw2) {
      errEl.textContent = "Passwords do not match.";
      errEl.style.display = "block";
      return;
    }

    $("recovery-submit").disabled = true;
    $("recovery-submit").textContent = "Saving…";

    const { error } = await supabase.auth.updateUser({ password: pw });

    if (error) {
      $("recovery-submit").disabled = false;
      $("recovery-submit").textContent = "Set Password";
      errEl.textContent = error.message;
      errEl.style.display = "block";
    } else {
      successEl.textContent = "Password updated! Redirecting to login…";
      successEl.style.display = "block";
      window.history.replaceState(null, "", window.location.pathname);
      setTimeout(() => {
        resetCard.remove();
        showLoginScreen();
      }, 2000);
    }
  });
} else {
  const h = window.location.hash;
  if (h !== "#signup" && h !== "#login") {
    window.history.replaceState(null, "", window.location.pathname);
  }
}

initSignupScreen().catch((e) => console.error("initSignupScreen:", e));
initCreateBusinessScreen();
boot().catch((err) => {
  console.error("Auto-boot failed:", err);
  showLoginScreen();
});
setTimeout(() => {
  const splash = document.getElementById("splash-screen");
  if (splash) { splash.classList.add("fade-out"); setTimeout(() => splash.remove(), 600); }
}, 1000);

window.__qwickposReady && window.__qwickposReady();

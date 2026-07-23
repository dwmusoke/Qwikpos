// =====================================================================
// QWICKPOS — APP BOOTSTRAP (auth, router, shell wiring)
// =====================================================================
import {
  supabase,
  STATE,
  $,
  qsa,
  toast,
  loadBootstrapData,
  hasRole,
  hasFeature,
  isSubscriptionActive,
  lowStockProducts,
  offlineQueueCount,
  flushOfflineQueue,
  loadNotifications,
  subscribeToNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  escapeHtml,
  fmtDate,
} from "./uganda-pos-core.js";
import { renderDashboard } from "./uganda-pos-view-dashboard.js";
import { renderPOS, submitSaleToSupabase } from "./uganda-pos-view-pos.js";
import { renderQuotations } from "./uganda-pos-view-quotations.js";
import { renderInventory } from "./uganda-pos-view-inventory.js";
import { renderCustomers } from "./uganda-pos-view-customers.js";
import { renderSuppliers } from "./uganda-pos-view-suppliers.js";
import { renderEfris } from "./uganda-pos-view-efris.js";
import { renderReports } from "./uganda-pos-view-reports.js";
import { renderAccounting } from "./uganda-pos-view-accounting.js";
import { renderSettings } from "./uganda-pos-view-settings.js";
import { renderBilling } from "./uganda-pos-view-billing.js";
import { renderAdmin } from "./uganda-pos-view-admin.js";
import { renderChat } from "./uganda-pos-view-chat.js";
import { renderNotifications } from "./uganda-pos-view-notifications.js";
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
  inventory: { title: "Inventory", render: renderInventory },
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
  billing: {
    title: "Billing",
    render: (root) => renderBilling(root, { paywall: false }),
  },
  admin: { title: "Platform Admin", render: renderAdmin, superadminOnly: true },
};

async function navigateTo(route) {
  if (!ROUTES[route])
    route = STATE.isSuperadmin && !STATE.business ? "admin" : "dashboard";

  // Superadmins with no vendor business of their own can only see the admin console.
  if (STATE.isSuperadmin && !STATE.business && route !== "admin")
    route = "admin";

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
    console.error(e);
    root.innerHTML = `<div class="empty-state">Something went wrong loading this page. Check the console for details.</div>`;
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

    // A superadmin with no vendor business of their own only needs the admin console.
    if (STATE.isSuperadmin && !STATE.business && route !== "admin") {
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
  $("app-shell").classList.add("hidden");
}

async function boot() {
  let ok = await loadBootstrapData();

  // Session exists but no app_users row yet — most likely this device just
  // confirmed its email after signing up. Finish creating the business now.
  if (!ok && STATE.session) {
    const result = await finishPendingSignupIfAny();
    if (result.ok && !result.skipped) {
      ok = await loadBootstrapData();
    }
  }

  if (!ok) {
    showLoginScreen();
    return;
  }

  $("login-screen").classList.add("hidden");
  $("signup-screen").classList.add("hidden");
  $("app-shell").classList.remove("hidden");
  try {
    wireShell();
  } catch (e) {
    console.error("wireShell failed:", e);
  }
  try {
    populateUserChip();
  } catch (e) {
    console.error("populateUserChip failed:", e);
  }
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
// Init
// ---------------------------------------------------------------------
if (window.location.hash || window.location.search) {
  window.history.replaceState(null, "", window.location.pathname);
}
initSignupScreen();
boot().catch((err) => {
  console.error("Auto-boot failed:", err);
  showLoginScreen();
});
